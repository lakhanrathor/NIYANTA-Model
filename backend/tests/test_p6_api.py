"""P6/P7 API surface: connectors, risk, watch/GEE, sensitivity, builders, exports."""

from __future__ import annotations

import io
import json
import time
import uuid

import pytest

from modules.catalog import catalog
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.run import execute as run_execute
from schemas.scenario import ScenarioSpec


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(3)
    yield
    jobs.stop_workers()


def client():
    from fastapi.testclient import TestClient

    from app import create_app

    return TestClient(create_app())


def wait_until(fn, timeout: float = 120.0, interval: float = 0.5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        out = fn()
        if out:
            return out
        time.sleep(interval)
    raise AssertionError("timed out waiting for condition")


def any_dam_id() -> str:
    row = db.query_one("SELECT id FROM dam ORDER BY created LIMIT 1")
    if row:
        return str(row["id"])
    import json as _json

    row = db.query_one(
        """INSERT INTO dam (name, river, state, location, crest_m, height_m, fsl_m,
                            storage_mcm, crest_length_m)
           VALUES ('Unit Test Dam', 'test', 'MH',
                   '{"type":"Point","coordinates":[78.0,22.05]}', 625, 45, 620, 286, 300)
           RETURNING id"""
    )
    return str(row["id"])  # type: ignore[index]


def make_spec(**over) -> dict:
    base = {
        "case": "3",
        "name": "p6 api test",
        "aoi": {"type": "bbox", "coords": [77.72, 21.72, 78.28, 22.28]},
        "breach": {"mode": "overtopping", "method": "froehlich2008"},
        "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                      "dam_height_m": 45.0, "area_km2": 12.0},
        "engine": "fast",
        "horizon": {"duration_hr": 4.0},
        "stations_km": [0.0, 5.0, 10.0],
    }
    base.update(over)
    return base


def validated_run_id() -> str:
    row = db.query_one(
        "SELECT id FROM run WHERE state IN ('VALIDATED','PUBLISHED') ORDER BY created DESC LIMIT 1"
    )
    if row:
        return str(row["id"])
    sc = catalog.scenario_create(ScenarioSpec.model_validate(make_spec()).model_dump(mode="json"))
    run = run_execute.create_run(str(sc["id"]))
    run_execute.execute(str(run["id"]))
    wait_until(lambda: catalog.run_get(str(run["id"]))["state"] == "VALIDATED", 240)
    return str(run["id"])


def test_connectors_list_and_sync():
    with client() as c:
        listing = c.get("/api/connectors")
        assert listing.status_code == 200
        names = {row["name"] for row in listing.json()}
        assert {"wris", "osm", "worldpop", "weather", "dem"} <= names
        out = c.post("/api/connectors/wris/sync")
        assert out.status_code == 200, out.text
        body = out.json()
        assert body["status"] == "ok"
        assert body["counts"]["dams"] >= 1
        bad = c.post("/api/connectors/nope/sync")
        assert bad.status_code == 404


def test_risk_reservoir_endpoint_builds_case1():
    dam_id = any_dam_id()
    with client() as c:
        out = c.post("/api/risk/reservoir", json={"dam_id": dam_id})
        assert out.status_code == 200, out.text
        body = out.json()
        score = body["detail"]["score"]
        assert 0.0 <= score <= 100.0
        assert body["detail"]["class"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
        stored = db.query_one(
            "SELECT * FROM risk_assessment WHERE id = %s", (str(body["risk"]["id"]),)
        )
        assert stored and stored["case"] == "1"
        # ≥ MODERATE auto-builds a case-1 scenario
        if body["detail"]["class"] in ("MODERATE", "HIGH", "CRITICAL"):
            assert body["scenario"] and body["scenario"]["case"] == "1"
        assert c.get("/api/risk", params={"target": dam_id}).status_code == 200
        single = c.get(f"/api/risk/{body['risk']['id']}")
        assert single.status_code == 200


def test_watch_boxes_sweep_and_event_risk():
    with client() as c:
        bbox = [77.9, 21.9, 78.1, 22.1]
        created = c.post("/api/watch/boxes", json={"name": f"unit box {uuid.uuid4().hex[:6]}",
                                                   "bbox": bbox, "preset": "custom"})
        assert created.status_code == 200, created.text
        box_id = created.json()["id"]
        assert c.get("/api/watch/boxes").status_code == 200

        sweep = c.post("/api/watch/run")
        assert sweep.status_code == 200, sweep.text
        job_id = sweep.json()["job_id"]
        # live EE fetches run 10–30 s per kind per box before caching — budget
        # for the full sweep (all active boxes × 6 kinds) plus any Flow A chains.
        # Cold in-process EE cache makes this several minutes when GEE is live
        # (previously seconds on the simulation fallback).
        wait_until(lambda: db.query_one("SELECT status FROM job WHERE id = %s", (job_id,))
                   ["status"] in ("done", "failed"), 1500)
        assert db.query_one("SELECT status FROM job WHERE id = %s", (job_id,))["status"] == "done"

        box_jobs = c.get("/api/watch/jobs", params={"box_id": box_id}).json()
        assert {j["kind"] for j in box_jobs} >= {"s2_indices", "s1_watermask", "lst_snow",
                                                 "seismic_sync", "flood_extent"}
        assert all(j["status"] == "done" for j in box_jobs)
        assert c.get(f"/api/watch/boxes/{box_id}/timeline").status_code == 200
        assert c.get(f"/api/watch/boxes/{box_id}/beforeafter").status_code == 200
        changes = c.get("/api/watch/changes").json()
        assert len(changes) >= 1

        scored = c.post(f"/api/risk/event/{box_id}")
        assert scored.status_code == 200, scored.text
        assert scored.json()["risk"]["case"] == "2"
        events = c.get("/api/risk/events").json()
        assert isinstance(events, list)


def test_flag_change_flags_big_delta():
    box_id = db.query_one(
        """INSERT INTO watch_box (name, bbox)
           VALUES ('delta box',
                   '{"type":"Polygon","coordinates":[[[77.9,21.9],[78.1,21.9],[78.1,22.1],[77.9,22.1],[77.9,21.9]]]}')
           RETURNING id"""
    )["id"]
    from modules.gee import flag_change

    first = flag_change(str(box_id), "water_mask", {"area_km2": 10.0, "sensor": "sentinel1"})
    assert first["flagged"] is False  # no baseline yet → seeds baseline
    second = flag_change(str(box_id), "water_mask", {"area_km2": 30.0, "sensor": "sentinel1"})
    assert second["flagged"] is True
    assert abs(second["metrics"]["delta_pct"]) >= 20.0


def test_scenario_sensitivity_endpoint():
    with client() as c:
        created = c.post("/api/scenarios", json=make_spec())
        assert created.status_code == 200, created.text
        scenario_id = created.json()["id"]
        out = c.post(f"/api/scenarios/{scenario_id}/sensitivity")
        assert out.status_code == 200, out.text
        body = out.json()
        assert len(body["width"]) == 5
        assert len(body["depth"]) == 5
        assert len(body["time"]) == 5
        row = db.query_one("SELECT sensitivity FROM breach_solution WHERE scenario_id = %s",
                           (scenario_id,))
        assert row and row["sensitivity"]
        alias = c.post(f"/api/breach/sensitivity/{scenario_id}")
        assert alias.status_code == 200
        methods = c.get("/api/breach/methods").json()
        assert "froehlich2008" in methods["methods"]
        fixture = c.get("/api/breach/methods/froehlich1995/fixture")
        assert fixture.status_code == 200
        assert fixture.json()["result"]["bottom_width_m"] > 0


def test_from_risk_builder_endpoint():
    dam_id = any_dam_id()
    from modules.risk import reservoir as risk_reservoir

    scored = risk_reservoir.assess(dam_id)
    risk_id = str(scored["risk"]["id"])
    with client() as c:
        out = c.post(f"/api/scenarios/from-risk/{risk_id}")
        assert out.status_code == 200, out.text
        sc = out.json()["scenario"]
        assert sc["case"] == "1"
        got = c.get(f"/api/scenarios/{sc['id']}")
        assert got.status_code == 200
        assert got.json()["breach_solution"] is not None


def test_from_event_builder_endpoint():
    change = db.query_one("SELECT id FROM change_detection ORDER BY ts DESC LIMIT 1")
    if not change:
        from modules.gee import flag_change
        box_id = db.query_one(
            """INSERT INTO watch_box (name, bbox)
               VALUES ('event box',
                       '{"type":"Polygon","coordinates":[[[77.9,21.9],[78.1,21.9],[78.1,22.1],[77.9,22.1],[77.9,21.9]]]}')
               RETURNING id"""
        )["id"]
        change = {"id": flag_change(str(box_id), "lake_area",
                                    {"area_km2": 25.0, "sensor": "sentinel1"})["id"]}
    with client() as c:
        out = c.post(f"/api/scenarios/from-event/{change['id']}")
        assert out.status_code == 200, out.text
        assert out.json()["scenario"]["case"] == "2"


def test_dataset_vector_upload_processes_to_canonical_layers():
    geojson = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"name": "UnitVillage"},
            "geometry": {"type": "Point", "coordinates": [78.01, 22.01]},
        }],
    }
    with client() as c:
        up = c.post("/api/datasets", data={"kind": "vector", "name": "villages_upload"},
                    files={"file": ("villages_upload.geojson",
                                    io.BytesIO(json.dumps(geojson).encode()), "application/geo+json")})
        assert up.status_code == 200, up.text
        dataset_id = up.json()["dataset"]["id"]
        job_id = up.json()["job_id"]
        wait_until(lambda: db.query_one("SELECT status FROM job WHERE id = %s", (job_id,))
                   ["status"] in ("done", "failed"), 60)
        assert db.query_one("SELECT status FROM job WHERE id = %s", (job_id,))["status"] == "done"
        detail = c.get(f"/api/datasets/{dataset_id}").json()
        assert any(p["kind"] == "inundation_vector" for p in detail["products"])
        hit = db.query_one(
            "SELECT id FROM vector_feature WHERE name = 'UnitVillage' AND dataset_id = %s",
            (dataset_id,),
        )
        assert hit
        # cleanup so the impact stage keeps its demo-only villages
        db.execute("DELETE FROM vector_feature WHERE dataset_id = %s", (dataset_id,))


