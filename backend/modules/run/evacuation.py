"""Evacuation corridors (roadmap §7, G1, decisions D5/D7).

Origins are the buildings / hospitals / schools the flood reaches (their wet
window from infra_exposure). Each walks over the OSM road graph to the nearest
safe node — a road junction none of whose segments is ever cut (> 0.30 m) in
this run. The search is time-dependent: a segment can only be walked if the
walker leaves it before its own cut time. Departure is T+0 (breach start =
warning received).

    margin_h = water arrival at origin − walk time
    OK (margin ≥ leave-now) · LEAVE NOW (0 ≤ margin < leave-now) ·
    IMPOSSIBLE (no open path, or margin < 0)

Pure function `build(infra_doc)` + a cache keyed on the infra doc.
"""
from __future__ import annotations

import heapq
import json
import math
from typing import Any

import numpy as np

from config import settings
from modules.run import infra_exposure
from modules.storage import paths

CACHE_VERSION = 1
ORIGIN_KINDS = ("building", "hospital", "school")


def _classify(margin_h: float | None, leave_now_h: float) -> str:
    if margin_h is None or margin_h < 0:
        return "impossible"
    return "leave_now" if margin_h < leave_now_h else "ok"


def build(doc: dict[str, Any], walk_kmh: float | None = None, leave_now_h: float | None = None,
          snap_m: float | None = None) -> dict[str, Any]:
    walk_kmh = walk_kmh or settings.evac_walk_kmh
    leave_now_h = settings.evac_leave_now_h if leave_now_h is None else leave_now_h
    snap_m = snap_m or settings.evac_snap_m
    times = doc["times_s"]
    v_ms = walk_kmh / 3.6

    # ---- road graph: nodes = segment endpoints (shared coords join ways)
    node_id: dict[tuple[float, float], int] = {}
    xy: list[tuple[float, float]] = []
    adj: list[list[tuple[int, float, float]]] = []  # (to, metres, cut_s)
    ever_cut: list[bool] = []

    def nid(x: float, y: float) -> int:
        k = (x, y)
        if k not in node_id:
            node_id[k] = len(xy)
            xy.append(k)
            adj.append([])
            ever_cut.append(False)
        return node_id[k]

    for r in doc["roads"]:
        a = nid(r["p"][0], r["p"][1])
        b = nid(r["p"][2], r["p"][3])
        if a == b:
            continue
        cut = r.get("f0")
        cut_s = float(times[cut]) if cut is not None else math.inf
        metres = r["km"] * 1000
        adj[a].append((b, metres, cut_s))
        adj[b].append((a, metres, cut_s))
        if cut is not None:
            ever_cut[a] = ever_cut[b] = True
    safe = [bool(adj[i]) and not ever_cut[i] for i in range(len(xy))]

    origins = [{"k": "building", "n": None, **b} for b in doc["buildings"] if b.get("f0") is not None]
    origins += [p for p in doc["points"] if p["k"] in ORIGIN_KINDS and p.get("f0") is not None]

    assumptions = {
        "walk_kmh": walk_kmh, "leave_now_h": leave_now_h, "snap_m": snap_m,
        "road_cut_m": doc["thresholds"]["road_cut_m"], "departure": "T+0 (breach start)",
        "safe_node": "road junction with no segment ever cut in this run",
    }
    empty = {"origins": [], "corridors": [], "assembly": [],
             "stats": {"ok": 0, "leave_now": 0, "impossible": 0, "origins": 0},
             "assumptions": assumptions, "road_nodes": len(xy), "safe_nodes": int(sum(safe))}
    if not origins:
        return empty

    # ---- snap each origin to its nearest road node (equirectangular metres)
    lat0 = math.radians(sum(o["y"] for o in origins) / len(origins))
    kx, ky = 111_320.0 * math.cos(lat0), 111_320.0
    if xy:
        nodes = np.asarray(xy)
        nx, ny = nodes[:, 0] * kx, nodes[:, 1] * ky
    snap: list[tuple[int, float] | None] = []
    for o in origins:
        if not xy:
            snap.append(None)
            continue
        d = np.hypot(nx - o["x"] * kx, ny - o["y"] * ky)
        j = int(d.argmin())
        snap.append((j, float(d[j])) if d[j] <= snap_m else None)

    # ---- time-dependent Dijkstra from each distinct start node
    # ponytail: one search per start node, early-exit at the first safe node;
    # a multi-source reverse search if very large runs get slow.
    routes: dict[int, tuple[list[int], float] | None] = {}

    def search(start: int, t0: float) -> tuple[list[int], float] | None:
        best = {start: t0}
        prev: dict[int, int] = {}
        pq = [(t0, start)]
        while pq:
            t, u = heapq.heappop(pq)
            if t > best.get(u, math.inf):
                continue
            if safe[u]:
                path = [u]
                while path[-1] in prev:
                    path.append(prev[path[-1]])
                return path[::-1], t
            for w, metres, cut_s in adj[u]:
                tw = t + metres / v_ms
                if tw <= cut_s and tw < best.get(w, math.inf):
                    best[w] = tw
                    prev[w] = u
                    heapq.heappush(pq, (tw, w))
        return None

    corridors: list[dict[str, Any]] = []
    corridor_of: dict[int, int] = {}
    assembly: dict[int, dict[str, Any]] = {}
    out: list[dict[str, Any]] = []
    stats = {"ok": 0, "leave_now": 0, "impossible": 0, "origins": len(origins)}
    for o, sn in zip(origins, snap):
        arrival_s = float(times[o["f0"]])
        row = {"k": o["k"], "n": o.get("n"), "x": o["x"], "y": o["y"],
               "arrival_s": arrival_s, "walk_km": None, "walk_s": None,
               "margin_h": None, "corridor": None}
        if sn is not None:
            start, snap_d = sn
            # the route is shared per start node; snap distance + margin are per origin
            if start not in routes:
                routes[start] = search(start, 0.0)
            hit = routes[start]
            if hit is not None:
                path, walk_s = hit
                walk_s += snap_d / v_ms
                row["walk_s"] = round(walk_s, 1)
                row["walk_km"] = round(walk_s * v_ms / 1000, 3)
                row["margin_h"] = round((arrival_s - walk_s) / 3600, 3)
                if start not in corridor_of:
                    corridor_of[start] = len(corridors)
                    corridors.append({"path": [list(xy[i]) for i in path], "origins": 0,
                                      "worst_margin_h": None, "walk_km": round(sum(
                                          math.hypot((xy[a][0] - xy[b][0]) * kx, (xy[a][1] - xy[b][1]) * ky)
                                          for a, b in zip(path, path[1:])) / 1000, 3),
                                      "assembly": path[-1]})
                c = corridors[corridor_of[start]]
                c["origins"] += 1
                if c["worst_margin_h"] is None or row["margin_h"] < c["worst_margin_h"]:
                    c["worst_margin_h"] = row["margin_h"]
                row["corridor"] = corridor_of[start]
                a = assembly.setdefault(path[-1], {"x": xy[path[-1]][0], "y": xy[path[-1]][1], "origins": 0})
                a["origins"] += 1
        row["cls"] = _classify(row["margin_h"], leave_now_h)
        stats[row["cls"]] += 1
        out.append(row)

    for c in corridors:
        c["cls"] = _classify(c["worst_margin_h"], leave_now_h)
        # latest safe departure (s): after this the slowest origin can't make it
        c["leave_by_s"] = None if c["worst_margin_h"] is None else round(c["worst_margin_h"] * 3600, 1)
    ids = {node: i for i, node in enumerate(assembly)}
    for c in corridors:
        c["assembly"] = ids[c["assembly"]]

    return {**empty, "origins": out, "corridors": corridors,
            "assembly": list(assembly.values()), "stats": stats}


