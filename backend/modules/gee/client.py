"""Lazy Earth Engine client (MODULE_SPEC 4.21).

`ready()` initializes `ee` once per process against settings.gee_project
(community tier, user OAuth credentials from `earthengine authenticate`).
All failures are captured in status() — live fetchers fall back to local
rasters/simulation instead of raising.
"""

from __future__ import annotations

import threading
from typing import Any

from config import settings

_lock = threading.Lock()
_state: dict[str, Any] = {
    "mode": settings.gee_mode,
    "project": settings.gee_project,
    "ready": False,
    "error": None,
    "init_ms": None,
}


def initialize() -> bool:
    """Initialize ee (cached). True when live GEE calls are usable."""
    import time

    with _lock:
        if _state["ready"]:
            return True
        if settings.gee_mode != "online":
            _state["error"] = "gee_mode=offline"
            return False
        t0 = time.perf_counter()
        try:
            import ee

            ee.Initialize(project=settings.gee_project)
            _state.update(ready=True, error=None,
                          init_ms=round((time.perf_counter() - t0) * 1000, 1))
            return True
        except Exception as exc:  # noqa: BLE001 - EE auth/network boundary
            _state["error"] = f"{type(exc).__name__}: {exc}"
            return False


def ready() -> bool:
    return bool(_state["ready"]) or initialize()


def peek() -> dict[str, Any]:
    """Status without triggering network initialization."""
    return dict(_state)


def status() -> dict[str, Any]:
    """Status, initializing if needed (use on demand, not in health checks)."""
    ready()
    return dict(_state)
