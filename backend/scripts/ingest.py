"""Real-world ingest: dams, rivers, glaciers, waterbodies -> PostGIS.

Every source is open and fetchable without a key. Each section degrades on
failure (a slow mirror skips that source, it never blocks the rest), and every
row records where it came from (`registry_source` / `source`).

    python scripts/ingest.py dams
    python scripts/ingest.py rivers
    python scripts/ingest.py glaciers waterbodies
    python scripts/ingest.py all
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.db import client as db  # noqa: E402

UA = {"User-Agent": "NIYANTA/1.0 (SIH26161; open-data ingest)"}
NET_TIMEOUT = 90
# Nominatim asks for <=1 request/second.
NOMINATIM_GAP = 1.1

# Bounding boxes covering India (west, south, east, north).
INDIA = (68.0, 6.5, 97.5, 35.5)
HIMALAYA = (72.0, 26.0, 96.5, 35.5)


# --------------------------------------------------------------- http utils
def _get(url: str, headers: dict[str, str] | None = None, timeout: int = NET_TIMEOUT,
         data: bytes | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise last  # type: ignore[misc]


def _json(url: str, **kw: Any) -> Any:
    return json.loads(_get(url, **kw))


def overpass(query: str, host: str = "https://overpass-api.de/api/interpreter",
             timeout: int = 120) -> Any:
    body = urllib.parse.urlencode({"data": query}).encode()
    return json.loads(_get(host, data=body, timeout=timeout))


def _bbox_clause(bbox: tuple[float, float, float, float]) -> str:
    w, s, e, n = bbox
    return f"({s},{w},{n},{e})"


# ------------------------------------------------------------------- geo
def _length_km(coords: list[list[float]]) -> float:
    """Great-circle length of a coordinate ring, in km."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        lon1, lon2 = math.radians(x1), math.radians(x2)
        lat1, lat2 = math.radians(y1), math.radians(y2)
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        total += 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))
    return total


def _bbox_of(coords: list[list[float]]) -> list[float]:
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def _ring_bbox(rings: list[list[list[float]]]) -> list[float]:
    pts = [p for ring in rings for p in ring]
    return _bbox_of(pts)


# --------------------------------------------------------------- dams
DAM_OVERPASS = """
[out:json][timeout:110];
(
  way["waterway"="dam"]["name"]{bbox};
  relation["waterway"="dam"]["name"]{bbox};
);
out geom;
"""


def _dam_state(el: dict) -> str | None:
    """Pick the admin state out of OSM tags / name suffix."""
    for key in ("addr:state", "state", "is_in:state"):
        if el.get("tags", {}).get(key):
            return str(el["tags"][key])
    return None


def _dam_height(tags: dict[str, str]) -> float | None:
    for key in ("height", "dam:height", "wall:height"):
        raw = tags.get(key)
        if not raw:
            continue
        digits = "".join(ch for ch in raw if ch.isdigit() or ch == ".")
        if digits:
            try:
                return float(digits)
            except ValueError:
                continue
    return None


def ingest_dams(limit: int = 4000) -> dict:
    print("[dams] querying OSM Overpass for named dams in India ...")
    data = overpass(DAM_OVERPASS.format(bbox=_bbox_clause(INDIA)))
    elements = data.get("elements", [])
    print(f"[dams] {len(elements)} OSM dam features")

    existing = {r["name"].lower() for r in db.query("SELECT name FROM dam")}
    inserted = 0
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name or name.lower() in existing:
            continue
        lat, lon, coords = _centroid(el)
        if lat is None:
            continue
        # OSM height is metres only when tagged; otherwise leave it null.
        height = _dam_height(tags)
        capacity = None
        raw_cap = tags.get("capacity") or tags.get("reservoir:capacity")
        if raw_cap:
            digits = "".join(ch for ch in raw_cap if ch.isdigit() or ch == ".")
            try:
                capacity = float(digits)
            except ValueError:
                capacity = None
        row = {
            "name": name,
            "river": tags.get("waterway") if tags.get("waterway") != "dam" else tags.get("river"),
            "state": _dam_state(el),
            "country": "IN",
            "dam_type": None,
            "height_m": height,
            "storage_mcm": capacity,
            "purpose": tags.get("usage") or tags.get("amenity"),
            "registry_source": "osm",
            "ingest_status": "listed",
            "meta": {
                "osm_type": el.get("type"),
                "osm_id": el.get("id"),
                "tags": {k: v for k, v in tags.items() if k != "name"},
                "height_tagged": height is not None,
            },
        }
        try:
            db.execute(
                """INSERT INTO dam (name, river, state, country, location, height_m,
                                    storage_mcm, purpose, registry_source, ingest_status, meta)
                   VALUES (%s, %s, %s, %s,
                           ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s::jsonb)
                   ON CONFLICT DO NOTHING""",
                (row["name"], row["river"], row["state"], row["country"], lon, lat,
                 row["height_m"], row["storage_mcm"], row["purpose"],
                 row["registry_source"], row["ingest_status"], json.dumps(row["meta"])),
            )
            existing.add(name.lower())
            inserted += 1
        except Exception as exc:  # noqa: BLE001 - one bad row must not abort ingest
            print(f"[dams] skip {name!r}: {exc}")
        if inserted >= limit:
            break
    total = db.scalar("SELECT count(*) FROM dam")
    print(f"[dams] inserted {inserted}, total {total}")
    return {"inserted": inserted, "total": total, "osm": len(elements)}


