from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from modules.catalog import catalog
from modules.db import client as db
from modules.run import execute as run_execute
from schemas.scenario import ScenarioSpec

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


def _require_uuid(scenario_id: str) -> None:
    # non-uuid ids (e.g. the UI's "p1" fallback) are a 404, not a db 500
    try:
        uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(404, "scenario not found") from None


@router.post("")
def create_scenario(body: dict) -> dict:
    try:
        spec = ScenarioSpec.model_validate(body)
    except Exception as exc:  # noqa: BLE001 - validation boundary
        raise HTTPException(422, f"invalid ScenarioSpec: {exc}") from exc
    from modules.scenario.validate import validate_spec  # noqa: PLC0415

    problems = validate_spec(spec.model_dump(mode="json"))
    if problems:
        raise HTTPException(422, "; ".join(problems))
    row = catalog.scenario_create(spec.model_dump(mode="json"))
    try:
        from modules.breach import solve_for_scenario  # noqa: PLC0415

        solve_for_scenario(str(row["id"]))
    except Exception:
        pass  # breach solving is best-effort at create time
    return catalog.scenario_get(row["id"])


@router.get("")
def list_scenarios(case: str | None = None, dam_id: str | None = None) -> list[dict]:
    return catalog.scenario_list(case, dam_id)


@router.get("/{scenario_id}")
def get_scenario(scenario_id: str) -> dict:
    _require_uuid(scenario_id)
    sc = catalog.scenario_get(scenario_id)
    if not sc:
        raise HTTPException(404, "scenario not found")
    breach = db.query_one("SELECT * FROM breach_solution WHERE scenario_id = %s", (scenario_id,))
    runs = catalog.run_list(scenario_id=scenario_id)
    return {"scenario": sc, "breach_solution": breach, "runs": runs}


@router.post("/{scenario_id}/execute")
def execute_scenario(scenario_id: str, engine: str | None = None) -> dict:
    _require_uuid(scenario_id)
    if not catalog.scenario_get(scenario_id):
        raise HTTPException(404, "scenario not found")
    run = run_execute.create_run(scenario_id, engine)
    outcome = run_execute.execute(run["id"])
    return {"run": catalog.run_get(run["id"]), **outcome}


@router.post("/from-risk/{risk_id}")
def from_risk(risk_id: str) -> dict:
    from modules.scenario import builders  # noqa: PLC0415

    return builders.from_risk(risk_id)


@router.post("/from-event/{change_id}")
def from_event(change_id: str) -> dict:
    from modules.scenario import builders  # noqa: PLC0415

    return builders.from_event(change_id)


@router.post("/{scenario_id}/sensitivity")
def scenario_sensitivity(scenario_id: str) -> dict:
    from routers.breach import sweep  # noqa: PLC0415

    try:
        return sweep(scenario_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
