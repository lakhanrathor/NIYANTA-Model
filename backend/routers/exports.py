from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs import queue as jobs
from modules.storage import paths

router = APIRouter(tags=["exports"])

VALID_FORMATS = ("shp", "kml", "geojson", "geotiff", "csv", "report", "pdf")


@router.post("/exports")
def create_export(body: dict) -> dict:
    run_id = body.get("run_id")
    if not run_id or not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    formats = [f for f in (body.get("formats") or list(VALID_FORMATS)) if f in VALID_FORMATS]
    if not formats:
        raise HTTPException(422, f"formats must include at least one of {VALID_FORMATS}")
    job_row = db.insert("export_job", {"run_id": run_id, "formats": formats, "status": "queued"})
    job = jobs.add_job("export.package", {"run_id": run_id, "formats": formats,
                                          "export_job_id": str(job_row["id"])})
    return {**job_row, "job_id": str(job["id"])}


@router.get("/exports")
def list_exports(limit: int = 50) -> list[dict]:
    return db.query("SELECT * FROM export_job ORDER BY created DESC LIMIT %s", (limit,))


@router.get("/exports/{export_id}")
def get_export(export_id: str) -> dict:
    row = db.query_one("SELECT * FROM export_job WHERE id = %s", (export_id,))
    if not row:
        raise HTTPException(404, "export not found")
    return {**row, "download_url": f"/api/exports/{export_id}/download" if row["path"] else None}


@router.get("/exports/{export_id}/download")
def download_export(export_id: str) -> FileResponse:
    row = db.query_one("SELECT * FROM export_job WHERE id = %s", (export_id,))
    if not row or not row.get("path"):
        raise HTTPException(404, "export not ready")
    path = paths.abs_path(row["path"])
    if not path.exists():
        raise HTTPException(404, "export file missing")
    return FileResponse(path, media_type="application/zip", filename=f"niyanta_export_{export_id}.zip")


@router.get("/reports/{run_id}")
def get_report(run_id: str) -> Response:
    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    from modules.export import report  # noqa: PLC0415

    try:
        path = report.build(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, f"report inputs unavailable: {exc}") from exc
    return Response(content=path.read_text(encoding="utf-8"), media_type="text/html")
