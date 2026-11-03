from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException

from modules.alert import dispatch as alert_dispatch
from modules.alert import rules as alert_rules
from modules.db import client as db

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
def list_alerts(state: str | None = None, limit: int = 50) -> list[dict]:
    rows = alert_rules.get_list(state)
    return rows[:max(1, limit)]


# ------------------------------------------------------------ recipients
# Declared before /{alert_id}/… so "recipients" is never read as an alert id.
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}$")


def _clean_recipient(body: dict[str, Any]) -> dict[str, Any]:
    """Validate a recipient from the browser; at least one way to reach them."""
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    email = str(body.get("email") or "").strip() or None
    phone = str(body.get("phone") or "").strip() or None
    webhook = str(body.get("webhook") or "").strip() or None
    if email and not EMAIL.match(email):
        raise HTTPException(422, "email is not a valid address")
    if phone and not PHONE.match(phone):
        raise HTTPException(422, "phone must be digits, e.g. +919812345678")
    if webhook and not webhook.lower().startswith(("https://", "http://")):
        raise HTTPException(422, "webhook must be an http(s) URL")
    if not (email or phone or webhook):
        raise HTTPException(422, "give at least an email, a phone or a webhook")
    level = str(body.get("min_level") or "CRITICAL").upper()
    if level not in ("WARNING", "CRITICAL"):
        raise HTTPException(422, "min_level must be WARNING or CRITICAL")
    states = body.get("states") or []
    if not isinstance(states, list) or not all(isinstance(s, str) for s in states):
        raise HTTPException(422, "states must be a list of state names")
    return {
        "name": name[:120],
        "org": (str(body.get("org") or "").strip() or None),
        "role": (str(body.get("role") or "").strip() or None),
        "email": email,
        "phone": phone,
        "webhook": webhook,
        "states": json.dumps([s.strip() for s in states if s.strip()]),
        "min_level": level,
        "active": 1 if body.get("active", True) else 0,
    }


@router.get("/recipients")
def list_recipients() -> list[dict]:
    return db.query("SELECT * FROM alert_recipient ORDER BY created DESC")


@router.post("/recipients")
def create_recipient(body: dict) -> dict:
    return db.insert("alert_recipient", _clean_recipient(body))


@router.put("/recipients/{rid}")
def update_recipient(rid: str, body: dict) -> dict:
    if not db.query_one("SELECT id FROM alert_recipient WHERE id = %s", (rid,)):
        raise HTTPException(404, "recipient not found")
    row = _clean_recipient(body)
    db.execute(
        "UPDATE alert_recipient SET name=%s, org=%s, role=%s, email=%s, phone=%s, webhook=%s, states=%s, "
        "min_level=%s, active=%s WHERE id=%s",
        (row["name"], row["org"], row["role"], row["email"], row["phone"], row["webhook"], row["states"],
         row["min_level"], row["active"], rid),
    )
    return db.query_one("SELECT * FROM alert_recipient WHERE id = %s", (rid,))


@router.delete("/recipients/{rid}")
def delete_recipient(rid: str) -> dict:
    db.execute("DELETE FROM alert_recipient WHERE id = %s", (rid,))
    return {"deleted": rid}


@router.post("/recipients/{rid}/test")
def test_recipient(rid: str) -> dict:
    """Send a clearly-marked test message to one recipient on all their channels."""
    r = db.query_one("SELECT * FROM alert_recipient WHERE id = %s", (rid,))
    if not r:
        raise HTTPException(404, "recipient not found")
    fake = {"id": "test", "level": "INFO", "created": "now"}
    msg = {"subject": "[NIYANTA TEST] Alert delivery check",
           "text": f"This is a test from NIYANTA for {r['name']}. No action needed.", "state": ""}
    rows = alert_dispatch.deliver(fake, r, msg)
    return {"deliveries": rows}


@router.get("/channels")
def channels() -> dict:
    """Which delivery channels this server can send on (others log not_configured)."""
    return alert_dispatch.channels()


# ------------------------------------------------------------ per alert
@router.post("/{alert_id}/ack")
def ack(alert_id: str) -> dict:
    row = alert_rules.act(alert_id, "ack")
    if not row:
        raise HTTPException(404, "alert not found")
    return row


@router.post("/{alert_id}/dispatch")
def dispatch(alert_id: str) -> dict:
    """Send the alert to every matching official now; returns each attempt."""
    out = alert_dispatch.dispatch(alert_id)
    if out is None:
        raise HTTPException(404, "alert not found")
    return out


@router.get("/{alert_id}/message")
def preview_message(alert_id: str) -> dict:
    alert = db.query_one("SELECT * FROM alert WHERE id = %s", (alert_id,))
    if not alert:
        raise HTTPException(404, "alert not found")
    msg = alert_dispatch.message(alert)
    msg["recipients"] = [r["name"] for r in alert_dispatch.recipients_for(alert, msg["state"])]
    return msg


@router.get("/{alert_id}/deliveries")
def deliveries(alert_id: str) -> list[dict]:
    return db.query(
        "SELECT d.*, r.name AS recipient_name, r.org AS recipient_org FROM alert_delivery d "
        "LEFT JOIN alert_recipient r ON r.id = d.recipient_id WHERE d.alert_id = %s ORDER BY d.ts DESC",
        (alert_id,),
    )


@router.post("/{alert_id}/close")
def close_alert(alert_id: str) -> dict:
    row = alert_rules.act(alert_id, "close")
    if not row:
        raise HTTPException(404, "alert not found")
    return row


@router.get("/rules")
def list_rules() -> list[dict]:
    return alert_rules.rules()


@router.post("/rules")
def create_rule(body: dict) -> dict:
    if not body.get("name") or not body.get("condition"):
        raise HTTPException(422, "name and condition required")
    return alert_rules.rule_create(body["name"], body["condition"])
