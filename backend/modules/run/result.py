"""RunResult persistence: partial merge helpers shared by stage workers."""

from __future__ import annotations

from typing import Any

from modules.catalog import catalog


def base(run: dict[str, Any]) -> dict[str, Any]:
    return run.get("result") or {
        "schema_version": "1.0",
        "run_id": run["id"],
        "scenario_id": run["scenario_id"],
        "engine": run["engine"],
        "metrics": {},
        "rasters": {},
        "stations": [],
        "impact": {},
        "hazard": {},
        "exports": {},
        "validation": {},
    }


def merge(run_id: str, **fields: Any) -> dict[str, Any]:
    run = catalog.run_get(run_id)
    assert run
    result = base(run)
    for key, value in fields.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = {**result[key], **value}
        else:
            result[key] = value
    catalog.run_patch(run_id, result=result, metrics=result.get("metrics") or {})
    return result