def _centroid(el: dict) -> tuple[float | None, float | None, list | None]:
    if el.get("type") == "way" and el.get("geometry"):
        pts = [(p["lon"], p["lat"]) for p in el["geometry"]]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return sum(ys) / len(ys), sum(xs) / len(xs), pts
    if el.get("type") == "relation" and el.get("members"):
        pts = []
        for m in el["members"]:
            for c in m.get("geometry") or []:
                pts.append((c["lon"], c["lat"]))
        if pts:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return sum(ys) / len(ys), sum(xs) / len(xs), pts
    if "center" in el:
        return el["center"].get("lat"), el["center"].get("lon"), None
    if "lat" in el:
        return el.get("lat"), el.get("lon"), None
    return None, None, None


# -------------------------------------------------------------- rivers
# Curated list of Indian rivers: query Nominatim for the real OSM geometry and
# compute length/bbox from it. `basin`/`states` are hydrographic facts.
RIVERS: list[dict[str, Any]] = [
    {"q": "Ganga river India", "name": "Ganga", "alt": ["Ganges", "Bhagirathi"],
     "basin": "Ganga", "states": ["Uttarakhand", "Uttar Pradesh", "Bihar", "Jharkhand", "West Bengal"],
     "source": "Gangotri Glacier (Uttarakhand)", "mouth": "Ganga Sagar (West Bengal)",
     "rank": 1},
    {"q": "Yamuna river India", "name": "Yamuna", "alt": ["Jumna"],
     "basin": "Ganga", "states": ["Uttarakhand", "Haryana", "Delhi", "Uttar Pradesh"],
     "source": "Yamunotri Glacier (Uttarakhand)", "mouth": "Prayagraj (Uttar Pradesh)", "rank": 4},
    {"q": "Brahmaputra river India", "name": "Brahmaputra", "alt": ["Tsangpo", "Dihang"],
     "basin": "Brahmaputra", "states": ["Arunachal Pradesh", "Assam"],
     "source": "Chema-yungdung Glacier (Tibet)", "mouth": "Padma (Bangladesh)", "rank": 2},
    {"q": "Indus river", "name": "Indus", "alt": ["Sindhu"],
     "basin": "Indus", "states": ["Ladakh"],
     "source": "Senge Khabab (Tibet)", "mouth": "Arabian Sea (Pakistan)", "rank": 3},
    {"q": "Godavari river India", "name": "Godavari", "alt": ["Dakshin Ganga"],
     "basin": "Godavari", "states": ["Maharashtra", "Telangana", "Andhra Pradesh"],
     "source": "Trimbakeshwar (Maharashtra)", "mouth": "Bay of Bengal", "rank": 5},
    {"q": "Krishna river India", "name": "Krishna", "alt": [],
     "basin": "Krishna", "states": ["Maharashtra", "Karnataka", "Telangana", "Andhra Pradesh"],
     "source": "Mahabaleshwar (Maharashtra)", "mouth": "Bay of Bengal", "rank": 6},
    {"q": "Narmada river India", "name": "Narmada", "alt": [],
     "basin": "Narmada", "states": ["Madhya Pradesh", "Maharashtra", "Gujarat"],
     "source": "Amarkantak (Madhya Pradesh)", "mouth": "Arabian Sea", "rank": 7},
    {"q": "Kaveri river India", "name": "Kaveri", "alt": ["Cauvery"],
     "basin": "Kaveri", "states": ["Karnataka", "Tamil Nadu"],
     "source": "Talakaveri (Karnataka)", "mouth": "Palk Bay", "rank": 8},
    {"q": "Mahanadi river India", "name": "Mahanadi", "alt": [],
     "basin": "Mahanadi", "states": ["Chhattisgarh", "Odisha"],
     "source": "Sihawa (Chhattisgarh)", "mouth": "Bay of Bengal", "rank": 9},
    {"q": "Tapti river India", "name": "Tapti", "alt": ["Tapi"],
     "basin": "Tapti", "states": ["Maharashtra", "Madhya Pradesh", "Gujarat"],
     "source": "Multai (Madhya Pradesh)", "mouth": "Arabian Sea", "rank": 10},
    {"q": "Chambal river India", "name": "Chambal", "alt": [],
     "basin": "Ganga", "states": ["Madhya Pradesh", "Rajasthan", "Uttar Pradesh"],
     "source": "Vindhyachal (Madhya Pradesh)", "mouth": "Yamuna (Uttar Pradesh)"},
    {"q": "Ghaghara river India", "name": "Ghaghara", "alt": ["Karnali"],
     "basin": "Ganga", "states": ["Uttar Pradesh", "Bihar"],
     "source": "Nepal Himalaya", "mouth": "Ganga (Bihar)"},
    {"q": "Gandak river India", "name": "Gandak", "alt": ["Narayani"],
     "basin": "Ganga", "states": ["Bihar", "Uttar Pradesh"],
     "source": "Nepal Himalaya", "mouth": "Ganga (Bihar)"},
    {"q": "Kosi river India", "name": "Kosi", "alt": ["Sapta Koshi"],
     "basin": "Ganga", "states": ["Bihar"],
     "source": "Nepal Himalaya", "mouth": "Ganga (Bihar)"},
    {"q": "Son river India", "name": "Son", "alt": [],
     "basin": "Ganga", "states": ["Madhya Pradesh", "Uttar Pradesh", "Bihar"],
     "source": "Amarkantak (Madhya Pradesh)", "mouth": "Ganga (Bihar)"},
    {"q": "Betwa river India", "name": "Betwa", "alt": [],
     "basin": "Ganga", "states": ["Madhya Pradesh", "Uttar Pradesh"],
     "source": "Raisen (Madhya Pradesh)", "mouth": "Yamuna (Uttar Pradesh)"},
    {"q": "Ken river India", "name": "Ken", "alt": [],
     "basin": "Ganga", "states": ["Madhya Pradesh", "Uttar Pradesh"],
     "source": "Katni (Madhya Pradesh)", "mouth": "Yamuna (Uttar Pradesh)"},
    {"q": "Beas river India", "name": "Beas", "alt": [],
     "basin": "Indus", "states": ["Himachal Pradesh", "Punjab"],
     "source": "Rohtang Pass (Himachal Pradesh)", "mouth": "Sutlej (Punjab)"},
    {"q": "Ravi river India", "name": "Ravi", "alt": [],
     "basin": "Indus", "states": ["Himachal Pradesh", "Punjab"],
     "source": "Chamba (Himachal Pradesh)", "mouth": "Chenab (Pakistan)"},
    {"q": "Chenab river", "name": "Chenab", "alt": [],
     "basin": "Indus", "states": ["Jammu and Kashmir", "Ladakh"],
     "source": "Bara Lacha Pass (Himachal Pradesh)", "mouth": "Indus (Pakistan)"},
    {"q": "Jhelum river", "name": "Jhelum", "alt": [],
     "basin": "Indus", "states": ["Jammu and Kashmir"],
     "source": "Verinag (Jammu and Kashmir)", "mouth": "Chenab (Pakistan)"},
    {"q": "Sutlej river", "name": "Sutlej", "alt": ["Satluj"],
     "basin": "Indus", "states": ["Himachal Pradesh", "Punjab"],
     "source": "Rakshastal (Tibet)", "mouth": "Indus (Pakistan)"},
    {"q": "Teesta river India", "name": "Teesta", "alt": [],
     "basin": "Brahmaputra", "states": ["Sikkim", "West Bengal"],
     "source": "Tso Lhamo Lake (Sikkim)", "mouth": "Jamuna (Bangladesh)"},
    {"q": "Subansiri river India", "name": "Subansiri", "alt": [],
     "basin": "Brahmaputra", "states": ["Arunachal Pradesh", "Assam"],
     "source": "Tibet", "mouth": "Brahmaputra (Assam)"},
    {"q": "Lohit river India", "name": "Lohit", "alt": [],
     "basin": "Brahmaputra", "states": ["Arunachal Pradesh"],
     "source": "Tibet", "mouth": "Brahmaputra (Assam)"},
    {"q": "Dibang river India", "name": "Dibang", "alt": [],
     "basin": "Brahmaputra", "states": ["Arunachal Pradesh"],
     "source": "Tibet", "mouth": "Lohit (Arunachal Pradesh)"},
    {"q": "Barak river India", "name": "Barak", "alt": [],
     "basin": "Barak", "states": ["Manipur", "Assam"],
     "source": "Manipur Hills", "mouth": "Meghna (Bangladesh)"},
    {"q": "Manas river India", "name": "Manas", "alt": [],
     "basin": "Brahmaputra", "states": ["Assam"],
     "source": "Bhutan Himalaya", "mouth": "Brahmaputra (Assam)"},
    {"q": "Jaldhaka river India", "name": "Jaldhaka", "alt": [],
     "basin": "Brahmaputra", "states": ["West Bengal"],
     "source": "Sikkim Himalaya", "mouth": "Jamuna (Bangladesh)"},
    {"q": "Mandovi river India", "name": "Mandovi", "alt": ["Mahapushkarini"],
     "basin": "Mandovi", "states": ["Goa", "Karnataka"],
     "source": "Mahadev Hills (Goa)", "mouth": "Arabian Sea"},
    {"q": "Zuari river India", "name": "Zuari", "alt": ["Aldona"],
     "basin": "Zuari", "states": ["Goa"],
     "source": "Western Ghats (Goa)", "mouth": "Arabian Sea"},
    {"q": "Sharavathi river India", "name": "Sharavathi", "alt": [],
     "basin": "Sharavathi", "states": ["Karnataka"],
     "source": "Western Ghats (Karnataka)", "mouth": "Arabian Sea"},
    {"q": "Periyar river India", "name": "Periyar", "alt": [],
     "basin": "Periyar", "states": ["Kerala"],
     "source": "Western Ghats (Kerala)", "mouth": "Arabian Sea"},
    {"q": "Bharathapuzha river India", "name": "Bharathapuzha", "alt": ["Nila"],
     "basin": "Bharathapuzha", "states": ["Kerala"],
     "source": "Anamalai Hills", "mouth": "Arabian Sea"},
    {"q": "Vaigai river India", "name": "Vaigai", "alt": [],
     "basin": "Vaigai", "states": ["Tamil Nadu"],
     "source": "Megamalai (Tamil Nadu)", "mouth": "Palk Bay"},
    {"q": "Penna river India", "name": "Penna", "alt": ["Pinakini"],
     "basin": "Penna", "states": ["Karnataka", "Andhra Pradesh"],
     "source": "Nandi Hills (Karnataka)", "mouth": "Bay of Bengal"},
    {"q": "Mahan river India", "name": "Mahan", "alt": [],
     "basin": "Mahan", "states": ["Madhya Pradesh", "Odisha"],
     "source": "Satpura Range", "mouth": "Mahanadi (Odisha)"},
    {"q": "Damodar river India", "name": "Damodar", "alt": [],
     "basin": "Ganga", "states": ["Jharkhand", "West Bengal"],
     "source": "Chandwa (Jharkhand)", "mouth": "Hooghly (West Bengal)"},
    {"q": "Ajay river India", "name": "Ajay", "alt": [],
     "basin": "Ganga", "states": ["Jharkhand", "West Bengal", "Bihar"],
     "source": "Deoghar (Jharkhand)", "mouth": "Ganga (West Bengal)"},
    {"q": "Brahmaputra river Assam", "name": "Jamuna", "alt": ["Yamuna of Assam"],
     "basin": "Brahmaputra", "states": ["Assam"],
     "source": "Brahmaputra (Assam)", "mouth": "Meghna (Bangladesh)"},
]


