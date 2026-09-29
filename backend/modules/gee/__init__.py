"""GEE watch framework — live Earth Engine first (MODULE_SPEC 4.7).

Same pipeline shape as GEE: daily sweep enqueues per-box jobs; handlers run the
real change-detection math on live EE imagery (`modules.gee.live`), local
rasters (uploaded datasets / observations), and — only when both are missing —
a clearly-labelled `simulated: true` observation pair so the chain still runs
end to end. Source chain per job: live EE → local raster (Otsu) → simulation.
All metrics are computed by the real math below; every row records its source.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from modules.db import client as db

JOB_KINDS = ("s2_indices", "s1_watermask", "lst_snow", "seismic_sync",
             "flood_extent", "glacier_ice")
FLAG_DELTA_PCT = 20.0


def run_daily(box_id: str | None = None) -> list[dict]:
    """Enqueue one job of each kind for every active watch box (Flow A trigger).

    Deduplicated per (box, kind, day): the scheduler wakes every few minutes
    during the sweep hour and manual re-runs are common — a second call on the
    same day must not pile another full set of jobs onto the queue.
    """
    boxes = db.query("SELECT * FROM watch_box WHERE active")
    if box_id:
        boxes = [b for b in boxes if str(b["id"]) == box_id]
    today = date.today().isoformat()
    already = {(str(r["box_id"]), r["kind"]) for r in db.query(
        "SELECT box_id, kind FROM gee_job WHERE created >= %s::date", (today,))}
    rows = []
    for box in boxes:
        for kind in JOB_KINDS:
            if (str(box["id"]), kind) in already:
                continue
            rows.append(db.insert("gee_job", {"box_id": str(box["id"]), "kind": kind,
                                              "params": {"date": today}}))
    return rows


def jobs(box_id: str | None = None, limit: int = 100) -> list[dict]:
    if box_id:
        return db.query("SELECT * FROM gee_job WHERE box_id = %s ORDER BY created DESC LIMIT %s",
                        (box_id, limit))
    return db.query("SELECT * FROM gee_job ORDER BY created DESC LIMIT %s", (limit,))


def observations(box_id: str, limit: int = 50) -> list[dict]:
    return db.query("SELECT * FROM observation WHERE box_id = %s ORDER BY acquired DESC LIMIT %s",
                    (box_id, limit))


def timeline(box_id: str, days: int = 30) -> dict[str, Any]:
    since = date.today().toordinal() - days
    changes = db.query(
        """SELECT * FROM change_detection WHERE box_id = %s
           AND ts > datetime('now', %s) ORDER BY ts""",
        (box_id, f"-{days} days"),
    )
    obs = db.query(
        """SELECT * FROM observation WHERE box_id = %s
           AND acquired >= %s ORDER BY acquired""",
        (box_id, date.fromordinal(since)),
    )
    risk = db.query_one(
        """SELECT * FROM risk_assessment WHERE target_id = %s
           ORDER BY ts DESC LIMIT 1""",
        (box_id,),
    )
    return {"box_id": box_id, "changes": changes, "observations": obs, "latest_risk": risk}


def before_after(box_id: str) -> dict[str, Any]:
    """Before/after pair for a box: baseline vs latest water area."""
    # baselines are namespaced "<sensor>|<change kind>" (see flag_change); rows
    # written before namespacing used the bare sensor — keep them as fallback
    baseline = (db.query_one(
        "SELECT * FROM baseline WHERE box_id = %s AND sensor = 'sentinel1|water_mask'",
        (box_id,)) or db.query_one(
        "SELECT * FROM baseline WHERE box_id = %s AND sensor = 'sentinel1'",
        (box_id,)))
    latest = db.query_one(
        """SELECT * FROM change_detection WHERE box_id = %s AND kind IN ('water_mask','lake_area')
           ORDER BY ts DESC LIMIT 1""",
        (box_id,),
    )
    before = float((baseline or {}).get("metrics", {}).get("area_km2") or 0.0)
    after = float((latest or {}).get("metrics", {}).get("area_km2") or before)
    return {"box_id": box_id, "before_km2": before, "after_km2": after,
            "delta_pct": round((after - before) / before * 100.0, 1) if before else 0.0,
            "baseline": baseline, "latest": latest}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def flag_change(box_id: str, kind: str, metrics: dict[str, Any],
                observation_id: str | None = None) -> dict[str, Any]:
    """Insert a change_detection row + roll the baseline; returns the row (MODULE_SPEC 4.8).

    Baselines are namespaced per (sensor, change kind): flood vs water_mask share
    the sentinel1 sensor and glacier vs lake_area share sentinel2, but each pair
    measures a different physical quantity — sharing a baseline would fire false
    change flags on every sweep.
    """
    sensor = metrics.get("sensor", "sentinel1")
    baseline_sensor = f"{sensor}|{kind}"
    base = db.query_one("SELECT * FROM baseline WHERE box_id = %s AND sensor = %s",
                        (box_id, baseline_sensor))
    area = float(metrics.get("area_km2") or 0.0)
    baseline_value = float(base["metrics"].get("area_km2") or 0.0) if base else 0.0
    delta = round((area - baseline_value) / baseline_value * 100.0, 1) if baseline_value else 0.0
    flagged = abs(delta) >= FLAG_DELTA_PCT if baseline_value else False
    merged = {**metrics, "baseline_area_km2": baseline_value, "delta_pct": delta}
    row = db.insert("change_detection", {
        "box_id": box_id, "kind": kind, "flagged": flagged,
        "metrics": merged, "baseline_id": str(base["id"]) if base else None,
        "observation_id": observation_id,
    })
    # rolling baseline: simple average of previous baseline and new observation
    if area > 0:
        new_area = area if not baseline_value else round((baseline_value + area) / 2.0, 3)
        if base:
            db.upsert("baseline", {"box_id": box_id, "sensor": baseline_sensor,
                                   "path": base.get("path"),
                                   "metrics": {**base.get("metrics", {}), "area_km2": new_area}},
                      conflict="box_id, sensor")
        else:
            db.insert("baseline", {"box_id": box_id, "sensor": baseline_sensor,
                                   "metrics": {"area_km2": new_area}})
    return row


def save_observation(box_id: str, sensor: str, kind: str, meta: dict,
                     acquired: date | None = None) -> dict:
    return db.insert("observation", {"box_id": box_id, "sensor": sensor, "kind": kind,
                                     "acquired": acquired or date.today(), "meta": meta})
