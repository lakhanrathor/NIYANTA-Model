"""stage.post — canonical rasters, PNG playback frames, station tables, metrics."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from modules.catalog import catalog
from modules.jobs.queue import JobContext
from modules.proc_dem import mod_detect
from modules.run import grid as grid_mod
from modules.run import result as run_result
from modules.run import work_terrain
from modules.run.series import build as build_series
from modules.run.work_mesh import load_mesh
from modules.solvers.base import FrameSeries
from modules.storage import paths

EXTENT_THRESHOLD_M = 0.1


def handle_post(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    spec = catalog.scenario_get(run["scenario_id"])["spec"]
    ctx.progress(71, "post: loading frames")

    run_dir = paths.run_dir(run_id)
    frames = FrameSeries.load(run_dir / "frames.npz")
    # A cell already at (or near) its peak depth in the first output instant is
    # a primed reservoir pool, not flood water. Without this a deep upstream
    # basin reports as a 200 m "flood"; playback frames keep the stored pool.
    first = frames.depth[0].astype(np.float32)
    primed = (first > EXTENT_THRESHOLD_M) & (first >= 0.98 * frames.max_depth)
    flood_depth = np.where(primed, 0.0, frames.max_depth)
    flood_arrival = np.where(primed, np.nan, frames.arrival_s)
    # Persist the same mask on the frame series: every downstream stage
    # (impact, validate, playback) must see the flood the rasters publish, not
    # the primed reservoir pool the solver started with.
    frames.depth = np.where(primed, 0.0, frames.depth)
    frames.max_depth = flood_depth
    frames.max_vel = np.where(primed, 0.0, frames.max_vel)
    frames.arrival_s = flood_arrival
    frames.save(run_dir / "frames.npz")
    grid_meta = frames.meta.get("grid") or work_terrain.load_dem(run_id)[1]
    gt = grid_mod.geotransform(grid_meta)
    raster_meta = {"transform": gt, "crs": "EPSG:4326",
                   "width": int(frames.max_depth.shape[1]), "height": int(frames.max_depth.shape[0]),
                   "nodata": None}

    rasters: dict[str, str] = {}
    arrival_hr = np.where(np.isnan(flood_arrival), -1.0, flood_arrival / 3600.0)
    for kind, arr in (
        ("max_depth", flood_depth),
        ("max_velocity", frames.max_vel),
        ("arrival_time", arrival_hr.astype(np.float32)),
        ("inundation_extent", (flood_depth > EXTENT_THRESHOLD_M).astype(np.float32)),
    ):
        path = run_dir / f"{kind}.tif"
        mod_detect.write_geotiff(path, arr, raster_meta)
        rasters[kind] = paths.rel(path)
        catalog.product_create(kind, paths.rel(path), run_id=run_id, meta={"threshold": EXTENT_THRESHOLD_M})
    ctx.progress(75, "post: rasters written")

    # ---- PNG playback frames (georeferenced via index bounds)
    frame_dir = paths.tiles_dir(run_id, "depth")
    for old in frame_dir.glob("f*.png"):
        old.unlink()
    scale = float(min(max(frames.max_depth.max(), 1.0), 10.0))
    from matplotlib import colormaps

    cmap = colormaps["turbo"]
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        Image = None
    png_times: list[float] = []
    if Image is not None:
        for i in range(frames.depth.shape[0]):
            d = frames.depth[i].astype(np.float32)
            rgba = cmap(np.clip(d / scale, 0.0, 1.0))
            img = (rgba[..., :3] * 255).astype(np.uint8)
            img[d <= EXTENT_THRESHOLD_M] = (240, 240, 240)  # dry background
            Image.fromarray(img).save(frame_dir / f"f{i:03d}.png")
            png_times.append(round(float(frames.times_s[i]), 1))
    index = {
        "times_s": png_times,
        "bounds": list(grid_mod.bounds(grid_meta)),
        "depth_scale_m": scale,
        "grid": [int(frames.max_depth.shape[0]), int(frames.max_depth.shape[1])],
    }
    (frame_dir / "index.json").write_text(json.dumps(index), encoding="utf-8")
    catalog.product_create("depth_frames", paths.rel(frame_dir / "index.json"), run_id=run_id,
                           meta={"count": len(png_times), "scale_m": scale})
    ctx.progress(78, f"post: {len(png_times)} playback frames")

    # ---- stations
    mesh = load_mesh(run_id)
    z, _ = work_terrain.load_dem(run_id)
    # A station further downstream than the traced centreline falls outside the
    # modelled domain; its sampled values are the clamped end-cell, not a real
    # measurement. Flag it so the UI can say so instead of repeating numbers.
    centerline_m = float(len(mesh["centerline"])) * float(grid_meta["cell_m"])
    stations_out: list[dict[str, Any]] = []
    for km_s, series in sorted(frames.stations.items(), key=lambda kv: float(kv[0])):
        depths = series["depth_m"]
        qs = series["q_cms"]
        times = series["times_s"]
        wet_idx = [i for i, d in enumerate(depths) if d > EXTENT_THRESHOLD_M]
        r, c = mesh["stations_km"].get(float(km_s), (0, 0))
        lon, lat = grid_mod.cell_to_lonlat(grid_meta, r, c)
        stations_out.append({
            "km": float(km_s),
            "name": f"CH{float(km_s):.1f}",
            "lon": float(lon),
            "lat": float(lat),
            "in_domain": float(km_s) * 1000.0 <= centerline_m + float(grid_meta["cell_m"]),
            "peak_cms": float(max(qs)) if qs else 0.0,
            "arrival_hr": (times[wet_idx[0]] / 3600.0) if wet_idx else None,
            "max_depth_m": float(max(depths)) if depths else 0.0,
            "max_stage_m": float(z[r, c] + max(depths)) if depths else float(z[r, c]),
        })

    # ---- metrics
    hg = json.loads((run_dir / "breach_hydrograph.json").read_text(encoding="utf-8"))
    cell_m = float(grid_meta["cell_m"])
    extent_cells = int(np.count_nonzero(flood_depth > EXTENT_THRESHOLD_M))
    metrics = {
        "peak_discharge_cms": float(hg["peak_cms"]),
        "peak_at_hr": float(hg["peak_at_hr"]),
        "max_depth_m": float(flood_depth.max()),
        "inundation_km2": extent_cells * cell_m * cell_m / 1e6,
        "primed_cells": int(np.count_nonzero(primed)),
        "volume_hm3": float(frames.meta.get("injected_hm3") or 0.0),
        "mass_balance_error_pct": float(frames.meta.get("mass_balance_error_pct") or 0.0),
        # SPH resolves only the breach window; the depth raster is clipped to it.
        "near_field_only": bool(frames.meta.get("near_field_only")),
        "window_m": float(frames.meta.get("window_m") or 0.0),
        "duration_hr": float((spec.get("horizon") or {}).get("duration_hr") or 24.0),
    }
    (run_dir / "stations.json").write_text(json.dumps(stations_out), encoding="utf-8")
    catalog.product_create("stations", paths.rel(run_dir / "stations.json"), run_id=run_id,
                           meta={"count": len(stations_out)})

    # ---- impact series (area by hazard class + flood-front reach over time)
    series = build_series(frames, mesh, cell_m, min_m=EXTENT_THRESHOLD_M)

    run_result.merge(run_id, metrics=metrics, rasters=rasters, stations=stations_out,
                     series=series)
    ctx.progress(79, f"post: max depth {metrics['max_depth_m']:.1f} m, "
                     f"{metrics['inundation_km2']:.1f} km²")
    return {"metrics": metrics, "rasters": len(rasters), "stations": len(stations_out),
            "series": len(series["times_s"])}
