"""Live GEE fetchers, offline fallback chain, and namespaced baselines."""

from __future__ import annotations

import pytest

from config import settings
from modules.db import client as db
from modules.db import seed
from modules.gee import flag_change, live


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    yield


def _box() -> dict:
    return db.query_one("SELECT * FROM watch_box ORDER BY created LIMIT 1")


def _ee_online() -> bool:
    if settings.gee_mode != "online":
        return False
    from modules.gee import client

    return client.ready()


def test_lst_live_fetch():
    if not _ee_online():
        pytest.skip("gee offline or uninitialized")
    out = live.lst(_box())
    assert -80.0 < out["lst_c"] < 70.0
    assert -40.0 < out["anomaly_c"] < 40.0
    assert out["elapsed_ms"] > 0


def test_s1_water_live_fetch_flat_only():
    if not _ee_online():
        pytest.skip("gee offline or uninitialized")
    out = live.s1_water(_box())
    # slope-masked Otsu over the box — must stay a fraction of box area
    assert out["area_km2"] >= 0.0
    assert out["scenes_available"] >= 1
    assert out["threshold_db"] < 0.0  # VV backscatter in dB is negative


def test_compute_falls_back_when_gee_offline():
    from modules.gee import handlers

    box = _box()
    original = settings.gee_mode
    settings.gee_mode = "offline"  # live._require_ready raises → fallback path
    try:
        out = handlers.compute("lst_snow", dict(box))
    finally:
        settings.gee_mode = original
    assert out["source"] in ("local_raster", "simulation")
    assert out["water_area_km2"] >= 0.0
    assert out["flagged"] in (True, False)
    row = db.query_one("SELECT meta FROM observation WHERE id = %s",
                       (out["observation_id"],))
    assert row["meta"]["source"] == out["source"]


def test_baselines_namespaced_per_change_kind():
    box_id = db.query_one(
        """INSERT INTO watch_box (name, bbox)
           VALUES ('ns box', ST_MakeEnvelope(77.9, 21.9, 78.1, 22.1, 4326))
           RETURNING id"""
    )["id"]
    water = {"area_km2": 10.0, "sensor": "sentinel1"}
    flood = {"area_km2": 50.0, "sensor": "sentinel1"}
    first = flag_change(str(box_id), "water_mask", water)
    assert first["flagged"] is False  # seeds sentinel1|water_mask
    # flood shares the sentinel1 sensor but its own baseline: 50 vs empty →
    # not flagged. Without namespacing this would compare against 10 (+400%)
    second = flag_change(str(box_id), "flood", flood)
    assert second["flagged"] is False
    third = flag_change(str(box_id), "water_mask", {"area_km2": 30.0, "sensor": "sentinel1"})
    assert third["flagged"] is True  # +200% vs the water_mask baseline only
    rows = db.query("SELECT sensor FROM baseline WHERE box_id = %s", (box_id,))
    sensors = {r["sensor"] for r in rows}
    assert sensors == {"sentinel1|water_mask", "sentinel1|flood"}
