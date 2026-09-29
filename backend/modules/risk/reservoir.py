"""f₁ reservoir-risk scorer (MODULE_SPEC 4.14) — pure scoring + persistence.

Inputs: recent reservoir_level series + dam geometry.
Factors: freeboard deficit (forecast), storage % of capacity, rule-curve z-score,
seepage proxy (level-drop anomaly vs outflow). Weighted score → class.
"""

from __future__ import annotations

from typing import Any

from modules.db import client as db

WEIGHTS = {"freeboard": 0.40, "storage": 0.20, "rule_curve": 0.25, "seepage": 0.15}
CLASS_BANDS = [(25.0, "LOW"), (50.0, "MODERATE"), (75.0, "HIGH"), (101.0, "CRITICAL")]
FORECAST_HR = 24.0


def _class(score: float) -> str:
    for limit, cls in CLASS_BANDS:
        if score < limit:
            return cls
    return "CRITICAL"


def score(dam_id: str, series: list[dict] | None = None, dam: dict | None = None) -> dict[str, Any]:
    dam = dam or db.query_one("SELECT * FROM dam WHERE id = %s", (dam_id,))
    if not dam:
        raise ValueError(f"dam {dam_id} not found")
    if series is None:
        series = db.query(
            "SELECT * FROM reservoir_level WHERE dam_id = %s ORDER BY ts DESC LIMIT 500",
            (dam_id,),
        )
    series = list(reversed(series))

    fsl = float(dam.get("fsl_m") or 0.0)
    crest = float(dam.get("crest_m") or 0.0)
    capacity = float(dam.get("storage_mcm") or 0.0)
    height = float(dam.get("height_m") or 10.0)
    min_freeboard = max(1.0, 0.02 * height)

    factors: dict[str, Any] = {"samples": len(series)}
    if not series or not fsl:
        return {"score": 0.0, "class": "LOW", "factors": {**factors, "note": "no telemetry"}}

    series = [r for r in series if r.get("level_m") is not None]
    levels = [float(r["level_m"]) for r in series]
    storages = [float(r["storage_mcm"]) for r in series if r.get("storage_mcm") is not None]
    inflows = [float(r["inflow_cms"] or 0.0) for r in series]
    outflows = [float(r["outflow_cms"] or 0.0) for r in series]
    if not levels:
        return {"score": 0.0, "class": "LOW", "factors": {**factors, "note": "no levels"}}

    # forecast: recent linear trend projected over FORECAST_HR, never below last level
    last = levels[-1]
    window = levels[-min(24, len(levels)):]
    if len(window) >= 2:
        slope_per_sample = (window[-1] - window[0]) / (len(window) - 1)
        forecast_peak = last + max(0.0, slope_per_sample) * (len(window) - 1)
        forecast_peak = max(forecast_peak, last)
    else:
        forecast_peak = last
    allowed = crest - min_freeboard
    deficit = forecast_peak - allowed
    freeboard_f = min(max(deficit / max(min_freeboard, 0.5), -1.0), 1.0)
    if deficit < 0:
        freeboard_f = max(deficit / max(0.5 * min_freeboard, 1.0), -1.0)
    factors["forecast_peak_m"] = round(forecast_peak, 2)
    factors["allowed_level_m"] = round(allowed, 2)
    factors["freeboard_deficit_m"] = round(deficit, 2)

    # storage %
    if storages and capacity > 0:
        storage_pct = min(storages[-1] / capacity, 1.5)
    else:
        storage_pct = min(last / fsl, 1.5) if fsl else 0.0
    factors["storage_pct"] = round(storage_pct * 100.0, 1)

    # rule-curve z-score: target = FSL (conservative synthetic rule curve)
    mean = sum(levels) / len(levels)
    var = sum((v - mean) ** 2 for v in levels) / max(len(levels), 1)
    std = var ** 0.5 or 1.0
    z = (last - fsl) / std
    factors["rule_curve_z"] = round(z, 2)

    # seepage proxy: unexplained drop periods (no inflow, outflow small, level falling)
    seepage_hits = 0
    checks = 0
    for i in range(1, len(series)):
        inflow = inflows[i]
        outflow = outflows[i]
        drop = levels[i - 1] - levels[i]
        if inflow < 1.0:
            checks += 1
            expected = outflow * 6.0 / 60.0 / max(capacity, 1.0) * height  # 6-min sample heuristic
            if drop > max(3.0 * expected, 0.05):
                seepage_hits += 1
    seepage_f = min(seepage_hits / 10.0, 1.0) if checks else 0.0
    factors["seepage_hits"] = seepage_hits

    parts = {
        "freeboard": _clamp01(freeboard_f),
        "storage": _clamp01((storage_pct - 0.6) / 0.6),
        "rule_curve": _clamp01(z / 3.0),
        "seepage": seepage_f,
    }
    score_val = sum(WEIGHTS[k] * parts[k] for k in WEIGHTS) * 100.0
    cls = _class(score_val)
    return {"score": round(score_val, 1), "class": cls,
            "factors": {**factors, "parts": parts, "weights": WEIGHTS}}


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def assess(dam_id: str) -> dict[str, Any]:
    """Score + persist risk_assessment row (case 1)."""
    from modules.risk import insert_risk

    out = score(dam_id)
    dam = db.query_one("SELECT name FROM dam WHERE id = %s", (dam_id,)) or {}
    row = insert_risk("1", dam_id, dam.get("name"), out["score"], out["class"], out["factors"])
    return {"risk": row, "detail": out}


def history(target_id: str, limit: int = 50) -> list[dict]:
    return db.query(
        "SELECT * FROM risk_assessment WHERE target_id = %s ORDER BY ts DESC LIMIT %s",
        (target_id, limit),
    )
