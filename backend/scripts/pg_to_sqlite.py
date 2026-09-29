from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# One-time migration: PostgreSQL/PostGIS -> SQLite (single file).
#
# For every table that exists in both schema.sql and the PG database, rows are
# copied over.  Geometry columns are converted with ST_AsGeoJSON so they land
# as the GeoJSON text the app now stores; jsonb/uuid/timestamptz/text[] come
# back as Python objects that the SQLite client binds natively.
#
# The target file is whatever NIYANTA_DB points at (default
# backend/data/niyanta.sqlite).  All target tables are cleared first so a
# re-run is idempotent.

PG_DSN = (
    f"host={__import__('os').getenv('NIYANTA_DB_HOST', 'localhost')} "
    f"port={__import__('os').getenv('NIYANTA_DB_PORT', '5433')} "
    f"dbname={__import__('os').getenv('NIYANTA_DB_NAME', 'niyanta')} "
    f"user={__import__('os').getenv('NIYANTA_DB_USER', 'postgres')} "
    f"password={__import__('os').getenv('NIYANTA_DB_PASSWORD', '')}"
)

GEOMETRY_COLS = {
    "dataset": ["bbox"],
    "watch_box": ["bbox"],
    "glacier": ["centroid", "bbox"],
    "dam": ["location"],
    "vector_feature": ["geom"],
    "river": ["path", "bbox"],
    "infra_footprint": ["geom"],
    "waterbody": ["centroid", "geom", "bbox"],
}


def main() -> int:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    from modules.db import client as db
    from modules.db import seed

    seed.seed_schema()

    try:
        pg = psycopg2.connect(PG_DSN)
    except Exception as exc:
        print(f"cannot reach PostgreSQL ({PG_DSN}): {exc}")
        print("nothing migrated; SQLite target left as-is.")
        return 1
    pg.autocommit = False

    tables = [
        r["name"]
        for r in db.query(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]

    total = 0
    with db.connection() as lite:
        cur = lite.cursor()
        with pg.cursor(cursor_factory=RealDictCursor) as src:
            for table in tables:
                src.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = %s",
                    (table,),
                )
                if src.fetchone() is None:
                    continue
                lite_cols = {r["name"] for r in db.query(f"PRAGMA table_info({table})")}
                src.execute(f'SELECT * FROM "{table}"')
                pg_cols = [d.name for d in src.description]
                cols = [c for c in pg_cols if c in lite_cols]
                if not cols:
                    continue
                select_cols = ", ".join(
                    f"ST_AsGeoJSON({c}) AS {c}" if c in GEOMETRY_COLS.get(table, []) else f'"{c}"'
                    for c in cols
                )
                src.execute(f'SELECT {select_cols} FROM "{table}"')
                rows = src.fetchall()
                cur.execute(f"DELETE FROM {table}")
                if rows:
                    ph = ", ".join("?" * len(cols))
                    qcols = ", ".join(f'"{c}"' for c in cols)
                    sql = f'INSERT INTO "{table}" ({qcols}) VALUES ({ph})'
                    from modules.db.client import _adapt

                    cur.executemany(sql, [tuple(_adapt(r[c]) for c in cols) for r in rows])
                    total += len(rows)
                print(f"{table:24s} {len(rows):6d}")
        lite.commit()

    pg.close()
    print(f"\n{total} rows migrated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
