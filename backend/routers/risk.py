from __future__ import annotations

from fastapi import APIRouter, HTTPException

from modules.alert import rules as alert_rules
from modules.db import client as db
from modules.risk import event as risk_event
from modules.risk import reservoir as risk_reservoir

router = APIRouter(prefix="/risk", tags=["risk"])

LEVEL_BY_CLASS = {"MODERATE": "WARNING", "HIGH": "WARNING", "CRITICAL": "CRITICAL"}


@router.post("/reservoir")
def score_reservoir(body: dict) -> dict:
    """f₁ on a dam → risk_assessment; ≥ MODERATE auto-builds a case-1 scenario."""
    dam_id = body.get("dam_id")
    if not dam_id:
        raise HTTPException(422, "dam_id required")
    if not db.query_one("SELECT id FROM dam WHERE id = %s", (dam_id,)):
        raise HTTPException(404, "dam not found")
    try:
        out = risk_reservoir.assess(dam_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    scenario = None
    cls = out["detail"]["class"]
    if cls in ("MODERATE", "HIGH", "CRITICAL") and body.get("auto_build", True):
        try:
            from modules.scenario import builders  # noqa: PLC0415

            scenario = builders.from_risk(str(out["risk"]["id"]))["scenario"]
        except ValueError:
            scenario = None
    alert = None
    if cls in LEVEL_BY_CLASS:
        alert = alert_rules.create(
            LEVEL_BY_CLASS[cls],
            f"Reservoir risk {cls}: {out['risk'].get('target_ref') or dam_id}",
            f"f₁ score {out['detail']['score']} on {out['risk'].get('target_ref')}",
            source="risk",
            payload={"risk_id": str(out["risk"]["id"]), "case": "1", "score": out["detail"]["score"],
                     "class": cls},
        )
    return {"risk": out["risk"], "detail": out["detail"], "scenario": scenario, "alert": alert}


@router.post("/event/{box_id}")
def score_event(box_id: str, body: dict | None = None) -> dict:
    """f₂ on a watch box → risk_assessment + trigger_event; ≥ HIGH builds case-2 scenario."""
    if not db.query_one("SELECT id FROM watch_box WHERE id = %s", (box_id,)):
        raise HTTPException(404, "watch box not found")
    try:
        out = risk_event.assess(box_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    scenario = None
    cls = out["detail"]["class"]
    if cls in ("HIGH", "CRITICAL") and (body or {}).get("auto_build", True):
        try:
            from modules.scenario import builders  # noqa: PLC0415

            change = db.query_one(
                """SELECT id FROM change_detection WHERE box_id = %s
                   ORDER BY flagged DESC, ts DESC LIMIT 1""",
                (box_id,),
            )
            if change:
                scenario = builders.from_event(str(change["id"]))["scenario"]
        except ValueError:
            scenario = None
    alert = None
    if cls in LEVEL_BY_CLASS:
        alert = alert_rules.create(
            LEVEL_BY_CLASS[cls],
            f"Event risk {cls}: {out['risk'].get('target_ref') or box_id}",
            f"f₂ score {out['detail']['score']}",
            source="gee",
            payload={"risk_id": str(out["risk"]["id"]), "case": "2", "score": out["detail"]["score"],
                     "class": cls, "box_id": box_id},
        )
    return {"risk": out["risk"], "detail": out["detail"], "scenario": scenario, "alert": alert}


@router.get("/events")
def list_events(limit: int = 100) -> list[dict]:
    return db.query("SELECT * FROM trigger_event ORDER BY ts DESC LIMIT %s", (limit,))


@router.get("")
def risk_history(target: str | None = None, limit: int = 50) -> list[dict]:
    if target:
        return risk_reservoir.history(target, limit)
    return db.query("SELECT * FROM risk_assessment ORDER BY ts DESC LIMIT %s", (limit,))


@router.get("/{risk_id}")
def get_risk(risk_id: str) -> dict:
    row = db.query_one("SELECT * FROM risk_assessment WHERE id = %s", (risk_id,))
    if not row:
        raise HTTPException(404, "risk not found")
    return row
