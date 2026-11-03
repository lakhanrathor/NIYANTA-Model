"""Deliver alerts to the officials who must act on them.

`message(alert)` turns an alert into plain language — which dam / river /
state, what the model says will happen, and a link to the evidence — using
only the alert's own run, dam and watch-box records. `dispatch(alert_id)`
sends it to every active recipient whose level and states match, over each
channel that recipient has (email / SMS / webhook), and logs every attempt in
`alert_delivery`. A channel the server has no credentials for is logged as
`not_configured`: nothing is ever reported as sent when it was not.
"""
from __future__ import annotations

import json
import smtplib
import ssl
import threading
import urllib.parse
import urllib.request
from email.message import EmailMessage
from typing import Any

from loguru import logger

from config import settings
from modules.db import client as db

LEVEL_RANK = {"INFO": 0, "WARNING": 1, "CRITICAL": 2}

RULE_TEXT = {
    "population_exposed": "a large number of people are inside the modelled flood zone",
    "arrival_fast": "the flood would reach downstream areas within a few hours",
    "risk_high": "the dam is rated HIGH/CRITICAL risk",
}


def _json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def _num(v: Any, digits: int = 0) -> str | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f"{f:,.{digits}f}"


def context(alert: dict[str, Any]) -> dict[str, Any]:
    """Who/where/what for an alert, from its run, dam and watch box (all optional)."""
    payload = _json(alert.get("payload")) or {}
    ctx: dict[str, Any] = {"label": None, "dam": None, "river": None, "state": None, "run_id": alert.get("run_id")}
    run = db.query_one("SELECT * FROM run WHERE id = %s", (alert["run_id"],)) if alert.get("run_id") else None
    spec: dict[str, Any] = {}
    if run:
        sc = db.query_one("SELECT spec FROM scenario WHERE id = %s", (run["scenario_id"],))
        spec = _json(sc["spec"]) if sc else {}
        metrics = _json(run.get("metrics")) or {}
        result = _json(run.get("result")) or {}
        impact = result.get("impact") or {}
        stations = result.get("stations") or []
        arrivals = [s.get("arrival_hr") for s in stations if isinstance(s, dict) and s.get("arrival_hr") is not None]
        ctx.update(
            people=impact.get("population_exposed"),
            villages=impact.get("villages_affected"),
            first_arrival_hr=min(arrivals) if arrivals else None,
            peak_cms=metrics.get("peak_discharge_cms"),
            area_km2=metrics.get("inundation_km2"),
        )
        try:
            from modules.scenario import lab  # noqa: PLC0415

            ctx["label"] = lab.label_of(spec)[0]
        except Exception:  # noqa: BLE001 - the badge is a courtesy, never a blocker
            ctx["label"] = None
    dam_id = alert.get("dam_id") or spec.get("dam_id")
    if dam_id:
        dam = db.query_one("SELECT id, name, river, river_id, state FROM dam WHERE id = %s", (dam_id,))
        if dam:
            ctx.update(dam=dam["name"], dam_id=dam["id"], river=dam.get("river"), state=dam.get("state"),
                       river_id=dam.get("river_id"))
            if dam.get("river_id") and not ctx["river"]:
                riv = db.query_one("SELECT name FROM river WHERE id = %s", (dam["river_id"],))
                ctx["river"] = riv["name"] if riv else None
    box_id = alert.get("box_id") or payload.get("box_id")
    if box_id and not ctx.get("dam"):
        box = db.query_one("SELECT name, state FROM watch_box WHERE id = %s", (box_id,))
        if box:
            ctx.update(place=box["name"], state=ctx.get("state") or box.get("state"))
    if not ctx.get("state") and alert.get("location"):
        ctx["state"] = str(alert["location"]).split(",")[-1].strip() or None
    ctx["rule"] = payload.get("rule")
    return ctx


def message(alert: dict[str, Any]) -> dict[str, str]:
    """Subject + plain-text body an official can act on."""
    c = context(alert)
    where = c.get("dam") or c.get("place") or "Watched area"
    tail = ", ".join(x for x in (c.get("river"), c.get("state")) if x)
    head = f"{where}{f' ({tail})' if tail else ''}"
    level = alert.get("level") or "INFO"
    lines = [f"{level} alert — {head}", ""]
    if c.get("rule") in RULE_TEXT:
        lines.append(f"Why: {RULE_TEXT[c['rule']]}.")
    else:
        lines.append(f"What: {alert.get('title')}")
        if alert.get("body"):
            lines.append(str(alert["body"]))
    facts = [
        f"flood reaches the first downstream point in {_num(c['first_arrival_hr'], 1)} h"
        if c.get("first_arrival_hr") is not None else None,
        f"{_num(c['people'])} people in the flood zone" if c.get("people") is not None else None,
        f"{_num(c['villages'])} villages affected" if c.get("villages") is not None else None,
        f"peak outflow {_num(c['peak_cms'])} m³/s" if c.get("peak_cms") is not None else None,
        f"{_num(c['area_km2'], 1)} km² flooded" if c.get("area_km2") is not None else None,
    ]
    facts = [f for f in facts if f]
    if facts:
        lines.append("Model: " + "; ".join(facts) + ".")
    if c.get("label"):
        lines.append(f"Scenario type: {str(c['label']).upper()} (modelled study"
                     + (" of a recorded event)." if c["label"] in ("observed", "reconstruction") else ", not an observed event)."))
    if c.get("run_id"):
        lines.append(f"Evidence: {settings.public_url}/results/{c['run_id']}")
    lines += ["", f"NIYANTA alert {alert['id']} · raised {alert.get('created')}"]
    return {"subject": f"[NIYANTA {level}] {head}", "text": "\n".join(lines), "state": c.get("state") or ""}


