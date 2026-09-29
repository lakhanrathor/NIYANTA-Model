"""Impact time series: area by hazard class + flood-front reach per output frame.

Built from the persisted frame stack (stage.post) so the numbers match the
published rasters exactly — same primed-pool mask, same extent threshold.
Stored on `run.result["series"]` and served by GET /runs/{id}/series.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from modules.catalog import catalog
from modules.run import result as run_result
from modules.run.work_mesh import load_mesh
from modules.solvers.base import FrameSeries
from modules.storage import paths

FLOOD_MIN_M = 0.1  # keep in sync with work_post.EXTENT_THRESHOLD_M
LOW_MAX_M = 0.5  # hazard bands: low [min, 0.5), moderate [0.5, 2), high >= 2
HIGH_MIN_M = 2.0


def build(frames: FrameSeries, mesh: dict[str, Any], cell_m: float,
          min_m: float = FLOOD_MIN_M) -> dict[str, Any]:
    depth = frames.depth.astype(np.float32, copy=False)
    n_f, rows, cols = depth.shape
    r0, c0 = mesh["dam_rc"]
    yy, xx = np.mgrid[0:rows, 0:cols]
    dist_km = np.sqrt(((yy - r0) * cell_m) ** 2 + ((xx - c0) * cell_m) ** 2) / 1000.0
    cell_km2 = cell_m * cell_m / 1e6

    times_s: list[float] = []
    total: list[float] = []
    low: list[float] = []
    moderate: list[float] = []
    high: list[float] = []
    reach: list[float] = []
    for i in range(n_f):
        d = depth[i]
        wet = d > min_m
        lo = wet & (d < LOW_MAX_M)
        md = wet & (d >= LOW_MAX_M) & (d < HIGH_MIN_M)
        hi = wet & (d >= HIGH_MIN_M)
        times_s.append(round(float(frames.times_s[i]), 1))
        total.append(round(float(wet.sum()) * cell_km2, 4))
        low.append(round(float(lo.sum()) * cell_km2, 4))
        moderate.append(round(float(md.sum()) * cell_km2, 4))
        high.append(round(float(hi.sum()) * cell_km2, 4))
        reach.append(round(float(dist_km[wet].max()), 3) if wet.any() else 0.0)

    return {
        "times_s": times_s,
        "area_km2": {"total": total, "low": low, "moderate": moderate, "high": high},
        "reach_km": reach,
        "threshold_m": float(min_m),
        "bands_m": [float(LOW_MAX_M), float(HIGH_MIN_M)],
    }


def ensure(run_id: str) -> dict[str, Any]:
    """Stored series for a run, rebuilt from frames.npz on first request.

    Also back-fills station lon/lat for runs persisted before those columns
    existed, so the gauge markers can be plotted on the map.
    """
    run = catalog.run_get(run_id)
    if not run:
        raise FileNotFoundError(run_id)
    result = run.get("result") or {}
    stored = result.get("series")
    stations = result.get("stations") or []
    missing_lonlat = bool(stations) and any(
        s.get("lon") is None or "in_domain" not in s for s in stations
    )
    if stored and not missing_lonlat:
        return stored

    patched: dict[str, Any] = {}
    mesh: dict[str, Any] | None = None
    if not stored:
        run_dir = paths.run_dir(run_id)
        frames = FrameSeries.load(run_dir / "frames.npz")
        mesh = load_mesh(run_id)
        grid = frames.meta.get("grid")
        if not grid or "cell_m" not in grid:
            from modules.run import work_terrain

            _, grid = work_terrain.load_dem(run_id)
        patched["series"] = build(frames, mesh, float(grid["cell_m"]))

    if missing_lonlat:
        from modules.run import grid as grid_mod
        from modules.run import work_terrain

        _, meta = work_terrain.load_dem(run_id)
        mesh = mesh or load_mesh(run_id)
        cell_m = float(meta["cell_m"])
        centerline_m = float(len(mesh["centerline"])) * cell_m
        for st in stations:
            if st.get("lon") is None:
                rc = mesh["stations_km"].get(float(st.get("km", -1)))
                if rc:
                    lon, lat = grid_mod.cell_to_lonlat(meta, rc[0], rc[1])
                    st["lon"], st["lat"] = float(lon), float(lat)
            if "in_domain" not in st:
                st["in_domain"] = float(st.get("km", 0.0)) * 1000.0 <= centerline_m + cell_m
        patched["stations"] = stations

    if patched:
        run_result.merge(run_id, **patched)
    return patched.get("series") or stored or {}
