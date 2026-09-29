"""osm_clip — pull buildings/roads/bridges/hospitals for a corridor bbox.

Overpass refuses a basin-wide `out geom` — Ganga's envelope OOMs its 2 GB
query budget — and rate-limits back-to-back queries with 429, so the clip
walks a grid of ~1.5° cells restricted to the ones the river's corridor
actually touches: one paced query per layer per cell, retrying across
mirrors, degrading to `partial` coverage per layer instead of discarding the
whole clip. Rows land as `infra_footprint` (the 3D player instances buildings
from these) and as `vector_feature` rows for the 2D layers. Failures are the
caller's problem to log — this module raises only when no answer arrived at
all.
"""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from loguru import logger

MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    # kumi.systems stopped answering (every retry burned a 90 s timeout);
    # mail.ru and private.coffee are the live public mirrors as of 2026-09.
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
QUERY_TIMEOUT = 60   # server-side budget advertised inside the query
NET_TIMEOUT = 90     # client socket timeout, above the server budget
PACE_S = 1.2         # Overpass 429s on back-to-back queries
MAX_CELL_DEG = 1.5   # 1.5° tile keeps buildings `out geom` under the 2 GB cap
CELL_MARGIN_KM = 5.0  # corridor buffer slack when pruning cells to the path
USER_AGENT = "Niyanta/1.0 (SIH26161 dam-break modelling)"
Progress = Callable[[int, str], None] | None

# kind → Overpass query fragment
_LAYERS = {
    "building": 'way["building"]',
    "road": 'way["highway"]',
    "bridge": 'way["bridge"]["name"]',
    "hospital": 'node["amenity"="hospital"]',
    "school": 'node["amenity"="school"]',
    "power": 'way["power"="line"]',
}


def fetch(river_id: str, bbox: tuple[float, float, float, float] | None,
          progress: Progress = None,
          cancel: Callable[[], None] | None = None) -> dict[str, Any]:
    """Grid walk over the corridor: one query per layer per cell.

    Cells whose envelope misses the river's buffered corridor are skipped —
    the buffer, not the bbox, is what the clip is actually interested in. A
    cell that a mirror still refuses is logged and skipped: that layer ends
    up `partial`, which is what the coverage measure reports honestly.
    """
    if not bbox:
        raise ValueError("no bbox for OSM clip")
    cells = _cells(river_id, bbox)
    deleted: set[str] = set()          # kinds whose old rows this clip replaced
    seen: set[tuple[str, int]] = set() # (osm type, id) — cells overlap on ways
    answered: set[str] = set()
    stored = 0
    steps = max(len(cells) * len(_LAYERS), 1)
    step = 0
    for kind, q in _LAYERS.items():
        for w, s, e, n in cells:
            if cancel:
                cancel()  # a query boundary is the cheapest safe stop point
            step += 1
            if progress:
                progress(int(70 * step / steps), f"osm: {kind} {step}/{steps}")
            # No `{kind}:` label here — Overpass QL has no such syntax and
            # answers "parse error: Unknown type" (HTTP 400) for every cell.
            query = (f"[out:json][timeout:{QUERY_TIMEOUT}];\n"
                     f"{q}({s},{w},{n},{e});\nout geom;")
            try:
                elements = json.loads(_post(query)).get("elements", [])
            except Exception as exc:  # noqa: BLE001 - one refused cell ≠ failed clip
                logger.warning("osm {} cell ({:.2f},{:.2f}) failed: {}",
                               kind, w, s, exc)
                continue
            answered.add(kind)
            fresh: list[dict[str, Any]] = []
            for el in elements:
                key = (str(el.get("type")), el.get("id"))
                if key in seen:
                    continue
                seen.add(key)
                fresh.append(el)
            if fresh and kind not in deleted:
                _delete_replaced(river_id, kind, bbox)
                deleted.add(kind)
            stored += _insert(river_id, fresh)
            time.sleep(PACE_S)
    if not answered:
        raise RuntimeError(
            "Overpass refused every layer on every mirror — "
            "corridor OSM clip got no answer at all")
    failed = sorted(set(_LAYERS) - answered)
    if progress:
        progress(100, f"osm: {stored} features from "
                      f"{len(answered)}/{len(_LAYERS)} layers"
                      + (f", failed: {', '.join(failed)}" if failed else ""))
    return {"elements": len(seen), "stored": stored,
            "layers": len(answered), "failed": failed}


