from __future__ import annotations

import json
import queue
import threading
import traceback
from typing import Any, Callable

from modules.db import client as db

Handler = Callable[["JobContext"], dict[str, Any]]

_handlers: dict[str, Handler] = {}


def register(job_type: str, handler: Handler) -> None:
    _handlers[job_type] = handler


def handler_types() -> list[str]:
    return sorted(_handlers)


class JobContext:
    """Passed to every handler: progress/log/cancel access."""

    def __init__(self, row: dict[str, Any]):
        self.id = row["id"]
        self.type = row["type"]
        self.params = row["params"] or {}
        self.run_id = row.get("run_id")
        self._cancelled = threading.Event()
        self._last_pct = -1

    # ---- progress -------------------------------------------------
    def progress(self, pct: int, msg: str = "") -> None:
        pct = max(0, min(100, int(pct)))
        if pct == self._last_pct and not msg:
            return
        self._last_pct = pct
        db.execute(
            "UPDATE job SET progress = %s, updated = now() WHERE id = %s "
            "AND status IN ('running', 'queued')",
            (pct, self.id),
        )
        # Handlers report pipeline-wide percent, so mirror it straight onto the
        # run; run.progress otherwise only moves at stage boundaries and the
        # Run screen bar sits frozen for the whole solve stage.
        if self.run_id and self.type.startswith("stage."):
            db.execute(
                "UPDATE run SET progress = %s, updated = now() WHERE id = %s "
                "AND state IN ('QUEUED', 'RUNNING')",
                (pct, self.run_id),
            )
        self._stage_pct(pct)
        if msg:
            self.log(msg)

    def _stage_pct(self, run_pct: int) -> None:
        """Mirror run-level progress onto run_stage as a within-stage percent.

        Handlers report progress against the whole pipeline (0-100 across all
        stages), but the Run screen shows one bar per stage.
        """
        if not self.run_id or not self.type.startswith("stage."):
            return
        from modules.jobs.handlers import STAGE_SPANS  # noqa: PLC0415 - import cycle

        span = STAGE_SPANS.get(self.type)
        if not span:
            return
        lo, hi = span
        span_len = max(1, hi - lo)
        local = round((min(max(run_pct, lo), hi) - lo) / span_len * 100)
        db.execute(
            "UPDATE run_stage SET progress = %s WHERE run_id = %s AND key = %s",
            (local, self.run_id, self.type),
        )

    def log(self, msg: str) -> None:
        db.execute(
            "UPDATE job SET log = left(log || %s, 200000), updated = now() WHERE id = %s",
            (f"\n{msg}", self.id),
        )

    def check_cancelled(self) -> None:
        """Raise between units of work when the job was cancelled *or* paused.

        A pause must stop an in-flight download the same way a cancel does —
        the `.part` file survives either way, so resume is a fresh worker
        picking the same job up and continuing the byte range.
        """
        row = db.query_one("SELECT status FROM job WHERE id = %s", (self.id,))
        if row and row["status"] == "cancelled":
            self._cancelled.set()
        if row and row["status"] == "paused":
            raise JobPaused()
        if self._cancelled.is_set():
            raise JobCancelled()


class JobCancelled(Exception):
    pass


class JobPaused(Exception):
    pass


# ---------------------------------------------------------------- queue
_q: "queue.Queue[str]" = queue.Queue()
_workers: list[threading.Thread] = []
_stop = threading.Event()
# Ids currently inside a handler — resume() must not enqueue those twice.
_active: set[str] = set()
_active_lock = threading.Lock()


def add_job(job_type: str, params: dict[str, Any] | None = None, run_id: str | None = None) -> dict:
    row = db.insert(
        "job",
        {"type": job_type, "params": params or {}, "run_id": run_id, "status": "queued"},
    )
    _q.put(row["id"])
    return row


def cancel(job_id: str) -> None:
    db.execute("UPDATE job SET status = 'cancelled', updated = now() WHERE id = %s", (job_id,))


def pause(job_id: str) -> bool:
    """Stop a job between units of work. The `.part` file survives, so the
    job can be resumed later and continue the byte range it had reached."""
    return bool(db.execute(
        "UPDATE job SET status = 'paused', updated = now() "
        "WHERE id = %s AND status IN ('queued', 'running')",
        (job_id,),
    ))


