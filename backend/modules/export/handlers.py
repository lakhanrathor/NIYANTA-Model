"""export job types: stage.export work + on-demand export.package job."""

from __future__ import annotations

import json
from typing import Any

from modules.catalog import catalog
from modules.db import client as db
from modules.export import gis
from modules.jobs import queue as jobs
from modules.jobs.queue import JobContext
from modules.run import result as run_result

EXPORT_KIND_MAP: dict[str, list[str]] = {
    "shp": ["shapefiles.zip"],
    "kml": ["niyanta_flood.kml"],
    "geojson": ["niyanta_bundle.geojson"],
    "geotiff": ["max_depth.tif"],
    "csv": ["stations.csv"],
    "report": ["report.html"],
}


def _exports_by_kind(files: list[str]) -> dict[str, str]:
    return {
        fmt: next(f for f in files if f in candidates)
        for fmt, candidates in EXPORT_KIND_MAP.items()
        if any(f in files for f in candidates)
    }


def handle_export_stage(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    if not run:
        raise ValueError("run not found")
    ctx.progress(92, "export: building package")
    pkg = gis.build_package(
        run_id, gis.ALL_FORMATS,
        progress=lambda p, m: ctx.progress(92 + int(p * 0.07), m),
    )
    job_row = db.insert("export_job", {
        "run_id": run_id,
        "formats": gis.ALL_FORMATS,
        "status": "done",
        "progress": 100,
        "path": pkg["path"],
        "files": pkg["files"],
    })
    run_result.merge(run_id, exports=_exports_by_kind(pkg["files"]))
    ctx.progress(99, f"export: {len(pkg['files'])} files")
    return {"files": pkg["files"], "export_job_id": str(job_row["id"]), **_exports_by_kind(pkg["files"])}


def handle_export_job(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.params["run_id"]
    formats = ctx.params.get("formats") or gis.ALL_FORMATS
    export_id = ctx.params.get("export_job_id")
    if export_id:
        db.execute("UPDATE export_job SET status = 'running' WHERE id = %s", (export_id,))
    try:
        pkg = gis.build_package(run_id, formats,
                                progress=lambda p, m: ctx.progress(p, m))
        if export_id:
            db.execute("UPDATE export_job SET status = 'done', progress = 100, path = %s, "
                       "files = %s::jsonb, updated = now() WHERE id = %s",
                       (pkg["path"], json.dumps(pkg["files"]), export_id))
        return pkg
    except Exception as exc:
        if export_id:
            db.execute("UPDATE export_job SET status = 'failed', error = %s, updated = now() WHERE id = %s",
                       (str(exc), export_id))
        raise


def register() -> None:
    jobs.register("export.package", handle_export_job)
    from modules.jobs.handlers import set_work

    set_work("stage.export", handle_export_stage)
