"""Centreline tracing: greedy descent must escape cell-scale pits/flats."""

from __future__ import annotations

import numpy as np

from modules.mesh.build import stations_along, trace_centerline


def _valley(rows: int, cols: int, fall: float = 2.0) -> np.ndarray:
    """South-falling valley with parabolic walls so the walk stays central."""
    z = np.zeros((rows, cols), dtype=np.float64)
    mid = (cols - 1) / 2
    for r in range(rows):
        for c in range(cols):
            z[r, c] = 100.0 - r * fall + 0.6 * (c - mid) ** 2
    return z


def test_trace_escapes_pit_and_reaches_edge():
    # valley falling south with a flat pit band at rows 6-7
    z = _valley(20, 30)
    z[6:8, :] = z[6, :].min()  # flat shelf: pure greedy stalls here
    z[6:8, 15] += 0.5  # one high cell so the shelf is a true local flat
    path = trace_centerline(z, (2, 15))
    assert len(path) > 12, f"stalled at {len(path)} cells"
    assert path[-1][0] == 19, "must reach the domain edge"


def test_trace_no_false_progress_on_bowl():
    # closed depression: escape finds nothing lower, walk ends honestly
    z = np.full((10, 10), 50.0)
    z[4:6, 4:6] = 40.0
    path = trace_centerline(z, (4, 4))
    assert len(path) >= 1


def test_stations_spread_down_valley():
    z = _valley(60, 30)
    path = trace_centerline(z, (2, 15))
    stations = stations_along(path, 50.0, [0.0, 1.0, 2.0])
    rows = [stations[k][0] for k in (0.0, 1.0, 2.0)]
    assert rows[0] < rows[1] < rows[2], f"stations pile up: {rows}"