def _pg_array(values: list[str] | None) -> str:
    """Postgres text[] literal.

    `db._adapt` JSON-encodes every Python list, so text[] columns must be
    passed as an explicit array literal with a `::text[]` cast.
    """
    items = [v for v in (values or []) if v]
    body = ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in items)
    return "{" + body + "}"


def _river_geometry(spec: dict[str, Any]) -> dict | None:
    """Real OSM geometry for a river.

    Nominatim answers differently depending on `featuretype`, and a long river
    arrives as a MultiLineString of many relation members (keeping only the
    longest member loses ~95% of the course). Several query variants are tried,
    each MultiLineString is chained into one line, and the longest wins.
    """
    name = spec["name"]
    terms = [spec["q"], name, f"{name} river"]
    terms.extend(spec.get("alt") or [])
    variants: list[dict[str, Any]] = []
    for term in terms:
        variants.append({"q": term, "format": "jsonv2", "polygon_geojson": 1,
                         "limit": 8, "featuretype": "river", "accept-language": "en"})
        variants.append({"q": term, "format": "jsonv2", "polygon_geojson": 1,
                         "limit": 8, "accept-language": "en"})

    best: dict | None = None
    best_km = 0.0
    seen: set[str] = set()
    for params in variants:
        key = f"{params['q']}|{bool(params.get('featuretype'))}"
        if key in seen:
            continue
        seen.add(key)
        try:
            rows = _json("https://nominatim.openstreetmap.org/search?"
                         + urllib.parse.urlencode(params))
        except Exception as exc:  # noqa: BLE001 - network boundary
            print(f"[rivers] {name}: nominatim failed ({exc})")
            time.sleep(NOMINATIM_GAP)
            continue
        time.sleep(NOMINATIM_GAP)
        for geom in _candidate_lines(rows):
            if not _in_india(geom["coordinates"]):
                continue  # e.g. "Penna" matched Pennsylvania, "Manas" a Russian river
            km = _length_km(geom["coordinates"])
            if km > best_km:
                best, best_km = geom, km
        # A 200 km+ answer is a real river, not a stub: later variants cannot
        # improve it, so stop spending rate-limit budget on this name.
        if best_km >= 200.0:
            break

    # Nominatim often returns only a polygon for a river relation; ask OSM
    # directly for the longest waterway way/relation with that name.
    if best_km < 50.0:
        q = f"""
[out:json][timeout:60];
(
  way["waterway"~"river|stream"]["name"="{name}"]{_bbox_clause(INDIA)};
  relation["waterway"="river"]["name"="{name}"]{_bbox_clause(INDIA)};
  way["name"="{name}"]["natural"="water"]{_bbox_clause(INDIA)};
);
out geom;
"""
        try:
            data = overpass(q, timeout=90)
            for el in data.get("elements", []):
                coords = _element_coords(el)
                if not coords or len(coords) < 2:
                    continue
                km = _length_km(coords)
                if km > best_km:
                    best, best_km = {"type": "LineString", "coordinates": coords}, km
        except Exception as exc:  # noqa: BLE001 - last source may be slow
            print(f"[rivers] {name}: overpass fallback failed ({exc})")
    if best is None:
        return None
    print(f"[rivers] {name}: best geometry {best_km:.1f} km "
          f"({len(best['coordinates'])} pts)")
    return best


