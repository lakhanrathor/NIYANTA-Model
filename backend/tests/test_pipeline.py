"""End-to-end: real terrain → mesh → solve → post → impact → validate → export."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from modules.catalog import catalog
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.run import execute as run_execute
from modules.solvers import delft3d_fm
from modules.storage import paths
from schemas.scenario import ScenarioSpec


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(3)
    yield
    jobs.stop_workers()


def make_spec(**over) -> dict:
    base = {
        "case": "1",
        "name": "pipeline test",
        "engine": "fast",
        "breach": {"mode": "overtopping", "method": "froehlich2008"},
        "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                      "dam_height_m": 45.0, "area_km2": 12.0},
        "horizon": {"duration_hr": 6.0},
        "stations_km": [0.0, 5.0, 10.0, 15.0],
    }
    base.update(over)
    return base


def run_to_completion(spec: dict, timeout: float = 240.0) -> dict:
    validated = ScenarioSpec.model_validate(spec)
    sc = catalog.scenario_create(validated.model_dump(mode="json"))
    run = run_execute.create_run(sc["id"])
    run_execute.execute(run["id"])
    t0 = time.time()
    while time.time() - t0 < timeout:
        row = catalog.run_get(run["id"])
        if row["state"] in ("VALIDATED", "FAILED", "PUBLISHED"):
            return row
        time.sleep(1)
    return catalog.run_get(run["id"])


def test_full_pipeline_validates_with_real_outputs():
    row = run_to_completion(make_spec())
    assert row["state"] == "VALIDATED", row["error"]
    res = row["result"] or {}
    metrics = row["metrics"]

    # metrics sanity
    assert metrics["peak_discharge_cms"] > 1000
    assert metrics["max_depth_m"] > 0.5
    assert 0.5 < metrics["inundation_km2"] < 1000
    assert metrics["mass_balance_error_pct"] < 5.0

    # rasters on disk
    for kind in ("max_depth", "max_velocity", "arrival_time", "inundation_extent"):
        assert kind in res["rasters"], kind
        assert paths.abs_path(res["rasters"][kind]).exists(), kind

    # stations from solver
    assert len(res["stations"]) == 4
    assert res["stations"][0]["peak_cms"] > 1000
    assert res["stations"][0]["arrival_hr"] is not None

    # impact vs seeded demo villages (default AOI center 78/22)
    impact = res["impact"]
    assert impact["villages_affected"] >= 1
    assert impact["population_exposed"] >= 1000
    assert impact["by_village"][0]["hazard"] in ("HIGH", "MODERATE", "LOW")

    # validation + exports
    assert res["validation"]["grade"] in ("A", "B", "C", "D")
    for kind in ("shp", "kml", "geojson", "geotiff", "csv", "report"):
        assert kind in res["exports"], kind
    assert paths.abs_path("exports/" + row["id"] + "/package.zip").exists()

    # stage products registered
    kinds = {p["kind"] for p in catalog.product_list(run_id=row["id"])}
    assert {"conditioned_dem", "mesh", "frames", "max_depth",
            "inundation_vector", "impact_table", "stations"} <= kinds

    # completion alert fired (arrival_fast rule)
    alerts = db.query("SELECT id FROM alert WHERE run_id = %s", (row["id"],))
    assert len(alerts) >= 1


def test_pipeline_second_run_and_publish():
    row = run_to_completion(make_spec(name="pipeline publish"))
    assert row["state"] == "VALIDATED", row["error"]
    pub = run_execute.publish(row["id"])
    assert pub["state"] == "PUBLISHED"


def test_benchmark_hidkal_grade():
    row = run_to_completion(make_spec(
        name="hidkal benchmark",
        benchmark="hidkal2021",
        breach={"mode": "overtopping", "method": "froehlich2008"},
        reservoir={"storage_mcm": 3706.0, "initial_level_m": 729.0,
                   "dam_height_m": 51.0, "area_km2": 80.0},
        horizon={"duration_hr": 8.0},
    ))
    assert row["state"] == "VALIDATED", row["error"]
    val = (row["result"] or {}).get("validation") or {}
    assert val["benchmark"] == "hidkal2021"
    assert val["error_peak_pct"] is not None and val["error_peak_pct"] >= 0
    assert val["grade"] in ("A", "B", "C", "D")
    stored = db.query_one("SELECT grade FROM validation_score WHERE run_id = %s", (row["id"],))
    assert stored and stored["grade"] == val["grade"]


def test_pipeline_sph_engine_validates():
    """Full stage chain on the near-field SPH engine (short horizon for speed)."""
    row = run_to_completion(make_spec(
        name="sph pipeline",
        engine="sph",
        horizon={"duration_hr": 1.0},
    ), timeout=300.0)
    assert row["state"] == "VALIDATED", row["error"]
    res = row["result"] or {}
    assert row["metrics"]["mass_balance_error_pct"] < 5.0
    for kind in ("max_depth", "max_velocity", "arrival_time", "inundation_extent"):
        assert paths.abs_path(res["rasters"][kind]).exists(), kind
    kinds = {p["kind"] for p in catalog.product_list(run_id=row["id"])}
    assert {"frames", "max_depth", "inundation_vector"} <= kinds
    frames = __import__("modules.solvers.base", fromlist=["FrameSeries"]).FrameSeries.load(
        paths.run_dir(row["id"]) / "frames.npz")
    assert frames.meta["engine"] == "sph"


@pytest.mark.skipif(not delft3d_fm.engine_available(),
                    reason="delft3d engine not installed")
def test_pipeline_delft3d_engine_validates():
    """Full stage chain on the D-Flow FM engine (short horizon for speed)."""
    row = run_to_completion(make_spec(
        name="delft3d pipeline",
        engine="delft3d",
        horizon={"duration_hr": 1.0},
    ), timeout=300.0)
    assert row["state"] == "VALIDATED", row["error"]
    res = row["result"] or {}
    assert row["metrics"]["mass_balance_error_pct"] < 5.0
    for kind in ("max_depth", "max_velocity", "arrival_time", "inundation_extent"):
        assert paths.abs_path(res["rasters"][kind]).exists(), kind
    kinds = {p["kind"] for p in catalog.product_list(run_id=row["id"])}
    assert {"frames", "max_depth", "inundation_vector"} <= kinds
    frames = __import__("modules.solvers.base", fromlist=["FrameSeries"]).FrameSeries.load(
        paths.run_dir(row["id"]) / "frames.npz")
    assert frames.meta["engine"] == "delft3d"
