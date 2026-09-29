"""case1 builder: risk_assessment → ScenarioSpec (reservoir criticality)."""

from __future__ import annotations

from typing import Any

from modules.db import client as db
from modules.scenario import spec as spec_mod


def from_risk(risk_id: str, auto_execute: bool = False) -> dict[str, Any]:
    risk = db.query_one("SELECT * FROM risk_assessment WHERE id = %s", (risk_id,))
    if not risk:
        raise ValueError(f"risk {risk_id} not found")
    if risk["case"] != "1":
        raise ValueError("from_risk expects a case-1 (reservoir) risk row")
    dam_id = risk["target_id"]
    dam = db.query_one("SELECT dam.*, ST_AsText(dam.location) AS loc_wkt FROM dam WHERE id = %s", (dam_id,))
    if not dam:
        raise ValueError("risk target dam missing")

    latest = db.query_one(
        "SELECT * FROM reservoir_level WHERE dam_id = %s ORDER BY ts DESC LIMIT 1", (dam_id,)
    )
    level = float((latest or {}).get("level_m") or (dam.get("fsl_m") or 0.0))
    storage = float((latest or {}).get("storage_mcm") or 0.0) or float(dam.get("storage_mcm") or 0.0)
    factors = risk.get("factors") or {}
    mode = "piping" if int(factors.get("seepage_hits") or 0) > 3 else "overtopping"

    aoi = _dam_bbox(dam, half_deg=0.28)
    spec = spec_mod.build(
        case="1",
        name=f"Auto c1: {dam['name']} ({risk['class']})",
        aoi=aoi,
        mode=mode,
        initial_level_m=level,
        storage_mcm=storage,
        area_km2=float(dam.get("storage_mcm") or 100.0) / max(level - float(dam.get("fsl_m") or level) + 20.0, 20.0),
        dam_height_m=float(dam.get("height_m") or 30.0),
        dam_id=dam_id,
        provenance={"producer": "risk", "trigger": "f1", "inputs": [risk_id]},
    )
    return {"scenario": _persist(spec, risk_id=risk_id, change_id=None, auto_execute=auto_execute)}


def _dam_bbox(dam: dict, half_deg: float) -> dict[str, Any]:
    loc = dam.get("loc_wkt") or dam.get("location")
    if loc:
        from shapely import wkt as shp_wkt

        pt = shp_wkt.loads(loc) if isinstance(loc, str) else loc
        lon, lat = pt.x, pt.y
        return {"type": "bbox",
                "coords": [round(lon - half_deg, 4), round(lat - half_deg, 4),
                           round(lon + half_deg, 4), round(lat + half_deg, 4)]}
    return {"type": "bbox", "coords": [77.72, 21.72, 78.28, 22.28]}


def _persist(spec: dict, risk_id: str | None, change_id: str | None, auto_execute: bool) -> dict:
    from modules.breach import solve_for_scenario
    from modules.catalog import catalog
    from modules.run import execute as run_execute
    from modules.scenario.validate import require_valid

    require_valid(spec)
    row = catalog.scenario_create(spec, risk_id=risk_id, change_id=change_id)
    try:
        solve_for_scenario(str(row["id"]), spec)
    except Exception:
        pass
    if auto_execute:
        run = run_execute.create_run(str(row["id"]))
        run_execute.execute(str(run["id"]))
        return {**row, "run_id": str(run["id"])}
    return row
