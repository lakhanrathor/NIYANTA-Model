from __future__ import annotations

import time
import uuid

import pytest

from modules.catalog import catalog
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.run import execute as run_execute
from modules.run import lifecycle
from schemas.scenario import ScenarioSpec


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(2)
    yield
    jobs.stop_workers()


def make_spec(**over) -> dict:
    base = {
        "case": "3",
        "name": "P1 smoke",
        "aoi": {"type": "bbox", "coords": [74.5, 16.3, 75.0, 16.7]},
        "breach": {"mode": "overtopping", "width_m": 200, "depth_m": 30,
                   "formation_time_hr": 4, "method": "froehlich2008"},
        "reservoir": {"initial_level_m": 600, "storage_mcm": 400, "area_km2": 12},
        "engine": "fast",
        "horizon": {"duration_hr": 24},
    }
    base.update(over)
    return base


def test_health_fields():
    from fastapi.testclient import TestClient

    from app import create_app

    with TestClient(create_app()) as c:
        r = c.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["db"] == "ok"
        assert body["queue_depth"] >= 0
        assert "stage.solve" in body["handlers"]


def test_scenario_validation_rejects_bad_spec():
    from fastapi.testclient import TestClient

    from app import create_app

    with TestClient(create_app()) as c:
        r = c.post("/api/scenarios", json={"case": "9"})
        assert r.status_code == 422


def test_full_stub_chain_validates():
    from fastapi.testclient import TestClient

    from app import create_app

    with TestClient(create_app()) as c:
        created = c.post("/api/scenarios", json=make_spec())
        assert created.status_code == 200, created.text
        scenario_id = created.json()["id"]

        run = c.post(f"/api/scenarios/{scenario_id}/execute")
        assert run.status_code == 200, run.text
        body = run.json()
        assert body["ok"] is True
        run_id = body["run"]["id"]

        deadline = time.time() + 120
        state = None
        while time.time() < deadline:
            r = c.get(f"/api/runs/{run_id}")
            state = r.json()["run"]["state"]
            if state in lifecycle.TERMINAL:
                break
            time.sleep(0.5)

        detail = c.get(f"/api/runs/{run_id}").json()
        assert state == "VALIDATED", f"state={state} error={detail['run']['error']}"
        stages_done = [j for j in detail["jobs"] if j["status"] == "done"]
        assert len(stages_done) >= 7, f"only {len(stages_done)} stage jobs done"
        assert detail["run"]["progress"] == 100
        assert len(detail["lifecycle"]) >= 7

        # retry must refuse a validated run
        assert c.post(f"/api/runs/{run_id}/retry").status_code == 409
        # publish transitions
        pub = c.post(f"/api/runs/{run_id}/publish")
        assert pub.status_code == 200
        assert pub.json()["state"] == "PUBLISHED"


def test_preflight_blocks_bad_engine():
    spec = make_spec(engine="fast", horizon={"duration_hr": 0})
    sc = catalog.scenario_create(ScenarioSpec.model_validate(spec).model_dump(mode="json"))
    run = catalog.run_create(sc["id"], "fast")
    outcome = run_execute.execute(run["id"])
    assert outcome["ok"] is False
    assert "duration_hr" in outcome["errors"][0]
    assert catalog.run_get(run["id"])["state"] == "FAILED"


def test_products_handoff_row():
    p = catalog.product_create("conditioned_dem", "products/x/dem.tif", dataset_id=None, meta={"cell": 30})
    got = catalog.product_latest("conditioned_dem")
    assert got and got["id"] == p["id"]
