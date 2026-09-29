from __future__ import annotations

from fastapi import APIRouter, HTTPException

from modules.alert import notify as alert_notify
from modules.alert import rules as alert_rules

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
def list_alerts(state: str | None = None, limit: int = 50) -> list[dict]:
    rows = alert_rules.get_list(state)
    return rows[:max(1, limit)]


@router.post("/{alert_id}/ack")
def ack(alert_id: str) -> dict:
    row = alert_rules.act(alert_id, "ack")
    if not row:
        raise HTTPException(404, "alert not found")
    return row


@router.post("/{alert_id}/dispatch")
def dispatch(alert_id: str) -> dict:
    row = alert_rules.act(alert_id, "dispatch")
    if not row:
        raise HTTPException(404, "alert not found")
    return row


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
