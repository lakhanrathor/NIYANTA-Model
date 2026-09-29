from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from routers import alerts, datasets, runs, scenarios, system, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(settings.workers)
    app.state.scheduler = None
    if settings.scheduler_enabled:
        try:
            from modules.gee.scheduler import start_scheduler

            app.state.scheduler = start_scheduler()
        except Exception:
            app.state.scheduler = None
    yield
    if app.state.scheduler is not None:
        try:
            from modules.gee.scheduler import stop_scheduler

            stop_scheduler()
        except Exception:
            pass
    jobs.stop_workers()
    db.close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="NIYANTA", version="1.0", lifespan=lifespan)
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(system.router, prefix="/api")
    app.include_router(datasets.router, prefix="/api")
    app.include_router(scenarios.router, prefix="/api")
    app.include_router(runs.router, prefix="/api")
    app.include_router(alerts.router, prefix="/api")
    app.include_router(ws.router, prefix="/api")

    _mount_phase_routers(app)
    return app


def _mount_phase_routers(app: FastAPI) -> None:
    """Phase modules register routers as they land; absence must not break boot."""
    for modname, attr in (
        ("routers.connectors", "router"),
        ("routers.watch", "router"),
        ("routers.risk", "router"),
        ("routers.exports", "router"),
        ("routers.compare", "router"),
        ("routers.breach", "router"),
        ("routers.discover", "router"),
        ("routers.ui", "router"),
        ("routers.tiles", "router"),
    ):
        try:
            mod = __import__(modname, fromlist=[attr])
            app.include_router(getattr(mod, attr), prefix="/api")
        except Exception as exc:  # noqa: BLE001 - keep booting, but do not hide it
            import sys

            print(f"[niyanta] router {modname} failed to mount: {exc}", file=sys.stderr)
            continue


app = create_app()