def _in_india(coords: list[list[float]], pad: float = 0.5) -> bool:
    """Reject a same-named feature in another country.

    Nominatim matches by name globally: "Penna" resolves to Pennsylvania and
    "Manas" to a Russian river. A candidate must fall inside India's extent.
    """
    if not coords:
        return False
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    w, e = min(xs), max(xs)
    s, n = min(ys), max(ys)
    return (w >= INDIA[0] - pad and e <= INDIA[2] + pad
            and s >= INDIA[1] - pad and n <= INDIA[3] + pad)


def _candidate_lines(rows: list[dict]) -> list[dict]:
    """Turn every Nominatim geometry into a single LineString candidate."""
    out: list[dict] = []
    for row in rows:
        g = row.get("geojson")
        if not g:
            continue
        if g.get("type") == "LineString" and len(g["coordinates"]) >= 2:
            out.append(g)
        elif g.get("type") == "MultiLineString":
            chained = chain_lines([p for p in g["coordinates"] if len(p) >= 2])
            if chained:
                out.append({"type": "LineString", "coordinates": chained})
        elif g.get("type") in ("Polygon", "MultiPolygon"):
            # A river rendered as a closed ring still traces the banks.
            rings = ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"])
            for ring in rings:
                if ring and len(ring[0]) >= 2:
                    out.append({"type": "LineString", "coordinates": ring[0]})
    return out


