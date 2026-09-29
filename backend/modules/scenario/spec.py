"""ScenarioSpec assembly: shared defaults for all three builders (MODULE_SPEC 4.19)."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

DEFAULTS = {
    "engine": "fast",
    "horizon": {"duration_hr": 12.0, "dt_s": 0.0},
    "boundary": {"downstream": {"type": "normal_depth", "slope": 0.0004}},
    "stations_km": [0.0, 5.0, 10.0, 15.0, 20.0],
    "breach": {"mode": "overtopping", "method": "froehlich2008", "chainage_m": 0.0,
               "width_m": 0.0, "depth_m": 0.0, "side_slope": 0.7, "formation_time_hr": 0.0},
}


def build(*, case: str, name: str | None = None, aoi: dict | None = None,
          mode: str = "overtopping", initial_level_m: float = 0.0,
          storage_mcm: float = 0.0, area_km2: float = 0.0,
          dam_height_m: float | None = None, dam_id: str | None = None,
          provenance: dict | None = None, **over: Any) -> dict:
    spec: dict[str, Any] = {
        "schema_version": "1.0",
        "scenario_id": str(uuid4()),
        "case": case,
        "name": name,
        "aoi": aoi or {"type": "bbox", "coords": []},
        "engine": DEFAULTS["engine"],
        "horizon": dict(DEFAULTS["horizon"]),
        "boundary": {"upstream": {},
                     "downstream": dict(DEFAULTS["boundary"]["downstream"])},
        "stations_km": list(DEFAULTS["stations_km"]),
        "terrain_ref": None,
        "dam_type": "homogeneous",
        "erodibility": "medium",
        "breach": {**DEFAULTS["breach"], "mode": mode},
        "reservoir": {"initial_level_m": initial_level_m, "crest_level_m": None,
                      "bed_level_m": None, "dam_height_m": dam_height_m,
                      "storage_mcm": storage_mcm, "area_km2": area_km2,
                      "inflow_cms": 0.0},
        "provenance": {**{"producer": "scenario", "trigger": "manual", "inputs": []},
                       **(provenance or {})},
        "dam_id": dam_id,
        "benchmark": None,
    }
    spec.update(over)
    return spec
