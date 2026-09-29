"""connectors — offline sync of wris/osm/worldpop/weather/dem/seismic into snapshots."""

from __future__ import annotations

import json
from typing import Any

from modules.db import client as db

CONNECTORS = ("wris", "osm", "worldpop", "weather", "dem", "seismic")


def sync(name: str) -> dict[str, Any]:
    """Force a connector fetch. Offline: recompute counts from local tables."""
    if name not in CONNECTORS:
        raise ValueError(f"unknown connector {name}; one of {CONNECTORS}")
    db.execute("UPDATE connector_snapshot SET status = 'syncing' WHERE name = %s", (name,))
    counts = _counts(name)
    db.execute(
        """INSERT INTO connector_snapshot (name, status, counts, last_sync)
           VALUES (%s, 'ok', %s::jsonb, now())
           ON CONFLICT (name) DO UPDATE SET status = 'ok',
             counts = EXCLUDED.counts, last_sync = now(), error = NULL""",
        (name, json.dumps(counts)),
    )
    return {"name": name, "status": "ok", "counts": counts, "offline": True}


def list() -> list[dict]:
    rows = db.query("SELECT * FROM connector_snapshot ORDER BY name")
    present = {r["name"] for r in rows}
    for name in CONNECTORS:
        if name not in present:
            rows.append({"name": name, "status": "idle", "counts": {}, "last_sync": None})
    return rows


def _counts(name: str) -> dict[str, Any]:
    def one(sql: str) -> int:
        return int((db.query_one(sql) or {}).get("n") or 0)
    if name == "wris":
        return {"dams": one("SELECT count(*) n FROM dam"),
                "reservoir_levels": one("SELECT count(*) n FROM reservoir_level")}
    if name == "osm":
        layers = db.query("SELECT layer, count(*) n FROM vector_feature GROUP BY layer")
        return {"features": one("SELECT count(*) n FROM vector_feature"),
                "by_layer": {r["layer"]: int(r["n"]) for r in layers}}
    if name == "worldpop":
        return {"villages": one("SELECT count(*) n FROM village_population"),
                "population_total": int(db.query_one(
                    "SELECT coalesce(sum(count),0) n FROM village_population")["n"])}
    if name == "weather":
        return {"bc_products": one(
            "SELECT count(*) n FROM product WHERE kind IN ('bc_upstream','weather_ingested')")}
    if name == "dem":
        return {"dem_datasets": one(
            "SELECT count(*) n FROM dataset WHERE kind = 'dem' AND deleted_at IS NULL"),
            "conditioned": one("SELECT count(*) n FROM product WHERE kind = 'conditioned_dem'")}
    if name == "seismic":
        return {"events_24h": one(
            "SELECT count(*) n FROM trigger_event WHERE ts > datetime('now', '-24 hours')")}
    return {}
