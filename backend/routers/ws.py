from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from modules.catalog import catalog
from modules.run import lifecycle

router = APIRouter(tags=["ws"])


@router.websocket("/ws/runs/{run_id}")
async def ws_run(ws: WebSocket, run_id: str) -> None:
    await ws.accept()
    last_sig: tuple | None = None
    last_job_sig: tuple | None = None
    try:
        while True:
            run = catalog.run_get(run_id)
            if run is None:
                await ws.send_text(json.dumps({"kind": "error", "error": "run not found"}))
                break
            sig = (run["state"], run["stage"], run["stage_status"], run["progress"], run["error"])
            if sig != last_sig:
                last_sig = sig
                await ws.send_text(
                    json.dumps(
                        {
                            "kind": "lifecycle",
                            "state": run["state"],
                            "stage": run["stage"],
                            "stage_status": run["stage_status"],
                            "progress": run["progress"],
                            "error": run["error"],
                        }
                    )
                )
            jobs = lifecycle.jobs_for_run(run_id)
            jsig = tuple((j["type"], j["status"], j["progress"]) for j in jobs)
            if jsig != last_job_sig:
                last_job_sig = jsig
                await ws.send_text(
                    json.dumps(
                        {
                            "kind": "jobs",
                            "jobs": [
                                {
                                    "id": str(j["id"]),
                                    "type": j["type"],
                                    "status": j["status"],
                                    "progress": j["progress"],
                                    "error": j["error"],
                                }
                                for j in jobs
                            ],
                        }
                    )
                )
            if run["state"] in lifecycle.TERMINAL:
                await ws.send_text(json.dumps({"kind": "terminal", "state": run["state"]}))
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@router.websocket("/ws/alerts")
async def ws_alerts(ws: WebSocket) -> None:
    await ws.accept()
    from modules.db import client as db

    last = 0
    try:
        while True:
            rows = db.query(
                "SELECT id, level, title, body, run_id, state, source, created FROM alert "
                "WHERE created > to_timestamp(%s) ORDER BY created",
                (last,),
            )
            for r in rows:
                await ws.send_text(json.dumps({"kind": "alert", "alert": r}, default=str))
                ts = r["created"]
                last = max(last, ts.timestamp() if hasattr(ts, "timestamp") else last)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
