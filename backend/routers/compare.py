from __future__ import annotations

from fastapi import APIRouter, HTTPException

from modules.catalog import catalog
from modules.db import client as db

router = APIRouter(tags=["compare", "validate"])


@router.get("/compare/{a}/{b}")
def compare(a: str, b: str) -> dict:
    run_a = catalog.run_get(a)
    run_b = catalog.run_get(b)
    if not run_a or not run_b:
        raise HTTPException(404, "both runs must exist")
    metrics_a = run_a.get("metrics") or {}
    metrics_b = run_b.get("metrics") or {}
    keys = sorted(set(metrics_a) | set(metrics_b))
    delta = {}
    for key in keys:
        va, vb = metrics_a.get(key), metrics_b.get(key)
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            delta[key] = round(vb - va, 6)
        elif va != vb:
            delta[key] = {"a": va, "b": vb}
    spec_a = catalog.scenario_get(run_a["scenario_id"])["spec"]
    spec_b = catalog.scenario_get(run_b["scenario_id"])["spec"]
    return {
        "a": {"run_id": a, "engine": run_a.get("engine"), "status": run_a.get("status"),
              "metrics": metrics_a, "scenario_id": run_a["scenario_id"]},
        "b": {"run_id": b, "engine": run_b.get("engine"), "status": run_b.get("status"),
              "metrics": metrics_b, "scenario_id": run_b["scenario_id"]},
        "delta": delta,
        "spec_diff": _spec_diff(spec_a, spec_b),
    }


@router.get("/validate/{run_id}")
def get_validation(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    row = db.query_one("SELECT * FROM validation_score WHERE run_id = %s", (run_id,))
    return {"run_id": run_id, "validation": row, "run_validation": (run.get("metrics") or {}).get("validation")}


@router.post("/validate/benchmark/{run_id}")
def run_benchmark(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    from modules.run import work_validate  # noqa: PLC0415

    result = work_validate.score(run_id)
    row = db.query_one("SELECT * FROM validation_score WHERE run_id = %s", (run_id,))
    return {"result": result, "validation": row}


def _spec_diff(a: dict, b: dict) -> dict:
    diff = {}
    for key in sorted(set(a) | set(b)):
        if a.get(key) != b.get(key):
            diff[key] = {"a": a.get(key), "b": b.get(key)}
    return diff