def chain_lines(parts: list[list[list[float]]], max_gap_km: float = 8.0) -> list[list[float]]:
    """Order relation members into one continuous line by nearest endpoint.

    OSM river relations store the course as unordered member ways; this walks
    them end-to-end so the stored path covers the whole river instead of its
    single longest member.
    """
    if not parts:
        return []
    if len(parts) == 1:
        return list(parts[0])
    remaining = [list(p) for p in parts]
    # start from the longest part so the main stem anchors the chain
    chain = max(remaining, key=len)
    remaining.remove(chain)
    while remaining:
        tail = chain[-1]
        best_i, best_rev, best_d = -1, False, None
        for i, part in enumerate(remaining):
            for rev, end in ((False, part[0]), (True, part[-1])):
                d = _length_km([tail, end])
                if best_d is None or d < best_d:
                    best_i, best_rev, best_d = i, rev, d
        if best_i < 0 or (best_d is not None and best_d > max_gap_km):
            break  # gap too large: stop rather than teleport across the map
        nxt = remaining.pop(best_i)
        if best_rev:
            nxt = list(reversed(nxt))
        # drop a duplicated shared endpoint vertex
        if chain[-1] == nxt[0]:
            nxt = nxt[1:]
        chain.extend(nxt)
    return chain


def _element_coords(el: dict) -> list[list[float]] | None:
    if el.get("type") == "way" and el.get("geometry"):
        return [[p["lon"], p["lat"]] for p in el["geometry"]]
    if el.get("type") == "relation" and el.get("members"):
        parts = []
        for m in el["members"]:
            geo = m.get("geometry") or []
            if geo:
                parts.append([[p["lon"], p["lat"]] for p in geo])
        if parts:
            return max(parts, key=len)
    if el.get("center") and el.get("bounds"):
        b = el["bounds"]
        return [[b["minlon"], b["minlat"]], [b["maxlon"], b["maxlat"]]]
    return None


