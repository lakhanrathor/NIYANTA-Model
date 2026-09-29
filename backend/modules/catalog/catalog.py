from __future__ import annotations

from typing import Any
from uuid import UUID

from modules.db import client as db


# ---------------------------------------------------------------- dataset
def dataset_create(kind: str, name: str, path: str | None = None, **kw: Any) -> dict:
    return db.insert(
        "dataset",
        {
            "kind": kind,
            "name": name,
            "path": path,
            "crs": kw.get("crs"),
            "bbox": kw.get("bbox"),  # WKT or None (router passes WKT)
            "meta": kw.get("meta", {}),
        },
    )


def dataset_get(dataset_id: str) -> dict | None:
    return db.query_one(
        "SELECT * FROM dataset WHERE id = %s AND deleted_at IS NULL", (dataset_id,)
    )


def dataset_list(kind: str | None = None) -> list[dict]:
    if kind:
        return db.query(
            "SELECT * FROM dataset WHERE kind = %s AND deleted_at IS NULL ORDER BY created DESC",
            (kind,),
        )
    return db.query("SELECT * FROM dataset WHERE deleted_at IS NULL ORDER BY created DESC")


def dataset_set_status(dataset_id: str, status: str, **meta: Any) -> None:
    if meta:
        db.execute(
            "UPDATE dataset SET status = %s, meta = meta || %s::jsonb WHERE id = %s",
            (status, _json(meta), dataset_id),
        )
    else:
        db.execute("UPDATE dataset SET status = %s WHERE id = %s", (status, dataset_id))


def dataset_delete(dataset_id: str) -> None:
    db.execute("UPDATE dataset SET deleted_at = now() WHERE id = %s", (dataset_id,))


# ---------------------------------------------------------------- product
def product_create(kind: str, path: str, *, run_id=None, dataset_id=None, scenario_id=None, meta=None) -> dict:
    return db.insert(
        "product",
        {
            "kind": kind,
            "path": path,
            "run_id": run_id,
            "dataset_id": dataset_id,
            "scenario_id": scenario_id,
            "meta": meta or {},
        },
    )


def product_get(product_id: str) -> dict | None:
    return db.query_one("SELECT * FROM product WHERE id = %s", (product_id,))


def product_latest(kind: str, *, run_id=None, dataset_id=None) -> dict | None:
    sql = "SELECT * FROM product WHERE kind = %s"
    params: list[Any] = [kind]
    if run_id:
        sql += " AND run_id = %s"
        params.append(run_id)
    if dataset_id:
        sql += " AND dataset_id = %s"
        params.append(dataset_id)
    sql += " ORDER BY created DESC LIMIT 1"
    return db.query_one(sql, tuple(params))


def product_list(*, run_id=None, dataset_id=None) -> list[dict]:
    sql = "SELECT * FROM product WHERE 1=1"
    params: list[Any] = []
    if run_id:
        sql += " AND run_id = %s"
        params.append(run_id)
    if dataset_id:
        sql += " AND dataset_id = %s"
        params.append(dataset_id)
    sql += " ORDER BY created DESC"
    return db.query(sql, tuple(params))


# ---------------------------------------------------------------- scenario
def scenario_create(spec: dict, *, risk_id=None, change_id=None) -> dict:
    return db.query_one(
        """INSERT INTO scenario ("case", name, spec, risk_id, change_id)
           VALUES (%s, %s, %s::jsonb, %s, %s) RETURNING *""",
        (spec["case"], spec.get("name"), _json(spec), risk_id, change_id),
    )


def scenario_get(scenario_id: str) -> dict | None:
    return db.query_one("SELECT * FROM scenario WHERE id = %s", (scenario_id,))


def scenario_list(case: str | None = None, dam_id: str | None = None) -> list[dict]:
    """List scenarios; dam_id narrows to one structure's saved configurations
    (spec->>'dam_id'), which is how Build shows its config shelf."""
    where: list[str] = []
    params: list[Any] = []
    if case:
        where.append('"case" = %s')
        params.append(case)
    if dam_id:
        where.append("spec->>'dam_id' = %s")
        params.append(dam_id)
    sql = "SELECT * FROM scenario"
    if where:
        sql += " WHERE " + " AND ".join(where)
    return db.query(sql + " ORDER BY created DESC", tuple(params))


def scenario_update_status(scenario_id: str, status: str) -> None:
    db.execute("UPDATE scenario SET status = %s, updated = now() WHERE id = %s", (status, scenario_id))


# ---------------------------------------------------------------- run
def run_create(scenario_id: str, engine: str) -> dict:
    return db.insert("run", {"scenario_id": scenario_id, "engine": engine, "state": "DRAFT"})


def run_get(run_id: str) -> dict | None:
    return db.query_one("SELECT * FROM run WHERE id = %s", (run_id,))


def run_list(state: str | None = None, scenario_id: str | None = None) -> list[dict]:
    sql = "SELECT r.*, s.name AS scenario_name, s.\"case\" AS scenario_case FROM run r JOIN scenario s ON s.id = r.scenario_id"
    params: list[Any] = []
    where: list[str] = []
    if state:
        where.append("r.state = %s")
        params.append(state)
    if scenario_id:
        where.append("r.scenario_id = %s")
        params.append(scenario_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY r.created DESC LIMIT 200"
    return db.query(sql, tuple(params))


def run_patch(run_id: str, **fields: Any) -> dict | None:
    if not fields:
        return run_get(run_id)
    sets = ", ".join(f"{k} = %s" for k in fields)
    values = tuple(_maybe_json(fields[k]) for k in fields)
    return db.query_one(
        f"UPDATE run SET {sets}, updated = now() WHERE id = %s RETURNING *",
        values + (run_id,),
    )


# ---------------------------------------------------------------- helpers
def _json(v: Any) -> str:
    import json

    return json.dumps(v)


def _maybe_json(v: Any) -> Any:
    import json

    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return v
