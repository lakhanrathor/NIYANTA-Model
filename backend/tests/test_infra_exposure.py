"""OSM infrastructure × frame stack (modules/run/infra_exposure.py)."""

from __future__ import annotations

import json
import uuid

import numpy as np

from modules.db import client as db
from modules.db import seed
from modules.run import infra_exposure
from modules.solvers.base import FrameSeries
from modules.storage import paths

# 10×10 grid of 0.001° cells, north-west corner at (80.0 E, 30.01 N)
GRID = {"origin_lon": 80.0, "origin_lat": 30.01, "dx_deg": 0.001, "dy_deg": 0.001,
        "rows": 10, "cols": 10}


def _cell_center(r: int, c: int) -> tuple[float, float]:
    return 80.0 + (c + 0.5) * 0.001, 30.01 - (r + 0.5) * 0.001


def test_exposure_windows_thresholds_and_rtree():
    seed.seed_schema()  # infra_rtree + triggers
    run_id = str(uuid.uuid4())
    river_id = str(uuid.uuid4())

    # 4 frames: cell (2,2) floods 0.5 m at frame 1, 2.0 m at frame 2, dries at 3;
    # cell (7,7) only ever reaches 0.2 m (wet for a building, not a road cut)
    depth = np.zeros((4, 10, 10), dtype=np.float32)
    depth[1, 2, 2], depth[2, 2, 2] = 0.5, 2.0
    depth[1:, 7, 7] = 0.2
    FrameSeries(
        times_s=np.array([60.0, 120.0, 180.0, 240.0]), depth=depth,
        max_depth=depth.max(0), max_vel=np.zeros((10, 10), np.float32),
        arrival_s=np.full((10, 10), np.nan, np.float32), meta={"grid": GRID},
    ).save(paths.run_dir(run_id) / "frames.npz")

    def square(lon: float, lat: float, h: float = 0.0001) -> str:
        ring = [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]
        return json.dumps({"type": "Polygon", "coordinates": [ring]})

    lon_a, lat_a = _cell_center(2, 2)
    lon_b, lat_b = _cell_center(7, 7)
    lon_o, lat_o = 81.0, 31.0  # outside the grid: must never be returned
    rows = [
        ("building", square(lon_a, lat_a)),
        ("building", square(lon_b, lat_b)),
        ("building", square(lon_o, lat_o)),
        # road with one segment centred on (2,2) and one on (7,7)
        ("road", json.dumps({"type": "LineString", "coordinates": [
            [lon_a - 0.0004, lat_a], [lon_a + 0.0004, lat_a],
            [lon_b - 0.0004, lat_b], [lon_b + 0.0004, lat_b]]})),
    ]
    for kind, geom in rows:
        db.execute("INSERT INTO infra_footprint (river_id, kind, geom) VALUES (%s, %s, %s)",
                   (river_id, kind, geom))
    try:
        doc = infra_exposure.build(run_id)
        b = sorted(doc["buildings"], key=lambda x: -x.get("d", 0))
        assert len(b) == 2, "the out-of-grid building must be pruned by the R*Tree probe"
        # flooded 0.5 → 2.0 m over frames 1..2, then dry
        assert (b[0]["f0"], b[0]["f1"], b[0]["d"], b[0]["s"]) == (1, 2, 2.0, [0.5, 2.0])
        # 0.2 m > 0.1 m building threshold → wet from frame 1 to the end
        assert (b[1]["f0"], b[1]["f1"]) == (1, 3)

        cut = [r for r in doc["roads"] if "f0" in r]
        # only the segment over (2,2) passes the 0.30 m road-cut threshold;
        # the (7,7) segment's 0.2 m and the connector over dry ground do not
        assert len(cut) == 1 and cut[0]["d"] == 2.0
        assert doc["summary"]["buildings_flooded"] == 2
        assert doc["summary"]["road_km_cut"] > 0
    finally:
        db.execute("DELETE FROM infra_footprint WHERE river_id = %s", (river_id,))
    # the delete trigger keeps the index in step
    assert not db.query(
        "SELECT id FROM infra_rtree WHERE minx >= 80.0 AND maxx <= 80.02 AND miny >= 29.99 AND maxy <= 30.02")
