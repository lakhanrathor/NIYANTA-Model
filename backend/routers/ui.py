"""UI facade: the aggregate endpoints the frontend reads (docs/API_CONTRACT.md).

Every helper here degrades to an honest null / empty state when the underlying
row is missing. Nothing in this module invents a number.
"""

from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from loguru import logger

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs import queue as jobs
from modules.run import stages as run_stages
from modules.storage import paths
from .tiles import sample_point

router = APIRouter(tags=["ui"])

DEPTH_RAMP = [
    {"v": 0, "label": "0", "color": "#eaf3fb"},
    {"v": 0.5, "label": "0.5", "color": "#9ec9ee"},
    {"v": 1, "label": "1", "color": "#4a9bd8"},
    {"v": 2, "label": "2", "color": "#1f6fb2"},
    {"v": 5, "label": "5", "color": "#0d4a86"},
    {"v": 10, "label": "10", "color": "#5b2a86"},
    {"v": 20, "label": "20+", "color": "#3a1560"},
]
ARRIVAL_RAMP = [
    {"v": 24, "label": ">24 h", "color": "#c9dcf0"},
    {"v": 12, "label": "12–24 h", "color": "#7fb4de"},
    {"v": 6, "label": "6–12 h", "color": "#4a9bd8"},
    {"v": 3, "label": "3–6 h", "color": "#1f6fb2"},
    {"v": 1, "label": "1–3 h", "color": "#0d4a86"},
    {"v": 0, "label": "<1 h", "color": "#5b2a86"},
]
EXTENT_RAMP = [
    {"v": 1, "label": "SPH Extent", "color": "#4a9bd8"},
    {"v": 2, "label": "Delft3D Extent", "color": "#b42318"},
    {"v": 3, "label": "Overlap", "color": "#6b3fa0"},
]
DIFF_RAMP = [
    {"v": 5, "label": ">+5", "color": "#b42318"},
    {"v": 2, "label": "+2", "color": "#e07a5f"},
    {"v": 1, "label": "+1", "color": "#f0c9b8"},
    {"v": 0, "label": "0", "color": "#f4f5f7"},
    {"v": -1, "label": "−1", "color": "#c3dcf2"},
    {"v": -2, "label": "−2", "color": "#4a9bd8"},
    {"v": -5, "label": "<−5", "color": "#0d4a86"},
]
VELOCITY_RAMP = [
    {"v": 0, "label": "0", "color": "#eaf3fb"},
    {"v": 1, "label": "1", "color": "#9ec9ee"},
    {"v": 2, "label": "2", "color": "#4a9bd8"},
    {"v": 4, "label": "4", "color": "#1f6fb2"},
    {"v": 6, "label": "6+", "color": "#0d4a86"},
]
RAMPS: dict[str, list[dict[str, Any]]] = {
    "depth": DEPTH_RAMP,
    "arrival": ARRIVAL_RAMP,
    "velocity": VELOCITY_RAMP,
    "extent": EXTENT_RAMP,
    "difference": DIFF_RAMP,
}
KIND_LABEL = {"depth": "Water Depth (m)", "arrival": "Arrival Time",
              "velocity": "Velocity (m/s)", "extent": "Inundation Extent",
              "difference": "Depth Difference (m)"}

# Bottom status bar sources (docs/UI_SPEC.md §Global chrome).
SOURCES = [
    {"id": "esri", "label": "Esri World Imagery", "state": "online"},
    {"id": "sentinel2", "label": "Sentinel-2 (GEE)", "state": "online"},
    {"id": "dem", "label": "DEM (Copernicus 30m)", "state": "online"},
    {"id": "hydrorivers", "label": "HydroRIVERS", "state": "local"},
    {"id": "dams", "label": "GeoDAR/GRanD/CWC", "state": "local"},
    {"id": "osm", "label": "OSM / WorldPop", "state": "local"},
]

LAYER_DEFS = [
    {"id": "esri", "group": "base", "label": "Esri World Imagery", "source": "Esri", "enabled": True},
    {"id": "s2", "group": "base", "label": "Sentinel-2 (Local)", "source": "Copernicus", "enabled": False},
    {"id": "rivers", "group": "overlay", "label": "Rivers (HydroRIVERS)", "source": "HydroRIVERS", "enabled": True},
    {"id": "dams", "group": "overlay", "label": "Dams (GeoDAR/GRanD/CWC)", "source": "GeoDAR / GRanD / CWC", "enabled": True},
    {"id": "state", "group": "overlay", "label": "State Boundary", "source": "Survey of India (OSM)", "enabled": True},
    {"id": "boxes", "group": "overlay", "label": "Watch Boxes", "source": "NIYANTA", "enabled": True},
]


# ------------------------------------------------------------------ system
@router.get("/system")
def system() -> dict:
    row = db.query_one("SELECT max(updated) AS ts FROM app_setting")
    updated = row["ts"] if row else None
    if isinstance(updated, str):
        # SQLite stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' (UTC).
        updated = f"{updated.replace(' ', 'T')}Z" if len(updated) == 19 else updated
    elif updated is not None:
        updated = updated.isoformat()
    return {
        "region": "India",
        "epsg": "EPSG:4326",
        "updated_at": updated,
        "sources": SOURCES,
    }


@router.get("/layers")
def layers() -> list[dict]:
    return LAYER_DEFS


@router.get("/settings")
def get_settings() -> dict:
    rows = db.query("SELECT key, value FROM app_setting")
    out: dict[str, Any] = {}
    for r in rows:
        v = r["value"]
        out[r["key"]] = v
    return out


@router.put("/settings/{key}")
def put_setting(key: str, body: dict) -> dict:
    value = body.get("value")
    db.execute(
        "INSERT INTO app_setting (key, value) VALUES (%s, %s::jsonb) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()",
        (key, json.dumps(value)),
    )
    return {"ok": True, "key": key}


@router.get("/jobs")
def list_jobs(limit: int = Query(100, ge=1, le=500)) -> list[dict]:
    rows = db.query(
        "SELECT id, type, status, priority, progress, params, run_id, error, attempts, "
        "created, updated FROM job ORDER BY created DESC LIMIT %s",
        (limit,),
    )
    for r in rows:
        r["id"] = str(r["id"])
        r["run_id"] = str(r["run_id"]) if r.get("run_id") else None
    return rows


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    row = db.query_one("SELECT id FROM job WHERE id = %s", (job_id,))
    if not row:
        raise HTTPException(404, "job not found")
    db.execute(
        "UPDATE job SET status = 'cancelled', updated = now() "
        "WHERE id = %s AND status IN ('queued','running')",
        (job_id,),
    )
    return {"ok": True}


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: str) -> dict:
    """Stop a job between units of work, keeping its partial download."""
    row = db.query_one("SELECT id FROM job WHERE id = %s", (job_id,))
    if not row:
        raise HTTPException(404, "job not found")
    from modules.jobs import queue as jobs  # noqa: PLC0415
    return {"ok": jobs.pause(job_id)}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: str) -> dict:
    """Re-queue a paused job; the download continues from its `.part` file."""
    row = db.query_one("SELECT id FROM job WHERE id = %s", (job_id,))
    if not row:
        raise HTTPException(404, "job not found")
    from modules.jobs import queue as jobs  # noqa: PLC0415
    return {"ok": jobs.resume(job_id)}