def ingest_rivers(limit: int = 60) -> dict:
    print(f"[rivers] resolving {min(limit, len(RIVERS))} rivers via Nominatim ...")
    inserted = 0
    failed: list[str] = []
    for spec in RIVERS[:limit]:
        name = spec["name"]
        if db.query_one("SELECT id FROM river WHERE name = %s", (name,)):
            continue
        geom = _river_geometry(spec)
        if geom is None:
            failed.append(name)
            print(f"[rivers] {name}: no line geometry from any source")
            continue

        coords = geom["coordinates"]
        if len(coords) < 2:
            failed.append(name)
            continue
        length_km = round(_length_km(coords), 1)
        bbox = _bbox_of(coords)
        try:
            db.execute(
                """INSERT INTO river (name, name_alt, kind, basin, states, source_name,
                                      mouth_name, length_km, bbox, path, source, rank,
                                      featured)
                   VALUES (%s, %s::text[], 'river', %s, %s::text[], %s, %s, %s,
                           ST_SetSRID(ST_MakeEnvelope(%s, %s, %s, %s), 4326),
                           ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 'osm', %s, %s)
                   ON CONFLICT DO NOTHING""",
                (name, _pg_array(spec.get("alt")), spec["basin"],
                 _pg_array(spec["states"]), spec["source"], spec["mouth"], length_km,
                 bbox[0], bbox[1], bbox[2], bbox[3],
                 json.dumps(geom), spec.get("rank"),
                 bool(spec.get("rank") and spec["rank"] <= 6)),
            )
            inserted += 1
            print(f"[rivers] {name}: {length_km} km, {len(coords)} pts, {spec['basin']}")
        except Exception as exc:  # noqa: BLE001 - one bad row must not abort ingest
            failed.append(name)
            print(f"[rivers] {name}: insert failed ({exc})")
    total = db.scalar("SELECT count(*) FROM river")
    print(f"[rivers] inserted {inserted}, total {total}, failed {len(failed)}")
    return {"inserted": inserted, "total": total, "failed": failed}


# ------------------------------------------------------------ glaciers
GLACIER_OVERPASS = """
[out:json][timeout:110];
(
  way["natural"="glacier"]["name"]{bbox};
  relation["natural"="glacier"]["name"]{bbox};
);
out geom;
"""


def ingest_glaciers(limit: int = 3000) -> dict:
    print("[glaciers] querying OSM for named glaciers in the Himalaya ...")
    try:
        data = overpass(GLACIER_OVERPASS.format(bbox=_bbox_clause(HIMALAYA)))
    except Exception as exc:  # noqa: BLE001 - skip this source, keep the rest
        print(f"[glaciers] source unavailable: {exc}")
        return {"inserted": 0, "error": str(exc)}
    elements = data.get("elements", [])
    print(f"[glaciers] {len(elements)} OSM glacier features")

    existing = {r["name"].lower() for r in db.query("SELECT name FROM glacier")}
    inserted = 0
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name or name.lower() in existing:
            continue
        lat, lon, coords = _centroid(el)
        if lat is None or lon is None:
            continue
        area_km2 = None
        bbox = None
        if coords and len(coords) > 2:
            # planar approximation is fine at Himalayan latitudes for a listing
            bbox = _bbox_of(coords)
            area_km2 = _shoelace_km2(coords)
        try:
            db.execute(
                """INSERT INTO glacier (name, state, district, area_km2, centroid, bbox, source, meta)
                   VALUES (%s, %s, %s, %s,
                           ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                           CASE WHEN %s IS NULL THEN NULL
                                ELSE ST_SetSRID(ST_MakeEnvelope(%s, %s, %s, %s), 4326) END,
                           'osm', %s::jsonb)
                   ON CONFLICT DO NOTHING""",
                (name, tags.get("addr:state") or _state_from_tags(tags), tags.get("addr:district"),
                 area_km2, lon, lat,
                 bbox, bbox[0], bbox[1], bbox[2], bbox[3],
                 json.dumps({"osm_type": el.get("type"), "osm_id": el.get("id"),
                             "tags": tags})),
            )
            existing.add(name.lower())
            inserted += 1
        except Exception as exc:  # noqa: BLE001
            print(f"[glaciers] skip {name!r}: {exc}")
        if inserted >= limit:
            break
    total = db.scalar("SELECT count(*) FROM glacier")
    print(f"[glaciers] inserted {inserted}, total {total}")
    return {"inserted": inserted, "total": total}


def _shoelace_km2(coords: list[list[float]]) -> float:
    area = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:] + coords[:1]):
        area += x1 * y2 - x2 * y1
    mean_lat = math.radians(sum(c[1] for c in coords) / len(coords))
    return abs(area) / 2.0 * (111.32 * math.cos(mean_lat)) * 110.57


def _state_from_tags(tags: dict[str, str]) -> str | None:
    for key in ("addr:state", "is_in:state", "state"):
        if tags.get(key):
            return tags[key]
    return None


# ---------------------------------------------------------- waterbodies
WATER_OVERPASS = """
[out:json][timeout:110];
(
  way["natural"="water"]["name"]["water"~"lake|reservoir"]{bbox};
  relation["type"="multipolygon"]["natural"="water"]["name"]{bbox};
);
out geom;
"""


