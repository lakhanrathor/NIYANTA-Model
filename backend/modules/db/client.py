from __future__ import annotations

import datetime as dt
import decimal
import json
import re
import sqlite3
import threading
import uuid as uuid_mod
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from config import settings

# ---------------------------------------------------------------------------
# SQLite driver (single file, WAL).  The public API is unchanged from the old
# psycopg2 layer so the ~500 call sites keep working; PostgreSQL-isms in the
# SQL text (%s placeholders, now(), ::casts, ILIKE, greatest/least) are
# rewritten on the way in by _translate().
# ---------------------------------------------------------------------------

_TS_FMT = "%Y-%m-%d %H:%M:%S"
_local = threading.local()


# --- parameter adaptation -------------------------------------------------


def _to_ts(v: dt.datetime) -> str:
    if v.tzinfo is not None:
        v = v.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return v.strftime(_TS_FMT)


def _adapt(v: Any) -> Any:
    if isinstance(v, (dict, list, tuple)):
        return json.dumps(v, default=str)
    if isinstance(v, uuid_mod.UUID):
        return str(v)
    if isinstance(v, dt.datetime):
        return _to_ts(v)
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def _bind(params: tuple | list | dict | Any) -> tuple | dict:
    if isinstance(params, dict):
        return {k: _adapt(v) for k, v in params.items()}
    if isinstance(params, (tuple, list)):
        return tuple(_adapt(p) for p in params)
    return _adapt(params)


# --- PG -> SQLite statement translation ------------------------------------
# Runs outside 'string' / "identifier" literals and comments only.

_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_WORD_MAP = {
    "greatest": "max",
    "least": "min",
    "ilike": "like",
    "false": "0",
    "true": "1",
}


def _translate(sql: str) -> str:
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        # string / identifier literals: copy verbatim
        if ch == "'" or ch == '"':
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                c2 = sql[i]
                out.append(c2)
                i += 1
                if c2 == quote:
                    if i < n and sql[i] == quote:  # doubled escape
                        out.append(sql[i])
                        i += 1
                        continue
                    break
            continue
        # comments: copy verbatim
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            j = sql.find("\n", i)
            j = n if j < 0 else j
            out.append(sql[i:j])
            i = j
            continue
        if ch == "/" and i + 1 < n and sql[i + 1] == "*":
            j = sql.find("*/", i)
            j = n if j < 0 else j + 2
            out.append(sql[i:j])
            i = j
            continue
        # %s placeholder -> ?
        if ch == "%" and i + 1 < n and sql[i + 1] == "s":
            out.append("?")
            i += 2
            continue
        # ::cast -> (drop type), including text[] style array suffixes
        if ch == ":" and i + 1 < n and sql[i + 1] == ":":
            i += 2
            while i < n and sql[i] in " \t\r\n":
                i += 1
            while i < n and (sql[i].isalnum() or sql[i] == "_"):
                i += 1
            k = i
            while k < n and sql[k] in " \t\r\n":
                k += 1
            if k + 1 < n and sql[k] == "[" and sql[k + 1] == "]":
                i = k + 2
            continue
        # words: now(), greatest(), least(), ILIKE, TRUE/FALSE
        if ch.isalpha() or ch == "_":
            m = _WORD_RE.match(sql, i)
            assert m is not None
            word = m.group(0)
            i = m.end()
            low = word.lower()
            if low == "now":
                k = i
                while k < n and sql[k] in " \t\r\n":
                    k += 1
                if k < n and sql[k] == "(":
                    depth = 1
                    k += 1
                    while k < n and depth:
                        if sql[k] == "(":
                            depth += 1
                        elif sql[k] == ")":
                            depth -= 1
                        k += 1
                    out.append("datetime('now')")
                    i = k
                    continue
                out.append(word)
                continue
            repl = _WORD_MAP.get(low)
            out.append(repl if repl is not None else word)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


# --- value converters (declared column types) ------------------------------


def _cv_json(b: Any) -> Any:
    if b is None:
        return None
    if isinstance(b, (bytes, bytearray)):
        b = b.decode("utf-8", "replace")
    try:
        return json.loads(b)
    except Exception:
        return b


def _cv_bool(b: Any) -> Any:
    if b is None:
        return None
    if isinstance(b, (bytes, bytearray)):
        b = b.decode("utf-8", "replace")
    if isinstance(b, int):
        return bool(b)
    return str(b).strip().lower() in ("1", "true", "t", "yes", "y", "on")


def _cv_str(b: Any) -> Any:
    if b is None:
        return None
    if isinstance(b, (bytes, bytearray)):
        return b.decode("utf-8", "replace")
    return str(b)


