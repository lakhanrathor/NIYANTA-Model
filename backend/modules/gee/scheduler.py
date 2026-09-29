"""gee scheduler thread — enqueues the daily sweep at settings.gee_daily_hour (MODULE_SPEC 4.21)."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from config import settings
from modules.jobs import queue as jobs

_thread: threading.Thread | None = None
_stop = threading.Event()
_last_enqueued: str | None = None


def _loop() -> None:
    global _last_enqueued
    while not _stop.is_set():
        now = datetime.now(timezone.utc)
        target = now.replace(hour=settings.gee_daily_hour, minute=0, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        wait = min((target - now).total_seconds(), 300.0)  # wake at least every 5 min
        if _stop.wait(wait):
            return
        # enqueue once per UTC day (wake granularity would otherwise re-fire
        # every 5 min throughout the sweep hour)
        if (datetime.now(timezone.utc).hour == settings.gee_daily_hour
                and _last_enqueued != now.date().isoformat()):
            try:
                jobs.add_job("gee.daily", {"trigger": "scheduler"})
                _last_enqueued = now.date().isoformat()
            except Exception:
                pass


def start_scheduler() -> threading.Event:
    global _thread
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="gee-scheduler", daemon=True)
    _thread.start()
    return _stop


def stop_scheduler() -> None:
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