def test_export_report_validate_compare():
    run_id = validated_run_id()
    with client() as c:
        exp = c.post("/api/exports", json={"run_id": run_id, "formats": ["csv", "geojson"]})
        assert exp.status_code == 200, exp.text
        export_id = exp.json()["id"]
        wait_until(lambda: db.query_one("SELECT status FROM export_job WHERE id = %s",
                                        (export_id,))["status"] in ("done", "failed"), 120)
        status = db.query_one("SELECT status, path FROM export_job WHERE id = %s", (export_id,))
        assert status["status"] == "done", status
        detail = c.get(f"/api/exports/{export_id}").json()
        assert detail["download_url"]
        dl = c.get(f"/api/exports/{export_id}/download")
        assert dl.status_code == 200
        assert dl.headers["content-type"].startswith("application/zip")
        assert len(dl.content) > 100

        report = c.get(f"/api/reports/{run_id}")
        assert report.status_code == 200
        assert "text/html" in report.headers["content-type"]
        assert run_id in report.text or "NIYANTA" in report.text

        val = c.get(f"/api/validate/{run_id}")
        assert val.status_code == 200
        bench = c.post(f"/api/validate/benchmark/{run_id}")
        assert bench.status_code == 200, bench.text
        assert bench.json()["result"]["grade"] in ("A", "B", "C", "D")

        cmp = c.get(f"/api/compare/{run_id}/{run_id}")
        assert cmp.status_code == 200
        assert all(v == 0 for k, v in cmp.json()["delta"].items() if isinstance(v, (int, float)))


def test_alert_rules_endpoint():
    with client() as c:
        out = c.get("/api/alerts/rules")
        assert out.status_code == 200
        assert isinstance(out.json(), list)
        created = c.post("/api/alerts/rules",
                         json={"name": "unit rule", "condition": {"metric": "score", "op": ">",
                                                                  "threshold": 50}})
        assert created.status_code == 200, created.text
