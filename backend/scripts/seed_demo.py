"""Frontend demo data: prune test scenarios/runs, seed one scenario per case,
and complete a run for case 1 so MissionHub/Overview/Dashboard show real data.

Run from backend/:  python scripts/seed_demo.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from modules.catalog import catalog
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.run import execute as run_execute
from schemas.scenario import ScenarioSpec

BBOX = [77.88, 21.88, 78.12, 22.12]

DEMO = [
    {
        "case": "1",
        "name": "Rishi Ganga Flash Flood (2021)",
        "mode": "overtopping",
        "duration_hr": 6.0,
        "run": True,
    },
    {
        "case": "2",
        "name": "Kosi Barrage Reservoir Overspill",
        "mode": "overtopping",
        "duration_hr": 6.0,
        "run": False,
    },
    {
        "case": "3",
        "name": "Transboundary Sabotage Exercise",
        "mode": "attack",
        "duration_hr": 6.0,
        "run": False,
    },
]

# No FK constraints in schema.sql; order is just for tidiness.
PRUNE = [
    "alert_action", "alert", "export_job", "report", "validation_score",
    "run_lifecycle", "product", "job", "breach_solution", "mesh_meta", "proc_log",
    "run", "scenario",
]


def spec_for(d: dict) -> dict:
    return {
        "case": d["case"],
        "name": d["name"],
        "aoi": {"type": "bbox", "coords": BBOX},
        "engine": "fast",
        "breach": {"mode": d["mode"], "method": "froehlich2008"},
        "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                      "dam_height_m": 45.0, "area_km2": 12.0},
        "horizon": {"duration_hr": d["duration_hr"], "dt_s": 0.0},
        "stations_km": [0.0, 5.0, 10.0, 15.0],
        "dam_type": "homogeneous",
        "erodibility": "medium",
    }


def prune() -> None:
    for table in PRUNE:
        db.execute(f"DELETE FROM {table}")
    # test-fixture watch boxes (and their sweeps) accumulate across pytest runs;
    # the demo keeps only seed.py's DEMO_BOXES.
    junk = ("unit box%", "delta box", "ns box", "Auto %")
    where = "name LIKE %s OR name LIKE %s OR name LIKE %s OR name LIKE %s"
    db.execute(f"DELETE FROM gee_job WHERE box_id IN "
               f"(SELECT id FROM watch_box WHERE {where})", junk)
    db.execute(f"DELETE FROM watch_box WHERE {where}", junk)
    print(f"pruned: {', '.join(PRUNE)} + test watch boxes")


def main() -> None:
    seed.seed()
    prune()

    case1_id = None
    for d in DEMO:
        spec = ScenarioSpec.model_validate(spec_for(d))
        sc = catalog.scenario_create(spec.model_dump(mode="json"))
        print(f"scenario: [{d['case']}] {d['name']} ({sc['id']})")
        if d["case"] == "1":
            case1_id = str(sc["id"])

    assert case1_id
    if DEMO[0]["run"]:
        job_handlers.register_all()
        jobs.start_workers(3)
        run = run_execute.create_run(case1_id)
        print("run:", run["id"])
        print("execute:", run_execute.execute(run["id"]))
        t0 = time.time()
        final = None
        while time.time() - t0 < 300:
            final = catalog.run_get(run["id"])
            if final and final["state"] in ("VALIDATED", "PUBLISHED", "FAILED"):
                break
            time.sleep(1)
        jobs.stop_workers()
        state = final["state"] if final else "missing"
        print(f"final state: {state}" + (f" error={final['error']}" if final and final.get("error") else ""))
        if state != "VALIDATED":
            raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
