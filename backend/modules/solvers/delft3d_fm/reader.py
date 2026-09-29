"""D-Flow FM result reader — *_map.nc / *_his.nc → FrameSeries components.

Element fields are mapped back onto the run's conditioned grid by their
lon/lat centres (round-trip against grid_meta), so post/impact stages see the
same (H, W) arrays the fast/sph engines produce. No interpolation is needed:
the mesh was built from the same grid — only the row flip back to north-up.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np


def _seconds_axis(nc_time, values: np.ndarray) -> np.ndarray:
    units = str(getattr(nc_time, "units", "")).lower()
    if "minute" in units:
        return values * 60.0
    if "hour" in units:
        return values * 3600.0
    if "day" in units:
        return values * 86400.0
    return values  # seconds since ref (DFM map default)


def _resample(t_src: np.ndarray, arr: np.ndarray,
              t_q: np.ndarray) -> np.ndarray:
    """Linear resample (nT, ...) along axis 0 onto times t_q."""
    if t_src.size == 1:
        return np.repeat(arr[:1], len(t_q), axis=0)
    pos = np.interp(t_q, t_src, np.arange(t_src.size, dtype=np.float64))
    lo = np.clip(np.floor(pos).astype(np.int64), 0, t_src.size - 1)
    hi = np.clip(lo + 1, 0, t_src.size - 1)
    w = (pos - lo).reshape((-1,) + (1,) * (arr.ndim - 1))
    return arr[lo] * (1.0 - w) + arr[hi] * w


def _scatter(series_e: np.ndarray, rows: np.ndarray, cols: np.ndarray,
             ok: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """(nF, nE) element series → (nF, H, W) via per-cell maximum."""
    n_f = series_e.shape[0]
    out = np.zeros((n_f, shape[0], shape[1]), dtype=np.float32)
    rows_ok, cols_ok = rows[ok], cols[ok]
    src = series_e[:, ok]
    for f in range(n_f):
        np.maximum.at(out[f], (rows_ok, cols_ok), src[f])
    return out


def _mass_balance(model_dir: Path, model_name: str,
                  storage_scale: float) -> float | None:
    his = model_dir / "output" / f"{model_name}_his.nc"
    if not his.exists():
        return None
    import netCDF4

    try:
        with netCDF4.Dataset(str(his)) as ds:
            err = np.asarray(ds.variables["water_balance_volume_error"][:],
                             dtype=np.float64)
            storage = np.asarray(ds.variables["water_balance_storage"][:],
                                 dtype=np.float64)
    except (KeyError, OSError):
        return None
    denom = max(float(np.max(np.abs(storage))), storage_scale, 1.0)
    return float(abs(err[-1]) / denom * 100.0)


def read(model_dir: Path, model_name: str, *, geo: dict[str, Any],
         stations_km: dict[str, tuple[int, int]], cell_m: float,
         duration_s: float, frames: int,
         arrival_threshold_m: float = 0.05) -> dict[str, Any]:
    """Read finished map output into FrameSeries-ready arrays + meta."""
    import netCDF4

    map_path = model_dir / "output" / f"{model_name}_map.nc"
    if not map_path.exists():
        raise RuntimeError(f"D-Flow FM map output missing: {map_path}")

    h, w = int(geo["rows"]), int(geo["cols"])
    with netCDF4.Dataset(str(map_path)) as ds:
        t = _seconds_axis(ds.variables["time"], np.asarray(ds.variables["time"][:], dtype=np.float64))
        depth_e = np.clip(np.asarray(ds.variables["waterdepth"][:], dtype=np.float32), 0.0, None)
        ucx_e = np.asarray(ds.variables["ucx"][:], dtype=np.float32)
        ucy_e = np.asarray(ds.variables["ucy"][:], dtype=np.float32)
        if "FlowElem_xcc" in ds.variables:
            lon = np.asarray(ds.variables["FlowElem_xcc"][:], dtype=np.float64)
            lat = np.asarray(ds.variables["FlowElem_ycc"][:], dtype=np.float64)
        else:
            lon = lat = None
    if lon is None or lat is None:
        raise RuntimeError("map output lacks element centres (FlowElem_xcc/ycc)")

    col = np.rint((lon - geo["origin_lon"]) / geo["dx_deg"] - 0.5).astype(np.int64)
    row_s = np.rint((lat - (geo["origin_lat"] - h * geo["dy_deg"]))
                    / geo["dy_deg"] - 0.5).astype(np.int64)
    ok = (col >= 0) & (col < w) & (row_s >= 0) & (row_s < h)
    row = h - 1 - row_s

    record_step = duration_s / max(frames, 1)
    t_q = np.array([record_step * (i + 1) for i in range(frames)], dtype=np.float64)
    if t_q[-1] > t[-1] + 1e-6:
        t_q = np.minimum(t_q, t[-1])

    depth_q = _resample(t, depth_e, t_q)
    speed_q = _resample(t, np.hypot(ucx_e, ucy_e), t_q)
    ucy_q = _resample(t, ucy_e, t_q)
    depth_grid = _scatter(depth_q, row, col, ok, (h, w))
    vel_grid = _scatter(speed_q, row, col, ok, (h, w))

    max_depth = depth_grid.max(axis=0)
    max_vel = vel_grid.max(axis=0)
    arrival = np.full((h, w), np.nan, dtype=np.float32)
    for f in range(depth_grid.shape[0]):
        wet = (depth_grid[f] > arrival_threshold_m) & np.isnan(arrival)
        arrival[wet] = t_q[f]

    # station series + approximate cross-section discharge (element flux)
    stations: dict[str, Any] = {}
    for km, (sr, sc) in stations_km.items():
        key = str(km)
        rr = slice(max(sr - 3, 0), min(sr + 4, h))
        cc = slice(max(sc - 3, 0), min(sc + 4, w))
        band_depth = depth_grid[:, rr, cc].max(axis=(1, 2))
        sel = ((np.abs(row - sr) <= 1) & (np.abs(col - sc) <= 8) & ok)
        if np.any(sel):
            # southward flux through the station line (ucy is north-positive)
            q = np.abs(np.sum(-ucy_q[:, sel] * depth_q[:, sel], axis=1)) * cell_m
        else:
            q = np.zeros(len(t_q))
        stations[key] = {
            "times_s": [round(float(x), 2) for x in t_q],
            "depth_m": [round(float(x), 3) for x in band_depth],
            "q_cms": [round(float(x), 1) for x in q],
        }

    storage_scale = float(max_depth.sum() * cell_m * cell_m)
    mb = _mass_balance(model_dir, model_name, storage_scale)
    meta: dict[str, Any] = {
        "engine": "delft3d",
        "native_timesteps": int(depth_e.shape[0]),
        "mapped_elements": int(np.count_nonzero(ok)),
    }
    if mb is not None:
        meta["mass_balance_error_pct"] = mb
    return {
        "times_s": t_q,
        "depth": depth_grid.astype(np.float16),
        "max_depth": max_depth,
        "max_vel": max_vel,
        "arrival_s": arrival,
        "stations": stations,
        "meta": meta,
    }
