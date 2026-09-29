"""enrich_dam_specs — replace calibrated dam values with Wikidata facts.

    python scripts/enrich_dam_specs.py            # dry run: report matches
    python scripts/enrich_dam_specs.py --apply    # write them

A dam is a candidate while it sits on calibration (`ingest_status='default'`).
Each distinct name goes through the Wikidata search API for candidate
entities; the entity's claims are then pulled in batches and kept only when
the English label matches exactly AND its coordinates sit within MATCH_KM of
the dam's own location — "Jari Dam" in Pakistan must never land on "Jari
Dam" in India. Only columns still on a calibration default or NULL are
written, so CWC/OSM values are never overwritten; gains move the row to
`ingest_status='wikidata'` with `meta.spec_source` for provenance.

Wikidata properties: P2048 height (m), P2043 length (m), P2928 storage
capacity (m³), P625 coordinate location. Crest/FSL elevations have no
Wikidata source — those stay calibrated and flagged. (SPARQL is avoided on
purpose: WDQS rejects literals in VALUES and label scans time out.)
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.db import client as db  # noqa: E402

SEARCH = "https://www.wikidata.org/w/api.php"
USER_AGENT = "Niyanta/1.0 (SIH26161; dam spec enrichment)"
SEARCH_LIMIT = 10        # candidates per label; coordinates decide the rest
CLAIMS_CHUNK = 40        # wbgetentities ids per request
PACE_S = 1.05            # Wikimedia rate-limits hard above ~1 req/s
MATCH_KM = 10.0
METRE_UNIT = "Q11573"
CUBIC_METRE_UNIT = "Q17438075"

# calibration defaults written by seed_dam_specs — the values we may replace
CAL = {"height_m": 25.0, "crest_m": 250.0, "fsl_m": 248.5,
       "storage_mcm": 85.0, "crest_length_m": 420.0}
EPS = 1e-6


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429:      # rate limited: Wikimedia wants real cool-off
                time.sleep(20 * (attempt + 1))
            elif attempt < 4:
                time.sleep(3 * (attempt + 1))
            else:
                break
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"wikidata api failed: {last}")


def targets() -> list[dict]:
    rows = db.query(
        """SELECT id, name, ST_X(location) AS lon, ST_Y(location) AS lat,
                  height_m, crest_m, fsl_m, storage_mcm, crest_length_m, meta
           FROM dam
           WHERE ingest_status = 'default'
             AND location IS NOT NULL
             AND json_extract(meta, '$.synthetic') IS NULL
             AND json_extract(meta, '$.benchmark') IS NULL""")
    out = []
    for r in rows:
        out.append({
            "id": str(r["id"]), "name": r["name"],
            "lon": float(r["lon"]), "lat": float(r["lat"]),
            "height_m": r["height_m"], "crest_m": r["crest_m"], "fsl_m": r["fsl_m"],
            "storage_mcm": r["storage_mcm"], "crest_length_m": r["crest_length_m"],
            "meta": r["meta"] or {},
        })
    return out


def search_qids(label: str) -> list[str]:
    q = urllib.parse.urlencode(
        {"action": "wbsearchentities", "search": label, "language": "en",
         "type": "item", "limit": SEARCH_LIMIT, "format": "json"})
    data = _get(f"{SEARCH}?{q}")
    return [s["id"] for s in data.get("search", [])]


def entity_claims(qids: list[str]) -> dict[str, dict]:
    """qid → {label, lat, lon, height_m, length_m, storage_m3}."""
    out: dict[str, dict] = {}
    for i in range(0, len(qids), CLAIMS_CHUNK):
        chunk = qids[i:i + CLAIMS_CHUNK]
        q = urllib.parse.urlencode(
            {"action": "wbgetentities", "ids": "|".join(chunk),
             "props": "claims|labels", "languages": "en", "format": "json"})
        data = _get(f"{SEARCH}?{q}")
        for qid, ent in (data.get("entities") or {}).items():
            if ent.get("missing") is not None:
                continue
            label = (ent.get("labels") or {}).get("en", {}).get("value")
            if not label:
                continue
            rec: dict = {"qid": qid, "label": label}
            claims = ent.get("claims") or {}
            _fill_coord(rec, claims.get("P625"))
            _fill_quantity(rec, claims.get("P2048"), "height_m", METRE_UNIT)
            _fill_quantity(rec, claims.get("P2043"), "length_m", METRE_UNIT)
            _fill_quantity(rec, claims.get("P2928"), "storage_m3", CUBIC_METRE_UNIT)
            out[qid] = rec
        time.sleep(PACE_S)
    return out


def _fill_coord(rec: dict, claims: list | None) -> None:
    if not claims:
        return
    dv = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value") or {}
    if "latitude" in dv and "longitude" in dv:
        rec["lat"] = float(dv["latitude"])
        rec["lon"] = float(dv["longitude"])


def _fill_quantity(rec: dict, claims: list | None, key: str, unit: str) -> None:
    if not claims:
        return
    dv = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value") or {}
    amount, unit_uri = dv.get("amount"), dv.get("unit", "")
    if not amount or unit not in str(unit_uri):
        return
    try:
        rec[key] = float(str(amount).lstrip("+"))
    except ValueError:
        return


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = (0.5 - math.cos((lat2 - lat1) * p) / 2
         + math.cos(lat1 * p) * math.cos(lat2 * p)
         * (1 - math.cos((lon2 - lon1) * p)) / 2)
    return 2 * 6371 * math.asin(math.sqrt(a))


def _open(value, default) -> bool:
    """A column is open when it is NULL or still exactly the calibration."""
    if value is None:
        return True
    if isinstance(default, float) and isinstance(value, (int, float)):
        return abs(float(value) - default) < EPS
    return False


def run(apply: bool) -> None:
    cands = targets()
    print(f"candidates on calibration: {len(cands)}")
    by_label: dict[str, list[dict]] = {}
    for c in cands:
        by_label.setdefault(c["name"], []).append(c)
    labels = sorted(by_label)

    # Phase 1: label → candidate QIDs (the only per-label network work).
    label_qids: dict[str, list[str]] = {}
    failures = 0
    for i, label in enumerate(labels):
        try:
            label_qids[label] = search_qids(label)
        except Exception as exc:  # noqa: BLE001 - one failed search ≠ abort
            failures += 1
            print(f"  [search failed] {label!r}: {exc}")
        if (i + 1) % 50 == 0:
            print(f"  search {i + 1}/{len(labels)} ({failures} failed)")
        time.sleep(PACE_S)
    wanted = {q for qs in label_qids.values() for q in qs}
    print(f"search done: {len(wanted)} candidate entities")

    # Phase 2: claims for every candidate, in bulk.
    ents = entity_claims(sorted(wanted))
    print(f"claims fetched: {len(ents)} entities")

    # Phase 3: match by exact label + coordinates, write (no network).
    ents_by_label: dict[str, list[dict]] = {}
    for ent in ents.values():
        ents_by_label.setdefault(ent["label"].lower(), []).append(ent)
    matched = 0
    written = 0
    per_col = {"height_m": 0, "crest_length_m": 0, "storage_mcm": 0}
    for label in labels:
        for c in by_label[label]:
            for ent in ents_by_label.get(label.lower(), []):
                if "lat" not in ent:
                    continue  # no coordinates: refuse to guess
                if haversine_km(c["lat"], c["lon"],
                                ent["lat"], ent["lon"]) > MATCH_KM:
                    continue
                matched += 1
                sets, params = [], []
                if "height_m" in ent and _open(c["height_m"], CAL["height_m"]):
                    sets.append("height_m = %s")
                    params.append(ent["height_m"])
                    per_col["height_m"] += 1
                if "length_m" in ent and _open(c["crest_length_m"], CAL["crest_length_m"]):
                    sets.append("crest_length_m = %s")
                    params.append(ent["length_m"])
                    per_col["crest_length_m"] += 1
                if "storage_m3" in ent and _open(c["storage_mcm"], CAL["storage_mcm"]):
                    sets.append("storage_mcm = %s")
                    params.append(ent["storage_m3"] / 1e6)
                    per_col["storage_mcm"] += 1
                if not sets:
                    continue
                sets.append("ingest_status = 'wikidata'")
                meta = dict(c["meta"])
                meta["spec_source"] = f"wikidata:{ent['qid']}"
                sets.append("meta = %s::jsonb")
                params.append(json.dumps(meta))
                params.append(c["id"])
                if apply:
                    db.execute(
                        f"UPDATE dam SET {', '.join(sets)} WHERE id = %s",
                        tuple(params))
                    written += 1
                else:
                    cols = [s.split(" =")[0] for s in sets[:-2]]
                    print(f"  [dry] {c['name']}: {cols} -> {ent['qid']}")

    print(f"matched pairs: {matched}, rows written: {written}")
    print(f"columns filled: {per_col}")
    if apply:
        print(db.query_one(
            "SELECT count(*) FILTER (WHERE ingest_status='wikidata') AS wikidata, "
            "count(*) FILTER (WHERE ingest_status='default') AS still_default, "
            "count(*) FILTER (WHERE ingest_status='complete') AS complete FROM dam"))


if __name__ == "__main__":
    run(apply="--apply" in sys.argv)
