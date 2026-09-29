"""stage.solve — breach geometry + hydrograph (+sensitivity), engine dispatch,
FrameSeries persisted for post."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from modules.breach import inputs_from_spec, sensitivity, solve_spec
from modules.breach.hydrograph import ReservoirState
from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.mesh import build as mesh_build
from modules.run import work_mesh, work_terrain
from modules.solvers import base as solvers
from modules.storage import paths


def handle_solve(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    spec = catalog.scenario_get(run["scenario_id"])["spec"]
    engine = run["engine"]
    ctx.progress(26, f"solve: breach ({spec.get('breach', {}).get('method')}) + engine={engine}")

    geom, hg = solve_spec(spec)
    inputs, bed = inputs_from_spec(spec)
    sweep = sensitivity.sweep(
        spec.get("breach", {}).get("method", "froehlich2008"), inputs,
        __import__("modules.breach.hydrograph", fromlist=["ReservoirState"]).ReservoirState(
            initial_level_m=float((spec.get("reservoir") or {}).get("initial_level_m") or 0.0) or 1.0,
            bed_level_m=bed,
            storage_m3=float((spec.get("reservoir") or {}).get("storage_mcm") or 0.0) * 1e6 or inputs.v_w,
            area_m2=float((spec.get("reservoir") or {}).get("area_km2") or 0.0) * 1e6 or 1.0,
            inflow_cms=float((spec.get("reservoir") or {}).get("inflow_cms") or 0.0),
        ),
        duration_hr=float((spec.get("horizon") or {}).get("duration_hr") or 24.0),
        mode=spec.get("breach", {}).get("mode", "overtopping"),
    )

    run_dir = paths.run_dir(run_id)
    hg_path = run_dir / "breach_hydrograph.json"
    hg_path.write_text(json.dumps(hg), encoding="utf-8")

    # resolve breach cells on the stored dam line
    z, grid_meta = work_terrain.load_dem(run_id)
    mesh = work_mesh.load_mesh(run_id)
    b_r, b_c = mesh_build.breach_cells_from_line(
        mesh["dam_line"], mesh["dam_rc"], float(grid_meta["cell_m"]), geom.bottom_width_m
    )

    solver_mesh = {
        "z": z,
        "cell_m": float(grid_meta["cell_m"]),
        "breach_cells": (b_r, b_c),
        "stations_km": mesh["stations_km"],
        "dam_line": mesh["dam_line"],
        "dam_rc": mesh["dam_rc"],
    }

    duration_s = float((spec.get("horizon") or {}).get("duration_hr") or 24.0) * 3600.0

    def progress_cb(pct: int, msg: str) -> None:
        ctx.progress(26 + int(pct * 0.43), f"solve: {msg}")

    params = None
    if engine == "delft3d":
        reservoir = spec.get("reservoir") or {}
        params = {
            "geo": grid_meta,
            "work_dir": str(paths.run_dir(run_id) / "delft3d"),
            "breach_geom": geom.as_dict(),
            "initial_level_m": float(reservoir.get("initial_level_m") or 0.0)
            or float(hg["level_m"][0]),
            "dam_height_m": float(reservoir.get("dam_height_m") or 20.0),
        }

    ctx.progress(30, f"solve: engine={engine}, {duration_s/3600:.1f}h horizon")
    frames = solvers.run(engine, solver_mesh, hg, duration_s=duration_s, frames=96,
                         progress_cb=progress_cb, params=params)
    frames.meta["breach"] = geom.as_dict()
    frames.meta["grid"] = grid_meta
    frames.meta["hydrograph_path"] = paths.rel(hg_path)
    fs_path = run_dir / "frames.npz"
    frames.save(fs_path)
    if frames.particles is not None:
        pt_path = run_dir / "particles.npz"
        np.savez_compressed(pt_path, particles=frames.particles.astype(np.float32),
                            times_s=frames.times_s.astype(np.float64),
                            l0_m=np.float64(frames.meta.get("l0_m") or 0.0),
                            cell_m=np.float64(frames.meta.get("cell_m") or 0.0))
        catalog.product_create("particles", paths.rel(pt_path), run_id=run_id,
                               meta={"frames": int(frames.particles.shape[0]),
                                     "cap": int(frames.particles.shape[1])})

    db.upsert(
        "breach_solution",
        {
            "scenario_id": run["scenario_id"],
            "method": geom.method,
            "mode": spec.get("breach", {}).get("mode", "overtopping"),
            "width_m": geom.bottom_width_m,
            "depth_m": geom.depth_m,
            "side_slope": geom.side_slope,
            "t_form_hr": geom.t_form_hr,
            "hydrograph_path": paths.rel(hg_path),
            "sensitivity": sweep,
        },
        conflict="scenario_id",
    )
    catalog.product_create("breach_hydrograph", paths.rel(hg_path), run_id=run_id,
                           scenario_id=run["scenario_id"],
                           meta={"peak_cms": hg["peak_cms"], "peak_at_hr": hg["peak_at_hr"]})
    catalog.product_create("frames", paths.rel(fs_path), run_id=run_id,
                           meta={"frames": int(frames.depth.shape[0]),
                                 "mb_err": frames.meta.get("mass_balance_error_pct")})
    ctx.progress(69, f"solve: peak {hg['peak_cms']:.0f} m³/s, "
                     f"{frames.depth.shape[0]} frames, mb err {frames.meta.get('mass_balance_error_pct', 0):.2f}%")
    return {"engine": engine, "peak_cms": hg["peak_cms"], "frames": int(frames.depth.shape[0])}