# ------------------------------------------------------------------ stats
@router.get("/stats/featured-rivers")
def featured_rivers(limit: int = Query(6, ge=1, le=50)) -> list[dict]:
    from routers.discover import RIVER_COLS  # noqa: PLC0415
    from modules import discover  # noqa: PLC0415

    rows = db.query(
        f"SELECT {RIVER_COLS} FROM river ORDER BY rank NULLS LAST, "
        "length_km DESC NULLS LAST LIMIT %s",
        (limit,),
    )
    return [discover.shape_river(r) for r in rows]


# ------------------------------------------------------------------- dams
def _shape_dam(r: dict[str, Any]) -> dict[str, Any]:
    out = dict(r)
    out["id"] = str(r["id"])
    out["river_id"] = str(r["river_id"]) if r.get("river_id") else None
    out["dataset_id"] = str(r["dataset_id"]) if r.get("dataset_id") else None
    out["river_name"] = r.get("river")
    out["capacity_mcm"] = r.get("storage_mcm")
    out["length_m"] = r.get("crest_length_m")
    out["status"] = "in_db"
    out["cwc_id"] = (r.get("meta") or {}).get("cwc_id") or (r.get("meta") or {}).get("id")
    out["source"] = r.get("registry_source")
    out.pop("location", None)
    return out


@router.get("/dams")
def list_dams(limit: int = 200) -> list[dict]:
    rows = db.query(
        "SELECT d.*, ST_X(d.location) AS lon, ST_Y(d.location) AS lat FROM dam d "
        "ORDER BY d.name LIMIT %s",
        (max(1, min(limit, 5000)),),
    )
    return [_shape_dam(r) for r in rows]


@router.get("/dams/{dam_id}")
def get_dam(dam_id: str) -> dict:
    r = db.query_one(
        "SELECT d.*, ST_X(d.location) AS lon, ST_Y(d.location) AS lat FROM dam d WHERE d.id = %s",
        (dam_id,),
    )
    if not r:
        raise HTTPException(404, "dam not found")
    return _shape_dam(r)


@router.post("/dams")
def create_dam(body: dict) -> dict:
    """Analyst-added dam point (Discover → Build flow): name + lon/lat are
    required; every unrecorded attribute stays NULL rather than guessed.
    Stored exactly like registry rows (GeoJSON text) so the spatial dam
    queries keep working unchanged."""
    name = (body.get("name") or "").strip()
    try:
        lon = float(body.get("lon"))
        lat = float(body.get("lat"))
    except (TypeError, ValueError):
        raise HTTPException(422, "name, lon and lat are required") from None
    if not name:
        raise HTTPException(422, "name, lon and lat are required")
    if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        raise HTTPException(422, "lon/lat out of range")

    def num(key: str) -> float | None:
        v = body.get(key)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            raise HTTPException(422, f"{key} must be a number") from None

    row = db.insert("dam", {
        "name": name,
        "river": body.get("river"),
        "river_id": body.get("river_id"),
        "state": body.get("state"),
        "country": body.get("country") or "IN",
        "location": json.dumps({"type": "Point", "coordinates": [lon, lat]}),
        "dam_type": body.get("dam_type"),
        "crest_m": num("crest_m"),
        "height_m": num("height_m"),
        "fsl_m": num("fsl_m"),
        "storage_mcm": num("storage_mcm"),
        "crest_length_m": num("crest_length_m"),
        "purpose": body.get("purpose"),
        "registry_source": body.get("registry_source") or "manual",
        "ingest_status": "complete",
    })
    return get_dam(str(row["id"]))


@router.get("/dams/{dam_id}/image")
def dam_image(dam_id: str) -> dict:
    """Dam photo: local registry image if cached, else the stored URL, else null.

    Never proxies an unverified URL — the UI shows its placeholder instead.
    """
    r = db.query_one("SELECT photo FROM dam WHERE id = %s", (dam_id,))
    if not r:
        raise HTTPException(404, "dam not found")
    photo = r.get("photo")
    if photo:
        if photo.startswith(("http://", "https://")):
            return {"url": photo}
        fp = paths.abs_path(photo) if hasattr(paths, "abs_path") else paths.ROOT / photo
        if Path(fp).exists():
            return {"url": f"/api/dams/{dam_id}/photo"}
    return {"url": None}


@router.get("/dams/{dam_id}/photo")
def dam_photo(dam_id: str) -> Response:
    r = db.query_one("SELECT photo FROM dam WHERE id = %s", (dam_id,))
    if not r or not r.get("photo"):
        raise HTTPException(404, "no photo")
    photo = str(r["photo"])
    if photo.startswith(("http://", "https://")):
        raise HTTPException(404, "photo not cached locally")
    fp = Path(paths.ROOT) / photo
    if not fp.exists():
        raise HTTPException(404, "photo file missing")
    media = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
             "webp": "image/webp"}.get(fp.suffix.lstrip(".").lower(), "application/octet-stream")
    return Response(content=fp.read_bytes(), media_type=media)


# ----------------------------------------------------------- breach diagram
@router.get("/breach/profile")
def breach_profile(
    dam_id: str = Query(""),
    width: float = Query(150, ge=1, le=5000),
    depth: float = Query(120, ge=1, le=500),
    shape: str = Query("trapezoidal"),
) -> dict:
    """Breach cross-section for the Build screen diagram (pure geometry)."""
    shape = shape if shape in ("trapezoidal", "rectangular", "parabolic") else "trapezoidal"
    slope = 1.5 if shape == "trapezoidal" else 0.0
    top = width + 2 * slope * depth
    steps = 40
    points: list[dict[str, float]] = []
    for i in range(steps + 1):
        t = i / steps
        x = (0.5 - t) * top
        if shape == "parabolic":
            y = -depth * (1 - (2 * t - 1) ** 2)
        else:
            y = -depth if t < 0.5 else -depth
        points.append({"x": round(x, 3), "y": round(y, 3)})
    # Draw the actual section outline: crest left -> channel -> crest right.
    half_bottom = width / 2
    outline = [
        {"x": -top / 2, "y": 0},
        {"x": -half_bottom, "y": -depth},
        {"x": half_bottom, "y": -depth},
        {"x": top / 2, "y": 0},
    ]
    if shape == "parabolic":
        outline = [
            {"x": -top / 2, "y": 0},
            *[{"x": -top / 2 + i * top / steps,
               "y": -depth * (1 - (2 * i / steps - 1) ** 2)} for i in range(steps + 1)],
            {"x": top / 2, "y": 0},
        ]
    level = None
    if dam_id:
        r = db.query_one("SELECT fsl_m FROM dam WHERE id = %s", (dam_id,))
        level = float(r["fsl_m"]) if r and r.get("fsl_m") is not None else None
    return {
        "shape": shape,
        "points": outline or points,
        "width": width,
        "depth": depth,
        "level": level,
        "top_width": round(top, 1),
        "side_slope": slope,
    }


