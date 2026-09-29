"""backfill_dam_state — reverse-geocode dam.state from Nominatim.

    python scripts/backfill_dam_state.py              # dry run (sample 15)
    python scripts/backfill_dam_state.py --apply      # fill every NULL state
    python scripts/backfill_dam_state.py --apply --limit 50

~978 dams carry no state: OSM rarely tags addr:state and the registry
records it for only a handful. Nominatim's reverse endpoint gives one state
per request at its fair-use pace (1.1 s) — a full sweep is ~20 minutes.
Only `state` is written (NULL → value, nothing else is touched); rows whose
lookup fails stay NULL and are reported at the end.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.db import client as db  # noqa: E402

REVERSE = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "Niyanta/1.0 (SIH26161; dam state backfill)"
PACE_S = 1.1          # Nominatim fair-use: max 1 request/second
ZOOM = 10             # county level — address.state still present at this zoom


def targets(limit: int | None) -> list[dict]:
    rows = db.query(
        """SELECT id, name, ST_X(location) AS lon, ST_Y(location) AS lat
           FROM dam
           WHERE state IS NULL AND location IS NOT NULL
           ORDER BY name, id""",
    )
    if limit:
        rows = rows[:limit]
    return rows


def reverse_state(lat: float, lon: float) -> str | None:
    q = urllib.parse.urlencode(
        {"lat": lat, "lon": lon, "format": "json", "zoom": ZOOM})
    req = urllib.request.Request(
        f"{REVERSE}?{q}", headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            addr = data.get("address") or {}
            for key in ("state", "province", "state_district"):
                if addr.get(key):
                    return str(addr[key])
            return None
        except urllib.error.HTTPError as exc:
            if exc.code == 429:  # rate limited despite pacing: back off harder
                last = exc
                time.sleep(10 * (attempt + 1))
            else:
                return None  # 404 over water etc.: simply unresolved
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            time.sleep(2 * (attempt + 1))
    if last:
        print(f"    [lookup failed] {lat},{lon}: {last}")
    return None


def run(apply: bool, limit: int | None) -> None:
    rows = targets(None if apply and not limit else (limit or 15))
    if not apply:
        rows = rows[:limit or 15]
    print(f"state-less dams: {len(rows)}{' (sample)' if not apply else ''}")
    written = 0
    unresolved = 0
    for i, r in enumerate(rows):
        state = reverse_state(float(r["lat"]), float(r["lon"]))
        if not state:
            unresolved += 1
            print(f"  [unresolved] {r['name']}")
        elif apply:
            db.execute("UPDATE dam SET state = %s WHERE id = %s AND state IS NULL",
                       (state, str(r["id"])))
            written += 1
        else:
            print(f"  [dry] {r['name']} -> {state}")
        time.sleep(PACE_S)
        if (i + 1) % 50 == 0:
            print(f"  ...{i + 1}/{len(rows)}")
    print(f"resolved: {written if apply else len(rows) - unresolved}, "
          f"unresolved: {unresolved}")
    if apply:
        print(db.query_one(
            "SELECT count(*) FILTER (WHERE state IS NOT NULL) AS with_state, "
            "count(*) FILTER (WHERE state IS NULL) AS still_null, "
            "count(*) AS total FROM dam"))


if __name__ == "__main__":
    args = sys.argv[1:]
    lim = None
    if "--limit" in args:
        lim = int(args[args.index("--limit") + 1])
    run(apply="--apply" in args, limit=lim)
