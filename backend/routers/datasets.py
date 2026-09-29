from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs import queue as jobs
from modules.storage import paths

router = APIRouter(prefix="/datasets", tags=["datasets"])

KINDS = {"dem", "imagery_pre", "imagery_post", "sar", "vector", "dam", "weather", "population", "other"}


def _bbox_wkt(meta: dict[str, Any]) -> str | None:
    b = meta.get("bbox")
    if not b or len(b) != 4:
        return None
    w, s, e, n = b
    return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"


@router.post("")
async def upload_dataset(kind: str = Form(...), name: str = Form(...), file: UploadFile = File(...)) -> dict:
    if kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(KINDS)}")
    ds = catalog.dataset_create(kind, name)
    dest = paths.upload_path(ds["id"], file.filename or "upload.bin")
    with dest.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    rel_path = paths.rel(dest)
    db.execute("UPDATE dataset SET path = %s WHERE id = %s", (rel_path, str(ds["id"])))
    catalog.dataset_set_status(ds["id"], "ready", size=dest.stat().st_size,
                               original_name=file.filename)
    # bbox is discovered by proc_* when processing runs
    job = jobs.add_job("dataset.process", {"dataset_id": ds["id"]})
    db.insert("proc_log", {"dataset_id": ds["id"], "stage": "upload", "status": "done", "msg": f"stored {dest.name}"})
    return {"dataset": catalog.dataset_get(ds["id"]), "job_id": job["id"]}


@router.get("")
def list_datasets(kind: str | None = None) -> list[dict]:
    return catalog.dataset_list(kind)


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    ds = catalog.dataset_get(dataset_id)
    if not ds:
        raise HTTPException(404, "dataset not found")
    logs = db.query("SELECT * FROM proc_log WHERE dataset_id = %s ORDER BY ts", (dataset_id,))
    products = catalog.product_list(dataset_id=dataset_id)
    return {"dataset": ds, "proc_log": logs, "products": products}


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str) -> dict:
    if not catalog.dataset_get(dataset_id):
        raise HTTPException(404, "dataset not found")
    catalog.dataset_delete(dataset_id)
    p = paths.UPLOADS / dataset_id
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)
    return {"deleted": dataset_id}


@router.post("/{dataset_id}/reprocess")
def reprocess(dataset_id: str) -> dict:
    if not catalog.dataset_get(dataset_id):
        raise HTTPException(404, "dataset not found")
    job = jobs.add_job("dataset.process", {"dataset_id": dataset_id})
    return {"job_id": job["id"]}
