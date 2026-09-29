from __future__ import annotations

import json
from pathlib import Path

from config import settings
from modules.db import client as db

SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"


def seed_schema() -> None:
    # SQLite DDL is idempotent (IF NOT EXISTS everywhere); executescript
    # commits before running, which is fine at boot before workers start.
    script = SCHEMA.read_text(encoding="utf-8")
    with db.connection() as conn:
        conn.executescript(script)
        # rows that predate the infra_rtree trigger: index them once
        n_rows = conn.execute("SELECT count(*) FROM infra_footprint").fetchone()[0]
        n_idx = conn.execute("SELECT count(*) FROM infra_rtree").fetchone()[0]
        if n_idx < n_rows:
            conn.execute(
                """INSERT OR REPLACE INTO infra_rtree
                   SELECT rowid, ST_XMin(geom), ST_XMax(geom), ST_YMin(geom), ST_YMax(geom)
                     FROM infra_footprint
                    WHERE rowid NOT IN (SELECT id FROM infra_rtree)
                      AND ST_XMin(geom) IS NOT NULL""")


def _envelope(west: float, south: float, east: float, north: float) -> str:
    return json.dumps(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [west, south],
                    [east, south],
                    [east, north],
                    [west, north],
                    [west, south],
                ]
            ],
        }
    )


def _point(lon: float, lat: float) -> str:
    return json.dumps({"type": "Point", "coordinates": [lon, lat]})


DEMO_BOXES = [
    {
        "name": "Rishiganga (Uttarakhand)",
        "preset": "rishiganga",
        "bbox": "(78.05,30.10,78.55,30.55)",
        "meta": {"river": "Rishiganga", "state": "Uttarakhand", "note": "2021 disaster corridor"},
    },
    {
        "name": "Kosi Barrage (Bihar/Nepal)",
        "preset": "kosi",
        "bbox": "(86.60,26.35,87.20,26.85)",
        "meta": {"river": "Kosi", "state": "Bihar", "note": "proximal settlement set"},
    },
    {
        "name": "Phuktal (Ladakh)",
        "preset": "phuktal",
        "bbox": ("76.85,33.05,77.35,33.45"),
        "meta": {"river": "Zanskar", "state": "Ladakh", "note": "natural blockage risk"},
    },
    {
        "name": "Hidkal Dam (Karnataka)",
        "preset": "hidkal",
        "bbox": "(74.45,16.25,75.05,16.75)",
        "meta": {"river": "Bhima", "state": "Karnataka", "note": "SIH benchmark dam"},
    },
]


def seed_demo() -> None:
    for b in DEMO_BOXES:
        exists = db.query_one("SELECT id FROM watch_box WHERE preset = %s", (b["preset"],))
        if exists:
            continue
        west, south, east, north = [float(x) for x in b["bbox"].strip("()").split(",")]
        db.query(
            "INSERT INTO watch_box (name, preset, bbox, meta) VALUES (%s, %s, %s, %s)",
            (b["name"], b["preset"], _envelope(west, south, east, north), b["meta"]),
        )

    for name, counts in (
        ("wris", {}),
        ("osm", {}),
        ("worldpop", {}),
        ("weather", {}),
        ("dem", {}),
    ):
        db.execute(
            "INSERT INTO connector_snapshot (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (name,),
        )

    defaults = [
        ("population_exposed", {"metric": "population_exposed", "op": ">", "threshold": 5000}),
        ("arrival_fast", {"metric": "arrival_hr", "op": "<", "threshold": 3}),
        ("risk_high", {"metric": "risk_class", "op": "in", "threshold": ["HIGH", "CRITICAL"]}),
    ]
    for name, cond in defaults:
        db.execute(
            "INSERT INTO alert_rule (name, condition) SELECT %s, %s "
            "WHERE NOT EXISTS (SELECT 1 FROM alert_rule WHERE name = %s)",
            (name, json.dumps(cond), name),
        )

    _seed_geo_demo()