def recipients_for(alert: dict[str, Any], state: str) -> list[dict[str, Any]]:
    rank = LEVEL_RANK.get(str(alert.get("level") or "INFO").upper(), 0)
    out = []
    for r in db.query("SELECT * FROM alert_recipient WHERE active ORDER BY created"):
        if rank < LEVEL_RANK.get(str(r.get("min_level") or "CRITICAL").upper(), 2):
            continue
        states = [s.lower() for s in (_json(r.get("states")) or [])]
        if states and (not state or state.lower() not in states):
            continue
        out.append(r)
    return out


# ---------------------------------------------------------------- channels
def _send_email(to: str, subject: str, text: str) -> tuple[str, str]:
    if not settings.smtp_host or not settings.smtp_from:
        return "not_configured", "set NIYANTA_SMTP_HOST / NIYANTA_SMTP_FROM to send email"
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_pass)
            s.send_message(msg)
        return "sent", f"email to {to}"
    except Exception as exc:  # noqa: BLE001 - logged per attempt, never raised
        return "failed", f"{type(exc).__name__}: {exc}"


def _send_sms(to: str, text: str) -> tuple[str, str]:
    if not settings.sms_url:
        return "not_configured", "set NIYANTA_SMS_URL to send SMS"
    url = settings.sms_url.replace("{to}", urllib.parse.quote(to)).replace("{text}", urllib.parse.quote(text[:600]))
    try:
        with urllib.request.urlopen(url, timeout=20) as r:  # noqa: S310 - operator-configured gateway
            return ("sent" if 200 <= r.status < 300 else "failed"), f"gateway HTTP {r.status}"
    except Exception as exc:  # noqa: BLE001
        return "failed", f"{type(exc).__name__}: {exc}"


def _send_webhook(url: str, alert: dict[str, Any], msg: dict[str, str]) -> tuple[str, str]:
    if not url.lower().startswith(("https://", "http://")):
        return "failed", "webhook must be an http(s) URL"
    body = json.dumps({"text": f"{msg['subject']}\n\n{msg['text']}", "subject": msg["subject"],
                       "level": alert.get("level"), "alert_id": str(alert["id"])}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - recipient-provided endpoint
            return ("sent" if 200 <= r.status < 300 else "failed"), f"HTTP {r.status}"
    except Exception as exc:  # noqa: BLE001
        return "failed", f"{type(exc).__name__}: {exc}"


def channels() -> dict[str, bool]:
    """Which channels the server can actually send on right now."""
    return {"email": bool(settings.smtp_host and settings.smtp_from), "sms": bool(settings.sms_url), "webhook": True}


def deliver(alert: dict[str, Any], recipient: dict[str, Any], msg: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    attempts = [
        ("email", recipient.get("email"), lambda t: _send_email(t, msg["subject"], msg["text"])),
        ("sms", recipient.get("phone"), lambda t: _send_sms(t, f"{msg['subject']}\n{msg['text']}")),
        ("webhook", recipient.get("webhook"), lambda t: _send_webhook(t, alert, msg)),
    ]
    for channel, target, send in attempts:
        if not target:
            continue
        status, detail = send(target)
        rows.append(db.insert("alert_delivery", {
            "alert_id": str(alert["id"]), "recipient_id": str(recipient["id"]), "channel": channel,
            "target": target, "status": status, "detail": detail[:500]}))
    return rows


def dispatch(alert_id: str, actor: str = "operator") -> dict[str, Any] | None:
    """Send an alert to every matching recipient; returns the attempts made."""
    alert = db.query_one("SELECT * FROM alert WHERE id = %s", (alert_id,))
    if not alert:
        return None
    msg = message(alert)
    sent: list[dict[str, Any]] = []
    targets = recipients_for(alert, msg["state"])
    for r in targets:
        sent += deliver(alert, r, msg)
    from modules.alert import rules  # noqa: PLC0415

    ok = sum(1 for d in sent if d["status"] == "sent")
    # an alert nobody was set up to receive is not "dispatched"
    if targets:
        rules.act(alert_id, "dispatch", actor=actor,
                  note=f"{len(targets)} recipient(s), {ok}/{len(sent)} deliveries sent")
    return {"alert_id": alert_id, "recipients": len(targets), "sent": ok, "deliveries": sent, "message": msg}


def auto_dispatch(alert: dict[str, Any]) -> None:
    """CRITICAL alerts go out the moment they are raised (background thread)."""
    if not settings.alert_auto_dispatch or str(alert.get("level")).upper() != "CRITICAL":
        return

    def _run() -> None:
        try:
            dispatch(str(alert["id"]), actor="auto")
        except Exception as exc:  # noqa: BLE001 - delivery must never break alert creation
            logger.warning("auto-dispatch of alert {} failed: {}", alert.get("id"), exc)

    threading.Thread(target=_run, daemon=True, name="alert-dispatch").start()