def _cells(river_id: str,
           bbox: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    """Envelope grid pruned to cells the river's corridor buffer touches."""
    w, s, e, n = bbox
    cols = max(1, math.ceil((e - w) / MAX_CELL_DEG))
    rows = max(1, math.ceil((n - s) / MAX_CELL_DEG))
    dx = (e - w) / cols
    dy = (n - s) / rows
    grid = [(round(w + c * dx, 5), round(s + r * dy, 5),
             round(w + (c + 1) * dx, 5), round(s + (r + 1) * dy, 5))
            for r in range(rows) for c in range(cols)]
    buffer_m = _corridor_buffer_m(river_id)
    try:
        from modules.db import client as db  # noqa: PLC0415
        from pyproj import CRS, Transformer
        from shapely.geometry import box, shape as shapely_shape
        from shapely.ops import transform as shapely_transform

        row = db.query_one("SELECT path FROM river WHERE id = %s", (river_id,))
        if not row or not row.get("path"):
            return grid  # no path (imported river): keep everything
        line = shapely_shape(json.loads(row["path"]))
        w0, s0, e0, n0 = line.bounds
        lon0, lat0 = (w0 + e0) / 2.0, (s0 + n0) / 2.0
        aeqd = CRS.from_proj4(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m +no_defs")
        fwd = Transformer.from_crs("EPSG:4326", aeqd, always_xy=True)
        inv = Transformer.from_crs(aeqd, "EPSG:4326", always_xy=True)
        corridor = shapely_transform(
            inv.transform,
            shapely_transform(fwd.transform, line).buffer(buffer_m, resolution=4),
        )
        kept = [cell for cell in grid
                if corridor.intersects(box(cell[0], cell[1], cell[2], cell[3]))]
        return kept or grid
    except Exception as exc:  # noqa: BLE001 - pruning is an optimisation
        logger.warning("osm cell pruning unavailable, using full grid: {}", exc)
        return grid


def _corridor_buffer_m(river_id: str) -> float:
    """The corridor width the last prepare recorded, plus margin."""
    try:
        from modules.db import client as db  # noqa: PLC0415

        row = db.query_one("SELECT buffer_m FROM corridor WHERE river_id = %s",
                           (river_id,))
        return float(row["buffer_m"] or 20_000) + CELL_MARGIN_KM * 1000
    except Exception:  # noqa: BLE001 - default corridor width
        return 25_000.0


def _delete_replaced(river_id: str, kind: str,
                     bbox: tuple[float, float, float, float]) -> None:
    """Drop the rows this clip is about to replace, per kind, once.

    Scoped to the clip's envelope: `vector_feature` has no river column, so
    the bbox keeps a different river's (or the synthetic demo's) rows alive.
    """
    from modules.db import client as db  # noqa: PLC0415

    w, s, e, n = bbox
    db.execute(
        "DELETE FROM infra_footprint WHERE river_id = %s AND kind = %s",
        (river_id, kind))
    if kind in ("bridge", "hospital", "school"):
        from modules.db.client import geo_bounds  # noqa: PLC0415

        ids = []
        for row in db.query("SELECT id, geom FROM vector_feature WHERE layer = %s", (kind,)):
            env = geo_bounds(row["geom"])
            if env and env[0] <= e and env[2] >= w and env[1] <= n and env[3] >= s:
                ids.append(row["id"])
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            db.execute(
                f"DELETE FROM vector_feature WHERE id IN ({', '.join('?' * len(chunk))})",
                tuple(chunk),
            )


def _insert(river_id: str, elements: list[dict[str, Any]]) -> int:
    from modules.db import client as db  # noqa: PLC0415

    count = 0
    for el in elements:
        kind = _kind_of(el)
        if not kind:
            continue
        tags = el.get("tags") or {}
        geom = _geom_wkt(el)
        if not geom:
            continue
        props = json.dumps({k: v for k, v in tags.items() if k != "name"})
        try:
            db.execute(
                """INSERT INTO infra_footprint (river_id, kind, name, geom, attrs, source)
                   VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), %s::jsonb, 'osm')""",
                (river_id, kind, tags.get("name"), geom, props),
            )
            if kind in ("bridge", "hospital", "school"):
                db.execute(
                    """INSERT INTO vector_feature (layer, name, geom, props)
                       VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s::jsonb)""",
                    (kind, tags.get("name"), geom, props),
                )
            count += 1
        except Exception:  # noqa: BLE001 - duplicate/bad geometry: keep going
            continue
    return count


def _kind_of(el: dict[str, Any]) -> str | None:
    tags = el.get("tags") or {}
    if tags.get("building"):
        return "building"
    if tags.get("bridge"):
        return "bridge"
    if tags.get("highway"):
        return "road"
    if tags.get("amenity") in ("hospital", "school"):
        return tags["amenity"]
    if tags.get("power") == "line":
        return "power"
    return None


def _geom_wkt(el: dict[str, Any]) -> str | None:
    geom = el.get("geometry")
    if not geom:
        return None
    pts = [(float(p["lon"]), float(p["lat"])) for p in geom if "lon" in p and "lat" in p]
    if not pts:
        return None
    if len(pts) == 1:
        return f"POINT({pts[0][0]} {pts[0][1]})"
    body = ", ".join(f"{x} {y}" for x, y in pts)
    return f"LINESTRING({body})"


def _post(query: str, attempts: int = 4) -> str:
    """POST to Overpass with mirror fallback, pacing, and remark detection.

    A `remark` (OOM, timeout, load) still parses as valid JSON with empty
    elements, so it must be treated as a failure or the clip would store an
    empty answer as if it were data.
    """
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        url = MIRRORS[attempt % len(MIRRORS)]
        req = urllib.request.Request(url, data=body,
                                     headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=NET_TIMEOUT) as resp:
                text = resp.read().decode("utf-8", "replace")
            remark = json.loads(text).get("remark")
            if remark:
                raise RuntimeError(f"overpass remark: {remark}")
            return text
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            status = getattr(exc, "code", None)
            if attempt < attempts - 1:
                # 429s deserve a longer cool-off than a flaky mirror does.
                time.sleep(12.0 if status == 429 else 2.0 * (attempt + 1))
    raise last  # type: ignore[misc]
