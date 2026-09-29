from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from modules import discover
from modules.db import client as db

router = APIRouter(tags=["discover"])

RIVER_COLS = """id, name, state, states, basin, kind, source, source_name,
                 mouth_name, length_km, drainage_km2, major_dam_count, rank,
                 featured, thumb, prepared_at, osm_id,
                 ST_AsGeoJSON(path) AS path_geojson,
                 ST_AsGeoJSON(bbox) AS bbox_geojson"""


def _require_uuid(value: str, message: str) -> None:
    """A non-uuid path segment (e.g. /rivers/featured) is a 404, not a DB 500."""
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(404, message) from None


def _headline(text: str | None, last: bool = False) -> str | None:
    """First (or last) non-empty line of a multi-line job field, or None."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return None
    return lines[-1 if last else 0]


@router.get("/rivers/search")
def search_rivers(q: str = Query(""), limit: int = Query(10, ge=1, le=50)) -> list[dict]:
    """Offline catalogue lookup. Never touches the network — see
    /rivers/search/world for the tier that may."""
    try:
        return discover.search(q, limit)
    except Exception as exc:  # noqa: BLE001 - last-resort boundary
        logger.warning("river search failed for {}: {}", q, exc)
        return []


@router.get("/rivers/search/world")
def search_rivers_world(q: str = Query(""), limit: int = Query(10, ge=1, le=50)) -> list[dict]:
    """Explicit online tier: catalogue → Nominatim/Overpass → saved into the
    catalogue, so the next search for that name answers from the database.

    Rows carry `cached: true` when they came straight from the local table.
    """
    try:
        return discover.search_world(q, limit)
    except Exception as exc:  # noqa: BLE001 - an upstream must not 500 Discover
        logger.warning("world river search failed for {}: {}", q, exc)
        return []


# NOTE: literal routes MUST be declared before /rivers/{river_id} or FastAPI
# matches "featured" as a river id and 500s on the uuid cast.
@router.get("/rivers/featured")
def featured_rivers(limit: int = Query(6, ge=1, le=50)) -> list[dict]:
    rows = db.query(
        f"SELECT {RIVER_COLS} FROM river WHERE featured = true "
        "ORDER BY rank NULLS LAST, length_km DESC NULLS LAST LIMIT %s",
        (limit,),
    )
    if not rows:
        # Ranks come from the river index; without them fall back to the
        # longest indexed rivers so the panel is never silently empty.
        rows = db.query(
            f"SELECT {RIVER_COLS} FROM river "
            "ORDER BY length_km DESC NULLS LAST LIMIT %s",
            (limit,),
        )
    return [discover.shape_river(r) for r in rows]


@router.get("/rivers")
def list_rivers(limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    rows = db.query(
        f"SELECT {RIVER_COLS} FROM river "
        "ORDER BY prepared_at DESC NULLS LAST, length_km DESC NULLS LAST LIMIT %s",
        (limit,),
    )
    return [discover.shape_river(r) for r in rows]


@router.post("/rivers")
def create_river(body: dict) -> dict:
    try:
        return discover.create_river(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/rivers/{river_id}")
def get_river(river_id: str) -> dict[str, Any]:
    """Identity + path for the selected river, ~20 KB instead of 7 MB.

    `corridor`, `coverage_pct`, `dam_total` and `dams` were dropped here: they
    belong to the buffered endpoints below and change when the slider moves,
    while this row only changes when the river context does.
    """
    _require_uuid(river_id, "river not found")
    river = discover.get_river(river_id)
    if not river:
        raise HTTPException(404, "river not found")
    return river


@router.get("/rivers/{river_id}/dams")
def river_dams(
    river_id: str,
    buffer_km: float = Query(None, ge=0.1, le=500),
) -> list[dict]:
    """Flat `RiverDam[]`. `buffer_km` keeps only dams inside that corridor."""
    _require_uuid(river_id, "river not found")
    if not db.query_one("SELECT id FROM river WHERE id = %s", (river_id,)):
        raise HTTPException(404, "river not found")
    return discover.river_dams(river_id, buffer_km)


@router.get("/rivers/{river_id}/corridor")
def river_corridor(
    river_id: str,
    buffer_km: float = Query(20, ge=0.1, le=500),
) -> dict:
    """Corridor polygon for the current slider width (map fill + legend)."""
    _require_uuid(river_id, "corridor not found")
    poly = discover.corridor_polygon(river_id, buffer_km)
    if poly is None:
        raise HTTPException(404, "river has no path geometry to buffer")
    return poly


@router.get("/rivers/{river_id}/availability")
def river_availability(
    river_id: str,
    buffer_km: float = Query(20, ge=0.1, le=500),
) -> dict:
    """Data availability for the corridor, read against the slider's buffer.

    Only ever reports what is actually recorded in corridor / corridor_dataset.
    A corridor is prepared for exactly one width, so the response also says
    which width it was prepared for: `stale` means the recorded coverage was
    measured at a different slider position and cannot describe the current one.
    """
    _require_uuid(river_id, "corridor not found")
    empty = {"pct": 0, "present": False}
    corridor = db.query_one("SELECT * FROM corridor WHERE river_id = %s", (river_id,))
    if not corridor:
        return {"coverage_pct": 0, "buffer_km": buffer_km, "corridor_buffer_km": None,
                "stale": True, "dem": dict(empty), "sentinel2": dict(empty),
                "osm": dict(empty), "worldpop": dict(empty),
                "dam_registry": dict(empty)}

    rows = db.query(
        "SELECT kind, coverage_pct, status FROM corridor_dataset WHERE corridor_id = %s",
        (corridor["id"],),
    )
    by_kind = {r["kind"]: r for r in rows}
    present = {"dem": "dem", "sentinel2": "imagery_s2", "osm": "osm",
               "worldpop": "worldpop", "dam_registry": "dams"}
    recorded = float(corridor.get("buffer_m") or 0) / 1000
    out: dict[str, Any] = {
        "coverage_pct": float(corridor.get("coverage_pct") or 0),
        "buffer_km": buffer_km,
        "corridor_buffer_km": round(recorded, 1),
        # 50 m of slider drift is noise, not a different corridor.
        "stale": abs(recorded - buffer_km) > 0.05,
    }
    # A corridor mid-prepare has no recorded rows yet — measure those kinds
    # live from disk evidence with the exact definitions the finalize step
    # writes, instead of reporting a wall of 0%. Once rows exist they rule.
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    bbox = discover._river_bbox(river) if river else None
    for api_key, db_kind in present.items():
        row = by_kind.get(db_kind)
        if row:
            pct = float(row["coverage_pct"]) if row["coverage_pct"] is not None else 0.0
            status = row.get("status") or "missing"
        else:
            measured = discover._measure_kind(river_id, db_kind, bbox)
            if measured:
                pct, status = measured[0], measured[1]
            else:
                pct, status = 0.0, "missing"
        out[api_key] = {"pct": round(pct, 1), "present": status == "available"}
    return out


@router.post("/rivers/{river_id}/prepare")
def prepare_river(river_id: str, buffer_km: float = Query(20, ge=0.1, le=500)) -> dict:
    """Queue corridor.prepare at the slider's current width.

    Re-running this after a slider move is the supported way to re-prepare:
    the corridor row records the new width, so coverage stops reading `stale`
    and only the dams inside the new width are fetched.
    """
    _require_uuid(river_id, "river not found")
    try:
        return {"job_id": discover.prepare(river_id, buffer_km)}
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/corridors")
def list_corridors() -> list[dict]:
    rows = db.query(
        """SELECT c.*, r.name AS river_name FROM corridor c
           JOIN river r ON r.id = c.river_id ORDER BY c.created DESC"""
    )
    for row in rows:
        row["id"] = str(row["id"])
        row["river_id"] = str(row["river_id"])
        row["created_at"] = row.pop("created", None)
    return rows


@router.get("/corridors/{corridor_id}/datasets")
def corridor_datasets(corridor_id: str) -> list[dict]:
    _require_uuid(corridor_id, "corridor not found")
    corr = db.query_one("SELECT river_id FROM corridor WHERE id = %s", (corridor_id,))
    if not corr:
        raise HTTPException(404, "corridor not found")
    rows = db.query(
        "SELECT * FROM corridor_dataset WHERE corridor_id = %s ORDER BY label",
        (corridor_id,),
    )
    if not rows:
        # A prepare that died mid-flight writes nothing, leaving the Downloads
        # panel with no DEM button at all. Measure from disk evidence instead —
        # a cached Copernicus tile reads as available without any download.
        try:
            discover._sync_dataset_rows(str(corr["river_id"]))
        except Exception:  # noqa: BLE001 - sync is best-effort; empty list below
            pass
        rows = db.query(
            "SELECT * FROM corridor_dataset WHERE corridor_id = %s ORDER BY label",
            (corridor_id,),
        )
    else:
        # One WorldPop country file serves every corridor in that country, so a
        # fetch made from any corridor (or prepare) must show here too. The
        # measure is a file stat; it only ever upgrades a row to available.
        try:
            river = db.query_one("SELECT * FROM river WHERE id = %s", (corr["river_id"],))
            m = discover._measure_kind(str(corr["river_id"]), "worldpop",
                                       discover._river_bbox(river)) if river else None
            if m and m[1] == "available" and any(
                    r["kind"] == "worldpop" and r["status"] != "available" for r in rows):
                discover._set_dataset_row(corridor_id, "worldpop", pct=m[0], status=m[1], size=m[2])
                rows = db.query(
                    "SELECT * FROM corridor_dataset WHERE corridor_id = %s ORDER BY label",
                    (corridor_id,),
                )
        except Exception:  # noqa: BLE001 - best-effort, like the sync above
            pass
    if not rows:
        raise HTTPException(404, "corridor not found")
    # Latest download job per kind so the panel can show live progress without
    # a second round trip. Finished jobs are dropped: the row itself is the truth.
    latest: dict[str, dict] = {}
    for job in db.query(
        """SELECT id, status, progress, error, right(log, 400) AS log,
                  params->>'kind' AS kind
             FROM job
            WHERE type = 'corridor.dataset' AND params->>'corridor_id' = %s
            ORDER BY created DESC""",
        (corridor_id,),
    ):
        if job["kind"] not in latest:
            latest[job["kind"]] = job
    out = []
    for r in rows:
        job = latest.get(r["kind"])
        live = job is not None and job["status"] in ("queued", "running", "paused")
        # A row left at `fetching` by a killed worker is not still working:
        # the newest job is the truth for anything the row can't confirm.
        status = r["status"]
        if live:
            # A prepare finishing mid-download rewrites rows from disk evidence,
            # so a stored 'missing' must not outrank a job that is still fetching.
            status = "fetching"
        elif job and job["status"] == "failed" and status != "available":
            # an old failure never outranks data that is on disk now
            status = "failed"
        elif status == "fetching":
            status = "missing"
        show = job if job and job["status"] not in ("done", "cancelled") and (
            live or status != "available") else None
        out.append(
            {
                "kind": r["kind"],
                "label": r["label"],
                "source": r["source"],
                "coverage_pct": round(float(r["coverage_pct"] or 0), 1),
                "status": status,
                "size_bytes": r["bytes"],
                "job": None if not show else {
                    "id": str(show["id"]),
                    "status": show["status"],
                    "progress": int(show["progress"] or 0),
                    # job.error carries the log tail for the Jobs screen; the
                    # row only needs the headline line.
                    "error": _headline(show["error"]),
                    "message": _headline(show["log"], last=True),
                },
            }
        )
    return out


@router.post("/corridors/{corridor_id}/datasets/{kind}/download")
def download_corridor_dataset(corridor_id: str, kind: str) -> dict:
    """Queue one dataset fetch; poll GET /corridors/{id}/datasets for progress.

    Returns `cached: true` (and no job) when the kind is already complete —
    reading must never cost a download.
    """
    _require_uuid(corridor_id, "corridor not found")
    if kind not in discover.DATASET_KINDS:
        raise HTTPException(400, f"unknown dataset kind {kind}")
    try:
        job_id = discover.download_dataset(corridor_id, kind)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"job_id": job_id or None, "cached": not job_id}
