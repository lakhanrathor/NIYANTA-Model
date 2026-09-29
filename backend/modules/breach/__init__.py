"""Breach module: equations + level-pool hydrograph + scenario solving (DB-facing)."""

from __future__ import annotations

import json
from typing import Any

from modules.breach import equations, hydrograph, sensitivity
from modules.breach.equations import BreachGeom, BreachInputs, solve
from modules.breach.hydrograph import ReservoirState
from modules.catalog import catalog
from modules.db import client as db
from modules.storage import paths


def inputs_from_spec(spec: dict[str, Any]) -> tuple[BreachInputs, float]:
    res = spec.get("reservoir") or {}
    breach = spec.get("breach") or {}
    v_w = float(res.get("storage_mcm") or 0.0) * 1e6
    initial = float(res.get("initial_level_m") or 0.0)
    crest = res.get("crest_level_m")
    bed = res.get("bed_level_m")
    dam_h = float(res.get("dam_height_m") or 30.0)
    # unset levels resolve to a relative datum: equations only need h_b/h_w/V_w
    if bed is None:
        bed = (initial - dam_h) if initial else 0.0
    bed = float(bed)
    if crest is None:
        crest = bed + dam_h
    crest = float(crest)
    if not initial:
        initial = crest - max(2.0, dam_h * 0.05)
    if v_w <= 0:
        v_w = max((initial - bed) * max(float(res.get("area_km2") or 1.0), 1.0) * 1e6 * 0.4, 1e6)
    return BreachInputs(
        v_w=v_w,
        h_b=max(crest - bed, 1.0),
        h_w=max(initial - bed, 1.0),
        h_d=max(dam_h, 1.0),
        mode=breach.get("mode", "overtopping"),
        dam_type=spec.get("dam_type", "homogeneous"),
        erodibility=spec.get("erodibility", "medium"),
        crest_width_m=float(spec.get("crest_width_m") or 10.0),
        upstream_slope=float(spec.get("upstream_slope") or 3.0),
        downstream_slope=float(spec.get("downstream_slope") or 3.0),
    ), bed  # type: ignore[return-value]


def reservoir_state(spec: dict[str, Any], bed: float) -> ReservoirState:
    res = spec.get("reservoir") or {}
    return ReservoirState(
        initial_level_m=float(res.get("initial_level_m") or 0.0),
        bed_level_m=bed,
        storage_m3=float(res.get("storage_mcm") or 0.0) * 1e6,
        area_m2=float(res.get("area_km2") or 1.0) * 1e6,
        inflow_cms=float(res.get("inflow_cms") or 0.0),
    )


def solve_spec(spec: dict[str, Any]) -> tuple[BreachGeom, dict]:
    inputs, bed = inputs_from_spec(spec)
    breach = spec.get("breach") or {}
    geom = solve(
        breach.get("method", "froehlich2008"),
        inputs,
        width_m=float(breach.get("width_m") or 0.0),
        depth_m=float(breach.get("depth_m") or 0.0),
        t_form_hr=float(breach.get("formation_time_hr") or 0.0),
        side_slope=float(breach.get("side_slope") or 0.7),
    )
    res = reservoir_state(spec, bed)
    hg = hydrograph.hydrograph(
        geom, res,
        duration_hr=float((spec.get("horizon") or {}).get("duration_hr") or 24.0),
        dt_s=float((spec.get("horizon") or {}).get("dt_s") or 0) or None,
        mode=breach.get("mode", "overtopping"),
    )
    return geom, hg


def solve_for_scenario(scenario_id: str, spec: dict[str, Any] | None = None) -> dict:
    """Compute geometry + hydrograph; persist breach_solution row + product file."""
    if spec is None:
        row = catalog.scenario_get(scenario_id)
        if not row:
            raise ValueError("scenario not found")
        spec = row["spec"]
    geom, hg = solve_spec(spec)
    hg_path = paths.product_file("breach_hydrograph", scenario_id, "json")
    hg_path.write_text(json.dumps(hg), encoding="utf-8")
    saved = db.upsert(
        "breach_solution",
        {
            "scenario_id": scenario_id,
            "method": geom.method,
            "mode": (spec.get("breach") or {}).get("mode", "overtopping"),
            "width_m": geom.bottom_width_m,
            "depth_m": geom.depth_m,
            "side_slope": geom.side_slope,
            "t_form_hr": geom.t_form_hr,
            "hydrograph_path": paths.rel(hg_path),
        },
        conflict="scenario_id",
    )
    catalog.product_create(
        "breach_hydrograph",
        paths.rel(hg_path),
        scenario_id=scenario_id,
        meta={"peak_cms": hg["peak_cms"], "peak_at_hr": hg["peak_at_hr"], "method": geom.method},
    )
    return {"geom": geom.as_dict(), "hydrograph": {k: hg[k] for k in ("peak_cms", "peak_at_hr", "released_hm3")}, "row": saved}
