from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from modules.catalog import catalog
from modules.db import client as db
from modules.run import execute as run_execute
from modules.run import lifecycle
from modules.run.series import ensure as ensure_series
from modules.storage import paths

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("")
def create_run(body: dict) -> dict:
    scenario_id = body.get("scenario_id")
    if not scenario_id:
        raise HTTPException(422, "scenario_id required")
    try:
        return run_execute.create_run(scenario_id, body.get("engine"))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{run_id}/execute")
def execute_run(run_id: str) -> dict:
    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    outcome = run_execute.execute(run_id)
    status = 200 if outcome["ok"] else 409
    return JSONResponse(outcome, status_code=status)


@router.get("")
def list_runs(state: str | None = None, scenario_id: str | None = None) -> list[dict]:
    return catalog.run_list(state, scenario_id)


@router.get("/{run_id}")
def get_run(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return {
        "run": run,
        "scenario": catalog.scenario_get(run["scenario_id"]),
        "lifecycle": lifecycle.lifecycle(run_id),
        "jobs": lifecycle.jobs_for_run(run_id),
        "products": catalog.product_list(run_id=run_id),
    }


@router.post("/{run_id}/retry")
def retry_run(run_id: str) -> dict:
    try:
        return run_execute.retry(run_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{run_id}/publish")
def publish_run(run_id: str) -> dict:
    try:
        return run_execute.publish(run_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{run_id}/result")
def run_result(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if not run.get("result"):
        raise HTTPException(409, f"run not complete (state={run['state']})")
    return run["result"]


@router.get("/{run_id}/stations")
def run_stations(run_id: str) -> list[dict]:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    result = run.get("result") or {}
    return result.get("stations", [])


@lru_cache(maxsize=4)
def _particles(path: str, mtime: float) -> dict[str, Any]:
    import numpy as np

    with np.load(path, allow_pickle=False) as d:
        return {"p": d["particles"], "t": d["times_s"],
                "l0": float(d["l0_m"]), "cell": float(d["cell_m"])}


@router.get("/{run_id}/particles")
def run_particles(run_id: str, frame: int = 0) -> dict:
    """SPH particles at one output frame: flat [col, row, z, speed, …] on the
    solve grid (the same grid as terrain.json?detail=full). 404 for engines
    that have no particles — the Player then draws the depth surface."""
    import numpy as np

    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    fp = paths.run_dir(run_id) / "particles.npz"
    if not fp.exists():
        raise HTTPException(404, "no SPH particles for this run")
    d = _particles(str(fp), fp.stat().st_mtime)
    n = int(d["p"].shape[0])
    if not 0 <= frame < n:
        raise HTTPException(404, f"frame out of range (0..{n - 1})")
    snap = d["p"][frame]
    snap = snap[np.isfinite(snap[:, 0])]
    return {
        "frame": frame,
        "frames": n,
        "t_s": float(d["t"][frame]),
        "count": int(snap.shape[0]),
        "l0_m": d["l0"],
        "cell_m": d["cell"],
        "data": np.round(snap, 2).ravel().tolist(),
    }


@router.get("/{run_id}/infrastructure")
def run_infrastructure(run_id: str) -> dict:
    """OSM buildings / road segments / bridges inside the model grid, each with
    its per-frame depth while wet (f0..f1 → s[]), peak depth d, and a summary.
    The 3D and 2D players colour infrastructure per frame from this."""
    from modules.run import infra_exposure  # noqa: PLC0415

    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    try:
        doc = infra_exposure.ensure(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(409, "run has no frame stack yet") from exc
    return {k: v for k, v in doc.items() if not k.startswith("_")}


@router.get("/{run_id}/series")
def run_series(run_id: str) -> dict:
    """Area by hazard class + flood-front reach over time (see modules.run.series)."""
    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    try:
        return ensure_series(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(409, "run has no frame stack yet") from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(409, f"series unavailable: {exc}") from exc


@router.get("/{run_id}/hydrograph")
def run_hydrograph(run_id: str, station: str | None = None) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    product = catalog.product_latest("hydrographs", run_id=run_id) or (
        catalog.product_latest("breach_hydrograph", run_id=run_id)
    )
    if not product:
        raise HTTPException(409, "no hydrograph product for this run")
    data = _load_json(paths.abs_path(product["path"]))
    if station:
        series = data.get("series", {}).get(station)
        if series is None:
            raise HTTPException(404, f"station {station} not found")
        return {"station": station, **series}
    return data


@router.get("/{run_id}/raster/{kind}")
def run_raster(run_id: str, kind: str):
    if kind not in ("depth", "max_depth", "velocity", "arrival", "extent"):
        raise HTTPException(404, f"unknown raster kind {kind}")
    product = catalog.product_latest(f"{kind}_raster", run_id=run_id) or catalog.product_latest(
        "extent_raster", run_id=run_id
    ) if kind == "extent" else catalog.product_latest(f"{kind}_raster", run_id=run_id)
    if not product or not product.get("path"):
        raise HTTPException(404, "raster not found (run may be incomplete)")
    fp = paths.abs_path(product["path"])
    if not fp.exists():
        raise HTTPException(404, "raster file missing on disk")
    return FileResponse(fp, media_type="image/tiff", filename=fp.name)


def _load_json(fp: Path) -> dict[str, Any]:
    import json

    if not fp.exists():
        raise HTTPException(404, "hydrograph file missing on disk")
    return json.loads(fp.read_text(encoding="utf-8"))


def _aoi_bbox(aoi: Any) -> list[float] | None:
    """Usable [w, s, e, n] from a bbox or polygon-ring AOI (mirrors AOI.bbox_4326)."""
    if not aoi:
        return None
    try:
        if len(aoi) == 4 and all(isinstance(v, (int, float)) for v in aoi):
            w, s, e, n = (float(v) for v in aoi)
            return [w, s, e, n] if w < e and s < n else None
        ring = aoi[0] if isinstance(aoi[0], (list, tuple)) and aoi[0] and isinstance(aoi[0][0], (list, tuple)) else aoi
        xs = [float(p[0]) for p in ring]
        ys = [float(p[1]) for p in ring]
        if not xs:
            return None
        w, e, s, n = min(xs), max(xs), min(ys), max(ys)
        return [w, s, e, n] if w < e and s < n else None
    except Exception:  # noqa: BLE001 - malformed AOI reads as absent
        return None


def _dam_lonlat(row: dict[str, Any]) -> tuple[float, float] | None:
    """Registry dam point — WKB hex or GeoJSON text, whichever ingest wrote."""
    loc = (row or {}).get("location")
    if not loc:
        return None
    try:
        from shapely import wkb  # noqa: PLC0415

        lon, lat = wkb.loads(loc).coords[0]
        return float(lon), float(lat)
    except Exception:  # noqa: BLE001 - try GeoJSON text instead
        pass
    try:
        import json  # noqa: PLC0415

        coords = (json.loads(loc) if isinstance(loc, str) else {}).get("coordinates") or []
        return float(coords[0]), float(coords[1])
    except Exception:  # noqa: BLE001 - unparseable location
        return None


def _hav_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    import math  # noqa: PLC0415

    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.post("/{run_id}/cascade")
def run_cascade(run_id: str, body: dict | None = None) -> dict:
    """Downstream-dam screening for one run's flood (event-in → dams-out).

    Samples the run's own max_depth / max_velocity / arrival_time rasters at
    every registry dam inside the run AOI and reports who gets wet, who
    overtops, and with what arrival. Overtopping is a screening flag from
    recorded crest geometry — never a failure prediction. With
    `create_scenarios`, one counterpart scenario per wet dam with recorded
    height is drafted (Froehlich, app-standard reservoir fallback); execution
    stays a deliberate 1-click step, never automatic.
    """
    import numpy as np  # noqa: PLC0415

    body = body or {}
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    scenario = catalog.scenario_get(run["scenario_id"]) or {}
    spec = scenario.get("spec") or {}
    aoi = ((spec.get("aoi") or {}).get("coords")) or []
    bbox = _aoi_bbox(aoi)
    if bbox is None:
        # No usable AOI (GUI scenarios may save an empty/polygon AOI): fall
        # back to the flood raster's own bounds — the screening domain is
        # where the water is, not where the form drew a box.
        depth_row = catalog.product_latest("max_depth", run_id=run_id)
        depth_fp = paths.abs_path(depth_row["path"]) if depth_row and depth_row.get("path") else None
        if depth_fp and depth_fp.exists():
            try:
                import rasterio  # noqa: PLC0415

                with rasterio.open(depth_fp) as _ds:
                    b = _ds.bounds
                    bbox = [b.left, b.bottom, b.right, b.top]
            except Exception:  # noqa: BLE001 - stays None → 409 below
                bbox = None
    if bbox is None:
        raise HTTPException(409, "run has neither a usable AOI nor raster bounds")

    dem_fp = paths.run_dir(run_id) / "dem.npz"
    if not dem_fp.exists():
        raise HTTPException(409, "run has no terrain yet")
    try:
        with np.load(dem_fp, allow_pickle=False) as d:
            import json  # noqa: PLC0415

            dem_z = np.asarray(d["z"], dtype=np.float64)
            dem_meta = json.loads(str(d["meta_json"]))
    except Exception as exc:  # noqa: BLE001 - corrupt terrain → 409, not 500
        raise HTTPException(409, f"run terrain unreadable: {exc}") from None

    rasters: dict[str, Any] = {}
    for kind, product in (("depth", "max_depth"), ("velocity", "max_velocity"), ("arrival", "arrival_time")):
        row = catalog.product_latest(product, run_id=run_id)
        fp = paths.abs_path(row["path"]) if row and row.get("path") else None
        if not fp or not fp.exists():
            raise HTTPException(409, f"run has no {product} raster yet")
        rasters[kind] = fp

    source_id = spec.get("dam_id")
    source = db.query_one("SELECT * FROM dam WHERE id = %s", (source_id,)) if source_id else None
    source_ll = _dam_lonlat(source) if source else None

    depth_thr = float(body.get("depth_threshold_m") or 0.1)
    reach_km = float(body.get("reach_km") or 25.0)
    max_dams = int(body.get("max_dams") or 20)
    make_scenarios = bool(body.get("create_scenarios"))

    import rasterio  # noqa: PLC0415

    ds_depth = rasterio.open(rasters["depth"])
    ds_vel = rasterio.open(rasters["velocity"])
    ds_arr = rasterio.open(rasters["arrival"])
    # Bed fallback with raster bounds (can exceed the dem.npz grid after
    # conditioning) so edge dams still get a crest evaluation.
    ds_bed = None
    bed_row = catalog.product_latest("conditioned_dem", run_id=run_id)
    bed_fp = paths.abs_path(bed_row["path"]) if bed_row and bed_row.get("path") else None
    if bed_fp and bed_fp.exists():
        try:
            ds_bed = rasterio.open(bed_fp)
        except Exception:  # noqa: BLE001 - bed stays DEM-grid-only
            ds_bed = None
    rows_n, cols_n = int(dem_meta["rows"]), int(dem_meta["cols"])
    try:
        dams = db.query(
            "SELECT id, name, state, location, dam_type, crest_m, height_m, crest_length_m "
            "FROM dam WHERE location IS NOT NULL"
        )
        out: list[dict[str, Any]] = []
        created: list[dict[str, Any]] = []
        for dam in dams:
            dam_id = str(dam["id"])
            if source_id and dam_id == str(source_id):
                continue
            ll = _dam_lonlat(dam)
            if not ll:
                continue
            lon, lat = ll
            if not (bbox[0] - 0.05 <= lon <= bbox[2] + 0.05 and bbox[1] - 0.05 <= lat <= bbox[3] + 0.05):
                continue
            # Domain test on the raster itself (its bounds can exceed the DEM
            # grid after conditioning); bed comes from the DEM when covered.
            try:
                rr, cc = ds_depth.index(lon, lat)
                in_grid = 0 <= rr < ds_depth.height and 0 <= cc < ds_depth.width
            except Exception:  # noqa: BLE001 - outside raster → outside domain
                in_grid = False
                rr, cc = -1, -1
            dem_ri = min(max(int(round((dem_meta["origin_lat"] - lat) / dem_meta["dy_deg"] - 0.5)), 0), rows_n - 1)
            dem_ci = min(max(int(round((lon - dem_meta["origin_lon"]) / dem_meta["dx_deg"] - 0.5)), 0), cols_n - 1)
            dem_covered = (
                0 <= (dem_meta["origin_lat"] - lat) / dem_meta["dy_deg"] - 0.5 < rows_n
                and 0 <= (lon - dem_meta["origin_lon"]) / dem_meta["dx_deg"] - 0.5 < cols_n
            )
            depth = vel = arr = None
            bed = None
            if in_grid:
                try:
                    depth = float(list(ds_depth.sample([(lon, lat)]))[0][0])
                    vel = float(list(ds_vel.sample([(lon, lat)]))[0][0])
                    arr = float(list(ds_arr.sample([(lon, lat)]))[0][0])
                    if dem_covered:
                        bed = float(dem_z[dem_ri, dem_ci])
                    elif ds_bed is not None:
                        try:
                            bed = float(list(ds_bed.sample([(lon, lat)]))[0][0])
                        except Exception:  # noqa: BLE001 - bed stays unknown
                            bed = None
                except Exception:  # noqa: BLE001 - unreadable cell reads dry
                    depth = None
            wet = in_grid and depth is not None and depth > depth_thr
            crest = dam.get("crest_m")
            if crest is None and dam.get("height_m") and bed is not None:
                crest = bed + float(dam["height_m"])
            level = bed + depth if (bed is not None and depth is not None) else None
            overtopped: bool | None = None
            if wet and crest is not None and level is not None:
                overtopped = bool(level > float(crest))
            if not in_grid:
                status = "outside-domain"
            elif not wet:
                status = "dry"
            elif overtopped is True:
                status = "overtopped"
            elif overtopped is False:
                status = "exposed"
            else:
                status = "exposed-unknown-geometry"
            entry: dict[str, Any] = {
                "dam_id": dam_id,
                "name": dam.get("name"),
                "state": dam.get("state"),
                "lon": lon,
                "lat": lat,
                "distance_km": round(_hav_km(source_ll[0], source_ll[1], lon, lat), 1) if source_ll else None,
                "max_depth_m": round(depth, 2) if depth is not None else None,
                "max_vel_ms": round(vel, 2) if vel is not None else None,
                "arrival_hr": round(arr, 3) if arr is not None and arr >= 0 else None,
                "bed_m": round(bed, 1) if bed is not None else None,
                "crest_m": round(float(crest), 1) if crest is not None else None,
                "overtopped": overtopped,
                "status": status,
                "scenario_id": None,
            }
            if make_scenarios and status in ("overtopped", "exposed") and dam.get("height_m"):
                entry["scenario_id"] = _cascade_counterpart(
                    dam, lon, lat, bed, crest, reach_km, run, spec
                )
                if entry["scenario_id"]:
                    created.append({"dam_id": dam_id, "scenario_id": entry["scenario_id"]})
            out.append(entry)
    finally:
        ds_depth.close()
        ds_vel.close()
        ds_arr.close()
        if ds_bed is not None:
            ds_bed.close()

    out.sort(key=lambda e: (e["distance_km"] is None, e["distance_km"] or 0))
    return {
        "run_id": run_id,
        "source_dam": (
            {"dam_id": str(source["id"]), "name": source.get("name"),
             "lon": source_ll[0], "lat": source_ll[1]} if source and source_ll else None
        ),
        "depth_threshold_m": depth_thr,
        "dams": out[:max_dams],
        "scenarios_created": created,
    }


def _cascade_counterpart(
    dam: dict[str, Any],
    lon: float,
    lat: float,
    bed: float | None,
    crest: float | None,
    reach_km: float,
    run: dict[str, Any],
    spec: dict[str, Any],
) -> str | None:
    """Draft one counterpart scenario from recorded dam geometry.

    Breach via Froehlich (computed), reservoir via app-standard fallback
    (storage 0 → breach-implied volume) — the same assumptions any analyst run
    with blank pondage gets. AOI is a reach-sized box on the dam; the Build
    page exists to refine it. Returns the scenario id or None.
    """
    import math  # noqa: PLC0415

    height = float(dam["height_m"])
    lat_rad = math.radians(lat)
    half = (reach_km / 2) / 111.32
    half_lon = half / max(math.cos(lat_rad), 0.05)
    res = spec.get("reservoir") or {}
    horizon = spec.get("horizon") or {}
    dam_type = {"concrete": "concrete_faced"}.get((dam.get("dam_type") or "").lower(), "homogeneous")
    initial = float(crest) if crest is not None else (bed + height if bed is not None else height)
    counterpart = {
        "case": spec.get("case", "2"),
        "name": f"Cascade counterpart — {dam.get('name')} (from run {str(run['id'])[:8]})",
        "dam_id": str(dam["id"]),
        "dam_type": dam_type,
        "erodibility": spec.get("erodibility", "medium"),
        "engine": run.get("engine", "fast"),
        "aoi": {
            "type": "bbox",
            "crs": "EPSG:4326",
            "coords": [lon - half_lon, lat - half, lon + half_lon, lat + half],
        },
        "breach": {
            "mode": "overtopping",
            "method": "froehlich2008",
            "chainage_m": 0.0,
            "width_m": 0.0,
            "depth_m": 0.0,
            "side_slope": 1.0,
            "formation_time_hr": 0.0,
            "timing": {"instantaneous": False},
        },
        "reservoir": {
            "initial_level_m": initial,
            "crest_level_m": float(crest) if crest is not None else None,
            "bed_level_m": bed,
            "dam_height_m": height,
            "storage_mcm": 0.0,
            "area_km2": 0.0,
            "inflow_cms": float(res.get("inflow_cms") or 0.0),
        },
        "horizon": {"dt_s": float(horizon.get("dt_s") or 1.0), "duration_hr": float(horizon.get("duration_hr") or 6.0)},
        "stations_km": [0.0, 5.0, 10.0, 15.0, 20.0],
        "provenance": {
            "producer": "cascade",
            "trigger": "manual",
            "inputs": [f"cascade:{run['id']}", f"source-dam:{spec.get('dam_id')}"],
        },
    }
    try:
        row = catalog.scenario_create(counterpart)
        return str(row["id"])
    except Exception:  # noqa: BLE001 - draft failure must not fail screening
        return None
