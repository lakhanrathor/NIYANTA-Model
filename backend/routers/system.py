from __future__ import annotations

from fastapi import APIRouter

from config import settings
from modules.db import client as db
from modules.jobs import queue as jobs

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    db_ok = db.ping()
    # present = the D-Flow FM kernel (run_dimr.bat) resolves, not just a folder
    from modules.solvers import delft3d_fm  # noqa: PLC0415

    engine_ok = delft3d_fm.engine_available()
    from modules.gee import client as gee_client  # noqa: PLC0415

    return {
        "status": "ok" if db_ok else "degraded",
        "db": "ok" if db_ok else "down",
        "workers": len([t for t in jobs._workers if t.is_alive()]) if hasattr(jobs, "_workers") else 0,  # noqa: SLF001
        "queue_depth": jobs.queue_depth(),
        "handlers": jobs.handler_types(),
        "engine_root": settings.engine_root or "not_set",
        "engine_present": engine_ok,
        "gee_mode": settings.gee_mode,
        "gee": gee_client.peek(),  # no network init in health checks
        "storage": str(settings.storage_dir),
    }
