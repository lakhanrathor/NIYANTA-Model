"""discover — the spine: river search → corridor → dam gap analysis → prepare.

Search is two explicit tiers, never one blended call:
  1. `search()` — the local `river` table only (trigram match on the ingested
     OSM/HydroRIVERS paths). Milliseconds, no socket. This is what a keystroke
     hits.
  2. `search_world()` — the same table first, then Nominatim/Overpass, and a
     hit is written back so the next search for that name is local.

  3. none → the candidate is name-only; corridor prepare derives the path from
     the DEM (steepest descent) once tiles exist

`river.prepare` is the only job here. It is deliberately idempotent: every
sub-step checks what is already cached and only fetches what is missing.
"""

from __future__ import annotations

import json
import math
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from loguru import logger

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobCancelled, JobContext, JobPaused, add_job, register

USER_AGENT = "Niyanta/1.0 (SIH26161 dam-break modelling)"
OVERPASS = "https://overpass-api.de/api/interpreter"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
NET_TIMEOUT = 25
# Search is interactive: a slow upstream must degrade, not hang the request.
SEARCH_TIMEOUT = 8
Progress = Callable[[int, str], None] | None


# ---------------------------------------------------------------- search

def search(q: str, limit: int = 10) -> list[dict[str, Any]]:
    """Local catalogue only — the interactive path never opens a socket.

    Rows are deliberately geometry-free: a result is clicked before anything is
    drawn, and `GET /rivers/{id}` supplies the path for the one river selected.
    Shipping the paths here costs ~200 KB per hit for data the list never shows.
    """
    q = (q or "").strip()
    if not q:
        return []
    rows = db.query(
        """SELECT id, name, state, states, basin, kind, source, length_km,
                  major_dam_count, prepared_at
           FROM river
           WHERE name LIKE %s
              OR (name_alt IS NOT NULL AND EXISTS (
                     SELECT 1 FROM json_each(name_alt) je
                     WHERE je.value LIKE %s))
           ORDER BY length_km DESC NULLS LAST LIMIT %s""",
        (f"%{q}%", f"%{q}%", limit),
    )
    return [shape_search_row(r) for r in rows]


def shape_search_row(row: dict[str, Any]) -> dict[str, Any]:
    """Compact catalogue row: identity and stats, no geometry, no source detail."""
    return {
        "id": str(row["id"]) if row.get("id") else None,
        "name": row.get("name"),
        "state": row.get("state"),
        "states": row.get("states") or [],
        "basin": row.get("basin"),
        "kind": row.get("kind"),
        "source": row.get("source"),
        "length_km": row.get("length_km"),
        "major_dam_count": row.get("major_dam_count") or 0,
        "prepared_at": row.get("prepared_at"),
        "path": None,
        "geometry": None,
        "bbox": None,
    }


def search_world(q: str, limit: int = 10) -> list[dict[str, Any]]:
    """Explicit online tier: catalogue → Nominatim/Overpass → write back.

    Only the Discover screen's "search the whole world" button calls this, so a
    slow upstream costs the user one deliberate click instead of every keystroke.
    A fetched river is persisted, so the next search for that name is local.
    """
    q = (q or "").strip()
    if not q:
        return []
    local = search(q, limit)
    if local:
        return [{**row, "cached": True} for row in local]

    found: list[dict[str, Any]] = []
    for fetch in (nominatim_rivers, overpass_rivers):
        found = [c for c in fetch(q, limit) if c.get("path")]
        if found:
            break

    out: list[dict[str, Any]] = []
    for cand in found:
        saved = create_river(cand)
        out.append({**shape_search_row(saved), "cached": False})
        if len(out) >= limit:
            break
    if out:
        return out
    # Nothing on the wire either: hand back an unsaved name-only candidate so
    # the screen can say plainly that this river is not in the catalogue.
    return [{**_name_only(q), "cached": False}]


def shape_river(row: dict[str, Any]) -> dict[str, Any]:
    """Row → API shape: geometry as GeoJSON, ids as str."""
    raw = row.pop("path_geojson", None)
    path = json.loads(raw) if raw else None
    if path is None and isinstance(row.get("path"), (bytes, memoryview)):
        path = json.loads(_as_geojson(row["path"]))
    bbox = _bbox(path)
    if bbox is None and isinstance(row.get("bbox"), (bytes, memoryview)):
        try:
            box = json.loads(_as_geojson(row["bbox"]))
            bbox = [round(v, 5) for v in _bbox(box)] if box else None
        except Exception:  # noqa: BLE001 - corrupt bbox degrades to null
            bbox = None
    return {
        "id": str(row["id"]) if row.get("id") else None,
        "name": row["name"],
        "state": row.get("state"),
        "states": row.get("states") or [],
        "basin": row.get("basin"),
        "kind": row.get("kind"),
        "source": row["source"],
        "source_name": row.get("source_name"),
        "mouth_name": row.get("mouth_name"),
        "length_km": row.get("length_km"),
        "drainage_km2": row.get("drainage_km2"),
        "major_dam_count": row.get("major_dam_count") or 0,
        "rank": row.get("rank"),
        "featured": bool(row.get("featured")),
        "prepared_at": row.get("prepared_at"),
        "path": path,
        "geometry": path,
        "bbox": bbox,
        "osm_id": row.get("osm_id"),
        "thumbnail": row.get("thumb"),
    }


def nominatim_rivers(q: str, limit: int) -> list[dict[str, Any]]:
    """Nominatim first: one light request, usually returns the river geometry
    directly as a LineString/MultiLineString (much cheaper than an Overpass
    geom dump, which is what times out on big rivers)."""
    try:
        url = (
            f"{NOMINATIM}?q={urllib.parse.quote(q)}"
            "&format=jsonv2&polygon_geojson=1&limit=5&featuretype=river"
            "&accept-language=en"
        )
        elements = json.loads(_get(url))
    except Exception as exc:  # noqa: BLE001 - network boundary
        logger.warning("nominatim search failed for {}: {}", q, exc)
        return []

    out: list[dict[str, Any]] = []
    for el in elements:
        if not _is_water_feature(el):
            continue
        geo = el.get("geojson") or {}
        path = _geojson_to_path(geo)
        name = el.get("name") or el.get("display_name", "").split(",")[0].strip() or q
        if name.lower() in {c["name"].lower() for c in out}:
            continue
        # Nominatim also returns unrelated specks with the same name (a well,
        # an island). A real river path spans at least ~1 km.
        if path and _length_km(path) < 1.0:
            continue
        if not path and not _bbox_from(el):
            continue
        out.append(
            {
                "id": None,
                "name": name,
                "state": _state_from(el.get("display_name")),
                "source": "osm",
                "length_km": _length_km(path) if path else None,
                "prepared_at": None,
                "path": path,
                "bbox": _bbox(path) if path else _bbox_from(el),
                "osm_id": _osm_id(el.get("osm_id")),
            }
        )
        if len(out) >= limit:
            break
    return out


