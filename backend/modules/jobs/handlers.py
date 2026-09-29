"""Stage handler registration: every stage handler = work + chain continuation."""

from __future__ import annotations

import time
from typing import Any, Callable

from modules.jobs import queue as jobs
from modules.jobs.queue import JobContext, register
from modules.run import stages as run_stages

WorkFn = Callable[[JobContext], dict[str, Any]]

_work: dict[str, WorkFn] = {}


def set_work(stage: str, fn: WorkFn) -> None:
    """Real modules replace stub work here (mesh, solve, impact, ...)."""
    _work[stage] = fn


def _is_stub(stage: str) -> bool:
    return stage not in _work


def _make_handler(stage: str, span: tuple[int, int]) -> WorkFn:
    lo, hi = span

    def handler(ctx: JobContext) -> dict:
        run_id = ctx.run_id or ctx.params.get("run_id")
        if not run_id:
            raise ValueError(f"{stage}: missing run_id")
        from modules.run import lifecycle  # noqa: PLC0415

        lifecycle.set_stage(run_id, stage, "running", progress=lo)
        work = _work.get(stage)
        try:
            if work is None:
                ctx.progress(lo, f"{stage}: started (stub)")
                for p in range(lo + 5, hi, max(5, (hi - lo) // 4)):
                    time.sleep(0.1)
                    ctx.check_cancelled()
                    ctx.progress(p, f"{stage}: step {p}")
                result: dict[str, Any] = {"stage": stage, "stub": True}
            else:
                result = work(ctx) or {}
            ctx.check_cancelled()
        except jobs.JobCancelled:
            raise
        except Exception as exc:
            run_stages.fail_run(run_id, stage, f"{type(exc).__name__}: {exc}")
            raise
        ctx.progress(hi, f"{stage}: done")
        run_stages.on_stage_done(run_id, stage, result)
        return {"stage": stage, **result}

    return handler


STAGE_SPANS: dict[str, tuple[int, int]] = {
    "stage.terrain": (0, 15),
    "stage.mesh": (15, 25),
    "stage.breach": (25, 30),
    "stage.solve": (30, 72),
    "stage.post": (72, 82),
    "stage.impact": (82, 89),
    "stage.validate": (89, 94),
    "stage.export": (94, 100),
}


def register_stage_handlers() -> None:
    for stage, span in STAGE_SPANS.items():
        register(stage, _make_handler(stage, span))


def register_all() -> None:
    register_stage_handlers()
    _register_stage_work()
    _register_extra()


def _register_stage_work() -> None:
    """Real physics/mesh/terrain work replaces the stub spans."""
    try:
        from modules.run import work_breach, work_impact, work_mesh, work_post, work_solve, work_terrain, work_validate

        set_work("stage.terrain", work_terrain.handle_terrain)
        set_work("stage.mesh", work_mesh.handle_mesh)
        set_work("stage.breach", work_breach.handle_breach)
        set_work("stage.solve", work_solve.handle_solve)
        set_work("stage.post", work_post.handle_post)
        set_work("stage.impact", work_impact.handle_impact)
        set_work("stage.validate", work_validate.handle_validate)
    except Exception:
        pass


def _register_extra() -> None:
    """Non-stage job types (dataset processing, connectors, exports, gee sweeps)."""
    try:
        from modules.proc_dem import handlers as dem_handlers

        dem_handlers.register()
    except Exception:
        pass
    try:
        from modules.export import handlers as export_handlers

        export_handlers.register()
    except Exception:
        pass
    try:
        from modules.gee import handlers as gee_handlers

        gee_handlers.register()
    except Exception:
        pass
    try:
        from modules.connector import handlers as connector_handlers

        connector_handlers.register()
    except Exception:
        pass
    try:
        from modules import discover

        discover.register_jobs()
    except Exception:
        pass
