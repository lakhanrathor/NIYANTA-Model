"""connector.sync job — async variant of connector.sync (offline counts refresh)."""

from __future__ import annotations

from typing import Any

from modules import connector
from modules.jobs import queue as jobs
from modules.jobs.queue import JobContext


def handle_sync(ctx: JobContext) -> dict[str, Any]:
    name = ctx.params["name"]
    out = connector.sync(name)
    ctx.progress(100, f"connector {name} synced")
    return out


def register() -> None:
    jobs.register("connector.sync", handle_sync)
