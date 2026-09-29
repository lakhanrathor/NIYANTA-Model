"""DEM conditioning: priority-flood pit fill, sink smoothing, synthetic valley DEM."""

from __future__ import annotations

import heapq
from typing import Any

import numpy as np


def pit_fill(z: np.ndarray) -> np.ndarray:
    """Priority-flood pit filling (Barnes et al. 2014) — edges are seeds."""
    h, w = z.shape
    filled = z.copy()
    visited = np.zeros((h, w), dtype=bool)
    heap: list[tuple[float, int, int]] = []

    for x in range(w):
        for y in (0, h - 1):
            if not visited[y, x]:
                visited[y, x] = True
                heapq.heappush(heap, (float(filled[y, x]), y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x]:
                visited[y, x] = True
                heapq.heappush(heap, (float(filled[y, x]), y, x))

    while heap:
        v, y, x = heapq.heappop(heap)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                visited[ny, nx] = True
                nv = max(float(z[ny, nx]), v)
                filled[ny, nx] = nv
                heapq.heappush(heap, (nv, ny, nx))
    return filled


def condition(z: np.ndarray, smooth: bool = True) -> np.ndarray:
    z = np.nan_to_num(z, nan=float(np.nanmean(z)) if not np.all(np.isnan(z)) else 0.0)
    filled = pit_fill(z)
    if smooth:
        from scipy.ndimage import uniform_filter

        blended = uniform_filter(filled, size=3)
        # keep pits filled: take max so smoothing never re-creates sinks below neighbours
        filled = np.maximum(filled, blended) * 0.5 + blended * 0.5
        filled = pit_fill(filled)
    return filled.astype(np.float32)


def synthetic_valley(height: int = 240, width: int = 240, cell_m: float = 100.0,
                     relief_m: float = 600.0, channel_depth_m: float = 35.0,
                     seed: int = 7) -> tuple[np.ndarray, dict[str, Any]]:
    """Generate a realistic river-valley DEM (no external data needed).

    Long profile: monotone descent with knickpoints.
    Cross profile: parabolic valley walls + floodplain flat.
    """
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width].astype(np.float64)

    # channel centerline meanders around mid-column
    meander = (width * 0.14) * np.sin(y / height * np.pi * 2.4) + (width * 0.05) * np.sin(y / height * np.pi * 6.1)
    cx = width * 0.5 + meander
    dist = np.abs(x - cx)

    # valley half-width grows downstream (toward bottom of array)
    valley_w = width * (0.10 + 0.16 * (y / height))
    wall_factor = np.clip((dist - valley_w) / np.maximum(valley_w, 1.0), 0, None)
    valley = (wall_factor ** 1.6) * relief_m * 0.9

    # long profile: elevation drops from top to bottom
    bed = relief_m * 1.35 - (y / height) * (relief_m * 1.15)
    bed += 30.0 * np.sin(y / height * np.pi * 3.0) * 0.3  # knickpoints

    # channel incision (parabolic near center)
    incision = channel_depth_m * np.exp(-((dist / np.maximum(valley_w, 1.0)) ** 2))

    z = bed + valley - incision
    z += rng.normal(0, 2.5, z.shape)                    # micro-relief
    z = np.maximum(z, 0.0)
    return z.astype(np.float32), {
        "transform": [cell_m, 0.0, 0.0, 0.0, -cell_m, height * cell_m],
        "crs": "LOCAL",
        "width": width,
        "height": height,
        "nodata": None,
        "synthetic": True,
        "cell_m": cell_m,
    }
