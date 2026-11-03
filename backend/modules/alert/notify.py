from __future__ import annotations

from typing import Any

from modules.alert import rules as alert_rules
from modules.catalog import catalog
from modules.db import client as db


RULE_TITLE = {
    "population_exposed": "many people in the flood zone",
    "arrival_fast": "flood arrives within hours",
    "risk_high": "high dam-break risk",
}


def _evaluate(cond: dict[str, Any], metrics: dict[str, Any]) -> bool:
    metric = cond.get("metric")
    op = cond.get("op", ">")
    threshold = cond.get("threshold")
    value = metrics.get(metric)
    if value is None:
        if metric == "arrival_hr":
            stations = metrics.get("stations") or []
            arrivals = [s.get("arrival_hr") for s in stations if s.get("arrival_hr") is not None]
            value = min(arrivals) if arrivals else None
        if metric == "risk_class":
            value = metrics.get("risk_class")
    if value is None:
        return False
    try:
        if op == ">":
            return float(value) > float(threshold)
        if op == "<":
            return float(value) < float(threshold)
        if op == ">=":
            return float(value) >= float(threshold)
        if op == "<=":
            return float(value) <= float(threshold)
        if op == "in":
            return value in (threshold or [])
    except (TypeError, ValueError):
        return False
    return False


def on_run_complete(run_id: str) -> dict[str, Any] | None:
    """Fire alert(s) when a run reaches VALIDATED (event hook, not a stage)."""
    run = catalog.run_get(run_id)
    if not run:
        return None
    result = run.get("result") or {}
    metrics = dict(run.get("metrics") or {})
    if "impact" in result:
        metrics.setdefault("population_exposed", result["impact"].get("population_exposed", 0))
    if "stations" in result:
        metrics["stations"] = result["stations"]
    sc = catalog.scenario_get(run["scenario_id"])
    if sc:
        metrics.setdefault("risk_class", None)
    # where: the dam this run breached, so the alert names it and sits on the map
    dam_id = ((sc or {}).get("spec") or {}).get("dam_id")
    dam = db.query_one("SELECT name, river, river_id, state FROM dam WHERE id = %s", (dam_id,)) if dam_id else None
    where = f"{dam['name']}" if dam else f"Run {run_id[:8]}"
    fired = []
    for rule in alert_rules.rules():
        cond = rule.get("condition") or {}
        if not _evaluate(cond, metrics):
            continue
        title = f"{where}: {RULE_TITLE.get(rule['name'], rule['name'])}"
        # Re-running a stage re-evaluates the same rules; one open alert per
        # (run, rule) keeps the feed readable instead of 7 identical rows.
        if db.query_one(
            "SELECT id FROM alert WHERE run_id = %s AND title = %s AND state = 'NEW'",
            (run_id, title),
        ):
            continue
        fired.append(rule["name"])
        level = "CRITICAL" if cond.get("metric") in ("risk_class", "arrival_hr") else "WARNING"
        alert_rules.create(
            level,
            title,
            f"metrics={ {k: metrics.get(k) for k in ('population_exposed', 'peak_discharge_cms', 'inundation_km2')} }",
            run_id=run_id,
            source="rule",
            payload={"rule": rule["name"], "metrics": metrics},
            dam_id=dam_id,
            river_id=(dam or {}).get("river_id"),
            location=", ".join(x for x in ((dam or {}).get("river"), (dam or {}).get("state")) if x) or None,
        )
    return {"fired": fired}