def resume(job_id: str) -> bool:
    """Re-queue a paused job. Safe against a double click: only a paused row
    moves, and a live job for the same work stays live.

    If the old handler is still inside its cooperative stop (or kept running
    because the status flipped back), we must not hand the id to a second
    worker — it would run the same steps twice. The live handler re-enqueues
    the id itself when it finally leaves ``_run_one``.
    """
    if not db.execute(
        "UPDATE job SET status = 'queued', updated = now() WHERE id = %s AND status = 'paused'",
        (job_id,),
    ):
        return False
    with _active_lock:
        alive = job_id in _active
    if not alive:
        _q.put(job_id)
    return True


def get(job_id: str) -> dict | None:
    return db.query_one("SELECT * FROM job WHERE id = %s", (job_id,))


def list_jobs(run_id: str | None = None, status: str | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM job WHERE 1=1"
    params: list[Any] = []
    if run_id:
        sql += " AND run_id = %s"
        params.append(run_id)
    if status:
        sql += " AND status = %s"
        params.append(status)
    sql += " ORDER BY created DESC LIMIT %s"
    params.append(limit)
    return db.query(sql, tuple(params))


def queue_depth() -> int:
    return _q.qsize()


def active_count() -> int:
    return db.scalar("SELECT count(*) FROM job WHERE status = 'running'") or 0


# ---------------------------------------------------------------- worker
def _worker_loop(idx: int) -> None:
    while not _stop.is_set():
        try:
            job_id = _q.get(timeout=0.5)
        except queue.Empty:
            continue
        try:
            _run_one(job_id)
        except Exception:
            traceback.print_exc()
        finally:
            _q.task_done()


def _run_one(job_id: str) -> None:
    row = db.query_one("SELECT * FROM job WHERE id = %s", (job_id,))
    if row is None or row["status"] != "queued":
        return
    # Claim atomically: resume() and the startup requeue can both enqueue the
    # same id, and two workers must never run one job's handler twice.
    if not db.execute(
        "UPDATE job SET status = 'running', updated = now() WHERE id = %s AND status = 'queued'",
        (job_id,),
    ):
        return
    row = db.query_one("SELECT * FROM job WHERE id = %s", (job_id,))
    handler = _handlers.get(row["type"])
    if handler is None:
        db.execute(
            "UPDATE job SET status = 'failed', error = %s, updated = now() WHERE id = %s",
            (f"no handler registered for {row['type']}", job_id),
        )
        return
    ctx = JobContext(row)
    with _active_lock:
        _active.add(job_id)
    try:
        result = handler(ctx)
        db.execute(
            "UPDATE job SET status = 'done', progress = 100, result = %s::jsonb, updated = now() WHERE id = %s",
            (json.dumps(result or {}), job_id),
        )
    except JobCancelled:
        db.execute(
            "UPDATE job SET status = 'cancelled', updated = now() WHERE id = %s", (job_id,)
        )
    except JobPaused:
        # pause() already wrote the row; a resume() may have flipped it to
        # 'queued' while we were still exiting — settle that below.
        pass
    except Exception as exc:  # noqa: BLE001 - boundary: job failure is data, not crash
        log_row = db.query_one("SELECT log FROM job WHERE id = %s", (job_id,)) or {"log": ""}
        tail = (log_row.get("log") or "")[-4000:]
        db.execute(
            "UPDATE job SET status = 'failed', error = %s, log = %s, updated = now() WHERE id = %s",
            (f"{type(exc).__name__}: {exc}\n{tail}", traceback.format_exc()[-4000:], job_id),
        )
    finally:
        # Leaving the handler must re-arm a resumed job: resume() skips the
        # queue while the id is here, so this is the only hand-off point.
        with _active_lock:
            _active.discard(job_id)
        status = db.scalar("SELECT status FROM job WHERE id = %s", (job_id,))
        if status == "running":
            db.execute(
                "UPDATE job SET status = 'queued', updated = now() WHERE id = %s AND status = 'running'",
                (job_id,),
            )
            status = "queued"
        if status == "queued":
            _q.put(job_id)


def start_workers(n: int) -> None:
    global _workers
    if _workers:
        return
    _stop.clear()
    # recover interrupted rows from a previous process
    db.execute(
        "UPDATE job SET status = 'failed', error = 'interrupted by restart' WHERE status = 'running'"
    )
    for i in range(n):
        t = threading.Thread(target=_worker_loop, args=(i,), name=f"niyanta-worker-{i}", daemon=True)
        t.start()
        _workers.append(t)
    # requeue jobs left queued
    for row in db.query("SELECT id FROM job WHERE status = 'queued' ORDER BY created"):
        _q.put(row["id"])


def stop_workers() -> None:
    _stop.set()
    for t in _workers:
        t.join(timeout=3)
    _workers.clear()
