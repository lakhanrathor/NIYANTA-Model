from __future__ import annotations

import json
from typing import Any

from modules.db import client as db

STATES = [
    "DRAFT",
    "DATA_READY",
    "QUEUED",
    "RUNNING",
    "POST_PROCESSING",
    "VALIDATED",
    "PUBLISHED",
    "FAILED",
    "CANCELLED",
]

TERMINAL = {"VALIDATED", "PUBLISHED", "FAILED", "CANCELLED"}


def record(run_id: str, state: str | None = None, stage: str | None = None, detail: str = "") -> None:
    db.insert("run_lifecycle", {"run_id": run_id, "state": state, "stage": stage, "detail": detail})


def set_state(run_id: str, state: str, detail: str = "") -> None:
    db.execute("UPDATE run SET state = %s, updated = now() WHERE id = %s", (state, run_id))
    record(run_id, state=state, detail=detail)


def set_stage(run_id: str, stage: str, status: str, progress: int | None = None, detail: str = "") -> None:
    sets = "stage = %s, stage_status = %s"
    params: list[Any] = [stage, status]
    if progress is not None:
        sets += ", progress = %s"
        params.append(progress)
    db.execute(f"UPDATE run SET {sets}, updated = now() WHERE id = %s", tuple(params + [run_id]))
    record(run_id, state=None, stage=f"{stage}:{status}", detail=detail)
    _stage_row(run_id, stage, status, progress, detail)


def _stage_row(run_id: str, stage: str, status: str, progress: int | None, detail: str) -> None:
    """Mirror the stage into run_stage so the Run screen reads durable rows."""
    from modules.run import stages as run_stages  # noqa: PLC0415 - avoid import cycle

    if stage not in run_stages.STAGES:
        return
    meta = run_stages.STAGE_META.get(stage, {})
    idx = run_stages.STAGES.index(stage) + 1
    row_status = status if status in ("queued", "running", "done", "failed", "skipped") else "queued"
    # A finished stage is always 100% locally, whatever the run-level number was.
    eff = 100 if row_status in ("done", "skipped") else (progress or 0)
    try:
        db.query(
            """INSERT INTO run_stage (run_id, idx, key, title, subtitle, status, progress, detail, started, finished)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                       CASE WHEN %s THEN now() ELSE NULL END,
                       CASE WHEN %s IN ('done','failed') THEN now() ELSE NULL END)
               ON CONFLICT (run_id, idx) DO UPDATE SET
                 status = EXCLUDED.status,
                 progress = CASE WHEN EXCLUDED.status IN ('done','skipped') THEN 100
                                 ELSE GREATEST(run_stage.progress, EXCLUDED.progress) END,
                 detail = EXCLUDED.detail,
                 started = COALESCE(run_stage.started, EXCLUDED.started),
                 finished = CASE WHEN EXCLUDED.status IN ('done','failed')
                                 THEN now() ELSE run_stage.finished END""",
            (run_id, idx, stage, meta.get("title", stage), meta.get("subtitle", ""),
             row_status, eff, json.dumps({"method": meta.get("method", ""), "detail": detail}),
             row_status == "running", row_status),
        )
    except Exception:  # noqa: BLE001 - stage mirroring must never break the run
        pass


def fail(run_id: str, error: str) -> None:
    db.execute("UPDATE run SET state = 'FAILED', error = %s, updated = now() WHERE id = %s", (error, run_id))
    record(run_id, state="FAILED", detail=error[:500])


def lifecycle(run_id: str) -> list[dict]:
    return db.query("SELECT * FROM run_lifecycle WHERE run_id = %s ORDER BY ts, id", (run_id,))


def jobs_for_run(run_id: str) -> list[dict]:
    return db.query(
        "SELECT id, type, status, progress, error, created, updated FROM job "
        "WHERE run_id = %s ORDER BY created",
        (run_id,),
    )
