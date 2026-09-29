"""proc_dam — dam registry CSV/GeoJSON → `dam` rows (MODULE_SPEC 4.9)."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from modules.db import client as db
from modules.storage import paths

NUMERIC = ("crest_m", "height_m", "fsl_m", "storage_mcm", "crest_length_m", "river_km")


def process(dataset: dict, progress=None) -> dict[str, Any]:
    src = paths.abs_path(dataset["path"])
    records = _read(src)
    if progress:
        progress(40, f"dam registry: {len(records)} records")
    count = 0
    for rec in records:
        name = (rec.get("name") or rec.get("dam") or "").strip()
        lon = _num(rec.get("lon") or rec.get("longitude"))
        lat = _num(rec.get("lat") or rec.get("latitude"))
        if not name or lon is None or lat is None:
            continue
        meta = {k: rec.get(k) for k in ("dam_type", "erodibility", "gates", "spillway_cms") if rec.get(k)}
        existing = db.query_one("SELECT id FROM dam WHERE name = %s", (name,))
        fields = {
            "name": name,
            "river": rec.get("river") or None,
            "state": rec.get("state") or None,
            "meta": meta,
            **{k: _num(rec.get(k)) for k in NUMERIC},
        }
        if existing:
            sets = ", ".join(f"{k} = %s" for k in fields if k != "name")
            db.execute(f"UPDATE dam SET {sets} WHERE id = %s",
                       (*[fields[k] for k in fields if k != "name"], str(existing["id"])))
            db.execute("UPDATE dam SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326) WHERE id = %s",
                       (lon, lat, str(existing["id"])))
        else:
            db.execute(
                """INSERT INTO dam (name, river, state, crest_m, height_m, fsl_m,
                                    storage_mcm, crest_length_m, river_km, meta, location, dataset_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                           ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)""",
                (name, fields["river"], fields["state"], fields["crest_m"], fields["height_m"],
                 fields["fsl_m"], fields["storage_mcm"], fields["crest_length_m"],
                 fields["river_km"], json.dumps(meta), lon, lat, dataset["id"]),
            )
        count += 1
    if progress:
        progress(80, f"dam registry: {count} upserted")
    return {"kind": "dam_registry", "path": None, "meta": {"dams_upserted": count}}


def _read(src: Path) -> list[dict]:
    if src.suffix.lower() in (".geojson", ".json"):
        data = json.loads(src.read_text(encoding="utf-8"))
        feats = data.get("features", [data] if data.get("type") == "Feature" else [])
        out = []
        for feat in feats:
            props = dict(feat.get("properties") or {})
            coords = (feat.get("geometry") or {}).get("coordinates")
            if coords:
                props.setdefault("lon", coords[0])
                props.setdefault("lat", coords[1])
            out.append(props)
        return out
    with open(src, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def _num(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
