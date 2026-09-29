"""Player 3D endpoints: hazard villages, full-res terrain, tile ramp sets."""

from __future__ import annotations

import json
import uuid

import numpy as np


def _client():
    from fastapi.testclient import TestClient

    from app import create_app

    return TestClient(create_app())


def _make_run() -> str:
    from modules.db import client as db

    scen = db.insert("scenario", {"name": "player-test", "case": "c1", "spec": json.dumps({})})
    run = db.insert("run", {"scenario_id": scen["id"], "engine": "fast", "state": "VALIDATED"})
    return str(run["id"])


def _run_dir(run_id: str):
    from modules.storage import paths

    rd = paths.run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)
    return rd


def test_hazard_villages_unknown_run_404():
    assert _client().get(f"/api/runs/{uuid.uuid4()}/hazard-villages").status_code == 404


def test_hazard_villages_missing_file_404():
    run_id = _make_run()
    assert _client().get(f"/api/runs/{run_id}/hazard-villages").status_code == 404


def test_hazard_villages_roundtrip():
    run_id = _make_run()
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [78.2, 29.9]},
                "properties": {
                    "name": "Testpur",
                    "hazard": "HIGH",
                    "depth_m": 2.5,
                    "arrival_hr": 0.5,
                    "population": 100,
                },
            }
        ],
    }
    _run_dir(run_id).joinpath("hazard_villages.geojson").write_text(json.dumps(fc), encoding="utf-8")
    r = _client().get(f"/api/runs/{run_id}/hazard-villages")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"][0]["properties"]["name"] == "Testpur"


def test_terrain_detail_full_matches_source_grid():
    run_id = _make_run()
    H, W = 300, 260
    z = (np.arange(H * W, dtype=np.float64).reshape(H, W) % 500) + 200.0
    meta = {
        "origin_lon": 78.0,
        "origin_lat": 30.0,
        "dx_deg": 0.001,
        "dy_deg": 0.001,
        "rows": H,
        "cols": W,
        "cell_m": 90.0,
    }
    rd = _run_dir(run_id)
    np.savez_compressed(rd / "dem.npz", z=z, meta_json=np.array(json.dumps(meta)))
    c = _client()
    std = c.get(f"/api/runs/{run_id}/terrain.json").json()
    full = c.get(f"/api/runs/{run_id}/terrain.json?detail=full").json()
    # std caps at 200/axis (step 2 here), full at 400/axis (step 1 here)
    assert (len(std["rows"]), len(std["rows"][0])) == (150, 130)
    assert (len(full["rows"]), len(full["rows"][0])) == (H, W)
    assert full["detail"] == "full"
    assert full["bounds"] == std["bounds"]


def test_create_dam_roundtrip_and_validation():
    c = _client()
    bad = c.post("/api/dams", json={"name": "", "lon": 79.6, "lat": 30.5})
    assert bad.status_code == 422
    bad2 = c.post("/api/dams", json={"name": "Probe X", "lon": 999, "lat": 30.5})
    assert bad2.status_code == 422
    r = c.post("/api/dams", json={
        "name": "Probe Dam ZZZ", "lon": 79.60, "lat": 30.50,
        "state": "Uttarakhand", "height_m": 17,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lon"] == 79.60 and body["lat"] == 30.50
    assert body["height_m"] == 17.0 and body["crest_m"] is None
    got = c.get(f"/api/dams/{body['id']}")
    assert got.status_code == 200 and got.json()["name"] == "Probe Dam ZZZ"
