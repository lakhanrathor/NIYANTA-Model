"""delft3d — D-Flow FM engine (MODULE_SPEC 4.15.3).

Builds a rectilinear D-Flow FM model from the run's conditioned grid with an
ensured dam ridge + solved breach gap, initializes the reservoir, runs the
precompiled community kernel headlessly via DIMR, then reads *_map.nc back
into the canonical FrameSeries. Requires `params` from work_solve:

    geo             grid_meta (rows/cols/dx_deg/origin …)
    work_dir        scratch directory for model input/output
    breach_geom     BreachGeom.as_dict() (depth_m used for the gap carve)
    initial_level_m reservoir water surface (spec reservoir.initial_level_m)
    dam_height_m    spec reservoir.dam_height_m (ridge freeboard)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from modules.solvers.base import FrameSeries
from modules.solvers.delft3d_fm import builder, engine, reader

__all__ = ["run", "engine_available"]


def engine_available(engine_root: str | Path | None = None) -> bool:
    from config import settings

    return engine.is_available(engine_root or settings.engine_root)


def run(mesh: dict[str, Any], hydrograph: dict[str, Any], *, duration_s: float,
        frames: int = 96,
        progress_cb: Callable[[int, str], None] | None = None,
        params: dict[str, Any] | None = None,
        arrival_threshold_m: float = 0.05) -> FrameSeries:
    params = params or {}
    missing = [k for k in ("geo", "work_dir", "breach_geom") if k not in params]
    if missing:
        raise ValueError(f"delft3d engine requires params: {', '.join(missing)}")
    from config import settings

    geo = params["geo"]
    model_dir = Path(params["work_dir"])
    breach = params["breach_geom"]
    levels = hydrograph.get("level_m") or []
    initial_level = float(params.get("initial_level_m")
                          or (levels[0] if levels else 10.0))
    dam_height = float(params.get("dam_height_m") or 20.0)

    if progress_cb:
        progress_cb(1, "delft3d: building model")

    manifest = builder.build_model(
        model_dir,
        z=mesh["z"],
        geo=geo,
        dam_rc=tuple(mesh["dam_rc"]),
        breach_cells=mesh["breach_cells"],
        initial_level_m=initial_level,
        dam_height_m=dam_height,
        breach_depth_m=float(breach.get("depth_m") or dam_height),
        duration_s=duration_s,
        frames=frames,
    )

    if progress_cb:
        progress_cb(5, "delft3d: running D-Flow FM kernel")

    def engine_progress(pct: int, msg: str) -> None:
        if progress_cb:
            progress_cb(min(5 + int(pct * 0.80), 85), f"delft3d: {msg}")

    summary = engine.run_model(
        model_dir,
        engine_root=settings.engine_root,
        timeout_s=float(params.get("timeout_s") or 3600.0),
        progress_cb=engine_progress,
    )

    if progress_cb:
        progress_cb(86, "delft3d: reading map output")
    data = reader.read(
        model_dir,
        "niyanta",
        geo=geo,
        stations_km={str(km): tuple(v) for km, v in mesh.get("stations_km", {}).items()},
        cell_m=float(mesh["cell_m"]),
        duration_s=duration_s,
        frames=frames,
        arrival_threshold_m=arrival_threshold_m,
    )
    meta = data["meta"]
    meta.update({
        "crest_m": manifest["crest_m"],
        "gap_bottom_m": manifest["gap_bottom_m"],
        "initial_level_m": initial_level,
        "engine_wall_time_sec": summary["wall_time_sec"],
        "cell_m": float(mesh["cell_m"]),
    })
    if progress_cb:
        progress_cb(99, f"delft3d: done in {summary['wall_time_sec']}s, "
                        f"{meta['native_timesteps']} native steps")
    return FrameSeries(
        times_s=data["times_s"],
        depth=data["depth"],
        max_depth=data["max_depth"],
        max_vel=data["max_vel"],
        arrival_s=data["arrival_s"],
        stations=data["stations"],
        meta=meta,
    )