def _cv_date(b: Any) -> Any:
    if b is None:
        return None
    if isinstance(b, (bytes, bytearray)):
        b = b.decode("utf-8", "replace")
    try:
        return dt.date.fromisoformat(str(b))
    except ValueError:
        return b


for _case in (str.lower, str.upper):
    sqlite3.register_converter(_case("jsonb"), _cv_json)
    sqlite3.register_converter(_case("boolean"), _cv_bool)
    sqlite3.register_converter(_case("uuid"), _cv_str)
    sqlite3.register_converter(_case("date"), _cv_date)


# --- connection management (thread-local; no server) -----------------------


def _udf_left(s: Any, n: Any) -> Any:
    if s is None or n is None:
        return None
    return str(s)[: int(n)]


def _udf_right(s: Any, n: Any) -> Any:
    if s is None or n is None:
        return None
    return str(s)[-int(n):]


def _udf_to_timestamp(epoch: Any) -> Any:
    if epoch is None:
        return None
    return dt.datetime.fromtimestamp(float(epoch), dt.timezone.utc).strftime(_TS_FMT)


# --- PostGIS surface over GeoJSON text -------------------------------------
# Geometry columns are stored as GeoJSON text; these keep the old ST_* SQL
# callers working (ST_AsGeoJSON is an identity, ST_AsText converts via shapely).


def _gj(g: Any) -> Any:
    if isinstance(g, (dict, list)):
        return json.dumps(g)
    if isinstance(g, (bytes, bytearray)):
        return g.decode("utf-8", "replace")
    return g


def _udf_as_geojson(g: Any, *rest: Any) -> Any:
    if g is None:
        return None
    return _gj(g)


def _udf_as_text(g: Any, *rest: Any) -> Any:
    if g is None:
        return None
    from shapely.geometry import shape

    obj = json.loads(g) if isinstance(g, (str, bytes, bytearray)) else g
    return shape(obj).wkt


def _udf_geom_from_text(w: Any, *rest: Any) -> Any:
    if w is None:
        return None
    from shapely import wkt as shapely_wkt
    from shapely.geometry import mapping

    obj = w if isinstance(w, (dict, list)) else json.loads(w) if str(w).lstrip()[:1] == "{" else None
    if obj is None:
        obj = mapping(shapely_wkt.loads(str(w)))
    return json.dumps(obj)


def _udf_geom_from_geojson(g: Any, *rest: Any) -> Any:
    # Geometry is stored as GeoJSON text already: pass through.
    return _gj(g)


def _udf_set_srid(g: Any, *rest: Any) -> Any:
    # GeoJSON is implicitly lon/lat (EPSG:4326); SRID is a no-op.
    return _gj(g) if g is not None else None


def _udf_make_point(x: Any, y: Any, *rest: Any) -> Any:
    if x is None or y is None:
        return None
    return json.dumps({"type": "Point", "coordinates": [float(x), float(y)]})


