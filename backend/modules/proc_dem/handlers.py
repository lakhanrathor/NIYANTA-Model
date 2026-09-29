"""dataset.process job: detect DEM kind → store conditioned product."""

from __future__ import annotations

from pathlib import Path

from modules.catalog import catalog
from modules.jobs import queue as jobs
from modules.jobs.queue import JobContext
from modules.proc_dem import mod_condition, mod_detect
from modules.storage import paths


def handle_dataset_process(ctx: JobContext) -> dict:
    dataset_id = ctx.params["dataset_id"]
    ds = catalog.dataset_get(dataset_id)
    if not ds:
        raise ValueError(f"dataset {dataset_id} not found")
    catalog.dataset_set_status(dataset_id, "processing")
    ctx.progress(10, f"processing {ds['kind']}: {ds['name']}")
    kind = ds["kind"]

    try:
        if kind == "dem" and ds.get("path"):
            src = paths.abs_path(ds["path"])
            z, meta = mod_detect.read(src)
            mod_detect.log(dataset_id, "clip", "done", f"{meta['width']}x{meta['height']}")
            ctx.progress(40, "conditioning DEM (pit fill)")
            z2 = mod_condition.condition(z)
            out = paths.product_file("conditioned_dem", dataset_id, "tif")
            mod_detect.write_geotiff(out, z2, meta)
            product = catalog.product_create("conditioned_dem", paths.rel(out), dataset_id=dataset_id, meta=meta)
            mod_detect.log(dataset_id, "condition", "done", str(out.name))
        else:
            product = _process_by_kind(kind, ds, ctx)
        catalog.dataset_set_status(dataset_id, "ready")
        ctx.progress(100, "done")
        return {"product_id": str(product["id"]), "kind": kind}
    except Exception as exc:
        catalog.dataset_set_status(dataset_id, "failed")
        mod_detect.log(dataset_id, "process", "failed", str(exc))
        raise


def register() -> None:
    jobs.register("dataset.process", handle_dataset_process)


def _process_by_kind(kind: str, ds: dict, ctx: JobContext):
    """Dispatch non-DEM kinds to their proc module (4.6–4.11) then record the product."""
    dataset_id = str(ds["id"])
    progress = lambda p, m: ctx.progress(10 + int(p * 0.8), m)  # noqa: E731
    if kind == "vector":
        from modules import proc_vector
        res = proc_vector.process(ds, progress)
    elif kind in ("imagery_pre", "imagery_post"):
        from modules import proc_imagery
        res = proc_imagery.process(ds, progress)
    elif kind == "sar":
        from modules import proc_sar
        res = proc_sar.process(ds, progress)
    elif kind == "dam":
        from modules import proc_dam
        res = proc_dam.process(ds, progress)
    elif kind == "weather":
        from modules import proc_weather
        res = proc_weather.process(ds, progress)
    elif kind == "population":
        from modules import proc_population
        res = proc_population.process(ds, progress)
    elif kind == "gee_export":
        from modules import proc_imagery
        res = proc_imagery.process(ds, progress)
    else:
        res = {"kind": "ingested", "path": None, "meta": {}}
    mod_detect.log(dataset_id, "process", "done", res["kind"])
    return catalog.product_create(res["kind"], res.get("path") or ds.get("path") or "",
                                  dataset_id=dataset_id, meta=res.get("meta") or {})
