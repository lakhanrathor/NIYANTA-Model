"""GEE watch job handlers — live Earth Engine + offline fallbacks (MODULE_SPEC 4.7).

Source chain per kind: live EE fetch (`modules.gee.live`) → local single-band
raster (Otsu) → labelled simulation. Live failures are logged and fall back —
`compute()` never raises on fetch problems, so the daily sweep always finishes.
Real math either way: Otsu thresholding → water area → `gee.flag_change`
(delta vs rolling baseline). Flagged changes run the Flow A chain: f₂ risk →
case-2 scenario → execute → alert.
"""

from __future__ import annotations

import json
from datetime import date as date_cls
from typing import Any

from loguru import logger

from modules.db import client as db
from modules.gee import flag_change, live, run_daily, save_observation

SENSOR_FOR_KIND = {"s2_indices": "sentinel2", "s1_watermask": "sentinel1",
                   "lst_snow": "lst", "flood_extent": "sentinel1",
                   "seismic_sync": "seismic", "glacier_ice": "sentinel2"}

# live fetcher per kind (all same-day cached inside modules.gee.live)
_LIVE_KINDS = {"s2_indices": live.s2_water, "s1_watermask": live.s1_water,
               "flood_extent": live.flood, "lst_snow": live.lst,
               "glacier_ice": live.glacier}

# change_detection baselines are per (sensor, change kind) — keep kinds distinct
_CHANGE_KIND = {"s2_indices": "lake_area", "lst_snow": "snow",
                "flood_extent": "flood", "glacier_ice": "glacier"}

_OBS_KIND = {"s2_indices": "indices", "lst_snow": "lst", "glacier_ice": "indices"}

# kinds with a downloadable crop → SAM boundary refinement (modules.seg)
_SAM_KINDS = ("s2_indices", "glacier_ice")


def register() -> None:
    from modules.jobs import queue as jobs

    jobs.register("gee.daily", handle_daily)


def handle_daily(ctx: Any) -> dict:
    from concurrent.futures import ThreadPoolExecutor

    enqueued = run_daily()
    if not enqueued:
        ctx.progress(100, "gee: nothing new (all boxes swept today)")
        return {"enqueued": 0, "flagged": 0, "results": []}

    def one(row: dict) -> dict:
        try:
            return process_gee_job(str(row["id"]), ctx)
        except Exception as exc:  # noqa: BLE001 - one box must not sink the sweep
            logger.error("gee job {} failed: {}", row["id"], exc)
            return {"error": f"{type(exc).__name__}: {exc}", "flagged": False}

    # live EE fetches are network-bound; sweep boxes in parallel (each kind's
    # same-day cache is process-local, and DB conns are held only for the
    # short statement calls inside process_gee_job)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, enqueued))
    ctx.progress(100, f"gee: {len(results)} jobs processed")
    return {"enqueued": len(enqueued),
            "flagged": sum(1 for r in results if r.get("flagged")),
            "results": results}


def process_gee_job(job_id: str, ctx: Any | None = None) -> dict:
    job = db.query_one("SELECT * FROM gee_job WHERE id = %s", (job_id,))
    if not job:
        raise ValueError(f"gee_job {job_id} not found")
    box = db.query_one("SELECT * FROM watch_box WHERE id = %s", (job["box_id"],))
    if not box:
        # box deleted while the sweep was in flight (tests clean up mid-run)
        raise ValueError(f"watch box {job['box_id']} no longer exists")
    db.execute("UPDATE gee_job SET status = 'running', started = now() WHERE id = %s", (job_id,))
    try:
        if job["kind"] == "seismic_sync":
            result = _seismic_sync(box)
        else:
            result = compute(job["kind"], box, job["params"] or {})
        db.execute("UPDATE gee_job SET status = 'done', result = %s::jsonb, finished = now() "
                   "WHERE id = %s", (json.dumps(result), job_id))
        return result
    except Exception as exc:
        db.execute("UPDATE gee_job SET status = 'failed', error = %s, finished = now() "
                   "WHERE id = %s", (f"{type(exc).__name__}: {exc}", job_id))
        raise