def ingest_waterbodies(limit: int = 2000) -> dict:
    print("[waterbodies] querying OSM for named lakes/reservoirs in India ...")
    try:
        data = overpass(WATER_OVERPASS.format(bbox=_bbox_clause(INDIA)))
    except Exception as exc:  # noqa: BLE001 - skip this source, keep the rest
        print(f"[waterbodies] source unavailable: {exc}")
        return {"inserted": 0, "error": str(exc)}
    elements = data.get("elements", [])
    print(f"[waterbodies] {len(elements)} OSM water features")

    existing = {r["name"].lower() for r in db.query("SELECT name FROM waterbody")}
    inserted = 0
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name or name.lower() in existing:
            continue
        rings = _rings(el)
        if not rings or len(rings[0]) < 4:
            continue
        area_km2 = _shoelace_km2(rings[0])
        if area_km2 < 0.05:  # ponds below 0.05 km2 are noise for this platform
            continue
        bbox = _ring_bbox(rings)
        wkt = json.dumps({"type": "Polygon", "coordinates": rings})
        centroid = rings[0][0]
        kind = "reservoir" if (tags.get("water") == "reservoir"
                               or tags.get("dam")) else "lake"
        try:
            db.execute(
                """INSERT INTO waterbody (name, kind, state, area_km2, centroid, bbox, geom,
                                          source, meta)
                   VALUES (%s, %s, %s, %s,
                           ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                           ST_SetSRID(ST_MakeEnvelope(%s, %s, %s, %s), 4326),
                           ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                           'osm', %s::jsonb)
                   ON CONFLICT DO NOTHING""",
                (name, kind, _state_from_tags(tags), round(area_km2, 3),
                 sum(p[0] for p in rings[0]) / len(rings[0]),
                 sum(p[1] for p in rings[0]) / len(rings[0]),
                 bbox[0], bbox[1], bbox[2], bbox[3], wkt,
                 json.dumps({"osm_type": el.get("type"), "osm_id": el.get("id"),
                             "perimeter_km": round(_length_km(rings[0]), 2),
                             "tags": tags})),
            )
            existing.add(name.lower())
            inserted += 1
        except Exception as exc:  # noqa: BLE001
            print(f"[waterbodies] skip {name!r}: {exc}")
        if inserted >= limit:
            break
    total = db.scalar("SELECT count(*) FROM waterbody")
    print(f"[waterbodies] inserted {inserted}, total {total}")
    return {"inserted": inserted, "total": total}


def _rings(el: dict) -> list[list[list[float]]]:
    if el.get("type") == "way" and el.get("geometry"):
        pts = [[p["lon"], p["lat"]] for p in el["geometry"]]
        if pts and pts[0] != pts[-1]:
            pts.append(list(pts[0]))
        return [pts]
    if el.get("type") == "relation" and el.get("members"):
        outer, holes = [], []
        for m in el["members"]:
            if m.get("type") != "way" or not m.get("geometry"):
                continue
            pts = [[p["lon"], p["lat"]] for p in m["geometry"]]
            if pts and pts[0] != pts[-1]:
                pts.append(list(pts[0]))
            if len(pts) < 4:
                continue
            (holes if m.get("role") == "inner" else outer).append(pts)
        if outer:
            return [max(outer, key=len), *holes]
    return []


# ------------------------------------------------- river <-> dam linking
def link_river_dams() -> dict:
    """river_dam_ref: every dam inside the river corridor, with chainage."""
    rivers = db.query(
        "SELECT id, name, path, ST_AsGeoJSON(bbox) AS bbox_geojson FROM river "
        "WHERE path IS NOT NULL"
    )
    for river in rivers:
        raw = river.pop("bbox_geojson", None)
        try:
            river["bbox"] = json.loads(raw)["coordinates"] if raw else None
        except Exception:  # noqa: BLE001 - corrupt bbox just means "no spatial filter"
            river["bbox"] = None
    dams = db.query(
        "SELECT id, name, state, registry_source, location, "
        "ST_X(location) lon, ST_Y(location) lat FROM dam WHERE location IS NOT NULL"
    )
    total = 0
    for river in rivers:
        if not river.get("bbox"):
            continue
        # wipe and rebuild this river's ref list so re-runs are idempotent
        db.execute("DELETE FROM river_dam_ref WHERE river_id = %s", (river["id"],))
        inside = [
            d for d in dams
            if _within_bbox(float(d["lon"]), float(d["lat"]), river["bbox"])
        ]
        if not inside:
            continue
        pts = _line_points(river)
        for dam in inside:
            chain_km = _chainage(dam["lon"], dam["lat"], pts) if pts else None
            status = "in_db" if dam.get("id") else "missing"
            try:
                db.execute(
                    """INSERT INTO river_dam_ref (river_id, dam_id, name, state,
                                                  distance_km, registry_source, status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (river_id, name) DO UPDATE SET
                         dam_id = EXCLUDED.dam_id, distance_km = EXCLUDED.distance_km,
                         status = EXCLUDED.status""",
                    (river["id"], dam["id"], dam["name"], dam["state"],
                     round(chain_km, 2) if chain_km is not None else None,
                     dam.get("registry_source") or "osm", status),
                )
                total += 1
            except Exception as exc:  # noqa: BLE001
                print(f"[link] {river['name']}/{dam['name']}: {exc}")
        db.execute("UPDATE river SET major_dam_count = "
                   "(SELECT count(*) FROM river_dam_ref WHERE river_id = %s) "
                   "WHERE id = %s", (river["id"], river["id"]))
    print(f"[link] {total} river-dam refs across {len(rivers)} rivers")
    return {"refs": total, "rivers": len(rivers)}