def ensure(run_id: str) -> dict[str, Any]:
    """Cached on the infra doc's key + the assumptions in force."""
    doc = infra_exposure.ensure(run_id)
    fp = paths.run_dir(run_id) / "evacuation.json"
    key = {"infra": doc.get("_key"), "version": CACHE_VERSION,
           "a": [settings.evac_walk_kmh, settings.evac_leave_now_h, settings.evac_snap_m]}
    if fp.exists():
        try:
            cached = json.loads(fp.read_text(encoding="utf-8"))
            if cached.get("_key") == key:
                return cached
        except ValueError:
            pass
    out = build(doc)
    out["_key"] = key
    fp.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return out


if __name__ == "__main__":
    # self-check on a straight A–B–S–T road: A–B is cut, so B is not safe; S is
    toy = {
        "times_s": [0, 300, 600, 900, 3600 * 3],
        "thresholds": {"building_m": 0.1, "road_cut_m": 0.3},
        "roads": [
            {"p": [0.0, 0.0, 0.0, 0.01], "km": 1.113, "f0": 3},   # A–B cut at 900 s
            {"p": [0.0, 0.01, 0.0, 0.02], "km": 1.113},           # B–S never cut
            {"p": [0.0, 0.02, 0.0, 0.03], "km": 1.113},           # S–T never cut
        ],
        "buildings": [
            {"x": 0.0, "y": 0.0, "a": 10, "f0": 4},   # at A, wet at 3 h → ok
            {"x": 0.0, "y": 0.0, "a": 10, "f0": 1},   # at A, wet at 300 s → impossible
        ],
        "points": [],
    }
    r = build(toy, walk_kmh=4.5, leave_now_h=1.0, snap_m=500)
    # A→B (1.113 km, done at 890 s < cut 900 s) → B is not safe (A–B cut) → S safe
    assert r["origins"][0]["cls"] == "ok", r["origins"][0]
    assert abs(r["origins"][0]["walk_km"] - 2.226) < 0.01
    assert r["origins"][1]["cls"] == "impossible"
    assert r["stats"] == {"ok": 1, "leave_now": 0, "impossible": 1, "origins": 2}
    toy["roads"][0]["f0"] = 2   # A–B cut at 600 s, walker needs 890 s → no path
    r = build(toy, walk_kmh=4.5, leave_now_h=1.0, snap_m=500)
    assert r["origins"][0]["cls"] == "impossible" and r["origins"][0]["walk_km"] is None
    print("evacuation self-check ok")
