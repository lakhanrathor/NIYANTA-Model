"""mesh: centerline (steepest descent), stations, dam line, grid2d meta."""

from __future__ import annotations

from typing import Any

import numpy as np

NEIGH8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _walk_cells(r0: int, c0: int, r1: int, c1: int) -> list[tuple[int, int]]:
    """8-connected straight steps from (r0, c0) toward (r1, c1), exclusive."""
    cells: list[tuple[int, int]] = []
    r, c = r0, c0
    while (r, c) != (r1, c1):
        r += 0 if r == r1 else (1 if r1 > r else -1)
        c += 0 if c == c1 else (1 if c1 > c else -1)
        cells.append((r, c))
    return cells


def _pit_escape(z: np.ndarray, r: int, c: int, seen: set[tuple[int, int]],
                max_ring: int) -> tuple[int, int] | None:
    """Nearest lower cell within `max_ring` Chebyshev rings (exclusive)."""
    h, w = z.shape
    here = float(z[r, c])
    for ring in range(1, max_ring + 1):
        best: tuple[int, int] | None = None
        best_z = here
        for dr in range(-ring, ring + 1):
            for dc in range(-ring, ring + 1):
                if max(abs(dr), abs(dc)) != ring:
                    continue
                nr, nc = r + dr, c + dc
                if not (0 <= nr < h and 0 <= nc < w) or (nr, nc) in seen:
                    continue
                v = float(z[nr, nc])
                if v < best_z:
                    best_z = v
                    best = (nr, nc)
        if best is not None:
            return best
    return None


def trace_centerline(z: np.ndarray, start: tuple[int, int], max_ring: int = 24) -> np.ndarray:
    """Steepest-descent path from start cell to the domain edge (thalweg).

    Conditioned DEMs still hold flats and pits at cell scale — and reservoir
    conditioning can flatten a ~1 km impoundment plateau around the dam. A
    pure greedy walk stalls at the first one and every downstream gauge clamps
    to that cell. On a stall the walk steps toward the nearest lower cell
    within `max_ring` rings (≈1.3 km at 53 m cells, verified to converge on
    the Rini gorge where 12 rings stalled) and continues — chainage stays
    monotonic, gauges land down-valley instead of on top of the dam.
    """
    h, w = z.shape
    r, c = int(start[0]), int(start[1])
    path = [(r, c)]
    seen = {(r, c)}
    for _ in range(h + w + 16):
        if r in (0, h - 1) or c in (0, w - 1):
            break
        best = None
        best_drop = -1e-9
        for dr, dc in NEIGH8:
            nr, nc = r + dr, c + dc
            if (nr, nc) in seen:
                continue
            drop = float(z[r, c] - z[nr, nc])
            if drop > best_drop:
                best_drop = drop
                best = (nr, nc)
        if best is None or best_drop <= 0:
            esc = _pit_escape(z, r, c, seen, max_ring)
            if esc is None:
                break
            for cell in _walk_cells(r, c, esc[0], esc[1]):
                if cell not in seen:
                    seen.add(cell)
                    path.append(cell)
            r, c = esc
            continue
        r, c = best
        seen.add((r, c))
        path.append((r, c))
    return np.asarray(path, dtype=np.int64)


def stations_along(path: np.ndarray, cell_m: float, stations_km: list[float]) -> dict[float, tuple[int, int]]:
    """Map chainage (km) to nearest centerline cell."""
    if len(path) < 2:
        return {float(km): (int(path[0][0]), int(path[0][1])) for km in stations_km}
    seg = np.sqrt(np.sum(np.diff(path.astype(np.float64), axis=0) ** 2, axis=1)) * cell_m
    chain = np.concatenate([[0.0], np.cumsum(seg)])
    total_km = chain[-1] / 1000.0
    out: dict[float, tuple[int, int]] = {}
    for km in stations_km:
        if km <= 0:
            i = 0
        elif km >= total_km:
            i = len(path) - 1
        else:
            i = int(np.argmin(np.abs(chain - km * 1000.0)))
        out[float(km)] = (int(path[i][0]), int(path[i][1]))
    return out


def dam_line(z: np.ndarray, dam_rc: tuple[int, int], path: np.ndarray,
             cell_m: float, max_span_m: float = 6000.0) -> np.ndarray:
    """Cells along the dam axis: perpendicular to the local channel direction,
    extended both ways until the terrain rises above the valley shoulders."""
    r, c = int(dam_rc[0]), int(dam_rc[1])
    head = path[: min(8, len(path))]
    tail = path[max(0, len(path) - 8):]
    dirs = tail.astype(np.float64) - head.astype(np.float64)
    d = dirs.sum(axis=0)
    if np.allclose(d, 0):
        d = np.array([1.0, 0.0])
    # channel direction (dr, dc); perpendicular (dc, -dr) normalized
    d = d / np.hypot(*d)
    perp = np.array([d[1], -d[0]])

    h, w = z.shape
    base = float(z[r, c])
    zmin = float(z.min())
    zmax = float(z.max())
    shoulder = base + 0.35 * max(zmax - zmin, 10.0)
    cells = [(r, c)]
    for sign in (1.0, -1.0):
        rr, cc = float(r), float(c)
        dist = 0.0
        while dist < max_span_m:
            rr += perp[0] * sign
            cc += perp[1] * sign
            ri, ci = int(round(rr)), int(round(cc))
            if not (0 <= ri < h and 0 <= ci < w):
                break
            if (ri, ci) not in cells:
                cells.append((ri, ci))
            if float(z[ri, ci]) > shoulder and dist > cell_m * 3:
                break
            dist += cell_m
    return np.asarray(cells, dtype=np.int64)


def breach_cells_from_line(line: np.ndarray, dam_rc: tuple[int, int], cell_m: float,
                           bottom_width_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Subset of dam-line cells within bottom_width/2 of the dam cell."""
    dr = line[:, 0].astype(np.float64) - dam_rc[0]
    dc = line[:, 1].astype(np.float64) - dam_rc[1]
    dist = np.hypot(dr, dc) * cell_m
    keep = dist <= max(bottom_width_m / 2.0 + cell_m / 2.0, cell_m)
    if not np.any(keep):
        keep = dist <= dist.min() + cell_m
    sel = line[keep]
    return sel[:, 0], sel[:, 1]


def build(z: np.ndarray, dam_rc: tuple[int, int], cell_m: float,
          stations_km: list[float]) -> dict[str, Any]:
    path = trace_centerline(z, dam_rc)
    line = dam_line(z, dam_rc, path, cell_m)
    stations = stations_along(path, cell_m, stations_km)
    chainage_m = float(len(path)) * cell_m
    return {
        "centerline": path,
        "dam_line": line,
        "dam_rc": (int(dam_rc[0]), int(dam_rc[1])),
        "stations_km": stations,
        "centerline_length_m": chainage_m,
        "sections_count": max(2, int(chainage_m // 150)),
    }