def _within_bbox(lon: float, lat: float, ring: list | None) -> bool:
    """True when the point falls in the river bbox (1 deg tolerance).

    `bbox` is a Polygon, so `ST_AsGeoJSON` nests it as [ring]; accept both the
    ring and the ring-wrapped form.
    """
    if not ring:
        return False
    if isinstance(ring[0][0], (list, tuple)):
        ring = ring[0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs) - 0.05 <= lon <= max(xs) + 0.05 and min(ys) - 0.05 <= lat <= max(ys) + 0.05


def _line_points(river: dict) -> list[list[float]] | None:
    try:
        from modules.db import client as _db  # noqa: PLC0415

        row = _db.query_one(
            "SELECT ST_AsGeoJSON(path) AS g FROM river WHERE id = %s", (river["id"],)
        )
        if not row or not row.get("g"):
            return None
        geom = json.loads(row["g"])
        if geom.get("type") == "LineString":
            return geom["coordinates"]
        if geom.get("type") == "MultiLineString":
            return max(geom["coordinates"], key=len)
    except Exception:  # noqa: BLE001
        return None
    return None


def _chainage(lon: float, lat: float, pts: list[list[float]]) -> float | None:
    """Distance along `pts` to the nearest vertex (km)."""
    best, cum = None, 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        seg = _length_km([[x1, y1], [x2, y2]])
        # project the point onto the segment
        px, py = lon, lat
        denom = (x2 - x1) ** 2 + (y2 - y1) ** 2
        t = 0.0 if denom == 0 else max(0.0, min(1.0, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / denom))
        qx, qy = x1 + t * (x2 - x1), y1 + t * (y2 - y1)
        d = _length_km([[qx, qy], [px, py]])
        if best is None or d < best[0]:
            best = (d, cum + seg * t)
        cum += seg
    if best is None or best[0] > 0.6:  # >600 m off the line: not on this river
        return None
    return best[1]


# ------------------------------------------------------------ corridor rows
def seed_corridor_datasets() -> dict:
    """Register the six corridor datasets as `missing` until a corridor is prepared."""
    rivers = db.query("SELECT id FROM river WHERE featured = true OR rank IS NOT NULL")
    made = 0
    kinds = [
        ("dem", "DEM (30m)", "Copernicus GLO-90/DLR"),
        ("imagery_s2", "Sentinel-2 Imagery", "ESA Copernicus / GEE"),
        ("sar_s1", "SAR (Sentinel-1)", "ESA Copernicus / GEE"),
        ("dams", "Dam Registry", "OSM / CWC / GeoDAR"),
        ("osm", "OSM Infrastructure", "OpenStreetMap"),
        ("worldpop", "WorldPop (Population)", "WorldPop / University of Southampton"),
    ]
    for river in rivers:
        row = db.query_one("SELECT id FROM corridor WHERE river_id = %s", (river["id"],))
        if not row:
            row = db.query_one(
                "INSERT INTO corridor (river_id, status) VALUES (%s, 'draft') RETURNING id",
                (river["id"],))
        if not row:
            continue
        for kind, label, source in kinds:
            db.execute(
                """INSERT INTO corridor_dataset (corridor_id, kind, label, source,
                                                 coverage_pct, status)
                   VALUES (%s, %s, %s, %s, 0, 'missing')
                   ON CONFLICT (corridor_id, kind) DO NOTHING""",
                (row["id"], kind, label, source),
            )
        made += 1
    print(f"[corridor] seeded dataset manifests for {made} rivers")
    return {"rivers": made}


# ----------------------------------------------------------------- runner
def main(argv: list[str]) -> int:
    tasks = argv[1:] or ["all"]
    if "all" in tasks:
        tasks = ["dams", "rivers", "glaciers", "waterbodies", "link", "corridor"]
    results = {}
    if "dams" in tasks:
        results["dams"] = ingest_dams()
    if "rivers" in tasks:
        results["rivers"] = ingest_rivers()
    if "glaciers" in tasks:
        results["glaciers"] = ingest_glaciers()
    if "waterbodies" in tasks:
        results["waterbodies"] = ingest_waterbodies()
    if "link" in tasks:
        results["link"] = link_river_dams()
    if "corridor" in tasks:
        results["corridor"] = seed_corridor_datasets()
    print("\n=== ingest summary ===")
    print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
