"""risk module — f₁ (reservoir) and f₂ (event) scorers. Shared row insert here."""

from __future__ import annotations

import json
from typing import Any

from modules.db import client as db


def insert_risk(case: str, target_id: str, target_ref: str | None, score: float,
                cls: str, factors: dict[str, Any]) -> dict:
    """risk_assessment insert with reserved-word quoting ("case" is reserved)."""
    return db.query_one(
        """INSERT INTO risk_assessment ("case", target_id, target_ref, score, class, factors)
           VALUES (%s, %s, %s, %s, %s, %s::jsonb) RETURNING *""",
        (case, target_id, target_ref, score, cls, json.dumps(factors)),
    ) or {}
