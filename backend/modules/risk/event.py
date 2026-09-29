"""f₂ event-risk scorer — change_detection rows + rainfall/seismic proxies → class."""

from __future__ import annotations

from typing import Any

from modules.db import client as db

# configurable weights; unavailable factors are dropped and weights renormalized
WEIGHTS = {
    "lake_area_delta": 0.35,
    "water_mask_delta": 0.25,
    "lst_anomaly": 0.15,
    "snow_cover_delta": 0.10,
    "rainfall": 0.10,
    "seismic": 0.05,
}
CLASS_BANDS = [(30.0, "LOW"), (55.0, "MODERATE"), (75.0, "HIGH"), (101.0, "CRITICAL")]
FLAG_DELTA_PCT = 20.0


def _class(score: float) -> str:
    for limit, cls in CLASS_BANDS:
        if score < limit:
            return cls
    return "CRITICAL"


def score_box(box_id: str, changes: list[dict] | None = None) -> dict[str, Any]:
    box = db.query_one("SELECT * FROM watch_box WHERE id = %s", (box_id,))
    if not box:
        raise ValueError(f"watch box {box_id} not found")
    if changes is None:
        changes = db.query(
            "SELECT * FROM change_detection WHERE box_id = %s ORDER BY ts DESC LIMIT 100",
            (box_id,),
        )

    parts: dict[str, float] = {}
    evidence: dict[str, Any] = {"changes": len(changes)}

    lake = next((c for c in changes if c["kind"] == "lake_area"), None)
    water = next((c for c in changes if c["kind"] == "water_mask"), None)
    lst = next((c for c in changes if c["kind"] == "lst"), None)
    snow = next((c for c in changes if c["kind"] == "snow"), None)

    if lake:
        delta = abs(float((lake.get("metrics") or {}).get("delta_pct") or 0.0))
        parts["lake_area_delta"] = min(delta / 40.0, 1.0)
        evidence["lake_delta_pct"] = delta
        evidence["lake_flagged"] = bool(lake.get("flagged"))
    if water:
        delta = abs(float((water.get("metrics") or {}).get("delta_pct") or 0.0))
        parts["water_mask_delta"] = min(delta / 50.0, 1.0)
        evidence["water_delta_pct"] = delta
    if lst:
        anomaly = abs(float((lst.get("metrics") or {}).get("anomaly_c") or 0.0))
        parts["lst_anomaly"] = min(anomaly / 6.0, 1.0)
        evidence["lst_anomaly_c"] = anomaly
    if snow:
        delta = abs(float((snow.get("metrics") or {}).get("delta_pct") or 0.0))
        parts["snow_cover_delta"] = min(delta / 30.0, 1.0)

    # rainfall: latest connector snapshot weather observation if present
    rain = db.query_one(
        """SELECT metrics FROM change_detection
           WHERE box_id = %s AND kind = 'rainfall' ORDER BY ts DESC LIMIT 1""",
        (box_id,),
    )
    if rain:
        rp = abs(float((rain.get("metrics") or {}).get("return_period_yr") or 0.0))
        parts["rainfall"] = min(rp / 50.0, 1.0)
        evidence["rain_return_period"] = rp
    # seismic: connector snapshot with recent event magnitude
    seism = db.query_one(
        "SELECT counts FROM connector_snapshot WHERE name = 'seismic' ORDER BY last_sync DESC LIMIT 1"
    )
    if seism and (seism.get("counts") or {}).get("events_24h"):
        n = int(seism["counts"]["events_24h"])
        parts["seismic"] = min(n / 5.0, 1.0)
        evidence["seismic_events_24h"] = n

    if not parts:
        return {"score": 0.0, "class": "LOW",
                "factors": {**evidence, "note": "no recent observations"}}

    total_w = sum(WEIGHTS[k] for k in parts)
    score_val = sum(WEIGHTS[k] * parts[k] for k in parts) / total_w * 100.0
    cls = _class(score_val)
    if evidence.get("lake_flagged"):
        score_val = max(score_val, 60.0)
        cls = _class(score_val)
    return {"score": round(score_val, 1), "class": cls,
            "factors": {**evidence, "parts": parts, "weights": WEIGHTS}}


def assess(box_id: str) -> dict[str, Any]:
    """Score + persist risk_assessment (case 2) + trigger_event when elevated."""
    from modules.risk import insert_risk

    out = score_box(box_id)
    box = db.query_one("SELECT name FROM watch_box WHERE id = %s", (box_id,)) or {}
    row = insert_risk("2", box_id, box.get("name"), out["score"], out["class"], out["factors"])
    trigger = None
    if out["class"] in ("HIGH", "CRITICAL"):
        trigger = db.insert("trigger_event", {
            "kind": "change", "box_id": box_id, "risk_id": row["id"],
            "payload": {"score": out["score"], "class": out["class"]},
        })
    return {"risk": row, "detail": out, "trigger": trigger}


def recent_changes(flagged_only: bool = False, limit: int = 100) -> list[dict]:
    if flagged_only:
        return db.query(
            "SELECT * FROM change_detection WHERE flagged ORDER BY ts DESC LIMIT %s", (limit,)
        )
    return db.query("SELECT * FROM change_detection ORDER BY ts DESC LIMIT %s", (limit,))
