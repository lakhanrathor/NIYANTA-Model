"""Impact ingest: OSM vector features + WorldPop population raster.

Feeds stage.impact (villages, roads, bridges, hospitals, buildings) and the
zonal population exposed calculation. Every row keeps its source.

    python scripts/ingest_impact.py features   # OSM villages/roads/bridges/hospitals/buildings
    python scripts/ingest_impact.py pop        # download WorldPop IND 2020 raster
    python scripts/ingest_impact.py all
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest import _bbox_clause, _get, overpass  # noqa: E402
from modules.db import client as db  # noqa: E402
from modules.storage import paths  # noqa: E402

POPS = Path(__file__).resolve().parent.parent / "storage" / "pop"
# Copernicus GHS-POP R2023A (epoch 2025), India clip, 100 m, hosted on HDX/S3.
POP_URL = (
    "https://data.humdata.org/dataset/b93f8372-aca1-4632-b6ad-5d09626e263b/"
    "resource/2ffa5ab4-0c89-496f-a1b9-abc11805929c/"
    "download/ghs_pop_e2025_r2023a_54009_100_v1_0_ind.tif"
)
POP_FILE = POPS / "ghs_pop_ind_2025_100m.tif"
POP_SOURCE = "Copernicus GHS-POP R2023A E2025 (India, 100 m) — HDX"
MAX_BUILDINGS = 40_000
# place nodes that carry an OSM population tag, keyed "lon,lat" at 5 decimals
OSM_POP: dict[str, str] = {}


def scenario_boxes() -> list[tuple[float, float, float, float]]:
    boxes: list[tuple[float, float, float, float]] = []
    seen: set[tuple[float, float, float, float]] = set()
    for row in db.query("SELECT spec FROM scenario"):
        spec = row["spec"]
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except json.JSONDecodeError:
                continue
        coords = ((spec or {}).get("aoi") or {}).get("coords")
        if not coords or len(coords) != 4:
            continue
        box = tuple(round(float(c), 5) for c in coords)
        if box in seen:
            continue
        seen.add(box)
        boxes.append(box)  # type: ignore[arg-type]
    return boxes


def _centroid(el: dict[str, Any]) -> tuple[float, float] | None:
    if el.get("type") == "node" and "lat" in el and "lon" in el:
        return float(el["lon"]), float(el["lat"])
    c = el.get("center") or {}
    if "lat" in c and "lon" in c:
        return float(c["lon"]), float(c["lat"])
    return None


def _road_wkt(el: dict[str, Any]) -> str | None:
    geom = el.get("geometry") or []
    pts = [(float(p["lon"]), float(p["lat"])) for p in geom if "lat" in p and "lon" in p]
    if len(pts) < 2:
        return None
    body = ", ".join(f"{lon} {lat}" for lon, lat in pts)
    return f"LINESTRING({body})"


def _insert(layer: str, name: str | None, wkt: str, props: dict[str, Any], seen: set) -> bool:
    key = (layer, name, wkt[:96])
    if key in seen:
        return False
    seen.add(key)
    db.execute(
        "INSERT INTO vector_feature (layer, name, geom, props) VALUES "
        "(%s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326)::geometry, %s::jsonb)",
        (layer, name, wkt, json.dumps(props)),
    )
    return True


def ingest_features() -> dict[str, Any]:
    boxes = scenario_boxes()
    if not boxes:
        return {"error": "no scenario AOIs"}
    seen: set = set()
    counts = {"village": 0, "road": 0, "bridge": 0, "hospital": 0, "building": 0}
    OSM_POP.clear()

    for box in boxes:
        area = _bbox_clause(box)

        # points + building centroids (nodes, ways and relations)
        q = (
            "[out:json][timeout:180];"
            "("
            f'node["place"~"^(village|hamlet|town|suburb)$"]{area};'
            f'way["bridge"~"^(yes|viaduct|aqueduct)$"]["highway"]{area};'
            f'way["amenity"="hospital"]{area};'
            f'node["amenity"="hospital"]{area};'
            f'relation["amenity"="hospital"]{area};'
            f'way["building"]{area};'
            ");out tags center;"
        )
        try:
            data = overpass(q, timeout=240)
        except Exception as exc:  # noqa: BLE001 - one slow mirror must not stop ingest
            print(f"  points query failed for {box}: {exc}")
            data = {"elements": []}
        buildings = 0
        for el in data.get("elements", []):
            t = el.get("tags") or {}
            pt = _centroid(el)
            if pt is None:
                continue
            lon, lat = pt
            wkt = f"POINT({lon} {lat})"
            place = t.get("place")
            if place:
                if _insert("village", t.get("name"), wkt, {"place": place, "osm_id": el.get("id")}, seen):
                    counts["village"] += 1
                    if t.get("population"):
                        OSM_POP[f"{lon:.5f},{lat:.5f}"] = t["population"]
                continue
            if t.get("bridge"):
                if _insert("bridge", t.get("name"), wkt, {"bridge": t.get("bridge"), "osm_id": el.get("id")}, seen):
                    counts["bridge"] += 1
                continue
            if t.get("amenity") == "hospital":
                if _insert("hospital", t.get("name"), wkt, {"osm_id": el.get("id")}, seen):
                    counts["hospital"] += 1
                continue
            if t.get("building") and buildings < MAX_BUILDINGS:
                if _insert(
                    "building",
                    t.get("name"),
                    wkt,
                    {"building": t.get("building"), "osm_id": el.get("id")},
                    seen,
                ):
                    counts["building"] += 1
                    buildings += 1

        # road centrelines with real geometry
        q = (
            "[out:json][timeout:180];"
            f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"]{area};'
            "out geom;"
        )
        try:
            data = overpass(q, timeout=240)
        except Exception as exc:  # noqa: BLE001 - degrade to "no roads for this box"
            print(f"  road query failed for {box}: {exc}")
            data = {"elements": []}
        for el in data.get("elements", []):
            wkt = _road_wkt(el)
            if wkt is None:
                continue
            t = el.get("tags") or {}
            if _insert(
                "road",
                t.get("name"),
                wkt,
                {"highway": t.get("highway"), "osm_id": el.get("id")},
                seen,
            ):
                counts["road"] += 1
        print(f"  {box}: {counts}")

    db.execute(
        "INSERT INTO app_setting (key, value) VALUES ('ingest_impact_features', %s::jsonb) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (json.dumps({"counts": counts, "boxes": boxes, "source": "OSM Overpass"}),),
    )
    return counts


def ingest_pop() -> dict[str, Any]:
    POPS.mkdir(parents=True, exist_ok=True)
    if POP_FILE.exists() and POP_FILE.stat().st_size > 350_000_000:
        return {"file": str(POP_FILE), "bytes": POP_FILE.stat().st_size, "cached": True}
    tmp = POP_FILE.with_suffix(".part")
    req = urllib_request(POP_URL)
    total = 0
    last = 0.0
    with open(tmp, "wb") as fh:
        while True:
            chunk = req.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
            if total - last >= 50 << 20:
                last = float(total)
                print(f"  {total / (1 << 20):.0f} MB", flush=True)
    tmp.replace(POP_FILE)
    return {"file": str(POP_FILE), "bytes": POP_FILE.stat().st_size, "source": POP_SOURCE}


def urllib_request(url: str):
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": "NIYANTA/1.0 (SIH26161; open-data ingest)"})
    return urllib.request.urlopen(req, timeout=180)  # noqa: S310 - fixed https host


def village_population() -> dict[str, Any]:
    """Populate village_population from OSM population tags (source recorded)."""
    rows = db.query(
        "SELECT vf.id, vf.name, ST_X(vf.geom) AS lon, ST_Y(vf.geom) AS lat "
        "FROM vector_feature vf WHERE vf.layer = 'village'"
    )
    filled = 0
    for row in rows:
        raw = OSM_POP.get(f"{row['lon']:.5f},{row['lat']:.5f}")
        if raw is None:
            continue
        try:
            count = int(str(raw).replace(",", "").strip())
        except ValueError:
            continue
        db.execute(
            "INSERT INTO village_population (village_id, count, source) VALUES (%s, %s, %s) "
            "ON CONFLICT (village_id) DO UPDATE SET count = EXCLUDED.count, source = EXCLUDED.source, "
            "updated = now()",
            (row["id"], count, "OSM place tag"),
        )
        filled += 1
    return {"villages": len(rows), "with_population": filled}


def main(argv: list[str]) -> int:
    what = argv or ["all"]
    if "features" in what or "all" in what:
        print("features:", ingest_features())
    if "pop" in what or "all" in what:
        print("population raster:", ingest_pop())
    if "villages" in what or "all" in what:
        print("village_population:", village_population())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