def _udf_make_envelope(w: Any, s: Any, e: Any, n: Any, *rest: Any) -> Any:
    if w is None or s is None or e is None or n is None:
        return None
    w, s, e, n = float(w), float(s), float(e), float(n)
    return json.dumps(
        {"type": "Polygon",
         "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
    )


def _udf_geom_x(p: Any) -> Any:
    if p is None:
        return None
    obj = json.loads(p) if isinstance(p, (str, bytes, bytearray)) else p
    return obj["coordinates"][0]


def _udf_geom_y(p: Any) -> Any:
    if p is None:
        return None
    obj = json.loads(p) if isinstance(p, (str, bytes, bytearray)) else p
    return obj["coordinates"][1]


def _geo_bounds(g: Any) -> tuple[float, float, float, float] | None:
    if g is None:
        return None
    obj = json.loads(g) if isinstance(g, (str, bytes, bytearray)) else g
    xs: list[float] = []
    ys: list[float] = []

    def walk(c: Any) -> None:
        if isinstance(c, (list, tuple)):
            if c and isinstance(c[0], (int, float)):
                xs.append(float(c[0]))
                ys.append(float(c[1]))
            else:
                for item in c:
                    walk(item)

    walk(obj.get("coordinates"))
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _udf_xmin(g: Any) -> Any:
    b = _geo_bounds(g)
    return b[0] if b else None

def _udf_ymin(g: Any) -> Any:
    b = _geo_bounds(g)
    return b[1] if b else None


def _udf_xmax(g: Any) -> Any:
    b = _geo_bounds(g)
    return b[2] if b else None


def _udf_ymax(g: Any) -> Any:
    b = _geo_bounds(g)
    return b[3] if b else None


# Public helper: envelope of any GeoJSON geometry (for `&&`-style bbox tests
# that are now done in Python).
geo_bounds = _geo_bounds


def _open() -> sqlite3.Connection:
    path = Path(settings.db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(path), timeout=30.0, check_same_thread=False,
        detect_types=sqlite3.PARSE_DECLTYPES,
    )
    conn.row_factory = sqlite3.Row
    # PG functions that have no SQLite builtin
    conn.create_function("left", 2, _udf_left)
    conn.create_function("right", 2, _udf_right)
    conn.create_function("to_timestamp", 1, _udf_to_timestamp)
    # PostGIS surface (GeoJSON-backed)
    conn.create_function("ST_AsGeoJSON", -1, _udf_as_geojson)
    conn.create_function("ST_AsText", -1, _udf_as_text)
    conn.create_function("ST_GeomFromText", -1, _udf_geom_from_text)
    conn.create_function("ST_GeomFromGeoJSON", -1, _udf_geom_from_geojson)
    conn.create_function("ST_SetSRID", -1, _udf_set_srid)
    conn.create_function("ST_MakePoint", -1, _udf_make_point)
    conn.create_function("ST_MakeEnvelope", -1, _udf_make_envelope)
    conn.create_function("ST_X", -1, _udf_geom_x)
    conn.create_function("ST_Y", -1, _udf_geom_y)
    conn.create_function("ST_XMin", -1, _udf_xmin)
    conn.create_function("ST_YMin", -1, _udf_ymin)
    conn.create_function("ST_XMax", -1, _udf_xmax)
    conn.create_function("ST_YMax", -1, _udf_ymax)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _open()
        _local.conn = conn
        _local.depth = 0
    return conn


def ensure_pool() -> None:
    # Kept for call-site compatibility with the old psycopg2 pool: opens the
    # calling thread's connection eagerly so boot fails fast if the file is
    # unusable.
    _conn()


def close_pool() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.commit()
            conn.close()
        except Exception:
            pass
        _local.conn = None
        _local.depth = 0


@contextmanager
def connection():
    # Re-entrant on one thread: only the outermost block commits/rolls back,
    # so a db.query() inside a transaction joins that transaction instead of
    # committing underneath it.
    conn = _conn()
    depth = getattr(_local, "depth", 0)
    _local.depth = depth + 1
    try:
        yield conn
    except Exception:
        if depth == 0:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    else:
        if depth == 0:
            conn.commit()
    finally:
        _local.depth = depth


@contextmanager
def transaction():
    with connection() as conn:
        yield conn


# --- statement helpers ------------------------------------------------------


def query(sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
    stmt = _translate(sql)
    with connection() as conn:
        cur = conn.cursor()
        try:
            cur.execute(stmt, _bind(params))
            if cur.description is None:
                return []
            return [dict(r) for r in cur.fetchall()]
        finally:
            cur.close()


def query_one(sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple | dict = ()) -> int:
    stmt = _translate(sql)
    with connection() as conn:
        cur = conn.cursor()
        try:
            cur.execute(stmt, _bind(params))
            return cur.rowcount
        finally:
            cur.close()


def scalar(sql: str, params: tuple | dict = ()) -> Any:
    row = query_one(sql, params)
    if row is None:
        return None
    return next(iter(row.values()))


def insert(table: str, row: dict[str, Any]) -> dict[str, Any]:
    cols = ", ".join(f'"{c}"' for c in row.keys())
    ph = ", ".join(["?"] * len(row))
    sql = f'INSERT INTO "{table}" ({cols}) VALUES ({ph}) RETURNING *'
    return query_one(sql, tuple(row.values()))  # type: ignore[return-value]


def upsert(table: str, row: dict[str, Any], conflict: str) -> dict[str, Any]:
    cols = ", ".join(f'"{c}"' for c in row.keys())
    ph = ", ".join(["?"] * len(row))
    conflict_cols = {c.strip() for c in conflict.split(",")}
    updates = ", ".join(f'"{c}"=excluded."{c}"' for c in row.keys() if c not in conflict_cols)
    conflict_sql = ", ".join(f'"{c}"' for c in conflict_cols)
    sql = (
        f'INSERT INTO "{table}" ({cols}) VALUES ({ph}) '
        f'ON CONFLICT ({conflict_sql}) DO UPDATE SET {updates} RETURNING *'
    )
    return query_one(sql, tuple(row.values()))  # type: ignore[return-value]


def ping() -> bool:
    try:
        return scalar("SELECT 1") == 1
    except Exception:
        return False
