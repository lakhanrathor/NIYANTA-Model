"""Auto real-data paths: Copernicus DEM tiles for any AOI + GEE watch box on execute."""

from __future__ import annotations

import time
import uuid

import numpy as np
import pytest

from config import settings
from modules.catalog import catalog
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.proc_dem import copernicus, mod_detect
from modules.run import execute as run_execute
from modules.storage import paths
from schemas.scenario import ScenarioSpec

# single 1° tile N21_00_E077_00; AOI sits inside it with an exact integer edge
BBOX = [77.9, 21.9, 78.0, 22.0]
TILE = "Copernicus_DSM_COG_10_N21_00_E077_00_DEM"


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(3)
    yield
    jobs.stop_workers()


def test_tile_names_edges_and_limits():
    assert copernicus.tile_names(BBOX) == [TILE]
    # exact integer east/north edge must not pull the adjacent tile
    assert copernicus.tile_names((77.0, 21.0, 78.0, 22.0)) == [TILE]
    # fractional span crosses into the next 1° tile
    assert len(copernicus.tile_names((77.5, 21.5, 78.6, 22.4))) == 4
    with pytest.raises(copernicus.CopernicusError):
        copernicus.tile_names((-200.0, 21.0, 78.0, 22.0))
    with pytest.raises(copernicus.CopernicusError):
        copernicus.tile_names((0.0, 0.0, 10.0, 10.0))  # > MAX_TILES


def test_ensure_dem_uses_cache_without_network(monkeypatch, tmp_path):
    # isolate from the real storage/dem cache so tests never clobber live tiles
    monkeypatch.setattr(paths, "DEM", tmp_path)
    fake = tmp_path / f"{TILE}.tif"
    fake.write_bytes(b"x" * 4096)
    try:
        out = copernicus.ensure_dem(BBOX)
        assert out == fake
    finally:
        fake.unlink(missing_ok=True)


def _write_fake_tile() -> None:
    """A real GeoTIFF at the tile path covering the AOI bbox (valley-shaped)."""
    rows = cols = 60
    yy, xx = np.mgrid[0:rows, 0:cols]
    z = (800.0 - 12.0 * yy + 60.0 * np.abs(xx - cols // 2) / (cols // 2)).astype(np.float32)
    from rasterio.transform import from_origin

    step = 0.1 / cols
    meta = {"transform": list(from_origin(BBOX[0], BBOX[3], step, step))[:6],
            "crs": "EPSG:4326", "width": cols, "height": rows, "nodata": None}
    paths.DEM.mkdir(parents=True, exist_ok=True)
    mod_detect.write_geotiff(paths.DEM / f"{TILE}.tif", z, meta)


def test_stage_terrain_auto_fetches_copernicus_from_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(paths, "DEM", tmp_path)
    _write_fake_tile()
    settings.auto_dem = True
    try:
        spec = ScenarioSpec.model_validate({
            "case": "1", "name": f"auto dem {uuid.uuid4().hex[:6]}",
            "aoi": {"type": "bbox", "coords": BBOX}, "engine": "fast",
            "breach": {"mode": "overtopping", "method": "froehlich2008"},
            "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                          "dam_height_m": 45.0, "area_km2": 12.0},
            "horizon": {"duration_hr": 1.0},
            "stations_km": [0.0, 5.0, 10.0],
        }).model_dump(mode="json")
        sc = catalog.scenario_create(spec)
        run = run_execute.create_run(sc["id"])
        run_execute.execute(run["id"])
        t0 = time.time()
        row = None
        while time.time() - t0 < 240:
            row = catalog.run_get(run["id"])
            if row["state"] in ("VALIDATED", "FAILED", "PUBLISHED"):
                break
            time.sleep(1)
        assert row and row["state"] == "VALIDATED", row and row["error"]

        prod = catalog.product_latest("conditioned_dem", run_id=run["id"])
        assert prod and prod["meta"]["source"] == "copernicus_auto"
        ds = db.query_one(
            "SELECT * FROM dataset WHERE path = %s AND deleted_at IS NULL",
            (paths.rel(paths.DEM / f"{TILE}.tif"),))
        assert ds and ds["status"] == "ready"
        assert ds["meta"].get("source") == "copernicus_dem_30m"
    finally:
        settings.auto_dem = False
        (paths.DEM / f"{TILE}.tif").unlink(missing_ok=True)
        db.execute("DELETE FROM dataset WHERE path = %s",
                   (paths.rel(paths.DEM / f"{TILE}.tif"),))


def test_auto_imagery_creates_watch_box_and_sweep():
    """execute-time side effect: covering box + one daily-deduped sweep job."""
    spec = ScenarioSpec.model_validate({
        "case": "1", "name": f"imagery {uuid.uuid4().hex[:6]}",
        "aoi": {"type": "bbox", "coords": [85.5, 27.5, 85.6, 27.6]},
        "engine": "fast",
        "breach": {"mode": "overtopping", "method": "froehlich2008"},
        "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                      "dam_height_m": 45.0, "area_km2": 12.0},
        "horizon": {"duration_hr": 1.0},
    }).model_dump(mode="json")
    sc = catalog.scenario_create(spec)
    run = run_execute.create_run(sc["id"])
    settings.auto_imagery = True
    job_ids: list[str] = []
    box_id = None
    try:
        run_execute._auto_imagery(run)
        from modules.db.client import geo_bounds

        box = None
        for row in db.query("SELECT id, bbox FROM watch_box WHERE preset = 'auto'"):
            env = geo_bounds(row["bbox"])
            if env and env[0] <= 85.6 and env[2] >= 85.5 and env[1] <= 27.6 and env[3] >= 27.5:
                box = row
                break
        assert box, "auto watch box not created"
        box_id = str(box["id"])
        jobs_for_run = db.query(
            "SELECT id FROM job WHERE type = 'gee.daily' AND params->>'run_id' = %s",
            (str(run["id"]),))
        assert len(jobs_for_run) == 1, "gee.daily sweep not queued exactly once"
        job_ids = [str(j["id"]) for j in jobs_for_run]
        # idempotent: a second call (retry/re-execute) must not queue another sweep
        run_execute._auto_imagery(run)
        again = db.query(
            "SELECT id FROM job WHERE type = 'gee.daily' AND params->>'run_id' = %s",
            (str(run["id"]),))
        assert len(again) == len(job_ids)
    finally:
        settings.auto_imagery = False
        for jid in job_ids:
            db.execute("DELETE FROM job WHERE id = %s", (jid,))
        if box_id:
            db.execute("DELETE FROM gee_job WHERE box_id = %s", (box_id,))
            db.execute("DELETE FROM watch_box WHERE id = %s", (box_id,))
