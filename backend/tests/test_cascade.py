"""Cascade screening: raster sampling, overtopping flags, counterpart drafts."""

from __future__ import annotations

import json

import numpy as np


def _client():
    from fastapi.testclient import TestClient

    from app import create_app

    return TestClient(create_app())


def _make_run_with_products():
    """Fabricated 10x10 run world: dam W wet+overtopped, dam D dry, dam S source."""
    import rasterio
    from rasterio.transform import Affine

    from modules.catalog import catalog
    from modules.db import client as db
    from modules.storage import paths

    scen = db.insert("scenario", {"name": "cascade-test", "case": "2", "spec": json.dumps({})})
    run = db.insert("run", {"scenario_id": scen["id"], "engine": "fast", "state": "VALIDATED"})
    run_id = str(run["id"])
    # Test DB persists across tests and invocations — drop earlier fabrications.
    db.execute("DELETE FROM dam WHERE name LIKE 'Cascade %'")

    H = W = 10
    origin_lon, origin_lat, d = 79.60, 30.55, 0.01
    z = np.full((H, W), 100.0, dtype=np.float64)
    meta = {
        "origin_lon": origin_lon, "origin_lat": origin_lat,
        "dx_deg": d, "dy_deg": d, "rows": H, "cols": W,
        "cell_m": 1000.0, "lat_mid": 30.5,
    }
    rd = paths.run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(rd / "dem.npz", z=z, meta_json=np.array(json.dumps(meta)))

    tr = Affine(d, 0.0, origin_lon, 0.0, -d, origin_lat)
    depth = np.zeros((H, W), dtype=np.float32)
    depth[5, 5] = 15.0
    vel = np.zeros((H, W), dtype=np.float32)
    vel[5, 5] = 3.0
    arr = np.full((H, W), -1.0, dtype=np.float32)
    arr[5, 5] = 0.25
    for name, arr_data in (("max_depth", depth), ("max_velocity", vel), ("arrival_time", arr)):
        fp = rd / f"{name}.tif"
        with rasterio.open(fp, "w", driver="GTiff", width=W, height=H, count=1,
                            dtype="float32", transform=tr, crs="EPSG:4326") as ds:
            ds.write(arr_data, 1)
        catalog.product_create(name, str(fp.relative_to(paths.ROOT)), run_id=run_id)

    def dam(name, lon, lat, height=None):
        return db.insert("dam", {
            "name": name,
            "location": json.dumps({"type": "Point", "coordinates": [lon, lat]}),
            "height_m": height, "state": "UT",
        })

    # cell (5,5) -> lon 79.655, lat 30.495
    dam_w = dam("Cascade Wet", 79.655, 30.495, 10.0)
    dam_d = dam("Cascade Dry", 79.605, 30.545, 10.0)
    dam_s = dam("Cascade Source", 79.62, 30.52, 5.0)
    spec = {
        "case": "2", "dam_id": str(dam_s["id"]),
        "aoi": {"type": "bbox", "crs": "EPSG:4326", "coords": [79.60, 30.49, 79.66, 30.55]},
        "reservoir": {"inflow_cms": 50.0},
        "horizon": {"dt_s": 1.0, "duration_hr": 2.0},
        "engine": "fast",
    }
    db.execute("UPDATE scenario SET spec = %s WHERE id = %s", (json.dumps(spec), scen["id"]))
    return run_id, {r["name"]: str(r["id"]) for r in (dam_w, dam_d, dam_s)}


def test_cascade_unknown_run_404():
    import uuid

    c = _client()
    assert c.post(f"/api/runs/{uuid.uuid4()}/cascade", json={}).status_code == 404


def test_cascade_screening_and_overtopping():
    run_id, ids = _make_run_with_products()
    c = _client()
    r = c.post(f"/api/runs/{run_id}/cascade", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_dam"]["dam_id"] == ids["Cascade Source"]
    by_name = {d["name"]: d for d in body["dams"]}
    # source excluded; wet dam overtopped (level 115 > crest 110); dry dam dry
    assert "Cascade Source" not in by_name
    wet = by_name["Cascade Wet"]
    assert wet["status"] == "overtopped" and wet["overtopped"] is True
    assert wet["max_depth_m"] == 15.0 and wet["arrival_hr"] == 0.25
    assert by_name["Cascade Dry"]["status"] == "dry"


def test_cascade_drafts_counterparts():
    run_id, ids = _make_run_with_products()
    c = _client()
    r = c.post(f"/api/runs/{run_id}/cascade", json={"create_scenarios": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scenarios_created"] == [
        {"dam_id": ids["Cascade Wet"], "scenario_id": body["scenarios_created"][0]["scenario_id"]}
    ]
    sid = body["scenarios_created"][0]["scenario_id"]
    got = c.get(f"/api/scenarios/{sid}")
    assert got.status_code == 200
    scenspec = got.json().get("spec") or got.json().get("scenario", {}).get("spec")
    if isinstance(scenspec, str):
        scenspec = json.loads(scenspec)
    assert scenspec["dam_id"] == ids["Cascade Wet"]
