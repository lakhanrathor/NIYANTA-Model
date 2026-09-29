from __future__ import annotations

from fastapi import APIRouter, HTTPException

from modules.breach import equations, inputs_from_spec, sensitivity
from modules.breach import reservoir_state as breach_reservoir_state
from modules.catalog import catalog
from modules.db import client as db

router = APIRouter(prefix="/breach", tags=["breach"])

METHODS = ("froehlich1995", "froehlich2008", "macdonald", "vonthun", "xuzhang", "manual")


@router.get("/methods")
def list_methods() -> dict:
    return {"methods": list(METHODS),
            "modes": ["overtopping", "piping", "blockage_breach", "breach_height", "manual"]}


@router.get("/methods/{method}/fixture")
def method_fixture(method: str) -> dict:
    """HEC-RAS worked-example fixture values for a method (docs/MODULE_SPEC 4.13)."""
    if method not in METHODS:
        raise HTTPException(404, "unknown method")
    from modules.breach.equations import BreachInputs  # noqa: PLC0415

    hec = BreachInputs(v_w=357.98e6, h_b=42.9, h_w=44.26, h_d=42.9,
                       mode="overtopping", dam_type="earth", erodibility="low")
    out = equations.solve(method, hec)
    return {"method": method, "fixture": "HEC-RAS HRM example", "result": out.as_dict()}


@router.get("/methods/{method}/estimate")
def method_estimate(method: str, height_m: float, storage_mcm: float,
                    level_m: float = 0.0, bed_m: float = 0.0,
                    crest_length_m: float = 0.0, dam_type: str = "homogeneous",
                    mode: str = "overtopping") -> dict:
    """The method's breach for THIS dam (Build's draft values), not the HEC-RAS
    worked example — the example is another dam and can exceed this crest.
    A computed width wider than the recorded crest is capped at the crest."""
    if method not in METHODS or method == "manual":
        raise HTTPException(404, "no estimate for this method")
    if height_m <= 0 or storage_mcm <= 0:
        raise HTTPException(422, "dam height and storage are needed for a breach estimate")
    from modules.breach.equations import BreachInputs  # noqa: PLC0415

    # water depth over the invert = pool level − bed (both absolute elevations)
    h_w = level_m - bed_m
    if not 0 < h_w <= height_m * 1.5:
        h_w = height_m * 0.9  # stated fallback: pool near crest at failure
    inputs = BreachInputs(v_w=storage_mcm * 1e6, h_b=height_m, h_w=h_w, h_d=height_m,
                          mode=mode, dam_type=dam_type)
    out = equations.solve(method, inputs).as_dict()
    capped = crest_length_m > 0 and out["avg_width_m"] > crest_length_m
    if capped:
        scale = crest_length_m / out["avg_width_m"]
        out["avg_width_m"] = crest_length_m
        out["bottom_width_m"] = round(out["bottom_width_m"] * scale, 2)
        out["notes"] = (out.get("notes") or "") + " width capped at the recorded crest length"
    return {"method": method, "fixture": "this dam" + (" (capped at crest)" if capped else ""),
            "result": out}


@router.post("/sensitivity/{scenario_id}")
def sweep(scenario_id: str) -> dict:
    """±20% breach sweep → breach_solution.sensitivity."""
    sc = catalog.scenario_get(scenario_id)
    if not sc:
        raise HTTPException(404, "scenario not found")
    spec = sc["spec"]
    breach = spec.get("breach") or {}
    inputs, bed = inputs_from_spec(spec)
    res = breach_reservoir_state(spec, bed)
    out = sensitivity.sweep(
        breach.get("method", "froehlich2008"), inputs, res,
        duration_hr=float((spec.get("horizon") or {}).get("duration_hr") or 24.0),
        mode=breach.get("mode", "overtopping"),
    )
    db.upsert("breach_solution", {"scenario_id": scenario_id, "sensitivity": out},
              conflict="scenario_id")
    return out