def compute(kind: str, box: dict, params: dict | None = None) -> dict[str, Any]:
    """Run change detection for one kind on a box; returns job result payload."""
    from modules.risk import event as risk_event  # noqa: PLC0415

    params = params or {}
    sensor = SENSOR_FOR_KIND.get(kind, "sentinel1")
    water_mask_path = None
    live_metrics = None
    if kind in _LIVE_KINDS:
        try:
            live_metrics = _LIVE_KINDS[kind](box)
        except Exception as exc:  # noqa: BLE001 - live is best effort, sweep must finish
            logger.warning("gee live fetch failed for {} box {}: {}", kind, box["id"], exc)

    if live_metrics is not None:
        source, simulated = "gee", False
        water_area = float(live_metrics.get("area_km2") or 0.0)
        water_mask_path = live_metrics.get("path")
    else:
        raster = _find_local_raster(box, sensor)
        if raster is None:
            source, simulated = "simulation", True
            water_area = _simulate_area(box, kind, params)
        else:
            source, simulated = "local_raster", False
            water_area, water_mask_path = _water_area_from_raster(raster)

    obs = save_observation(str(box["id"]), sensor, _OBS_KIND.get(kind, "water_mask"),
                           {"water_area_km2": water_area, "simulated": simulated,
                            "source": source, "path": water_mask_path, "kind": kind})
    change_kind = _CHANGE_KIND.get(kind, "water_mask")
    metrics: dict[str, Any] = {}
    if live_metrics is not None:
        metrics.update({k: v for k, v in live_metrics.items() if k != "path"})
    elif kind == "lst_snow":
        import numpy as np

        metrics["anomaly_c"] = round(float(np.random.default_rng(7).normal(2.5, 1.5)), 1)
    elif kind == "s2_indices":
        import numpy as np

        metrics["ndwi_mean"] = round(float(np.random.default_rng(11).uniform(0.1, 0.6)), 3)
    metrics.update({"area_km2": round(water_area, 3), "sensor": sensor,
                    "simulated": simulated, "source": source})
    if kind in _SAM_KINDS and water_mask_path:
        refined = _sam_refine(water_mask_path, kind)
        if refined:
            metrics["sam"] = refined
    change = flag_change(str(box["id"]), change_kind, metrics, str(obs["id"]))

    out: dict[str, Any] = {"water_area_km2": metrics["area_km2"],
                           "flagged": bool(change["flagged"]),
                           "change_id": str(change["id"]),
                           "observation_id": str(obs["id"]), "simulated": simulated,
                           "source": source,
                           "scenario_id": None, "run_id": None, "risk_id": None}
    if not change["flagged"]:
        return out

    # Flow A: flagged → f₂ risk → scenario → execute → alert
    try:
        scored = risk_event.assess(str(box["id"]))
        out["risk_id"] = str(scored["risk"]["id"])
        cls = scored["detail"]["class"]
        if cls in ("HIGH", "CRITICAL"):
            from modules.alert import rules as alert_rules  # noqa: PLC0415
            from modules.run import execute as run_execute  # noqa: PLC0415
            from modules.scenario import builders  # noqa: PLC0415

            scenario = builders.from_event(str(change["id"]), auto_execute=False)["scenario"]
            run = run_execute.create_run(str(scenario["id"]))
            run_execute.execute(str(run["id"]))
            out["scenario_id"] = str(scenario["id"])
            out["run_id"] = str(run["id"])
            alert = alert_rules.create(
                "CRITICAL" if cls == "CRITICAL" else "WARNING",
                f"Watch '{box['name']}': flagged {change_kind} (+{metrics.get('delta_pct', 0)}%)",
                f"f₂ score {scored['detail']['score']} → auto scenario launched",
                source="gee",
                payload={"box_id": str(box["id"]), "change_id": str(change["id"]),
                         "run_id": str(run["id"]), "class": cls},
            )
            out["alert_id"] = str(alert["id"])
        out["risk_class"] = cls
    except Exception as exc:  # noqa: BLE001 - automation must not lose the detection row
        out["chain_error"] = f"{type(exc).__name__}: {exc}"
    return out


def _seismic_sync(box: dict | None) -> dict:
    from modules import connector  # noqa: PLC0415

    counts = connector.sync("seismic")["counts"]
    return {"seismic": counts, "offline": True}


