"""stage.validate — benchmark comparison (Hidkal 2021), observed-mask IoU, grade."""

from __future__ import annotations

import statistics
from typing import Any

import numpy as np

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.run import result as run_result
from modules.storage import paths

# Hidkal dam-break reference (Bharath et al. 2021 / MODULE_SPEC 4.18)
HIDKAL2021 = {
    "piping": {"peak_cms": 72085.45, "extent_km2": 75.224},
    "overtopping": {"peak_cms": 78454.82, "extent_km2": 79.205},
}

GRADE_BANDS = [(10.0, "A"), (25.0, "B"), (40.0, "C")]


def _band(err_pct: float) -> str:
    for limit, grade in GRADE_BANDS:
        if err_pct <= limit:
            return grade
    return "D"


def handle_validate(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    return score(run_id, progress=ctx.progress)


def score(run_id: str, progress=None) -> dict[str, Any]:
    """Score a run against its benchmark / observed mask and persist validation_score.

    Shared by the stage handler and POST /api/validate/benchmark/{run_id}."""
    run = catalog.run_get(run_id)
    assert run
    spec = catalog.scenario_get(run["scenario_id"])["spec"]
    metrics = run.get("metrics") or {}
    if progress:
        progress(89, "validate: comparing references")

    detail: dict[str, Any] = {"mass_balance_error_pct": metrics.get("mass_balance_error_pct")}
    grade: str | None = None
    err_peak: float | None = None
    err_extent: float | None = None
    iou: float | None = None
    benchmark = spec.get("benchmark")

    if benchmark == "hidkal2021":
        mode = (spec.get("breach") or {}).get("mode", "overtopping")
        ref = HIDKAL2021.get(mode, HIDKAL2021["overtopping"])
        peak = float(metrics.get("peak_discharge_cms") or 0.0)
        extent = float(metrics.get("inundation_km2") or 0.0)
        err_peak = abs(peak - ref["peak_cms"]) / ref["peak_cms"] * 100.0
        err_extent = abs(extent - ref["extent_km2"]) / ref["extent_km2"] * 100.0
        worst = max(err_peak, err_extent)
        grade = _band(worst)
        detail.update({"reference": ref, "mode": mode, "error_peak_pct": err_peak,
                       "error_extent_pct": err_extent})
    else:
        # observed mask (e.g. SAR/GEE validated extent), if attached to the run
        prod = catalog.product_latest("observed_extent", run_id=run_id)
        if prod:
            iou = _observed_iou(run_id, prod)
            if iou is not None:
                grade = "A" if iou >= 0.6 else ("B" if iou >= 0.4 else "C")
                detail["extent_iou"] = iou
                detail["reference"] = "observed_extent"

    # recorded point observations (spec.observed): modelled vs observed
    observed = spec.get("observed") or []
    if observed:
        rows = observation_rows(run_id, observed)
        detail["observations"] = rows
        errs = [r["err_pct"] for r in rows if r["err_pct"] is not None]
        if errs:
            med = statistics.median(errs)
            detail["observation_median_err_pct"] = round(med, 1)
            if grade is None:
                grade = _band(med)
                detail["reference"] = "observed_points"

    mb_err = float(metrics.get("mass_balance_error_pct") or 0.0)
    if mb_err > 5.0:
        detail["mass_balance_warning"] = mb_err
        if grade in ("A", "B"):
            grade = "B" if grade == "A" else "C"
    if grade is None:
        detail["note"] = "no reference available; internal consistency only"
        grade = "B" if mb_err <= 1.0 else ("C" if mb_err <= 5.0 else "D")

    db.upsert(
        "validation_score",
        {
            "run_id": run_id,
            "benchmark": benchmark,
            "error_peak_pct": err_peak,
            "error_arrival_pct": None,
            "extent_error_pct": err_extent,
            "extent_iou": iou,
            "grade": grade,
            "detail": detail,
        },
        conflict="run_id",
    )
    run_result.merge(run_id, validation={"benchmark": benchmark, "error_peak_pct": err_peak,
                                         "extent_iou": iou, "grade": grade,
                                         "reference": detail.get("reference"),
                                         "observation_median_err_pct": detail.get("observation_median_err_pct")})
    if progress:
        progress(91, f"validate: grade {grade}")
    return {"grade": grade, "benchmark": benchmark}


def observation_rows(run_id: str, observed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per recorded value: the run sampled at the same point (max
    depth, max velocity, first-wet arrival — the probe's semantics)."""
    from routers.tiles import sample_point  # noqa: PLC0415

    rows: list[dict[str, Any]] = []
    for ob in observed:
        sim = sample_point(run_id, float(ob["lon"]), float(ob["lat"])) or {}
        arr = sim.get("arrival_s")
        modelled = {"arrival_min": None if arr is None else arr / 60.0,
                    "depth_m": sim.get("depth_m"), "velocity_ms": sim.get("velocity_mps")}
        for metric in ("arrival_min", "depth_m", "velocity_ms"):
            obs = ob.get(metric)
            if obs is None:
                continue
            mod = modelled[metric]
            err = None if mod is None or not obs else abs(mod - obs) / obs * 100.0
            rows.append({"name": ob["name"], "metric": metric, "observed": obs,
                         "modelled": None if mod is None else round(float(mod), 2),
                         "err_pct": None if err is None else round(err, 1),
                         "source": ob.get("source"), "lon": ob["lon"], "lat": ob["lat"]})
    return rows


def _observed_iou(run_id: str, prod: dict) -> float | None:
    """IoU between stored observed_extent mask (0/1 GeoTIFF) and run extent."""
    try:
        from modules.proc_dem import mod_detect

        path = paths.abs_path(prod["path"])
        obs, _ = mod_detect.read(path)
        from modules.solvers.base import FrameSeries

        frames = FrameSeries.load(paths.run_dir(run_id) / "frames.npz")
        sim = (frames.max_depth > 0.1).astype(np.uint8)
        obs_bin = (np.nan_to_num(obs) > 0.5).astype(np.uint8)
        if obs_bin.shape != sim.shape:
            obs_bin = obs_bin[: sim.shape[0], : sim.shape[1]]
            if obs_bin.shape != sim.shape:
                return None
        inter = np.count_nonzero(obs_bin & sim)
        union = np.count_nonzero(obs_bin | sim)
        return float(inter / union) if union else None
    except Exception:
        return None
