"""case2 builder: change_detection (lake/gLake) → ScenarioSpec (natural event)."""

from __future__ import annotations

from typing import Any

from modules.db import client as db
from modules.scenario import spec as spec_mod

ASSUMED_LAKE_DEPTH_M = 8.0


def from_event(change_id: str, auto_execute: bool = False) -> dict[str, Any]:
    change = db.query_one("SELECT * FROM change_detection WHERE id = %s", (change_id,))
    if not change:
        raise ValueError(f"change {change_id} not found")
    box = db.query_one(
        "SELECT wb.*, ST_AsText(wb.bbox) AS bbox_wkt FROM watch_box wb WHERE id = %s",
        (change["box_id"],),
    ) if change.get("box_id") else None
    if not box:
        raise ValueError("change has no watch box")

    metrics = change.get("metrics") or {}
    area_km2 = float(metrics.get("area_km2") or metrics.get("delta_area_km2") or 0.0)
    if area_km2 <= 0:
        area_km2 = 1.0
    # 1 km² × 1 m of depth = 1e6 m³ = 1 MCM
    storage_mcm = area_km2 * ASSUMED_LAKE_DEPTH_M

    coords = _bbox_coords(box.get("bbox_wkt") or box.get("bbox"))
    spec = spec_mod.build(
        case="2",
        name=f"Auto c2: {box['name']} lake breach",
        aoi={"type": "bbox", "coords": coords},
        mode="blockage_breach",
        initial_level_m=0.0,  # relative datum resolved against terrain at solve time
        storage_mcm=max(storage_mcm, 1.0),
        area_km2=area_km2,
        dam_height_m=ASSUMED_LAKE_DEPTH_M + 5.0,
        dam_id=None,
        provenance={"producer": "gee", "trigger": "f2", "inputs": [change_id, str(box["id"])]},
    )
    from modules.scenario.builders.case1 import _persist

    return {"scenario": _persist(spec, risk_id=None, change_id=change_id, auto_execute=auto_execute)}


def _bbox_coords(geom: Any) -> list[float]:
    from shapely import wkt

    g = wkt.loads(geom) if isinstance(geom, str) else geom
    minx, miny, maxx, maxy = g.bounds
    return [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)]
