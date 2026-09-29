from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from modules.catalog import catalog
from modules.jobs import queue as jobs
from modules.run import lifecycle, stages
from schemas.scenario import ScenarioSpec


def preflight(run_id: str) -> list[str]:
    """Return list of blocking errors; empty list means runnable."""
    errors: list[str] = []
    run = catalog.run_get(run_id)
    if not run:
        return ["run not found"]
    if run["state"] not in ("DRAFT", "FAILED"):
        errors.append(f"run state {run['state']} is not executable")
    sc = catalog.scenario_get(run["scenario_id"])
    if not sc:
        errors.append("scenario missing")
        return errors
    spec = sc["spec"]
    if spec.get("engine") not in ("fast", "delft3d", "sph", "hecras"):
        errors.append(f"unknown engine {spec.get('engine')!r}")
    if spec.get("engine") == "hecras":
        errors.append("hecras engine is not bundled in this build; use fast, sph or delft3d")
    if spec.get("engine") == "delft3d":
        from modules.solvers.delft3d_fm import engine_available

        if not engine_available():
            errors.append("delft3d engine unavailable: run_dimr.bat not found "
                          "(set NIYANTA_ENGINE_ROOT)")
    breach = spec.get("breach") or {}
    if float(breach.get("width_m") or 0) <= 0 and breach.get("method") == "manual":
        errors.append("breach.width_m must be > 0 for manual method")
    if float(spec.get("horizon", {}).get("duration_hr") or 0) <= 0:
        errors.append("horizon.duration_hr must be > 0")
    terrain_ref = spec.get("terrain_ref")
    if terrain_ref and not catalog.dataset_get(terrain_ref):
        errors.append(f"terrain_ref dataset {terrain_ref} not found")
    return errors


def execute(run_id: str) -> dict[str, Any]:
    errors = preflight(run_id)
    if errors:
        lifecycle.fail(run_id, "; ".join(errors))
        return {"ok": False, "errors": errors}
    run = catalog.run_get(run_id)
    assert run
    engine = run["engine"]
    catalog.run_patch(run_id, error=None)
    lifecycle.set_state(run_id, "QUEUED", f"engine={engine}")
    lifecycle.set_stage(run_id, stages.STAGES[0], "queued")
    job = jobs.add_job(stages.STAGES[0], {"run_id": run_id}, run_id=run_id)
    catalog.scenario_update_status(run["scenario_id"], "running")
    _auto_imagery(run)
    return {"ok": True, "job_id": job["id"], "first_stage": stages.STAGES[0]}


def _auto_imagery(run: dict) -> None:
    """Any-river imagery: ensure a watch box covers the scenario AOI and queue
    the (daily-deduped) GEE sweep so Sentinel/JRC products download for it in
    the background — the run itself never waits on imagery."""
    from config import settings

    if not settings.auto_imagery:
        return
    sc = catalog.scenario_get(run["scenario_id"])
    if not sc:
        return
    aoi = sc["spec"].get("aoi") or {}
    coords = aoi.get("coords") or []
    if aoi.get("type") == "bbox" and len(coords) == 4:
        west, south, east, north = (float(v) for v in coords)
    elif aoi.get("type") == "polygon" and len(coords) == 1 and isinstance(coords[0], list):
        # Ring AOI: the watch box covers the ring's envelope, same as a bbox.
        xs = [p[0] for p in coords[0] if isinstance(p, (list, tuple))]
        ys = [p[1] for p in coords[0] if isinstance(p, (list, tuple))]
        if not xs:
            return
        west, south, east, north = min(xs), min(ys), max(xs), max(ys)
    else:
        return
    from modules.db import client as db
    from modules.db.client import geo_bounds

    covering = None
    for row in db.query("SELECT id, bbox FROM watch_box WHERE active"):
        env = geo_bounds(row["bbox"])
        if env and env[0] <= east and env[2] >= west and env[1] <= north and env[3] >= south:
            covering = row
            break
    if not covering:
        covering = db.query_one(
            """INSERT INTO watch_box (name, preset, bbox, meta)
               VALUES (%s, %s, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s::jsonb)
               RETURNING id""",
            (f"Auto - {sc['name']}", "auto", west, south, east, north,
             json.dumps({"scenario_id": str(sc["id"])})))
    # run-scoped idempotency (retry/re-execute); kind-level dedup lives in run_daily
    queued = db.query_one(
        "SELECT id FROM job WHERE type = 'gee.daily' AND params->>'run_id' = %s",
        (str(run["id"]),))
    if not queued:
        jobs.add_job("gee.daily", {"trigger": "run.execute", "run_id": str(run["id"])})


def create_run(scenario_id: str, engine: str | None = None) -> dict:
    sc = catalog.scenario_get(scenario_id)
    if not sc:
        raise ValueError("scenario not found")
    eng = engine or sc["spec"].get("engine", "fast")
    run = catalog.run_create(scenario_id, eng)
    lifecycle.record(run["id"], state="DRAFT", detail="created")
    return run


def retry(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise ValueError("run not found")
    if run["state"] not in ("FAILED", "CANCELLED"):
        raise ValueError(f"cannot retry run in state {run['state']}")
    db_reset_chain(run_id)
    return execute(run_id)


def db_reset_chain(run_id: str) -> None:
    from modules.db import client as db

    db.execute("UPDATE job SET status = 'cancelled', updated = now() WHERE run_id = %s AND status IN ('queued','running')", (run_id,))
    catalog.run_patch(run_id, error=None, progress=0, stage=None, stage_status=None)
    lifecycle.record(run_id, state="DRAFT", detail="retry requested")


def publish(run_id: str) -> dict:
    run = catalog.run_get(run_id)
    if not run:
        raise ValueError("run not found")
    if run["state"] not in ("VALIDATED", "PUBLISHED"):
        raise ValueError(f"cannot publish run in state {run['state']}")
    lifecycle.set_state(run_id, "PUBLISHED", "operator publish")
    return catalog.run_get(run_id)  # type: ignore[return-value]
