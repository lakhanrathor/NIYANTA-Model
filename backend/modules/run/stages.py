"""Single source of truth for stage order and chaining."""

from __future__ import annotations

from typing import Any

from modules.catalog import catalog
from modules.jobs import queue as jobs
from modules.run import lifecycle

STAGES: list[str] = [
    "stage.terrain",
    "stage.mesh",
    "stage.breach",
    "stage.solve",
    "stage.post",
    "stage.impact",
    "stage.validate",
    "stage.export",
]

# The Run screen shows 7 rows; validate+export are one concept there.
DISPLAY_GROUPS: list[tuple[str, list[str]]] = [
    ("stage.terrain", ["stage.terrain"]),
    ("stage.mesh", ["stage.mesh"]),
    ("stage.breach", ["stage.breach"]),
    ("stage.solve", ["stage.solve"]),
    ("stage.post", ["stage.post"]),
    ("stage.impact", ["stage.impact"]),
    ("stage.validate", ["stage.validate", "stage.export"]),
]

# Display copy for the Run screen (docs/UI_SPEC.md §4).
STAGE_META: dict[str, dict[str, str]] = {
    "stage.terrain": {"title": "Terrain Preparation",
                      "subtitle": "DEM, river, domain, roughness",
                      "method": "Adaptive unstructured"},
    "stage.mesh": {"title": "Mesh Generation",
                   "subtitle": "Creating computational mesh...",
                   "method": "Refined along channel"},
    "stage.breach": {"title": "Breach Modelling",
                     "subtitle": "Generating breach hydrograph",
                     "method": "Froehlich / manual"},
    "stage.solve": {"title": "Hydrodynamic Solver",
                    "subtitle": "Running 1D solver",
                    "method": "Conservative finite volume"},
    "stage.post": {"title": "Post-processing",
                   "subtitle": "Computing flood metrics",
                   "method": "Depth / arrival / velocity"},
    "stage.impact": {"title": "Impact Analysis",
                     "subtitle": "Population, infrastructure, loss",
                     "method": "WorldPop + OSM overlay"},
    "stage.validate": {"title": "Validation & Export",
                       "subtitle": "Preparing outputs",
                       "method": "Benchmark + package"},
    "stage.export": {"title": "Validation & Export",
                     "subtitle": "Preparing outputs",
                     "method": "GeoTIFF / SHP / KML"},
}

ENGINE_LABEL = {
    # fast is a grid shallow-water solver; only `sph` is particles
    "fast": "2D SWE (fast)",
    "sph": "SPH particles",
    "delft3d": "Delft3D FM",
    "hecras": "HEC-RAS",
}


def stage_index(stage: str) -> int:
    return STAGES.index(stage)


def next_stage(stage: str) -> str | None:
    i = stage_index(stage)
    return STAGES[i + 1] if i + 1 < len(STAGES) else None


def enqueue_next(run_id: str, finished_stage: str) -> dict | None:
    """Called by a completed stage handler. Returns the enqueued job (or None at chain end)."""
    nxt = next_stage(finished_stage)
    if nxt is None:
        return finalize(run_id)
    lifecycle.set_stage(run_id, nxt, "queued", detail=f"chained from {finished_stage}")
    return jobs.add_job(nxt, {"run_id": run_id}, run_id=run_id)


def fail_run(run_id: str, stage: str, error: str) -> None:
    lifecycle.set_stage(run_id, stage, "failed", detail=error[:500])
    lifecycle.fail(run_id, f"{stage}: {error}")


def finalize(run_id: str) -> dict:
    """Chain finished: mark POST_PROCESSING → VALIDATED, fire completion hooks."""
    lifecycle.set_stage(run_id, "stage.export", "done", progress=100)
    lifecycle.set_state(run_id, "POST_PROCESSING", "finalizing")
    from modules.alert import notify as alert_notify  # noqa: PLC0415 - event hook

    alert_notify.on_run_complete(run_id)
    lifecycle.set_state(run_id, "VALIDATED", "all stages complete")
    return {"finalized": True, "run_id": run_id}


# ---------------------------------------------------------------- wiring
def on_stage_done(run_id: str, stage: str, result: dict[str, Any] | None = None) -> None:
    lifecycle.set_stage(run_id, stage, "done")
    enqueue_next(run_id, stage)
