from __future__ import annotations

from typing import Any

from modules.db import client as db


def create(level: str, title: str, body: str = "", run_id: str | None = None, source: str = "system",
           payload: dict | None = None, **where: str | None) -> dict:
    """Raise an alert; `where` may carry dam_id / river_id / box_id / location.
    CRITICAL alerts are sent to matching officials straight away (dispatch.py)."""
    row = db.insert(
        "alert",
        {"level": level, "title": title, "body": body, "run_id": run_id, "source": source, "payload": payload or {},
         **{k: v for k, v in where.items() if k in ("dam_id", "river_id", "box_id", "location") and v}},
    )
    from modules.alert import dispatch  # noqa: PLC0415

    dispatch.auto_dispatch(row)
    return row


def get_list(state: str | None = None, limit: int = 100) -> list[dict]:
    if state:
        return db.query("SELECT * FROM alert WHERE state = %s ORDER BY created DESC LIMIT %s", (state, limit))
    return db.query("SELECT * FROM alert ORDER BY created DESC LIMIT %s", (limit,))


def act(alert_id: str, action: str, actor: str = "operator", note: str = "") -> dict | None:
    new_state = {"ack": "ACK", "dispatch": "DISPATCH", "close": "CLOSED"}.get(action)
    if not new_state:
        raise ValueError(f"unknown action {action}")
    row = db.query_one("SELECT * FROM alert WHERE id = %s", (alert_id,))
    if not row:
        return None
    db.execute("UPDATE alert SET state = %s WHERE id = %s", (new_state, alert_id))
    db.insert("alert_action", {"alert_id": alert_id, "action": action, "actor": actor, "note": note})
    return db.query_one("SELECT * FROM alert WHERE id = %s", (alert_id,))


def rules() -> list[dict]:
    return db.query("SELECT * FROM alert_rule WHERE active ORDER BY created")


def rule_create(name: str, condition: dict) -> dict:
    return db.insert("alert_rule", {"name": name, "condition": condition})