# --------------------------------------------------------------- run read
def _require_run(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run


def _spec(run: dict) -> dict:
    sc = catalog.scenario_get(run["scenario_id"]) or {}
    return sc.get("spec") or {}


def _first(*vals: Any) -> Any:
    for v in vals:
        if v is not None:
            return v
    return None


_PLACE_CACHE: dict[tuple[float, float], str | None] = {}


def _place(lat: float | None, lon: float | None) -> str | None:
    """Reverse geocode an AOI centre to a real district/state label.

    Nominatim is the source; a miss returns None and the UI simply omits the
    line rather than inventing a place name. Results are cached for the process.
    """
    if lat is None or lon is None:
        return None
    key = (round(lat, 3), round(lon, 3))
    if key in _PLACE_CACHE:
        return _PLACE_CACHE[key]
    url = (
        "https://nominatim.openstreetmap.org/reverse"
        f"?format=jsonv2&zoom=10&lat={lat:.5f}&lon={lon:.5f}"
    )
    label: str | None = None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "niyanta/1.0 (SIH26161)"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        addr = data.get("address") or {}
        label = _first(
            addr.get("state_district"),
            addr.get("state"),
            addr.get("county"),
            addr.get("district"),
        )
    except Exception as exc:  # offline / rate limited — stay honest
        logger.warning("reverse geocode {} {}: {}", lat, lon, exc)
    _PLACE_CACHE[key] = label
    return label


def _result(run: dict) -> dict:
    """`run.result` is where the pipeline persists its output (a json column)."""
    raw = run.get("result")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _impact_flat(run: dict) -> dict[str, Any]:
    """Screenshot impact keys, read from `run.result` with a `run_impact` fallback.

    The pipeline writes `impact.population_exposed`; Results reads `population`.
    A real 0 stays 0 — only absent keys become null.
    """
    imp = _result(run).get("impact") or {}
    infra = imp.get("infra") or {}
    met = _result(run).get("metrics") or {}
    row = db.query_one("SELECT * FROM run_impact WHERE run_id = %s", (run["id"],)) or {}
    return {
        "inundated_km2": _num(_first(met.get("inundation_km2"), row.get("inundated_area_km2"))),
        "population": _num(_first(imp.get("population_exposed"), row.get("affected_population"))),
        "villages": _num(_first(imp.get("villages_affected"), row.get("affected_villages"))),
        "roads_km": _num(_first(infra.get("roads_km"), row.get("affected_roads_km"))),
        "bridges": _num(_first(infra.get("bridges"), row.get("bridges"))),
        "facilities": _num(_first(infra.get("hospitals_hit"), row.get("critical_facilities"))),
        "peak_depth_m": _num(_first(met.get("max_depth_m"), row.get("peak_depth_m"))),
        "buildings": _num(_first(imp.get("buildings_affected"), row.get("affected_buildings"))),
        "population_method": imp.get("population_method"),
        "population_source": imp.get("population_source"),
    }


def _domain_km2(run_id: str) -> float | None:
    """Real footprint of the modelled domain, read from the output raster header."""
    for kind in ("max_depth", "inundation_extent", "conditioned_dem"):
        prod = catalog.product_latest(kind, run_id=run_id)
        if not prod or not prod.get("path"):
            continue
        fp = Path(paths.abs_path(prod["path"]))
        if not fp.exists():
            continue
        try:
            import rasterio

            with rasterio.open(fp) as src:
                b = src.bounds
                mid = math.radians((b.top + b.bottom) / 2)
                w = (b.right - b.left) * 111.32 * math.cos(mid)
                h = (b.top - b.bottom) * 110.57
                return round(abs(w * h), 2)
        except Exception:  # noqa: BLE001 - unreadable raster means "unknown", not a crash
            continue
    return None


def _solver_dt_s(run_id: str) -> float | None:
    """Configured solver Δt, read from the Delft3D .mdu written by stage.solve."""
    for mdu in paths.run_dir(run_id).glob("**/niyanta.mdu"):
        try:
            text = mdu.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            if line.strip().startswith("DtMax"):
                try:
                    return float(line.split("=")[1])
                except (IndexError, ValueError):
                    return None
    return None


def _frame_dir(run_id: str) -> Path:
    return Path(paths.abs_path(paths.tiles_dir(run_id, "depth")))


@router.get("/runs/{run_id}/stages")
def run_stages_endpoint(run_id: str) -> list[dict]:
    _require_run(run_id)
    rows = {r["key"]: r for r in db.query("SELECT * FROM run_stage WHERE run_id = %s", (run_id,))}
    out: list[dict] = []
    for n, (key, members) in enumerate(run_stages.DISPLAY_GROUPS, start=1):
        present = [rows[m] for m in members if m in rows]
        if present:
            # Group is done only when every member is; active if any is running.
            if all(r["status"] in ("done", "skipped") for r in present):
                status, pct = "done", 100
            elif any(r["status"] == "failed" for r in present):
                status, pct = "failed", max(int(r["progress"] or 0) for r in present)
            elif any(r["status"] == "running" for r in present):
                status = "active"
                pct = max(int(r["progress"] or 0) for r in present)
            else:
                status, pct = "pending", 0
            detail = next((r["detail"] for r in reversed(present) if r.get("detail")), None)
        else:
            status, pct, detail = "pending", 0, None
        meta = run_stages.STAGE_META.get(key, {})
        out.append({
            "n": n,
            "key": key,
            "title": meta.get("title", key),
            "status": status,
            "pct": pct,
            "detail": meta.get("subtitle"),
            "method": (detail or {}).get("method") if isinstance(detail, dict) else None,
        })
    return out


@router.get("/runs/{run_id}/params")
def run_params(run_id: str) -> dict:
    run = _require_run(run_id)
    params = run.get("params") or {}
    spec = _spec(run)
    horizon = spec.get("horizon") or {}
    reservoir = spec.get("reservoir") or {}
    aoi = spec.get("aoi") or {}
    domain_km = None
    coords = aoi.get("coords")
    if isinstance(coords, list) and len(coords) == 4:
        # rough geodesic width x height of the AOI
        w = abs(float(coords[2]) - float(coords[0])) * 111.32 * math.cos(math.radians(15.0))
        h = abs(float(coords[3]) - float(coords[1])) * 110.57
        domain_km = round(w * h, 1)
    res = float(params.get("resolution_m") or 30)
    return {
        "target_resolution_m": res,
        "domain_km": domain_km or params.get("domain_km"),
        "expected_cells": int((domain_km * 1e6 / (res * res)) if domain_km else
                              (params.get("expected_cells") or 0)) or None,
        "method": params.get("method") or "Adaptive unstructured",
        "dt_s": horizon.get("dt_s"),
        "duration_hr": horizon.get("duration_hr"),
        "engine_label": params.get("engine_label"),
        "particles": params.get("particles"),
        "storage_mcm": reservoir.get("storage_mcm"),
    }


@router.get("/runs/{run_id}/metrics")
def run_metrics(run_id: str) -> dict:
    run = _require_run(run_id)
    met = _result(run).get("metrics") or {}
    merged: dict[str, Any] = {**(run.get("metrics") or {}), **met}
    for r in db.query("SELECT key, value, text_value FROM run_metric WHERE run_id = %s", (run_id,)):
        merged[r["key"]] = r["text_value"] if r["text_value"] is not None else r["value"]
    mesh = db.query_one("SELECT cells_count FROM mesh_meta WHERE run_id = %s", (run_id,)) or {}
    duration_hr = _first(merged.get("duration_hr"), (_spec(run).get("horizon") or {}).get("duration_hr"))
    hw = merged.get("hardware") or (run.get("params") or {}).get("hardware") or (_spec(run).get("hardware")) or "GPU"
    if str(hw).lower() in ("gpu", "cuda", "gpu (cuda)"):
        hw_label = "GPU (NVIDIA CUDA)"
    elif str(hw).lower() in ("cpu", "threads"):
        hw_label = "CPU (Multi-threaded)"
    else:
        hw_label = str(hw)

    return {
        "mesh_cells": _num(_first(mesh.get("cells_count"), merged.get("mesh_cells"))),
        "domain_km2": _num(_first(merged.get("domain_km2"), _domain_km2(run_id))),
        "dt_s": _num(_first(merged.get("dt_s"), _solver_dt_s(run_id))),
        "sim_time_s": _num(round(float(duration_hr) * 3600, 3)) if duration_hr is not None else None,
        "iterations": _num(merged.get("iterations")),
        "hardware": hw_label,
    }


def _num(v: Any) -> float | int | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


@router.get("/runs/{run_id}/log")
def run_log(run_id: str, tail: int = Query(200, ge=1, le=2000)) -> list[dict]:
    _require_run(run_id)
    rows = db.query(
        "SELECT ts, level, msg, stage, status FROM proc_log WHERE run_id = %s "
        "ORDER BY ts DESC, id DESC LIMIT %s",
        (run_id, tail),
    )
    rows.reverse()
    return [{"ts": r["ts"].isoformat(), "level": r["level"] or "info",
             "message": r["msg"] or "", "stage": r["stage"], "status": r["status"]}
            for r in rows]


@router.get("/runs/{run_id}/outputs")
def run_outputs(run_id: str) -> list[dict]:
    _require_run(run_id)
    want = [("dem", ("conditioned_dem", "dem_raster", "dem")),
            ("mesh", ("mesh", "mesh_raster")),
            ("breach", ("breach_hydrograph", "hydrograph")),
            ("water", ("max_depth", "depth_raster", "max_depth_raster"))]
    prods: dict[str, Any] = {}
    for p in catalog.product_list(run_id=run_id):
        prods.setdefault(p["kind"], p)
    out = []
    for key, kinds in want:
        row = next((prods[k] for k in kinds if k in prods), None)
        status = (row or {}).get("status") or "pending"
        ready = bool(row) and status == "ready"
        out.append({"key": key,
                    "status": status if row else "pending",
                    "thumb": f"/api/runs/{run_id}/outputs/{key}/thumb.png" if ready else None,
                    "elevation": None})
    # Fill elevation from the DEM raster header when present.
    dem = next((p for p in out if p["key"] == "dem" and p["status"] == "ready"), None)
    if dem:
        span = _dem_span(run_id)
        if span:
            dem["elevation"] = span
    return out


def _dem_span(run_id: str) -> list[float] | None:
    """Elevation stops (m) for the DEM preview, read from the raster itself."""
    prod = catalog.product_latest("conditioned_dem", run_id=run_id)
    if not prod or not prod.get("path"):
        return None
    fp = Path(paths.abs_path(prod["path"]))
    if not fp.exists():
        return None
    try:
        import numpy as np
        import rasterio

        with rasterio.open(fp) as src:
            arr = src.read(1, masked=True)
    except Exception:  # noqa: BLE001 - unreadable raster means "unknown"
        return None
    if arr.size == 0:
        return None
    return [round(float(np.nanmin(arr)), 1), round(float(np.nanmax(arr)), 1)]


# ----------------------------------------------------------- output thumbs
OUTPUT_SOURCES: dict[str, tuple[str, ...]] = {
    "dem": ("conditioned_dem", "dem_raster", "dem"),
    "mesh": ("mesh",),
    "breach": ("breach_hydrograph", "hydrograph"),
    "water": ("max_depth", "depth_raster", "max_depth_raster"),
}


@router.get("/runs/{run_id}/outputs/{key}/thumb.png")
def output_thumb(run_id: str, key: str) -> Response:
    """Render the stage output the Run screen previews (docs/UI_SPEC.md)."""
    _require_run(run_id)
    if key not in OUTPUT_SOURCES:
        raise HTTPException(404, f"unknown output {key}")
    prod = None
    for kind in OUTPUT_SOURCES[key]:
        prod = catalog.product_latest(kind, run_id=run_id)
        if prod and prod.get("path"):
            break
    if not prod or not prod.get("path"):
        raise HTTPException(404, "output not generated yet")
    fp = Path(paths.abs_path(prod["path"]))
    if not fp.exists():
        raise HTTPException(404, "output file missing")
    # v2: annotated previews (colour bars, titles, dam marker). A new name
    # retires the old unlabelled thumbs without a migration.
    cached = paths.run_dir(run_id) / f"thumb_{key}_v2.png"
    if cached.exists():
        return Response(content=cached.read_bytes(), media_type="image/png")
    png = _render_output(key, fp, run_id)
    if not png:
        raise HTTPException(404, "output could not be rendered")
    cached.write_bytes(png)
    return Response(content=png, media_type="image/png")


def _dam_lonlat(run_id: str) -> tuple[float, float] | None:
    """Dam position for preview annotation — registry only, never guessed."""
    try:
        run = catalog.run_get(run_id)
        spec = (_spec(run) if run else {}) or {}
        dam_id = spec.get("dam_id")
        if not dam_id:
            return None
        r = db.query_one(
            "SELECT ST_X(d.location) AS lon, ST_Y(d.location) AS lat FROM dam d WHERE d.id = %s",
            (dam_id,),
        )
        if not r or r.get("lon") is None or r.get("lat") is None:
            return None
        return float(r["lon"]), float(r["lat"])
    except Exception:  # noqa: BLE001 - no dam position means no marker, not a failure
        return None


def _run_metrics(run_id: str) -> dict:
    """Result metrics persisted by the pipeline (peak, h_max, area, …)."""
    try:
        run = catalog.run_get(run_id)
        res = _result(run or {})
        m = res.get("metrics")
        return m if isinstance(m, dict) else {}
    except Exception:  # noqa: BLE001 - titles degrade, the preview survives
        return {}


def _mark_dam(ax, src, lonlat) -> None:
    """Red dam dot + label in pixel space. Silent when off-raster."""
    if not lonlat:
        return
    try:
        lon, lat = lonlat
        r, c = src.index(lon, lat)
        if 0 <= r < src.height and 0 <= c < src.width:
            ax.plot([c], [r], marker="o", ms=7, mfc="#b42318", mec="white",
                    mew=1.5, zorder=5)
            ax.text(c, r - src.height * 0.025, "dam", color="white", fontsize=7,
                    ha="center", va="top",
                    bbox=dict(boxstyle="round,pad=0.25", fc="#b42318", ec="none"),
                    zorder=6)
    except Exception:  # noqa: BLE001 - annotation never breaks the preview
        pass


def _render_output(key: str, fp: Path, run_id: str) -> bytes | None:
    """Annotated PNG preview: colour bars with units, titles with the numbers
    that matter, the dam marked on spatial thumbs. A preview must read on its
    own — no surrounding UI to explain it."""
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    from matplotlib.colors import BoundaryNorm, LinearSegmentedColormap

    fig = None
    try:
        if key == "breach":
            data = json.loads(fp.read_text(encoding="utf-8"))
            times = [t / 3600 for t in (data.get("time_s") or [])]
            qs = data.get("q_cms") or []
            if not times or not qs:
                return None
            fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=100)
            ax.plot(times, qs, color="#0b6bcb", lw=1.8)
            ax.fill_between(times, qs, color="#0b6bcb", alpha=0.12)
            ax.set_xlabel("hours")
            ax.set_ylabel("m³/s")
            ax.grid(alpha=0.25, lw=0.5)
            ax.set_title(f"peak {float(data.get('peak_cms') or 0):,.0f} m³/s "
                         f"@ {float(data.get('peak_at_hr') or 0):.2f} h", fontsize=9)
            fig.tight_layout()
        elif key == "mesh":
            import numpy as np
            import rasterio

            fig, ax = plt.subplots(figsize=(6, 6), dpi=110)
            ax.set_facecolor("#f4f6f8")
            # The mesh is a structured grid over the DEM, so show the terrain
            # underneath and overlay the solved grid plus the dam crest line.
            dem = catalog.product_latest("conditioned_dem", run_id=run_id)
            rows = cols = 0
            if dem and dem.get("path"):
                dem_fp = Path(paths.abs_path(dem["path"]))
                if dem_fp.exists():
                    with rasterio.open(dem_fp) as src:
                        arr = src.read(1, masked=True)
                    ax.imshow(arr, cmap="Greys", alpha=0.5, origin="upper")
                    rows, cols = arr.shape
            if rows and cols:
                step = max(1, rows // 24)
                for r in range(0, rows, step):
                    ax.axhline(r - 0.5, color="#0b6bcb", lw=0.35, alpha=0.55)
                step = max(1, cols // 24)
                for c in range(0, cols, step):
                    ax.axvline(c - 0.5, color="#0b6bcb", lw=0.35, alpha=0.55)
            try:
                with np.load(fp, allow_pickle=False) as d:
                    for name, colour, lw, label in (
                        ("dam_line", "#b42318", 2.4, "dam crest"),
                        ("centerline", "#12805c", 1.6, "river centreline"),
                    ):
                        pts = d[name] if name in d else None
                        if pts is not None and len(pts) > 1:
                            ax.plot(pts[:, 1], pts[:, 0], color=colour, lw=lw, label=label)
                    if "stations_rc" in d and len(d["stations_rc"]):
                        ax.scatter(d["stations_rc"][:, 1], d["stations_rc"][:, 0],
                                   c="#12805c", s=30, zorder=3, edgecolors="white",
                                   label="gauge stations")
                ax.legend(fontsize=7, loc="lower right", framealpha=0.92)
            except Exception:  # noqa: BLE001 - unreadable mesh still shows the grid
                pass
            ax.invert_yaxis()
            cells = f"{rows:,}\u00d7{cols:,} ({rows * cols:,} cells)" if rows and cols else None
            ax.set_title(f"computational mesh \u2014 {cells}" if cells else "computational mesh",
                         fontsize=9)
            ax.set_xticks([])
            ax.set_yticks([])
            fig.tight_layout()
        elif key in ("dem", "water"):
            import numpy as np
            import rasterio

            dam_ll = _dam_lonlat(run_id)
            with rasterio.open(fp) as src:
                arr = src.read(1, masked=True)
                if arr.size == 0:
                    return None
                fig, ax = plt.subplots(figsize=(6, 6), dpi=110)
                if key == "water":
                    stops = [(s["v"], s["color"]) for s in DEPTH_RAMP]
                    cmap = LinearSegmentedColormap.from_list("depth", [c for _, c in stops])
                    bounds = [v for v, _ in stops] + [stops[-1][0] * 2]
                    img = ax.imshow(arr, cmap=cmap, norm=BoundaryNorm(bounds, cmap.N),
                                    origin="upper")
                    cb = fig.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                                      ticks=[v for v, _ in stops])
                    cb.ax.set_yticklabels([s["label"] for s in DEPTH_RAMP], fontsize=7)
                    cb.set_label("max depth (m)", fontsize=8)
                    m = _run_metrics(run_id)
                    bits = []
                    if m.get("max_depth_m") is not None:
                        bits.append(f"h_max {float(m['max_depth_m']):.1f} m")
                    if m.get("inundation_km2") is not None:
                        bits.append(f"{float(m['inundation_km2']):.1f} km\u00b2")
                    depth_title = "max depth — " + " · ".join(bits) if bits else "max depth"
                    ax.set_title(depth_title, fontsize=9)
                else:
                    try:
                        vmin = float(np.nanmin(arr))
                        vmax = float(np.nanmax(arr))
                    except Exception:  # noqa: BLE001 - unreadable values, still show the surface
                        vmin = vmax = None
                    if vmin is None or not (vmax > vmin):
                        vmin, vmax = (vmin or 0) - 0.5, (vmax or 0) + 0.5
                    img = ax.imshow(arr, cmap="terrain", origin="upper", vmin=vmin, vmax=vmax)
                    cb = fig.colorbar(img, ax=ax, fraction=0.046, pad=0.04)
                    cb.set_label("elevation (m)", fontsize=8)
                    cb.ax.tick_params(labelsize=7)
                    try:
                        dx, _ = (abs(v) for v in src.res)
                        mid_lat = (src.bounds.bottom + src.bounds.top) / 2
                        res_m = dx * 111320 * math.cos(math.radians(mid_lat))
                    except Exception:  # noqa: BLE001 - title degrades, the surface survives
                        res_m = None
                    title = f"conditioned DEM {vmin:,.0f}\u2013{vmax:,.0f} m"
                    if res_m:
                        title += f" \u00b7 {res_m:.0f} m grid"
                    ax.set_title(title, fontsize=9)
                _mark_dam(ax, src, dam_ll)
                ax.set_xticks([])
                ax.set_yticks([])
                fig.tight_layout()
        else:
            return None
        import io

        buf = io.BytesIO()
        fig.savefig(buf, format="png", facecolor="white")
        return buf.getvalue()
    except Exception as exc:  # noqa: BLE001 - a preview must never break the Run screen
        logger.warning("output thumb {} failed for {}: {}", key, run_id, exc)
        return None
    finally:
        if fig is not None:
            plt.close(fig)


# ---------------------------------------------------------------- impact
@router.get("/runs/{run_id}/impact")
def run_impact(run_id: str) -> dict:
    run = _require_run(run_id)
    hydro: list[dict] = []
    labels: list[str] | None = None
    # The breach hydrograph is a real product of stage.breach; it is the series
    # the Results chart plots, so read it rather than an absent `hydrographs`.
    hg = catalog.product_latest("breach_hydrograph", run_id=run_id)
    if hg and hg.get("path"):
        try:
            data = json.loads(Path(paths.abs_path(hg["path"])).read_text(encoding="utf-8"))
            times, qs = data.get("time_s"), data.get("q_cms")
            engine = str(run.get("engine") or "").lower()
            key = engine if engine in ("sph", "delft3d", "fast") else "sph"
            if isinstance(times, list) and isinstance(qs, list):
                hydro = [
                    {"t": t,
                     "sph": q if key == "sph" else None,
                     "delft3d": q if key == "delft3d" else None,
                     "fast": q if key == "fast" else None}
                    for t, q in zip(times, qs, strict=False)
                ]
                sim_h = float(data.get("duration_hr") or 0)
                labels = [f"{t / 3600:.2f}" for t in times] if sim_h else None
        except Exception as exc:  # noqa: BLE001 - chart must not break the page
            logger.warning("hydrograph read failed for {}: {}", run_id, exc)
    return {**_impact_flat(run), "hydrograph": hydro, "hydrograph_labels": labels}


@router.get("/runs/{run_id}/summary")
def run_summary(run_id: str) -> dict:
    run = _require_run(run_id)
    sc = catalog.scenario_get(run["scenario_id"]) or {}
    spec = sc.get("spec") or {}
    breach = spec.get("breach") or {}
    reservoir = spec.get("reservoir") or {}
    horizon = spec.get("horizon") or {}
    dam_id = spec.get("dam_id")
    dam = db.query_one("SELECT name, state, photo FROM dam WHERE id = %s", (dam_id,)) if dam_id else None
    breach_row = db.query_one("SELECT * FROM breach_solution WHERE scenario_id = %s",
                              (run["scenario_id"],)) or {}
    met = _result(run).get("metrics") or {}
    coords = (spec.get("aoi") or {}).get("coords") or []
    aoi_centre = (
        ((coords[1] + coords[3]) / 2, (coords[0] + coords[2]) / 2)
        if len(coords) == 4
        else (None, None)
    )
    return {
        "id": run["id"],
        "scenario_name": sc.get("name") or (dam or {}).get("name"),
        "state": (dam or {}).get("state") or _place(*aoi_centre),
        "engine": run.get("engine"),
        "engine_label": run_stages.ENGINE_LABEL.get(run.get("engine") or "",
                                                    (run.get("engine") or "").upper()),
        "near_field_only": bool(met.get("near_field_only")),
        "window_m": float(met.get("window_m") or 0.0) or None,
        "breach_width": breach.get("width_m") or breach_row.get("width_m"),
        "breach_depth": breach.get("depth_m") or breach_row.get("depth_m"),
        "breach_method": breach.get("method") or breach_row.get("method"),
        "reservoir_level": reservoir.get("initial_level_m") or breach_row.get("reservoir_level_m"),
        "sim_hours": horizon.get("duration_hr") or breach_row.get("sim_hours"),
        "run_id": str(run["id"])[:8],
        "status": run.get("state"),
        "photo": (dam or {}).get("photo"),
        "created": run.get("created"),
        "finished_at": run.get("finished_at"),
    }


# ---------------------------------------------------------------- probes
@router.get("/runs/{run_id}/probes")
def run_probe(run_id: str, lon: float, lat: float) -> dict:
    _require_run(run_id)
    key = f"{lat:.5f},{lon:.5f}"
    # Sample on demand straight from the run's own rasters (max depth /
    # arrival / velocity / DEM + the solve-grid series), then cache the cell
    # so repeat clicks and the probe history are instant. probed=False only
    # when the run has no depth product at all.
    sampled = sample_point(run_id, lon, lat)
    if sampled is None:
        # Honest empty state: nothing to sample for this run.
        return {"lat": lat, "lon": lon, "depth_m": None, "arrival_s": None,
                "velocity_mps": None, "inundated": None, "elevation_m": None,
                "series": [], "probed": False}
    try:
        db.execute(
            "INSERT INTO run_probe (run_id, point_key, lon, lat, series) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT(run_id, point_key) DO UPDATE SET series = excluded.series",
            (run_id, key, lon, lat, sampled["series"]),
        )
    except Exception:
        logger.warning("probe cache write failed for {}/{}", run_id, key)
    return {"lat": lat, "lon": lon, **sampled, "probed": True}


@router.get("/probes/{run_id}")
def list_probes(run_id: str) -> list[dict]:
    _require_run(run_id)
    rows = db.query("SELECT lat, lon, label, series FROM run_probe WHERE run_id = %s "
                    "ORDER BY created DESC LIMIT 50", (run_id,))
    out = []
    for r in rows:
        for p in (r.get("series") or []):
            out.append({"t": p.get("t_s"), "depth_m": p.get("depth_m"),
                        "lat": r["lat"], "lon": r["lon"]})
    out.sort(key=lambda p: p.get("t") or 0)
    return out


# ---------------------------------------------------------------- frames
def _frame_index(run_id: str) -> dict:
    """stage.post writes depth/index.json with one entry per playback frame."""
    fp = _frame_dir(run_id) / "index.json"
    if not fp.exists():
        return {}
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


@router.get("/runs/{run_id}/frames.json")
def run_frames(run_id: str) -> dict:
    _require_run(run_id)
    index = _frame_index(run_id)
    times = index.get("times_s") or []
    spec = _spec(_require_run(run_id))
    sim_hours = float((spec.get("horizon") or {}).get("duration_hr") or 0)
    return {
        "frames": [
            {"i": i, "t": t,
             "t_label": f"{t / 3600:.2f} h",
             "thumbnail": f"/api/runs/{run_id}/frames/{i}/thumb.png"}
            for i, t in enumerate(times)
        ],
        "kind": "depth",
        "kind_label": KIND_LABEL["depth"],
        "ramp": DEPTH_RAMP,
        "sim_hours": sim_hours,
    }


@router.get("/runs/{run_id}/frames/{idx}/thumb.png")
def frame_thumb(run_id: str, idx: int) -> Response:
    # No DB lookup here: the results timeline fires ~100 thumbnails at once and
    # each connection-holding lookup exhausted the pool. The file is the guard.
    try:
        UUID(run_id)
    except ValueError:
        raise HTTPException(404, "run not found") from None
    fp = _frame_dir(run_id) / f"f{idx:03d}.png"
    if not fp.exists():
        raise HTTPException(404, "frame thumbnail not generated")
    return Response(content=fp.read_bytes(), media_type="image/png")


@router.get("/runs/{run_id}/terrain.json")
def run_terrain(run_id: str, detail: str = "std") -> dict:
    """Elevation grid for the 3D player — the run's DEM, downsampled so the
    JSON stays small and the heightfield builds fast. rows[0] is the north
    edge (GeoTIFF/raster order). `detail=full` lifts the cap to 400 cells per
    axis (≈ the solve grid); the default `std` cap is 200."""
    _require_run(run_id)
    from modules.run import grid as grid_mod  # noqa: PLC0415
    from modules.run import work_terrain  # noqa: PLC0415

    import numpy as np  # noqa: PLC0415

    try:
        z, meta = work_terrain.load_dem(run_id)
    except Exception:  # noqa: BLE001 - missing/invalid dem.npz → honest 404
        raise HTTPException(404, "no DEM for this run yet") from None
    z = np.asarray(z, dtype=np.float64)
    H, W = int(z.shape[0]), int(z.shape[1])
    cap = 400 if detail == "full" else 200
    step = int(max(1, math.ceil(max(H, W) / cap)))
    sub = z[::step, ::step]
    finite = sub[np.isfinite(sub)]
    lo = float(finite.min()) if finite.size else 0.0
    hi = float(finite.max()) if finite.size else 0.0
    filled = np.where(np.isfinite(sub), sub, lo)
    return {
        "bounds": list(grid_mod.bounds(meta)),
        "cell_m": float(meta.get("cell_m") or 0),
        "step": step,
        "detail": "full" if detail == "full" else "std",
        "min": round(lo, 1),
        "max": round(hi, 1),
        "rows": [[round(float(v), 1) for v in row] for row in filled],
    }


@router.get("/runs/{run_id}/hazard-villages")
def run_hazard_villages(run_id: str) -> dict:
    """Affected villages with modelled depth/arrival/population — written by
    stage.impact to hazard_villages.geojson. 404 when the run never produced
    one (impact not run, or no villages inside the extent)."""
    _require_run(run_id)
    fp = paths.run_dir(run_id) / "hazard_villages.geojson"
    if not fp.exists():
        raise HTTPException(404, "no hazard villages for this run yet")
    try:
        doc = json.loads(fp.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - corrupt product → 404, not a 500
        raise HTTPException(404, "hazard villages unreadable") from None
    if not isinstance(doc, dict) or doc.get("type") != "FeatureCollection":
        raise HTTPException(404, "hazard villages unreadable") from None
    return doc


# -------------------------------------------------------------- exports
@router.get("/runs/{run_id}/export")
def run_export(run_id: str, fmt: str = "geotiff") -> dict:
    _require_run(run_id)
    if fmt not in ("geotiff", "shp", "kml"):
        raise HTTPException(422, "fmt must be geotiff, shp or kml")
    # Reuse the existing export pipeline; report honestly if nothing is packaged.
    existing = db.query_one(
        "SELECT id, path FROM export_job WHERE run_id = %s AND status = 'done' "
        "AND EXISTS (SELECT 1 FROM json_each(formats) WHERE value = %s) "
        "ORDER BY updated DESC",
        (run_id, fmt),
    )
    if existing and existing.get("path"):
        return {"url": f"/api/exports/{existing['id']}/download",
                "filename": Path(existing["path"]).name}
    return {"url": None, "filename": None, "status": "not_packaged",
            "create": "POST /api/exports with run_id=" + run_id + " formats=" + fmt}


# ----------------------------------------------------------- comparisons
METRIC_ROWS = [
    ("inundated_km2", "Inundated Area (km²)", "km²"),
    ("peak_depth_m", "Peak Depth (m)", "m"),
    ("arrival_s", "Arrival Time", "s"),
    ("population", "Affected Population", "people"),
    ("villages", "Affected Villages", "count"),
    ("roads_km", "Affected Roads (km)", "km"),
    ("facilities", "Critical Facilities", "count"),
]


def _arrival_s(run_id: str) -> float | None:
    """First flood arrival at a downstream gauge, in seconds.

    Read from the same `result.stations` product Results renders, so Compare and
    Results can never disagree. CH0 sits on the breach and reports ~0 by
    construction, so only gauges below it count; a run with no downstream gauge
    reports None (rendered "—"), never a guessed number.
    """
    stations = (_require_run(run_id).get("result") or {}).get("stations") or []
    times = []
    for s in stations:
        hr = s.get("arrival_hr")
        if hr is None or s.get("in_domain") is False:
            continue
        if float(s.get("km") or 0) <= 0:
            continue
        times.append(float(hr) * 3600.0)
    return round(min(times), 1) if times else None


def _impact_values(run_id: str) -> dict[str, Any]:
    """Compare metrics come from the same place Results reads, so the two
    screens can never disagree about a run."""
    flat = _impact_flat(_require_run(run_id))
    return {
        "inundated_km2": flat["inundated_km2"],
        "peak_depth_m": flat["peak_depth_m"],
        "arrival_s": _arrival_s(run_id),
        "population": flat["population"],
        "villages": flat["villages"],
        "roads_km": flat["roads_km"],
        "facilities": flat["facilities"],
    }


@router.get("/comparisons")
def comparison(
    run_a: str = Query(...),
    run_b: str = Query(...),
    mode: str = Query("swipe"),
) -> dict:
    _require_run(run_a)
    _require_run(run_b)
    va, vb = _impact_values(run_a), _impact_values(run_b)
    metrics = []
    for key, label, unit in METRIC_ROWS:
        a, b = va.get(key), vb.get(key)
        delta = pct = None
        direction = None
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            delta = round(b - a, 4)
            if a:
                pct = round((b - a) / abs(a) * 100, 1)
            direction = "up" if delta > 0 else ("down" if delta < 0 else "flat")
        metrics.append({"key": key, "label": label, "unit": unit,
                        "a": a, "b": b, "delta": delta, "pct": pct, "dir": direction})
    return {"a": run_a, "b": run_b, "mode": mode, "metrics": metrics,
            "ramp": DIFF_RAMP, "extent_ramp": EXTENT_RAMP,
            # The exact colour ramps the tile server paints with — legends on the
            # Compare screen are drawn from these, never from local constants.
            "ramps": {"depth": DEPTH_RAMP, "arrival": RAMPS["arrival"],
                      "velocity": RAMPS["velocity"], "extent": EXTENT_RAMP,
                      "difference": DIFF_RAMP}}


@router.get("/comparisons/{run_a}/longitudinal")
def longitudinal(run_a: str, lonlat: str = Query(""), run_b: str = Query("")) -> dict:
    """Max depth per kilometre downstream of the breach toe.

    Both runs are projected onto one shared axis (principal axis of the union of
    wet cells) so the two curves are measured along the same transect. Falls back
    to a stored longitudinal_profile product when stage.post wrote one.
    """
    _require_run(run_a)
    ids = [r for r in (run_a, run_b) if r]
    rasters = _depth_rasters(ids)
    axis = _profile_axis(rasters)
    series = []
    for run_id in ids:
        points = _stored_profile(run_id)
        if not points:
            raster = next((r for rid, r in rasters if rid == run_id), None)
            points = _bin_profile(raster, axis) if raster and axis else []
        if points:
            series.append({"key": run_id, "points": points})
    return {"series": series, "ramp": DEPTH_RAMP, "lonlat": lonlat}


def _stored_profile(run_id: str) -> list[dict[str, float]]:
    """Legacy JSON product, when stage.post wrote one."""
    row = db.query_one(
        "SELECT path FROM product WHERE run_id = %s AND kind = 'longitudinal_profile' "
        "ORDER BY created DESC LIMIT 1",
        (run_id,),
    )
    if not row or not row.get("path"):
        return []
    try:
        data = json.loads(Path(paths.abs_path(row["path"])).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - unreadable profile falls through to the raster
        return []
    raw = data.get("series") or data.get("points") or []
    if isinstance(raw, dict):
        raw = next(iter(raw.values()), [])
    return [p for p in raw if isinstance(p, dict)]


def _depth_rasters(run_ids: list[str]) -> list[tuple[str, dict[str, Any]]]:
    """max_depth.tif per run, unreadable rasters dropped (honest absence)."""
    out: list[tuple[str, dict[str, Any]]] = []
    import numpy as np

    for run_id in run_ids:
        row = catalog.product_latest("max_depth", run_id=run_id)
        if not row or not row.get("path"):
            continue
        fp = Path(paths.abs_path(row["path"]))
        if not fp.exists():
            continue
        try:
            import rasterio

            with rasterio.open(fp) as ds:
                depth = ds.read(1)
                transform = ds.transform
        except Exception:  # noqa: BLE001 - skip unreadable raster
            continue
        depth = np.nan_to_num(depth, nan=0.0, posinf=0.0, neginf=0.0)
        out.append((run_id, {"depth": depth, "transform": transform}))
    return out


def _profile_axis(rasters: list[tuple[str, dict[str, Any]]], bins: int = 48) -> dict[str, Any] | None:
    """Shared downstream axis: principal axis of all wet cells, d = 0 at the
    deepest cell (the breach toe), extent trimmed to the 1st-99th percentile so
    stray isolated pixels cannot stretch the transect."""
    import numpy as np

    lons_all, lats_all = [], []
    peak = (-1.0, 0.0, 0.0)
    for _run_id, r in rasters:
        depth = r["depth"]
        transform = r["transform"]
        rows, cols = np.nonzero(depth > 0.01)
        if rows.size == 0:
            continue
        lon = transform.c + (cols + 0.5) * transform.a
        lat = transform.f + (rows + 0.5) * transform.e
        lons_all.append(lon)
        lats_all.append(lat)
        values = depth[rows, cols]
        i = int(np.argmax(values))
        if float(values[i]) > peak[0]:
            peak = (float(values[i]), float(lon[i]), float(lat[i]))
    if not lons_all or peak[0] < 0:
        return None
    lons = np.concatenate(lons_all)
    lats = np.concatenate(lats_all)
    if lons.size < 16:
        return None
    mlat = float(np.deg2rad(float(np.mean(lats))))
    coslat = math.cos(mlat)
    x = lons * 111.32 * coslat
    y = lats * 110.54
    cx, cy = float(np.mean(x)), float(np.mean(y))
    dx, dy = x - cx, y - cy
    eigvals, eigvecs = np.linalg.eigh(np.cov(np.vstack([dx, dy])))
    vx, vy = eigvecs[:, int(np.argmax(eigvals))]
    o_proj = (peak[1] * 111.32 * coslat - cx) * vx + (peak[2] * 110.54 - cy) * vy
    proj = dx * vx + dy * vy
    if float(np.median(proj)) < o_proj:
        proj = -proj
        o_proj = -o_proj
        vx, vy = -vx, -vy
    rel = proj - o_proj
    lo, hi = float(np.percentile(rel, 1)), float(np.percentile(rel, 99))
    if hi <= lo:
        return None
    return {
        "vx": float(vx),
        "vy": float(vy),
        "cx": cx,
        "cy": cy,
        "o_proj": float(o_proj),
        "coslat": coslat,
        "edges": np.linspace(lo, hi, bins + 1),
        "bins": bins,
    }


def _bin_profile(raster: dict[str, Any], axis: dict[str, Any]) -> list[dict[str, float]]:
    """Max depth per distance bin along the shared axis."""
    import numpy as np

    depth = raster["depth"]
    transform = raster["transform"]
    rows, cols = np.nonzero(depth > 0.01)
    if rows.size < 16:
        return []
    lon = transform.c + (cols + 0.5) * transform.a
    lat = transform.f + (rows + 0.5) * transform.e
    x = lon * 111.32 * axis["coslat"]
    y = lat * 110.54
    rel = ((x - axis["cx"]) * axis["vx"] + (y - axis["cy"]) * axis["vy"]) - axis["o_proj"]
    values = depth[rows, cols].astype(float)
    edges = axis["edges"]
    bins = axis["bins"]
    inside = (rel >= edges[0]) & (rel <= edges[-1])
    if not bool(np.any(inside)):
        return []
    rel = rel[inside]
    values = values[inside]
    idx = np.clip(np.digitize(rel, edges) - 1, 0, bins - 1)
    peak = np.zeros(bins)
    for i in range(bins):
        sel = values[idx == i]
        if sel.size:
            peak[i] = float(sel.max())
    return [
        {"d": round(float((edges[i] + edges[i + 1]) / 2), 3),
         "depth": round(float(peak[i]), 3)}
        for i in np.nonzero(peak > 0)[0]
    ]