def _sam_refine(tif_path: str, kind: str) -> dict | None:
    """SAM boundary refinement over the crop: spectral seeds → object mask."""
    from pathlib import Path

    import numpy as np
    import rasterio

    from modules.seg import sam as seg_sam  # noqa: PLC0415
    from modules.storage import paths  # noqa: PLC0415

    fp = Path(tif_path)
    if not fp.is_absolute():
        fp = paths.ROOT / fp
    if not fp.exists():
        return None
    try:
        with rasterio.open(fp) as ds:
            rgb = np.transpose(ds.read((1, 2, 3)), (1, 2, 0)).astype(float)
    except Exception as exc:  # noqa: BLE001 - corrupt/partial crop → skip refinement
        logger.warning("sam refine: unreadable crop {} ({}); skipping", fp, exc)
        try:
            fp.unlink()
        except OSError:
            pass
        return None
    if kind == "glacier_ice":
        # crop saved as (B3, B11, B4): NDSI = (green − SWIR)/(green + SWIR)
        idx = (rgb[..., 0] - rgb[..., 1]) / (rgb[..., 0] + rgb[..., 1] + 1e-6)
    else:
        # crop saved as (B4, B3, B2): blue−red separates water from vegetation
        idx = (rgb[..., 2] - rgb[..., 0]) / (rgb[..., 2] + rgb[..., 0] + 1e-6)
    finite = idx[np.isfinite(idx)]
    if finite.size == 0:
        return None
    # high-precision prompts: top-1% of the index beats plain Otsu here —
    # loose seeds (tens of % of image) make SAM segment "everything"
    hi = max(_otsu(finite), float(np.quantile(finite, 0.99)))
    if kind == "glacier_ice":
        hi = max(hi, 0.2)  # physical snow/ice minimum, mirrors live.glacier
    seeds = idx > hi
    if not seeds.any() or seeds.all():
        return None
    return seg_sam.refine(str(fp), seeds)


def _envelope(g: Any) -> tuple[float, float, float, float] | None:
    """(west, south, east, north) of a GeoJSON polygon, or None."""
    if not g:
        return None
    obj = json.loads(g) if isinstance(g, (str, bytes, bytearray)) else g
    xs: list[float] = []
    ys: list[float] = []

    def walk(c: Any) -> None:
        if isinstance(c, (list, tuple)):
            if c and isinstance(c[0], (int, float)):
                xs.append(float(c[0]))
                ys.append(float(c[1]))
            else:
                for item in c:
                    walk(item)

    walk(obj.get("coordinates"))
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _find_local_raster(box: dict, sensor: str) -> str | None:
    """Raster product whose dataset bbox intersects the watch box."""
    box_env = _envelope(
        db.query_one("SELECT bbox FROM watch_box WHERE id = %s", (box["id"],))["bbox"]
    )
    if box_env is None:
        return None
    rows = db.query(
        """SELECT p.path, d.bbox FROM product p JOIN dataset d ON d.id = p.dataset_id
           WHERE p.path IS NOT NULL AND p.path <> ''
           ORDER BY d.created DESC"""
    )
    bw, bs, be, bn = box_env
    for row in rows:
        env = _envelope(row["bbox"])
        if env is None:
            continue
        w, s, e, n = env
        if w <= be and e >= bw and s <= bn and n >= bs:
            return row["path"]
    return None


def _water_area_from_raster(path: str) -> tuple[float, str | None]:
    """Otsu threshold of a single-band GeoTIFF → water area (km²)."""
    from pathlib import Path

    import numpy as np
    import rasterio

    fp = Path(path)
    if not fp.exists():
        return _simulate_area_raw(path, {}), None
    with rasterio.open(fp) as ds:
        arr = ds.read(1, masked=True)
        data = np.asarray(arr.filled(np.nan), dtype=float)
        finite = data[np.isfinite(data)]
        if finite.size == 0:
            return 0.0, None
        thr = _otsu(finite)
        water = data <= thr
        px_area = abs(ds.transform.a * ds.transform.e)
        area_km2 = float(np.count_nonzero(water)) * px_area / 1e6
        return area_km2, None


def _simulate_area(box: dict, kind: str, params: dict) -> float:
    day = params.get("date") or date_cls.today().isoformat()
    return _simulate_area_raw(f"{box['id']}|{kind}|{day}", {"kind": kind})


def _simulate_area_raw(seed_src: Any, params: dict) -> float:
    import hashlib

    import numpy as np

    digest = hashlib.md5(f"{seed_src}|{params.get('kind')}".encode()).digest()
    seed = int.from_bytes(digest[:4], "big")  # stable across processes (no hash randomization)
    rng = np.random.default_rng(seed)
    base = float(rng.uniform(4.0, 40.0))
    drift = float(rng.uniform(-0.3, 0.45))
    return round(base * (1.0 + drift), 3)


def _otsu(values) -> float:
    import numpy as np

    hist, bin_edges = np.histogram(values, bins=64)
    hist = hist.astype(float)
    total = hist.sum()
    sum_all = np.dot(hist, (bin_edges[:-1] + bin_edges[1:]) / 2)
    sum_b = 0.0
    w_b = 0.0
    best, best_thr = -1.0, bin_edges[1]
    for i in range(len(hist)):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += hist[i] * (bin_edges[i] + bin_edges[i + 1]) / 2
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best:
            best, best_thr = var, bin_edges[i + 1]
    return float(best_thr)