DEMO_DAMS = [
    {"name": "Naganad Demo Dam", "river": "Naganad", "state": "Karnataka",
     "loc": (78.0, 22.066), "crest_m": 665.0, "height_m": 45.0, "fsl_m": 663.0,
     "storage_mcm": 286.0, "crest_length_m": 420.0, "meta": {"synthetic": True}},
    {"name": "Hidkal Dam", "river": "Bhima", "state": "Karnataka",
     "loc": (74.75, 16.50), "crest_m": 731.0, "height_m": 51.0, "fsl_m": 729.0,
     "storage_mcm": 3706.0, "crest_length_m": 1550.0, "meta": {"benchmark": "hidkal2021"}},
]

# villages/infra around the default synthetic AOI (78.0E, 22.0N, +-12 km)
DEMO_VILLAGES = [
    ("Rampur", 78.012, 22.075, 4200),
    ("Shivpur", 77.986, 22.052, 2850),
    ("Hedagi", 78.028, 22.031, 5100),
    ("Mangalwadi", 77.995, 21.998, 3300),
    ("Kallur", 78.034, 21.974, 6400),
    ("Devarkhed", 77.981, 21.947, 1900),
    ("Nandihalli", 78.018, 21.923, 2750),
    ("Amarwadi", 77.965, 22.020, 1250),
]
DEMO_ROADS = [
    ("NH-cross-valley", [(77.940, 22.098), (77.985, 22.040), (78.010, 21.995), (78.045, 21.935)]),
    ("SH-ridge-road", [(78.075, 22.085), (78.040, 22.030), (78.055, 21.975), (78.020, 21.915)]),
]
DEMO_BRIDGES = [("Naganad Bridge", 78.004, 22.043), ("Bhima Link", 78.021, 21.962)]
DEMO_HOSPITALS = [("CHC Kallur", 78.037, 21.971)]


def _seed_geo_demo() -> None:
    from shapely.geometry import LineString, mapping

    for d in DEMO_DAMS:
        if db.query_one("SELECT id FROM dam WHERE name = %s", (d["name"],)):
            continue
        db.query(
            """INSERT INTO dam (name, river, state, location, crest_m, height_m, fsl_m,
                                storage_mcm, crest_length_m, meta)
               VALUES (%s,%s,%s, %s, %s,%s,%s,%s,%s, %s)""",
            (d["name"], d["river"], d["state"], _point(*d["loc"]),
             d["crest_m"], d["height_m"], d["fsl_m"], d["storage_mcm"], d["crest_length_m"],
             json.dumps(d["meta"])),
        )

    for name, lon, lat, pop in DEMO_VILLAGES:
        if db.query_one("SELECT id FROM vector_feature WHERE layer='village' AND name = %s", (name,)):
            continue
        row = db.query_one(
            """INSERT INTO vector_feature (layer, name, geom, props)
               VALUES ('village', %s, %s, %s) RETURNING id""",
            (name, _point(lon, lat), json.dumps({"pop_source": "census-demo"})),
        )
        db.execute(
            "INSERT INTO village_population (village_id, count, source) VALUES (%s, %s, 'demo') "
            "ON CONFLICT (village_id) DO NOTHING",
            (row["id"], pop),
        )

    for name, pts in DEMO_ROADS:
        if db.query_one("SELECT id FROM vector_feature WHERE layer='road' AND name = %s", (name,)):
            continue
        line = LineString(pts)
        db.query(
            """INSERT INTO vector_feature (layer, name, geom, props)
               VALUES ('road', %s, %s, %s)""",
            (name, json.dumps(mapping(line)),
             json.dumps({"class": "NH" if name.startswith("NH") else "SH"})),
        )

    for name, lon, lat in DEMO_BRIDGES:
        if db.query_one("SELECT id FROM vector_feature WHERE layer='bridge' AND name = %s", (name,)):
            continue
        db.query(
            """INSERT INTO vector_feature (layer, name, geom, props)
               VALUES ('bridge', %s, %s, '{}')""",
            (name, _point(lon, lat)),
        )

    for name, lon, lat in DEMO_HOSPITALS:
        if db.query_one("SELECT id FROM vector_feature WHERE layer='hospital' AND name = %s", (name,)):
            continue
        db.query(
            """INSERT INTO vector_feature (layer, name, geom, props)
               VALUES ('hospital', %s, %s, '{}')""",
            (name, _point(lon, lat)),
        )


def seed() -> None:
    ensure_storage()
    seed_schema()
    seed_demo()


def ensure_storage() -> None:
    from modules.storage import paths

    paths.ensure_all()
