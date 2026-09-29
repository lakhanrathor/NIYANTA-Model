"""Link dams to Wikidata entities (QIDs) for downstream enrichment.

    python scripts/link_dam_wikidata.py            # dry run: report matches
    python scripts/link_dam_wikidata.py --apply    # write meta.tags.wikidata
    python scripts/link_dam_wikidata.py --apply --limit 20

Only dams with a location and WITHOUT a stored QID are candidates
(synthetic/benchmark rows are excluded — they must never link to real
entities). Each distinct name goes through wbsearchentities; an entity is
kept only when its English label matches the dam name exactly AND its P625
coordinates sit within MATCH_KM of the dam's own location. A wrong QID would
surface a wrong photo, so strictness beats recall here.

The write only merges meta.tags.wikidata (+ provenance) — no spec column and
no ingest_status is touched. scripts/fetch_dam_photos.py picks up newly
linked dams on its next run automatically.
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

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SEARCH = "https://www.wikidata.org/w/api.php"
USER_AGENT = "Niyanta/1.0 (SIH26161; dam wikidata linking)"
SEARCH_LIMIT = 10
CLAIMS_CHUNK = 40
PACE_S = 1.5
MATCH_KM = 10.0


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429:
                time.sleep(20 * (attempt + 1))
            elif attempt < 4:
                time.sleep(3 * (attempt + 1))
            else:
                break
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"wikidata api failed: {last}")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = (0.5 - math.cos((lat2 - lat1) * p) / 2
         + math.cos(lat1 * p) * math.cos(lat2 * p)
         * (1 - math.cos((lon2 - lon1) * p)) / 2)
    return 2 * 6371 * math.asin(math.sqrt(a))


def targets() -> list[dict]:
    rows = db.query(
        """SELECT id, name, ST_X(location) AS lon, ST_Y(location) AS lat, meta
           FROM dam
           WHERE location IS NOT NULL
             AND json_extract(meta, '$.synthetic') IS NULL
             AND json_extract(meta, '$.benchmark') IS NULL""")
    out = []
    for r in rows:
        meta = r.get("meta") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        if (meta.get("tags") or {}).get("wikidata"):
            continue
        out.append({
            "id": str(r["id"]), "name": r["name"],
            "lon": float(r["lon"]), "lat": float(r["lat"]),
            "meta": meta,
        })
    return out


def run(apply: bool = False, limit: int = 0, offset: int = 0, batch: int = 25) -> None:
    cands = targets()
    print(f"dams without a QID: {len(cands)}", flush=True)
    by_label: dict[str, list[dict]] = {}
    for c in cands:
        by_label.setdefault(c["name"], []).append(c)
    labels = sorted(by_label)
    if offset > 0:
        labels = labels[offset:]
    if limit > 0:
        labels = labels[:limit]
    print(f"processing slice: {len(labels)} labels (offset {offset})", flush=True)

    matched = written = 0
    # Sub-batches write as they go: a timeout (or a throttle storm) banks
    # everything finished so far instead of losing the whole slice.
    for b in range(0, len(labels), batch):
        sub = labels[b : b + batch]
        m, w = _run_batch(by_label, sub, apply)
        matched += m
        written += w
        print(f"  batch {b // batch + 1}: slice {b}-{b + len(sub)} matched {m} written {w}",
              flush=True)
    print(f"TOTAL matched: {matched}, rows written: {written}", flush=True)


def _run_batch(by_label: dict[str, list[dict]], labels: list[str],
               apply: bool) -> tuple[int, int]:

    # Phase 1: label → candidate QIDs.
    label_qids: dict[str, list[str]] = {}
    failures = 0
    for i, label in enumerate(labels):
        try:
            q = urllib.parse.urlencode(
                {"action": "wbsearchentities", "search": label, "language": "en",
                 "type": "item", "limit": SEARCH_LIMIT, "format": "json"})
            label_qids[label] = [s["id"] for s in _get(f"{SEARCH}?{q}").get("search", [])]
        except Exception as exc:  # noqa: BLE001 - one failed search is not fatal
            failures += 1
            print(f"  [search failed] {label!r}: {exc}")
        if (i + 1) % 50 == 0:
            print(f"  search {i + 1}/{len(labels)} ({failures} failed)")
        time.sleep(PACE_S)
    wanted = sorted({q for qs in label_qids.values() for q in qs})
    print(f"search done: {len(wanted)} candidate entities")

    # Phase 2: labels + coordinates in bulk.
    ents: dict[str, dict] = {}
    for i in range(0, len(wanted), CLAIMS_CHUNK):
        chunk = wanted[i : i + CLAIMS_CHUNK]
        q = urllib.parse.urlencode(
            {"action": "wbgetentities", "ids": "|".join(chunk),
             "props": "claims|labels", "languages": "en", "format": "json"})
        for qid, ent in (_get(f"{SEARCH}?{q}").get("entities") or {}).items():
            if ent.get("missing") is not None:
                continue
            label = (ent.get("labels") or {}).get("en", {}).get("value")
            if not label:
                continue
            claims = ent.get("claims") or {}
            p625 = claims.get("P625") or []
            dv = (p625[0].get("mainsnak", {}).get("datavalue", {}).get("value") or {}) if p625 else {}
            if "latitude" not in dv or "longitude" not in dv:
                continue  # no coordinates: refuse to guess
            ents[qid] = {"qid": qid, "label": label,
                         "lat": float(dv["latitude"]), "lon": float(dv["longitude"])}
        time.sleep(PACE_S)
    print(f"claims fetched: {len(ents)} entities with coordinates")

    # Phase 3: exact label + coordinates, write (no network).
    ents_by_label: dict[str, list[dict]] = {}
    for ent in ents.values():
        ents_by_label.setdefault(ent["label"].lower(), []).append(ent)
    matched = written = 0
    for label in labels:
        for c in by_label[label]:
            for ent in ents_by_label.get(label.lower(), []):
                if haversine_km(c["lat"], c["lon"], ent["lat"], ent["lon"]) > MATCH_KM:
                    continue
                matched += 1
                meta = dict(c["meta"])
                tags = dict(meta.get("tags") or {})
                tags["wikidata"] = ent["qid"]
                meta["tags"] = tags
                meta["qid_source"] = "wbsearch+coord"
                if apply:
                    db.execute(
                        "UPDATE dam SET meta = %s::jsonb WHERE id = %s",
                        (json.dumps(meta), c["id"]))
                    written += 1
                else:
                    print(f"  [dry] {c['name']}: -> {ent['qid']} ({ent['label']})")
                break
    return matched, written


if __name__ == "__main__":
    args = sys.argv
    run(apply="--apply" in args,
        limit=int(args[args.index("--limit") + 1]) if "--limit" in args else 0,
        offset=int(args[args.index("--offset") + 1]) if "--offset" in args else 0,
        batch=int(args[args.index("--batch") + 1]) if "--batch" in args else 25)
