"""Scenario Lab catalogue — replayable scenarios grouped by hazard, with badges.

Spec §6–8 (scenario cards), §21.1 (instant replay of precomputed runs) and §29
(OBSERVED / RECONSTRUCTION / HYPOTHETICAL / DEMO). Every number returned comes
from a VALIDATED run row; nothing is filled in.

Hazard is read from the spec, never guessed from names:
  breach.mode == "blockage_breach"            → glof  (natural lake / GLOF-type)
  a dam_id, or piping / overtopping / attack  → dam_break
Badge: spec.provenance.label when the analyst set one, else HYPOTHETICAL —
every model run here is a what-if, and D10 forbids calling an analog a
reconstruction unless someone deliberately labels it so.
"""

from __future__ import annotations

import json
from typing import Any

from modules.db import client as db
from modules.run.stages import ENGINE_LABEL

LABELS = ("observed", "reconstruction", "hypothetical", "demo")
DEFAULT_LABEL = "hypothetical"
DONE = ("VALIDATED", "PUBLISHED")


def _json(v: Any) -> dict[str, Any]:
    if isinstance(v, dict):
        return v
    try:
        return json.loads(v) if v else {}
    except (TypeError, ValueError):
        return {}


def hazard_of(spec: dict[str, Any]) -> str:
    mode = (spec.get("breach") or {}).get("mode")
    if mode == "blockage_breach":
        return "glof"
    if spec.get("dam_id") or mode in ("piping", "overtopping", "attack"):
        return "dam_break"
    return "other"


def label_of(spec: dict[str, Any]) -> tuple[str, bool]:
    """(badge, set_by_analyst)."""
    lab = (spec.get("provenance") or {}).get("label")
    return (lab, True) if lab in LABELS else (DEFAULT_LABEL, False)


def catalogue() -> dict[str, Any]:
    """Scenarios that have at least one validated run, newest run first."""
    rows = db.query(
        f"""SELECT s.id AS scenario_id, s.name, s."case" AS case_id, s.spec,
                   r.id AS run_id, r.engine, r.created AS run_created, r.metrics, r.result
              FROM run r JOIN scenario s ON s.id = r.scenario_id
             WHERE r.state IN {DONE}
             ORDER BY r.created DESC""")
    scenarios: dict[str, dict[str, Any]] = {}
    for r in rows:
        sid = str(r["scenario_id"])
        if sid in scenarios:
            scenarios[sid]["runs"] += 1
            continue
        spec = _json(r["spec"])
        metrics = _json(r["metrics"])
        impact = _json(r["result"]).get("impact") or {}
        label, label_set = label_of(spec)
        scenarios[sid] = {
            "scenario_id": sid,
            "name": r["name"],
            "case": r["case_id"],
            "hazard": hazard_of(spec),
            "mode": (spec.get("breach") or {}).get("mode"),
            "producer": (spec.get("provenance") or {}).get("producer"),
            "label": label,
            "label_set": label_set,
            "runs": 1,
            "latest": {
                "run_id": str(r["run_id"]),
                "engine": r["engine"],
                "engine_label": ENGINE_LABEL.get(r["engine"] or "", (r["engine"] or "").upper()),
                "created": r["run_created"],
                "peak_discharge_cms": metrics.get("peak_discharge_cms"),
                "max_depth_m": metrics.get("max_depth_m"),
                "inundation_km2": metrics.get("inundation_km2"),
                "population_exposed": impact.get("population_exposed"),
                "buildings_affected": impact.get("buildings_affected"),
            },
        }
    items = list(scenarios.values())
    counts = {h: sum(1 for s in items if s["hazard"] == h) for h in ("dam_break", "glof", "other")}
    return {"labels": list(LABELS), "counts": counts, "scenarios": items}


def set_label(scenario_id: str, label: str | None) -> dict[str, Any]:
    """Set (or clear, with None) the analyst's badge on a scenario."""
    if label is not None and label not in LABELS:
        raise ValueError(f"label must be one of {LABELS} or null")
    row = db.query_one("SELECT spec FROM scenario WHERE id = %s", (scenario_id,))
    if not row:
        raise LookupError("scenario not found")
    spec = _json(row["spec"])
    prov = dict(spec.get("provenance") or {})
    if label is None:
        prov.pop("label", None)
    else:
        prov["label"] = label
    spec["provenance"] = prov
    db.execute("UPDATE scenario SET spec = %s, updated = now() WHERE id = %s",
               (json.dumps(spec), scenario_id))
    badge, label_set = label_of(spec)
    return {"scenario_id": scenario_id, "label": badge, "label_set": label_set}


def set_observed(scenario_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    """Replace the scenario's recorded point observations (validation, §30).
    Each is checked by schemas.scenario.Observation; re-score a run with
    POST /api/validate/benchmark/{run_id} to apply them."""
    from schemas.scenario import Observation  # noqa: PLC0415

    clean = [Observation(**it).model_dump() for it in items]
    row = db.query_one("SELECT spec FROM scenario WHERE id = %s", (scenario_id,))
    if not row:
        raise LookupError("scenario not found")
    spec = _json(row["spec"])
    spec["observed"] = clean
    db.execute("UPDATE scenario SET spec = %s, updated = now() WHERE id = %s",
               (json.dumps(spec), scenario_id))
    return {"scenario_id": scenario_id, "observed": clean}
