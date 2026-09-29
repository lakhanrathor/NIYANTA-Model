"""infra_exposure — OSM roads/buildings sampled against every output frame.

One pass over the run's frame stack: each building (footprint centroid) and
each road segment (midpoint) inside the model grid gets its depth series, the
first/last frame it is wet, and its peak depth. The 3D player and the 2D map
colour infrastructure from this per frame (water reaching, submerging and
leaving it); the impact stage reads the same summary, so the counts on screen
and in the result doc are one computation.

Thresholds: building wet at > EXTENT_THRESHOLD_M (0.1 m, the flood-extent
rule); road cut at > ROAD_CUT_M (0.30 m, decision D7 — vehicles stall).
Cached beside frames.npz, rebuilt when frames or the OSM rows change.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from modules.db import client as db
from modules.run import grid as grid_mod
from modules.run import work_terrain
from modules.solvers.base import FrameSeries
from modules.storage import paths

BUILDING_WET_M = 0.1
ROAD_CUT_M = 0.30
M_PER_DEG = 111_320.0
CACHE_VERSION = 2

KINDS = "('building', 'road', 'bridge', 'hospital', 'school')"


def _rows(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    w, s, e, n = bbox
    # OSM clip: R*Tree probe on the footprint bbox (schema infra_rtree)
    out = db.query(
        f"""SELECT f.kind, f.name, f.geom FROM infra_rtree r
              JOIN infra_footprint f ON f.rowid = r.id
             WHERE r.maxx >= %s AND r.minx <= %s AND r.maxy >= %s AND r.miny <= %s
               AND f.kind IN {KINDS}""", (w, e, s, n))
    # demo/seeded layers live in vector_feature under `layer` (small table)
    out += db.query(
        f"""SELECT layer AS kind, name, geom FROM vector_feature
             WHERE layer IN {KINDS}
               AND ST_XMax(geom) >= %s AND ST_XMin(geom) <= %s
               AND ST_YMax(geom) >= %s AND ST_YMin(geom) <= %s""", (w, e, s, n))
    return out


def _coords(geom: dict[str, Any]) -> list[list[list[float]]]:
    """Every vertex run of a geometry as a list of [lon, lat] lists."""
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Point":
        return [[c]]
    if t in ("LineString", "MultiPoint"):
        return [c]
    if t in ("Polygon", "MultiLineString"):
        return list(c)
    if t == "MultiPolygon":
        return [ring for poly in c for ring in poly]
    return []


def build(run_id: str) -> dict[str, Any]:
    run_dir = paths.run_dir(run_id)
    frames = FrameSeries.load(run_dir / "frames.npz")
    meta = frames.meta.get("grid") or work_terrain.load_dem(run_id)[1]
    bbox = grid_mod.bounds(meta)
    depth = frames.depth  # (n, H, W) float32
    n_frames, rows_n, cols_n = depth.shape
    coslat = math.cos(math.radians((bbox[1] + bbox[3]) / 2))

    def cell(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        c = np.rint((lon - meta["origin_lon"]) / meta["dx_deg"] - 0.5).astype(np.int64)
        r = np.rint((meta["origin_lat"] - lat) / meta["dy_deg"] - 0.5).astype(np.int64)
        return np.clip(r, 0, rows_n - 1), np.clip(c, 0, cols_n - 1)

    def exposure(series: np.ndarray, thr: float) -> dict[str, Any]:
        wet = np.flatnonzero(series > thr)
        if wet.size == 0:
            return {}
        f0, f1 = int(wet[0]), int(wet[-1])
        return {"f0": f0, "f1": f1, "d": round(float(series.max()), 2),
                "s": [round(float(v), 1) for v in series[f0:f1 + 1]]}

    buildings: list[dict[str, Any]] = []
    roads: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []
    seen_points: set[tuple[str, float, float]] = set()
    w, s, e, n = bbox
    for row in _rows(bbox):
        try:
            geom = json.loads(row["geom"]) if isinstance(row["geom"], str) else row["geom"]
        except (TypeError, ValueError):
            continue
        runs = [r for r in _coords(geom or {}) if r]
        if not runs:
            continue
        kind = row["kind"]
        if kind == "road":
            for run in runs:
                pts = np.asarray(run, dtype=np.float64)
                if pts.shape[0] < 2:
                    continue
                a, b = pts[:-1], pts[1:]
                mid = (a + b) / 2
                inside = (mid[:, 0] >= w) & (mid[:, 0] <= e) & (mid[:, 1] >= s) & (mid[:, 1] <= n)
                if not inside.any():
                    continue
                a, b, mid = a[inside], b[inside], mid[inside]
                rr, cc = cell(mid[:, 0], mid[:, 1])
                series = depth[:, rr, cc].T  # (segments, n)
                seg_km = np.hypot((b[:, 0] - a[:, 0]) * coslat, b[:, 1] - a[:, 1]) * M_PER_DEG / 1000
                for i in range(len(a)):
                    item = {"p": [round(float(a[i, 0]), 6), round(float(a[i, 1]), 6),
                                  round(float(b[i, 0]), 6), round(float(b[i, 1]), 6)],
                            "km": round(float(seg_km[i]), 4)}
                    item.update(exposure(series[i], ROAD_CUT_M))
                    roads.append(item)
            continue
        ring = np.asarray(runs[0], dtype=np.float64)
        if ring.shape[0] > 1 and np.allclose(ring[0], ring[-1]):
            ring = ring[:-1]
        lon, lat = float(ring[:, 0].mean()), float(ring[:, 1].mean())
        if not (w <= lon <= e and s <= lat <= n):
            continue
        rr, cc = cell(np.array([lon]), np.array([lat]))
        series = depth[:, rr[0], cc[0]]
        if kind == "building":
            # footprint side from the shoelace area (m) — sizes the 3D block
            x = (ring[:, 0] - lon) * coslat * M_PER_DEG
            y = (ring[:, 1] - lat) * M_PER_DEG
            area = 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
            item = {"x": round(lon, 6), "y": round(lat, 6),
                    "a": round(max(math.sqrt(area), 4.0), 1)}
            item.update(exposure(series, BUILDING_WET_M))
            buildings.append(item)
        else:
            # the OSM clip mirrors bridges/hospitals/schools into vector_feature
            key = (kind, round(lon, 4), round(lat, 4))
            if key in seen_points:
                continue
            seen_points.add(key)
            item = {"k": kind, "n": row.get("name"), "x": round(lon, 6), "y": round(lat, 6)}
            item.update(exposure(series, BUILDING_WET_M))
            points.append(item)

    summary = {
        "buildings": len(buildings),
        "buildings_flooded": sum(1 for b in buildings if "f0" in b),
        "road_km": round(sum(r["km"] for r in roads), 2),
        "road_km_cut": round(sum(r["km"] for r in roads if "f0" in r), 2),
        "bridges": sum(1 for p in points if p["k"] == "bridge"),
        "bridges_flooded": sum(1 for p in points if p["k"] == "bridge" and "f0" in p),
    }
    return {
        "version": CACHE_VERSION,
        "frames": int(n_frames),
        "times_s": [round(float(t), 1) for t in frames.times_s],
        "thresholds": {"building_m": BUILDING_WET_M, "road_cut_m": ROAD_CUT_M},
        "summary": summary,
        "buildings": buildings,
        "roads": roads,
        "points": points,
    }


def ensure(run_id: str) -> dict[str, Any]:
    """Cached build: reused until frames.npz or the OSM rows inside it change."""
    run_dir = paths.run_dir(run_id)
    fp = run_dir / "infra_exposure.json"
    frames_fp = run_dir / "frames.npz"
    if not frames_fp.exists():
        raise FileNotFoundError("run has no frame stack yet")
    # only rows inside this run's grid matter — a download elsewhere must not
    # invalidate it (meta_json is read alone; the frame stack stays on disk)
    with np.load(frames_fp, allow_pickle=False) as z:
        meta = json.loads(str(z["meta_json"])).get("grid")
    if not meta:
        meta = work_terrain.load_dem(run_id)[1]
    w, s, e, n = grid_mod.bounds(meta)
    rows_now = db.query_one(
        "SELECT count(*) AS n FROM infra_rtree WHERE maxx >= %s AND minx <= %s "
        "AND maxy >= %s AND miny <= %s", (w, e, s, n))["n"]
    key = {"frames_mtime": frames_fp.stat().st_mtime, "infra_rows": int(rows_now),
           "version": CACHE_VERSION}
    if fp.exists():
        try:
            doc = json.loads(fp.read_text(encoding="utf-8"))
            if doc.get("_key") == key:
                return doc
        except ValueError:
            pass
    doc = build(run_id)
    doc["_key"] = key
    fp.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return doc