_WATER_CATEGORIES = {"waterway", "water", "natural"}


def _is_water_feature(el: dict[str, Any]) -> bool:
    """Nominatim ignores featuretype for many queries, so a river search also
    returns towns/peaks named the same. Keep only waterway/water hits."""
    if (el.get("category") or el.get("class")) in _WATER_CATEGORIES:
        return True
    return (el.get("type") or "") in ("river", "stream", "canal", "riverbank")


def _geojson_to_path(geo: dict[str, Any]) -> dict[str, Any] | None:
    kind = geo.get("type")
    if kind == "LineString":
        return {"type": "LineString", "coordinates": [list(map(float, c)) for c in geo["coordinates"]]}
    if kind == "MultiLineString":
        longest = max(geo["coordinates"], key=len)
        return {"type": "LineString", "coordinates": [list(map(float, c)) for c in longest]}
    if kind == "Polygon":
        ring = geo["coordinates"][0]
        return {"type": "LineString", "coordinates": [list(map(float, c)) for c in ring]}
    if kind == "MultiPolygon":
        ring = geo["coordinates"][0][0]
        return {"type": "LineString", "coordinates": [list(map(float, c)) for c in ring]}
    return None


def _bbox_from(el: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bb = el.get("boundingbox")
    if not bb or len(bb) != 4:
        return None
    try:
        s, n, w, e = (float(v) for v in bb)
        return (w, s, e, n)
    except (TypeError, ValueError):
        return None


def _state_from(display_name: str | None) -> str | None:
    if not display_name:
        return None
    parts = [p.strip() for p in display_name.split(",")]
    return parts[1] if len(parts) > 1 else None


def _osm_id(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        return int(str(raw).split("/")[-1])
    except (TypeError, ValueError):
        return None


def overpass_rivers(q: str, limit: int) -> list[dict[str, Any]]:
    """Named river ways from OSM. Name-only if the network is unreachable."""
    query = f"""
[out:json][timeout:10];
(
  way["waterway"="river"]["name"~"^{_escape(q)}$",i];
  relation["waterway"="river"]["name"~"^{_escape(q)}$",i];
);
out geom;
"""
    try:
        payload = _post(OVERPASS, {"data": query}, timeout=SEARCH_TIMEOUT)
        elements = json.loads(payload).get("elements", [])
    except Exception as exc:  # noqa: BLE001 - network boundary
        logger.warning("overpass search failed for {}: {}", q, exc)
        return []

    rivers: list[dict[str, Any]] = []
    for el in elements:
        path = _element_path(el)
        if not path or len(path["coordinates"]) < 2:
            continue
        rivers.append(
            {
                "id": None,
                "name": (el.get("tags") or {}).get("name", q),
                "state": None,
                "source": "osm",
                "length_km": _length_km(path),
                "prepared_at": None,
                "path": path,
                "bbox": _bbox(path),
                "osm_id": el.get("id"),
            }
        )
    rivers.sort(key=lambda r: -(r["length_km"] or 0))
    return rivers[:limit] or ([_name_only(q)] if q else [])


def _name_only(q: str) -> dict[str, Any]:
    return {
        "id": None,
        "name": q,
        "state": None,
        "source": "name",
        "length_km": None,
        "prepared_at": None,
        "path": None,
        "bbox": None,
    }


def _element_path(el: dict[str, Any]) -> dict[str, Any] | None:
    geom = el.get("geometry")
    if not geom:
        return None
    coords = [[float(p["lon"]), float(p["lat"])] for p in geom if "lon" in p and "lat" in p]
    if len(coords) < 2:
        return None
    return {"type": "LineString", "coordinates": coords}


def _escape(text: str) -> str:
    return "".join(c for c in text if c.isalnum() or c in " _-").strip() or "a"


# ---------------------------------------------------------------- ingest

def create_river(body: dict[str, Any]) -> dict[str, Any]:
    """Confirm a candidate → `river` row (path optional until prepare)."""
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("name required")
    path = body.get("path")
    bbox = body.get("bbox") or (_bbox(path) if path else None)
    source = body.get("source") or ("osm" if path else "name")

    existing = db.query_one("SELECT * FROM river WHERE name ILIKE %s", (name,))
    if existing:
        return shape_river({**existing, "path_geojson": _as_geojson(existing.get("path"))})

    row = db.query_one(
        """INSERT INTO river (name, source, osm_id, path, bbox, length_km)
           VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326),
                   CASE WHEN %s THEN ST_MakeEnvelope(%s, %s, %s, %s, 4326) END, %s)
           RETURNING *""",
        (
            name, source, body.get("osm_id"),
            _wkt(path),
            bbox is not None,
            *(bbox or (0, 0, 0, 0)),
            body.get("length_km"),
        ),
    )
    assert row
    return shape_river({**row, "path_geojson": _as_geojson(row.get("path"))})


def get_river(river_id: str) -> dict[str, Any] | None:
    """One river's identity + geometry. Corridor and dams are their own
    endpoints: they move with the buffer slider, this row does not."""
    row = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not row:
        return None
    return shape_river({**row, "path_geojson": _as_geojson(row.get("path"))})


def river_dams(river_id: str, buffer_km: float | None = None) -> list[dict[str, Any]]:
    """Dams for this river: everything inside the corridor, plus every curated
    `river_dam_ref` link.

    Two memberships are deliberately merged. The curated registry is what
    "43 major dams" means to a user (the linked dams average ~180 km from the
    main stem — they are tributary dams, and a corridor test would hide them),
    while the spatial corridor is what the DEM and imagery tiles actually cover.
    Each row carries `in_corridor` so the UI can show both without pretending
    the corridor is bigger than it is.

    Membership is spatial: a dam belongs to the corridor when its point lies
    within `buffer_km` of the river path, measured on `geography` (real metres —
    `geometry` would treat the value as degrees and swallow every dam in India).

    `distance_km` is chainage from source: the curated link's stored value when
    there is one, otherwise the dam projected onto the path
    (`ST_LineLocatePoint`), falling back to the great-circle distance to the
    start point for a dam upstream of the recorded start.
    """
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not river:
        return []
    if not river.get("path"):
        # No geometry means no corridor to test against: the curated list is
        # the whole answer, and marking it all "in corridor" keeps the UI from
        # graying out every row.
        return [{**d, "in_corridor": True} for d in _registry_dams(river_id)]
    if buffer_km is None:
        corr = db.query_one(
            "SELECT buffer_m FROM corridor WHERE river_id = %s", (river_id,))
        buffer_km = float(corr["buffer_m"]) / 1000 if corr and corr.get("buffer_m") else 20.0

    rows = _corridor_dam_rows(river, buffer_km)
    inside = [_river_dam_row(r) for r in rows]
    for row in inside:
        row["in_corridor"] = True
    inside_ids = {dam_key(r) for r in inside}
    out = list(inside)
    for row in _registry_dams(river_id):
        if dam_key(row) in inside_ids:
            continue  # already listed with its corridor measurements
        row["in_corridor"] = False
        out.append(row)
    # Corridor first — that is the set the map and the DEM cover — then the
    # curated dams that are still part of this river.
    out.sort(key=lambda r: (not r["in_corridor"], r["distance_km"] is None, r["distance_km"] or 0))
    if any(r["distance_km"] is None and r.get("id") for r in out):
        # The registry records chainage for only ~2 of 43 Ganga links, and a
        # Distance column full of dashes reads as broken data.
        chain = _curated_chainage(river_id)
        for r in out:
            if r["distance_km"] is None and r.get("id") in chain:
                r["distance_km"] = chain[r["id"]]
    return out


def _corridor_dam_rows(river: dict[str, Any], buffer_km: float) -> list[dict[str, Any]]:
    """Spatial corridor membership: dams within `buffer_km` of the river path.

    The old SQL leaned on PostGIS (ST_Expand / && / ST_DWithin / ST_LineLocatePoint
    over `geography`). Geometry is GeoJSON text now, so the same stages run in
    Python: bbox prune in degrees, metres via a local AEQD frame (pyproj), then
    chainage by planar projection onto the path — the same planar
    `ST_LineLocatePoint` semantics as before. The stored length is what the UI
    already reports; `_length_km` only covers a river with no recorded length.
    """
    from pyproj import CRS, Transformer
    from shapely.geometry import Point, shape as shapely_shape
    from shapely.ops import transform as shapely_transform

    path = json.loads(_as_geojson(river.get("path")) or "null")
    if not path:
        return []
    line = shapely_shape(path)
    if line.is_empty or not line.length:
        return []
    # Cheap degree-space prune first. One degree of longitude bottoms out near
    # 88 km at India's northern edge — 80 km/deg overstates the metre distance,
    # so every dam past this test stays a candidate for the exact frame below.
    w, s, e, n = line.bounds
    tol = buffer_km * 1000.0 / 80000.0
    env = (w - tol, s - tol, e + tol, n + tol)
    len_m = float(river["length_km"]) * 1000.0 if river.get("length_km") else _length_km(path) * 1000.0

    rows = db.query(
        """SELECT d.id, d.name, d.state, d.dam_type, d.height_m, d.meta, d.location,
                  rr.status AS link_status, rr.distance_km AS link_km
           FROM dam d
           LEFT JOIN river_dam_ref rr ON rr.dam_id = d.id AND rr.river_id = %s
           WHERE d.location IS NOT NULL""",
        (river["id"],),
    )
    cand: list[tuple[dict[str, Any], Any]] = []
    for r in rows:
        try:
            obj = json.loads(r["location"]) if isinstance(r["location"], (str, bytes, bytearray)) else r["location"]
            pt = shapely_shape(obj)
            if pt.is_empty:
                continue
        except (ValueError, TypeError, KeyError):
            continue
        if env[0] <= pt.x <= env[2] and env[1] <= pt.y <= env[3]:
            cand.append((r, pt))
    if not cand:
        return []

    lon0, lat0 = (w + e) / 2.0, (s + n) / 2.0
    aeqd = CRS.from_proj4(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m +no_defs")
    fwd = Transformer.from_crs("EPSG:4326", aeqd, always_xy=True)
    line_m = shapely_transform(fwd.transform, line)
    xs, ys = fwd.transform([pt.x for _, pt in cand], [pt.y for _, pt in cand])
    buffer_m = buffer_km * 1000.0
    start = line.interpolate(0.0)
    out: list[dict[str, Any]] = []
    for (r, pt), x, y in zip(cand, xs, ys):
        gap_m = line_m.distance(Point(x, y))
        if gap_m > buffer_m:
            continue
        frac = line.project(pt) / line.length
        # Distance from source. The projection only works where the dam sits
        # between the path's endpoints; a dam upstream of the recorded start
        # projects to 0, so fall back to the great-circle distance to that
        # endpoint rather than reporting "0.0 km".
        proj_km = _hav_km(pt.x, pt.y, start.x, start.y) if frac <= 0 else len_m / 1000.0 * min(frac, 1.0)
        out.append({
            "id": r["id"], "name": r["name"], "state": r["state"],
            "dam_type": r["dam_type"], "height_m": r["height_m"], "meta": r["meta"],
            "lon": pt.x, "lat": pt.y,
            "link_status": r["link_status"], "link_km": r["link_km"],
            "gap_m": gap_m, "frac": frac, "proj_km": proj_km,
        })
    out.sort(key=lambda row: row["frac"])
    return out


def dam_key(dam: dict[str, Any]) -> str:
    """Identity for merging the curated list with the spatial result."""
    return str(dam["id"]) if dam.get("id") else f"n:{dam.get('name')}"


def _curated_chainage(river_id: str) -> dict[str, float]:
    """Distance from source for curated dams whose registry row recorded none.

    Projects each onto the path with `ST_LineLocatePoint` — planar work only,
    so ~40 dams cost tens of milliseconds instead of the ~2 ms per dam a
    geography cast would take. Falls back to the great-circle distance to the
    path's start for a dam that projects upstream of it.
    """
    rows = db.query(
        """SELECT COALESCE(d.id, rr.dam_id) AS id, d.location
           FROM river_dam_ref rr
           LEFT JOIN dam d ON d.id = rr.dam_id
           WHERE rr.river_id = %s AND d.location IS NOT NULL""",
        (river_id,),
    )
    river = db.query_one(
        "SELECT path, COALESCE(length_km, 0) * 1000.0 AS len_m FROM river WHERE id = %s",
        (river_id,),
    )
    if not river or not river.get("path"):
        return {}
    from shapely.geometry import shape as shapely_shape

    line = shapely_shape(json.loads(_as_geojson(river["path"])))
    if line.is_empty or not line.length:
        return {}
    start = line.interpolate(0.0)
    len_m = float(river.get("len_m") or 0.0)
    out: dict[str, float] = {}
    for r in rows:
        if not r.get("id") or not r.get("location"):
            continue
        try:
            pt = shapely_shape(json.loads(_as_geojson(r["location"])))
            frac = line.project(pt) / line.length
            km = _hav_km(pt.x, pt.y, start.x, start.y) if frac <= 0 else len_m / 1000.0 * min(frac, 1.0)
        except (ValueError, TypeError, AttributeError):
            continue
        out[str(r["id"])] = round(float(km), 1)
    return out


def _registry_dams(river_id: str) -> list[dict[str, Any]]:
    """The curated `river_dam_ref` link for this river.

    Corridor prepare walks this list (not the spatial corridor) so a narrow
    slider width never shrinks the set of dams whose DEM tiles get fetched.
    Also the source for a river imported without path geometry.
    """
    rows = db.query(
        """SELECT COALESCE(d.id, rr.dam_id) AS id,
                  COALESCE(d.name, rr.name) AS name,
                  COALESCE(d.state, rr.state) AS state,
                  d.dam_type, d.height_m, d.meta,
                  ST_X(d.location) AS lon, ST_Y(d.location) AS lat,
                  rr.status AS link_status, rr.distance_km AS link_km,
                  NULL::float AS gap_m, NULL::float AS frac, NULL::float AS proj_km
           FROM river_dam_ref rr LEFT JOIN dam d ON d.id = rr.dam_id
           WHERE rr.river_id = %s ORDER BY rr.distance_km NULLS LAST, rr.name""",
        (river_id,),
    )
    return [_river_dam_row(r) for r in rows]


def _river_dam_row(row: dict[str, Any]) -> dict[str, Any]:
    distance = row.get("link_km")
    if distance is None and row.get("proj_km") is not None:
        distance = round(float(row["proj_km"]), 1)
    meta = row.get("meta") or {}
    return {
        "id": str(row["id"]) if row.get("id") else None,
        "name": row.get("name"),
        "state": row.get("state"),
        "dam_type": row.get("dam_type"),
        "height_m": row.get("height_m"),
        # `in_db` means we hold the dam record; the curated link supplies its own
        # status when it has one. `missing` stays reserved for a registry cross-check.
        "status": row.get("link_status") or "in_db",
        "distance_km": distance,
        "gap_km": (round(row["gap_m"] / 1000, 2) if row.get("gap_m") is not None else None),
        "in_corridor": bool(row.get("in_corridor")),
        "lat": row.get("lat"),
        "lon": row.get("lon"),
        "cwc_id": meta.get("cwc_id") or meta.get("id"),
    }


def corridor_polygon(river_id: str, buffer_km: float) -> dict[str, Any] | None:
    """Buffer polygon around the river path — the corridor the slider controls."""
    # One buffer, reused for both the polygon and its area: buffering a
    # 1900 km line twice was ~500 ms of every corridor request. The buffer runs
    # in a local AEQD frame (metres on the ground) and the area is measured
    # geodesically on the ellipsoid — the same job ST_Buffer(...geography) /
    # ST_Area did.
    row = db.query_one(
        "SELECT path FROM river WHERE id = %s AND path IS NOT NULL", (river_id,))
    if not row or not row.get("path"):
        return None
    from pyproj import CRS, Geod, Transformer
    from shapely.geometry import mapping, shape as shapely_shape
    from shapely.ops import transform as shapely_transform

    line = shapely_shape(json.loads(_as_geojson(row["path"])))
    if line.is_empty:
        return None
    w, s, e, n = line.bounds
    lon0, lat0 = (w + e) / 2.0, (s + n) / 2.0
    aeqd = CRS.from_proj4(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m +no_defs")
    fwd = Transformer.from_crs("EPSG:4326", aeqd, always_xy=True)
    inv = Transformer.from_crs(aeqd, "EPSG:4326", always_xy=True)
    poly_m = shapely_transform(fwd.transform, line).buffer(buffer_km * 1000.0, resolution=8)
    poly = shapely_transform(inv.transform, poly_m)
    area_m2, _ = Geod(ellps="WGS84").geometry_area_perimeter(poly)
    return {
        "river_id": river_id,
        "buffer_km": buffer_km,
        "area_km2": round(abs(float(area_m2)) / 1e6, 1),
        "geometry": json.loads(json.dumps(mapping(poly))),
    }


def dam_gap(river_id: str, buffer_km: float | None = None) -> list[dict[str, Any]]:
    """Gap analysis: corridor dams that lack a cached DEM tile.

    Scoped to the corridor width, not the curated registry: a narrow slider
    prepares only the dams the corridor can actually see, so re-preparing at
    1 km costs less work than at 20 km. Dams outside the width are left alone
    (they keep whatever DEM they already have) and simply are not counted.
    """
    out = []
    for dam in river_dams(river_id, buffer_km):
        if not dam.get("in_corridor"):
            continue
        if not (dam.get("lon") and dam.get("lat")):
            continue
        bbox = _point_bbox(dam["lon"], dam["lat"])
        names: list[str] = []
        try:
            from modules.proc_dem import copernicus  # noqa: PLC0415

            names = copernicus.tile_names(bbox)
        except Exception:  # noqa: BLE001 - bad bbox
            names = []
        cached = sum(
            1 for n in names if (copernicus.paths.DEM / f"{n}.tif").exists()
        ) if names else 0
        out.append(
            {
                "dam": dam,
                "has_dem": bool(names) and cached == len(names),
                "tiles": len(names),
                "bytes": cached * _TILE_BYTES,
            }
        )
    return out


_TILE_BYTES = 40_000_000  # Copernicus-30m tile ≈ 40 MB


# ---------------------------------------------------------------- prepare

def prepare(river_id: str, buffer_km: float | None = None) -> str:
    """Enqueue corridor.prepare for this river at the requested corridor width.

    The width is recorded on the corridor row up front: it is what `stale`
    compares against and what every later `dam_gap` scopes to, so a re-prepare
    at a new slider position both does the narrower work and marks the row as
    belonging to that width.
    """
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not river:
        raise ValueError(f"river {river_id} not found")
    if buffer_km is None:
        corr = db.query_one("SELECT buffer_m FROM corridor WHERE river_id = %s", (river_id,))
        buffer_km = float(corr["buffer_m"]) / 1000 if corr and corr.get("buffer_m") else 20.0
    db.execute(
        """INSERT INTO corridor (river_id, status, buffer_m) VALUES (%s, 'preparing', %s)
           ON CONFLICT (river_id) DO UPDATE SET status = 'preparing', buffer_m = EXCLUDED.buffer_m""",
        (river_id, int(round(buffer_km * 1000))),
    )
    job = add_job("corridor.prepare", {"river_id": river_id, "buffer_km": buffer_km})
    return str(job["id"])


# Progress bands: the four steps run at once, so each owns a slice of the bar
# and `report` keeps the published pct monotonic across concurrent writers.
_PREPARE_BANDS = {"dams": (10, 50), "dem": (50, 68), "osm": (68, 84), "worldpop": (84, 95)}


def handle_prepare(ctx: JobContext) -> dict[str, Any]:
    """Fetch only what is missing for this corridor, then mark it ready.

    The steps run concurrently — per-dam DEM, corridor DEM, OSM clip and the
    population clip hit different resources and none needs another's output, so
    a cold corridor costs the slowest step rather than the sum of all four.
    Imagery (GEE) is enqueued separately so a cold GEE init never blocks the
    corridor from reaching `ready`.
    """
    river_id = ctx.params["river_id"]
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not river:
        raise ValueError(f"river {river_id} not found")

    bbox = _river_bbox(river)
    corr = db.query_one("SELECT buffer_m FROM corridor WHERE river_id = %s", (river_id,))
    buffer_km = float(ctx.params.get("buffer_km") or (corr or {}).get("buffer_m") or 20000) / 1000
    ctx.progress(5, f"corridor: {river['name']} @ {buffer_km:g} km bbox {bbox}")

    state = {"pct": 5}
    gate = threading.Lock()

    def report(step: str, local: int, msg: str = "") -> None:
        lo, hi = _PREPARE_BANDS[step]
        pct = lo + int((hi - lo) * max(0, min(100, local)) / 100)
        with gate:
            state["pct"] = max(state["pct"], pct)
            pct = state["pct"]
        ctx.progress(pct, msg)

    outcome: dict[str, Any] = {}

    def step_dams() -> None:
        gap = dam_gap(river_id, buffer_km)
        missing = [g for g in gap if not g["has_dem"]]
        report("dams", 0, f"corridor: {len(missing)}/{len(gap)} dams missing DEM")
        fetched = 0
        for i, g in enumerate(missing):
            ctx.check_cancelled()
            dam = g["dam"]
            try:
                from modules.proc_dem import copernicus  # noqa: PLC0415

                point = _point_bbox(dam["lon"], dam["lat"])
                path = copernicus.ensure_dem(point, cancel=ctx.check_cancelled)
                copernicus.dataset_for(path, point)
                fetched += path.stat().st_size if path.exists() else 0
                db.execute("UPDATE dam SET dem_status = 'cached' WHERE id = %s", (dam["id"],))
            except (JobCancelled, JobPaused):
                raise  # pause/cancel must stop the step, not be logged as a failure
            except Exception as exc:  # noqa: BLE001 - one dam must not fail the corridor
                logger.warning("corridor DEM fetch failed for {}: {}", dam["name"], exc)
            report("dams", int(100 * (i + 1) / max(len(missing), 1)),
                   f"corridor: DEM {i + 1}/{len(missing)} {dam['name']}")
        outcome["fetched_bytes"] = fetched

    def step_dem() -> None:
        if not bbox:
            return
        try:
            from modules.proc_dem import copernicus  # noqa: PLC0415

            path = copernicus.ensure_dem(bbox, progress=lambda p, m: report(
                "dem", int(p * 100), m), cancel=ctx.check_cancelled)
            copernicus.dataset_for(path, bbox)
            outcome["fetched_bytes"] = outcome.get("fetched_bytes", 0) + (
                path.stat().st_size if path.exists() else 0)
        except (JobCancelled, JobPaused):
            raise
        except Exception as exc:  # noqa: BLE001 - oversized/offline → terrain falls back
            logger.warning("corridor DEM for bbox failed: {}", exc)

    def step_osm() -> None:
        _set_status(river_id, "osm_status", "fetching")
        try:
            from modules.discover import osm_clip  # noqa: PLC0415

            osm_clip.fetch(river_id, bbox, progress=lambda p, m: report(
                "osm", int(p), m), cancel=ctx.check_cancelled)
            _set_status(river_id, "osm_status", "ready")
        except (JobCancelled, JobPaused):
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("corridor OSM clip failed: {}", exc)
            _set_status(river_id, "osm_status", "failed")

    def step_worldpop() -> None:
        # The WorldPop 1 km country aggregate is ~19 MB, so prepare fetches it
        # (a 100 m file already on disk wins). A failed fetch never fails the
        # corridor: impact then falls back to settlement populations.
        from modules.discover import worldpop_clip  # noqa: PLC0415

        if worldpop_clip.cached(bbox):
            _set_status(river_id, "pop_status", "ready")
            report("worldpop", 100, "corridor: population already on disk")
            return
        _set_status(river_id, "pop_status", "fetching")
        try:
            worldpop_clip.fetch(river_id, bbox, progress=lambda p, m: report(
                "worldpop", int(p), m), cancel=ctx.check_cancelled)
            _set_status(river_id, "pop_status", "ready")
        except (JobCancelled, JobPaused):
            raise
        except Exception as exc:  # noqa: BLE001 - offline → settlements fallback
            logger.warning("corridor WorldPop fetch failed: {}", exc)
            _set_status(river_id, "pop_status", "failed")

    steps = {"dams": step_dams, "dem": step_dem, "osm": step_osm, "worldpop": step_worldpop}
    with ThreadPoolExecutor(max_workers=len(steps)) as pool:
        futures = {pool.submit(fn): name for name, fn in steps.items()}
        for fut in as_completed(futures):
            try:
                fut.result()
            except (JobCancelled, JobPaused):
                raise
            except Exception as exc:  # noqa: BLE001 - one step must not kill prepare
                logger.warning("corridor {} step failed: {}", futures[fut], exc)

    # imagery is async (GEE cold start 15-85s); corridor is usable without it
    _set_status(river_id, "imagery_status", "queued")

    # record what actually landed on disk — Data Downloads reads these rows.
    _sync_dataset_rows(river_id)

    gap_now = dam_gap(river_id)
    cached = sum(1 for g in gap_now if g["has_dem"])
    bytes_total = sum((g["bytes"] for g in gap_now)) + outcome.get("fetched_bytes", 0)
    db.execute(
        """UPDATE corridor SET status = 'ready', dam_total = %s, dam_cached = %s,
                  dam_missing = %s, bytes = %s WHERE river_id = %s""",
        (len(gap_now), cached, len(gap_now) - cached, bytes_total, river_id),
    )
    db.execute("UPDATE river SET prepared_at = now() WHERE id = %s", (river_id,))
    ctx.progress(100, f"corridor ready: {cached}/{len(gap_now)} dams cached")
    return {
        "river_id": river_id,
        "dams": len(gap_now),
        "cached": cached,
        "bytes": bytes_total,
    }


def _set_status(river_id: str, column: str, value: str) -> None:
    db.execute(f"UPDATE corridor SET {column} = %s WHERE river_id = %s", (value, river_id))


# ---------------------------------------------------------------- downloads

DATASET_KINDS = ("dem", "dams", "osm", "imagery_s2", "sar_s1", "worldpop")

# label/source match the seeded corridor_dataset rows so a row inserted later
# reads the same as one the catalogue already knows.
DATASET_META = {
    "dem": ("DEM (30m)", "Copernicus GLO-90/DLR"),
    "dams": ("Dam Registry", "OSM / CWC / GeoDAR"),
    "osm": ("OSM Infrastructure", "OpenStreetMap"),
    "sar_s1": ("SAR (Sentinel-1)", "ESA Copernicus / GEE"),
    "imagery_s2": ("Sentinel-2 Imagery", "ESA Copernicus / GEE"),
    "worldpop": ("WorldPop (Population)", "WorldPop / University of Southampton"),
}


def download_dataset(corridor_id: str, kind: str) -> str:
    """Enqueue one dataset fetch for a corridor.

    Idempotent: while a job for this (corridor, kind) is queued or running the
    same job id comes back, so a double click never starts a second download.
    """
    corridor = db.query_one("SELECT id, river_id FROM corridor WHERE id = %s", (corridor_id,))
    if not corridor:
        raise ValueError(f"corridor {corridor_id} not found")
    if kind not in DATASET_KINDS:
        raise ValueError(f"unknown dataset kind {kind}")
    live = db.query_one(
        """SELECT id FROM job WHERE type = 'corridor.dataset'
           AND status IN ('queued', 'running', 'paused')
           AND params->>'corridor_id' = %s AND params->>'kind' = %s""",
        (str(corridor["id"]), kind),
    )
    if live:
        return str(live["id"])
    # Already on disk: a second click is an acknowledgement, not a download.
    have = db.query_one(
        "SELECT status FROM corridor_dataset WHERE corridor_id = %s AND kind = %s",
        (str(corridor["id"]), kind),
    )
    if have and have.get("status") == "available":
        return ""
    job = add_job("corridor.dataset", {
        "corridor_id": str(corridor["id"]),
        "river_id": str(corridor["river_id"]),
        "kind": kind,
    })
    return str(job["id"])


def handle_dataset(ctx: JobContext) -> dict[str, Any]:
    """Fetch one corridor dataset and record the measured result on its row."""
    corridor_id = ctx.params["corridor_id"]
    river_id = ctx.params["river_id"]
    kind = ctx.params["kind"]
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not river:
        raise ValueError(f"river {river_id} not found")
    if kind not in DATASET_KINDS:
        raise ValueError(f"unknown dataset kind {kind}")
    bbox = _river_bbox(river)

    _set_dataset_row(corridor_id, kind, status="fetching")
    ctx.progress(1, f"{kind}: starting")
    try:
        pct, status, size = _fetch_kind(ctx, corridor_id, river_id, kind, bbox)
    except (JobCancelled, JobPaused):
        # Not a failure: the row stays `fetching` so resume picks it up as
        # unfinished work rather than reporting a dataset we never measured.
        raise
    except Exception:
        _set_dataset_row(corridor_id, kind, status="failed")
        raise
    _set_dataset_row(corridor_id, kind, pct=pct, status=status, size=size)
    ctx.progress(100, f"{kind}: {status} {pct:.0f}%")
    return {"kind": kind, "coverage_pct": pct, "status": status, "bytes": size}


def _fetch_kind(ctx: JobContext, corridor_id: str, river_id: str, kind: str,
                bbox: tuple[float, float, float, float] | None) -> tuple[float, str, int]:
    """Download one kind, then measure what is actually on disk.

    Raises on failure — the job row keeps the error and the row stays `failed`,
    so the UI never shows a percentage we did not do the work for.
    """
    if kind == "dem":
        if not bbox:
            raise ValueError("river has no bbox to fetch a DEM for")
        from modules.proc_dem import copernicus  # noqa: PLC0415
        from modules.storage import paths  # noqa: PLC0415

        names = copernicus.tile_names(bbox, cap=None)
        missing = [n for n in names
                   if not (paths.DEM / f"{n}.tif").exists()
                   or (paths.DEM / f"{n}.tif").stat().st_size <= copernicus.MIN_VALID_FILE]
        paths.DEM.mkdir(parents=True, exist_ok=True)
        ctx.progress(2, f"dem: {len(missing)}/{len(names)} tiles missing")
        for i, name in enumerate(missing):
            ctx.check_cancelled()
            dest = paths.DEM / f"{name}.tif"
            copernicus._fetch(f"{copernicus.BUCKET}/{name}/{name}.tif", dest,
                              cancel=ctx.check_cancelled)
            ctx.progress(2 + int(94 * (i + 1) / max(len(missing), 1)),
                         f"dem: {i + 1}/{len(missing)} {name}")
        return _measured_or(kind, _measure_kind(river_id, kind, bbox), 0)

    if kind == "dams":
        gap = dam_gap(river_id)
        missing = [g for g in gap if not g["has_dem"]]
        ctx.progress(5, f"dams: {len(missing)}/{len(gap)} dam tiles missing")
        for i, g in enumerate(missing):
            ctx.check_cancelled()
            dam = g["dam"]
            try:
                from modules.proc_dem import copernicus  # noqa: PLC0415

                point = _point_bbox(dam["lon"], dam["lat"])
                path = copernicus.ensure_dem(point, cancel=ctx.check_cancelled)
                copernicus.dataset_for(path, point)
                db.execute("UPDATE dam SET dem_status = 'cached' WHERE id = %s", (dam["id"],))
            except Exception as exc:  # noqa: BLE001 - one dam must not fail the rest
                logger.warning("dam DEM fetch failed for {}: {}", dam["name"], exc)
            ctx.progress(5 + int(90 * (i + 1) / max(len(missing), 1)),
                         f"dams: {i + 1}/{len(missing)} {dam['name']}")
        return _measured_or(kind, _measure_kind(river_id, kind, bbox), 0)

    if kind == "osm":
        if not bbox:
            raise ValueError("river has no bbox for an OSM clip")
        from modules.discover import osm_clip  # noqa: PLC0415

        osm_clip.fetch(river_id, bbox, progress=lambda p, m: ctx.progress(
            5 + int(p * 0.9), m), cancel=ctx.check_cancelled)
        return _measured_or(kind, _measure_kind(river_id, kind, bbox), 0)

    if kind == "worldpop":
        if not bbox:
            raise ValueError("river has no bbox for a population clip")
        from modules.discover import worldpop_clip  # noqa: PLC0415

        # Coverage is normally measured once at the end; for a multi-GB file
        # that leaves the row at 0% for hours, so move it with the bytes — but
        # never rewind (a Range-refused retry restarts bytes mid-job).
        best = {"pct": 0.0}

        def worldpop_progress(p: int, m: str) -> None:
            ctx.progress(p, m)
            if p >= best["pct"]:
                best["pct"] = float(p)
                _set_dataset_row(corridor_id, kind, pct=float(p))

        result = worldpop_clip.fetch(river_id, bbox, progress=worldpop_progress,
                                     cancel=ctx.check_cancelled)
        path = result.get("path")
        size = path.stat().st_size if path and path.exists() else 0
        return _measured_or(kind, _measure_kind(river_id, kind, bbox), size)

    # Sentinel: real GEE scenes for the corridor. `_require_ready` raises when
    # the process has no Earth Engine credentials, which is the honest outcome.
    if not bbox:
        raise ValueError("river has no bbox for imagery")
    from modules.gee import live  # noqa: PLC0415

    live._require_ready()
    if kind == "imagery_s2":
        ctx.progress(20, "imagery_s2: querying Sentinel-2")
        result = live._s2_water_uncached(bbox, corridor_id, 30, 30, True)
        ctx.progress(85, "imagery_s2: scene ready")
    else:
        ctx.progress(20, "sar_s1: querying Sentinel-1")
        result = live._s1_water_uncached(bbox, 90)
        ctx.progress(85, "sar_s1: scene ready")
    rel = result.get("path")
    if not rel:
        return (100.0, "available", 0)
    from modules.storage import paths  # noqa: PLC0415

    path = paths.abs_path(rel)
    size = path.stat().st_size if path.exists() else 0
    return (100.0, "available", size)


def _measured_or(kind: str, measured: tuple[float, str, int] | None,
                 fallback_bytes: int) -> tuple[float, str, int]:
    """Measurement wins; the fetch already succeeded if we got here."""
    if measured:
        return measured
    return (100.0, "available", fallback_bytes)


def _measure_kind(river_id: str, kind: str,
                  bbox: tuple[float, float, float, float] | None) -> tuple[float, str, int] | None:
    """Read-only evidence for one kind. None when there is nothing to measure."""
    try:
        if kind == "dams":
            gap = dam_gap(river_id)
            if not gap:
                return (100.0, "available", 0)
            cached = sum(1 for g in gap if g["has_dem"])
            return (round(100.0 * cached / len(gap), 1),
                    "available" if cached == len(gap) else ("partial" if cached else "missing"),
                    _registry_tile_bytes(gap))

        if kind == "osm":
            present = {r["kind"] for r in db.query(
                "SELECT DISTINCT kind FROM infra_footprint WHERE river_id = %s", (river_id,))}
            if not present:
                return (0.0, "missing", 0)
            # Coverage = the core layers impact and the 3D view use. Hospitals,
            # schools, power lines, named bridges legitimately don't exist in
            # every corridor — an answered-but-empty layer is not missing data,
            # so requiring all six kept remote valleys at "partial" forever.
            core = ("road", "building")
            have = sum(k in present for k in core)
            return (round(100.0 * have / len(core), 1),
                    "available" if have == len(core) else "partial", 0)

        if kind == "worldpop":
            if not bbox:
                return None
            from modules.discover.worldpop_clip import local_path  # noqa: PLC0415

            path = local_path(bbox)
            if not path:
                return (0.0, "missing", 0)
            return (100.0, "available", path.stat().st_size)

        if kind == "dem":
            # Terrain is only fetched for the corridor's dams: a basin-wide DEM
            # for a river like the Ganga needs 77 tiles and is refused by the
            # download cap, so requiring it here would keep the gate shut forever.
            from modules.proc_dem import copernicus  # noqa: PLC0415
            from modules.storage import paths  # noqa: PLC0415

            names = _tile_names_for(dam_gap(river_id))
            if not names:
                return (100.0, "available", 0)
            files = [paths.DEM / f"{n}.tif" for n in names]
            have = [f for f in files if f.exists() and f.stat().st_size > copernicus.MIN_VALID_FILE]
            pct = 100.0 * len(have) / len(files)
            return (round(pct, 1),
                    "available" if len(have) == len(files) else ("partial" if have else "missing"),
                    sum(f.stat().st_size for f in have))
    except Exception as exc:  # noqa: BLE001 - measurement must never fail the caller
        logger.warning("measure {} failed for {}: {}", kind, river_id, exc)
        return None
    return None


def _tile_names_for(gap: list[dict[str, Any]]) -> set[str]:
    """Unique Copernicus tiles the corridor's in-scope dams sit on."""
    from modules.proc_dem import copernicus  # noqa: PLC0415

    names: set[str] = set()
    for g in gap:
        dam = g["dam"]
        if not (dam.get("lon") and dam.get("lat")):
            continue
        try:
            names.update(copernicus.tile_names(_point_bbox(dam["lon"], dam["lat"]), cap=None))
        except Exception:  # noqa: BLE001 - unusable point contributes no tiles
            continue
    return names


def _registry_tile_bytes(gap: list[dict[str, Any]]) -> int:
    """Real on-disk bytes of the unique Copernicus tiles the dam points need.

    `dam_gap` reports `tiles * 40 MB` as a planning estimate; Data Downloads
    shows what is actually stored, so count file sizes instead.
    """
    from modules.proc_dem import copernicus  # noqa: PLC0415
    from modules.storage import paths  # noqa: PLC0415

    total = 0
    for name in _tile_names_for(gap):
        file = paths.DEM / f"{name}.tif"
        if file.exists() and file.stat().st_size > copernicus.MIN_VALID_FILE:
            total += file.stat().st_size
    return total


def _sync_dataset_rows(river_id: str) -> None:
    """Rewrite the corridor's dataset rows from local evidence after a prepare."""
    corridor = db.query_one("SELECT id FROM corridor WHERE river_id = %s", (river_id,))
    river = db.query_one("SELECT * FROM river WHERE id = %s", (river_id,))
    if not corridor or not river:
        return
    bbox = _river_bbox(river)
    for kind in ("dem", "dams", "osm", "worldpop"):
        measured = _measure_kind(river_id, kind, bbox)
        if measured:
            _set_dataset_row(str(corridor["id"]), kind, pct=measured[0],
                             status=measured[1], size=measured[2])


def _set_dataset_row(corridor_id: str, kind: str, pct: float | None = None,
                     status: str | None = None, size: int | None = None) -> None:
    """Upsert one corridor_dataset row; None leaves the stored value alone."""
    label, source = DATASET_META.get(kind, (kind, None))
    existing = db.query_one(
        "SELECT id FROM corridor_dataset WHERE corridor_id = %s AND kind = %s",
        (corridor_id, kind),
    )
    if not existing:
        db.insert("corridor_dataset", {
            "corridor_id": corridor_id,
            "kind": kind,
            "label": label,
            "source": source,
            "coverage_pct": pct or 0,
            "status": status or "missing",
            "bytes": size or 0,
        })
        return
    db.execute(
        """UPDATE corridor_dataset
              SET coverage_pct = COALESCE(%s, coverage_pct),
                  status = COALESCE(%s, status),
                  bytes = COALESCE(%s, bytes),
                  updated = now()
            WHERE corridor_id = %s AND kind = %s""",
        (pct, status, size, corridor_id, kind),
    )


# ---------------------------------------------------------------- geometry

def _river_bbox(river: dict[str, Any]) -> tuple[float, float, float, float] | None:
    if river.get("bbox"):
        env = db.query_one(
            "SELECT ST_XMin(bbox) w, ST_YMin(bbox) s, ST_XMax(bbox) e, ST_YMax(bbox) n "
            "FROM river WHERE id = %s",
            (river["id"],),
        )
        if env:
            return (float(env["w"]), float(env["s"]), float(env["e"]), float(env["n"]))
    if river.get("path"):
        path = json.loads(_as_geojson(river["path"])) if isinstance(river["path"], str) else None
        if path:
            return _bbox(path)
    return None


def _point_bbox(lon: float, lat: float, pad: float = 0.02) -> tuple[float, float, float, float]:
    return (lon - pad, lat - pad, lon + pad, lat + pad)


def _bbox(path: dict[str, Any] | None) -> tuple[float, float, float, float] | None:
    if not path:
        return None
    xs = [c[0] for c in path["coordinates"]]
    ys = [c[1] for c in path["coordinates"]]
    return (min(xs), min(ys), max(xs), max(ys))


def _length_km(path: dict[str, Any]) -> float:
    total = 0.0
    coords = path["coordinates"]
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        total += _hav_km(x1, y1, x2, y2)
    return total


def _hav_km(x1: float, y1: float, x2: float, y2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(y1), math.radians(y2)
    dp, dl = math.radians(y2 - y1), math.radians(x2 - x1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _wkt(path: dict[str, Any] | None) -> str | None:
    if not path:
        return None
    pts = ", ".join(f"{c[0]} {c[1]}" for c in path["coordinates"])
    return f"LINESTRING({pts})"


def _as_geojson(geom: Any) -> str | None:
    """Normalise a geometry column to GeoJSON text.

    psycopg2 returns `geometry` columns as EWKB hex (or as bytes when a driver
    change swaps the adapter), so a str is only GeoJSON after a JSON parse
    succeeds — otherwise it is hex to decode.
    """
    if geom is None:
        return None
    from shapely import wkb  # noqa: PLC0415

    if isinstance(geom, str):
        try:
            json.loads(geom)
            return geom
        except (ValueError, TypeError):
            return json.dumps(wkb.loads(bytes.fromhex(geom)).__geo_interface__)
    return json.dumps(wkb.loads(bytes(geom)).__geo_interface__)


def _post(url: str, data: dict[str, str], timeout: int = NET_TIMEOUT) -> str:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _get(url: str, timeout: int = SEARCH_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def register_jobs() -> None:
    register("corridor.prepare", handle_prepare)
    register("corridor.dataset", handle_dataset)


__all__ = [
    "search",
    "search_world",
    "shape_search_row",
    "create_river",
    "get_river",
    "river_dams",
    "corridor_polygon",
    "dam_gap",
    "prepare",
    "handle_prepare",
    "download_dataset",
    "handle_dataset",
    "DATASET_KINDS",
    "register_jobs",
    "shape_river",
]
