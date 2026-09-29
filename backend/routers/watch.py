from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

from modules.db import client as db
from modules.gee import before_after, jobs as gee_jobs, timeline
from modules.jobs import queue as jobs
from modules.risk import event as risk_event

router = APIRouter(prefix="/watch", tags=["watch"])


@router.get("/boxes")
def list_boxes() -> list[dict]:
    return db.query("SELECT *, ST_AsGeoJSON(bbox) AS bbox_geojson FROM watch_box ORDER BY created")


@router.get("/overview")
def overview() -> dict:
    """Pan-India counters for the Watch screen. Straight COUNT(*)."""
    def count(sql: str) -> int:
        row = db.query_one(sql)
        return int(next(iter(row.values())) if row else 0)

    return {
        "dams": count("SELECT count(*) FROM dam"),
        "watch_boxes": count("SELECT count(*) FROM watch_box"),
        "alerts": count("SELECT count(*) FROM alert WHERE state <> 'CLOSED'"),
        "rivers": count("SELECT count(*) FROM river"),
    }


@router.get("/gee-detections")
def gee_detections(days: int = 7) -> dict:
    """Detection counts over the last N days, grouped for Key Statistics."""
    rows = db.query(
        """SELECT
             CASE
               WHEN kind IN ('water_mask', 'water_extent') THEN 'water_extent'
               WHEN kind IN ('glacier', 'glacier_extent', 'snow') THEN 'glacier'
               WHEN kind IN ('high_rainfall', 'flood') THEN 'rainfall'
               WHEN kind IN ('blockage', 'reservoir_anomaly') THEN 'blockage'
               ELSE 'other'
             END AS bucket,
             count(*) AS n
           FROM change_detection
           WHERE ts >= datetime('now', %s)
           GROUP BY 1""",
        (f"-{days} days",),
    )
    out = {"water_extent": 0, "glacier": 0, "rainfall": 0, "blockage": 0, "total": 0}
    for r in rows:
        if r["bucket"] in out:
            out[r["bucket"]] = int(r["n"])
        out["total"] += int(r["n"])
    return out


@router.post("/boxes")
def create_box(body: dict) -> dict:
    name = body.get("name")
    bbox = body.get("bbox")
    if not name or not isinstance(bbox, list) or len(bbox) != 4:
        raise HTTPException(422, "name and bbox [minx, miny, maxx, maxy] required")
    try:
        row = db.query_one(
            """INSERT INTO watch_box (name, preset, bbox, meta)
               VALUES (%s, %s, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s::jsonb)
               RETURNING *""",
            (name, body.get("preset", "custom"), bbox[0], bbox[1], bbox[2], bbox[3],
             json.dumps(body.get("meta") or {})),
        )
    except Exception as exc:  # noqa: BLE001 - DB boundary
        raise HTTPException(422, str(exc)) from exc
    return row  # type: ignore[return-value]


@router.get("/boxes/{box_id}/timeline")
def box_timeline(box_id: str, days: int = 30) -> dict:
    if not db.query_one("SELECT id FROM watch_box WHERE id = %s", (box_id,)):
        raise HTTPException(404, "watch box not found")
    return timeline(box_id, days)


@router.get("/boxes/{box_id}/beforeafter")
def box_before_after(box_id: str) -> dict:
    if not db.query_one("SELECT id FROM watch_box WHERE id = %s", (box_id,)):
        raise HTTPException(404, "watch box not found")
    return before_after(box_id)


@router.post("/run")
def trigger_daily(body: dict | None = None) -> dict:
    """Enqueue the daily sweep (s2_indices, s1_watermask, lst_snow, flood_extent, glacier_ice)."""
    from config import settings  # noqa: PLC0415

    job = jobs.add_job("gee.daily", (body or {}).get("params") or {})
    return {"job_id": str(job["id"]), "status": job["status"], "mode": settings.gee_mode}


@router.get("/boxes/{box_id}/image")
def box_image(box_id: str) -> Any:
    """Latest live S2 quicklook PNG for a box (falls back to GeoTIFF bytes)."""
    from pathlib import Path  # noqa: PLC0415

    from fastapi.responses import FileResponse  # noqa: PLC0415

    from modules.storage import paths  # noqa: PLC0415

    if not db.query_one("SELECT id FROM watch_box WHERE id = %s", (box_id,)):
        raise HTTPException(404, "watch box not found")
    box_dir = paths.ROOT / "gee" / box_id
    if not box_dir.is_dir():
        raise HTTPException(404, "no imagery for box yet")
    files: list[Path] = sorted(
        [p for p in box_dir.glob("*.png") if p.stat().st_size > 0],
        key=lambda p: p.stat().st_mtime)
    if files:
        return FileResponse(files[-1], media_type="image/png")
    tifs = sorted([p for p in box_dir.glob("*.tif") if p.stat().st_size > 0],
                  key=lambda p: p.stat().st_mtime)
    if tifs:
        return FileResponse(tifs[-1], media_type="image/tiff")
    raise HTTPException(404, "no imagery for box yet")


@router.get("/jobs")
def list_jobs(box_id: str | None = None, limit: int = 100) -> list[dict]:
    return gee_jobs(box_id, limit)


@router.get("/changes")
def list_changes(flagged: bool = False, limit: int = 100) -> list[dict]:
    return risk_event.recent_changes(flagged_only=flagged, limit=limit)


@router.post("/score/{box_id}")
def score_box(box_id: str) -> dict:
    """Manual f₂ trigger for a box (same path the automation uses)."""
    from routers.risk import score_event  # noqa: PLC0415

    return score_event(box_id)
