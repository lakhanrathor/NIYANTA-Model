"""stage.mesh — centerline, dam line, stations; persists mesh.npz + mesh_meta row."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.mesh import build as mesh_build
from modules.run import work_terrain
from modules.storage import paths


def handle_mesh(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    spec = catalog.scenario_get(run["scenario_id"])["spec"]
    ctx.progress(16, "mesh: tracing centerline")

    z, meta = work_terrain.load_dem(run_id)
    dam_rc = tuple(meta["dam_rc"])
    mesh = mesh_build.build(z, dam_rc, float(meta["cell_m"]),
                            [float(km) for km in spec.get("stations_km") or [0.0, 5.0, 10.0, 15.0, 20.0]])

    run_dir = paths.run_dir(run_id)
    np.savez_compressed(
        run_dir / "mesh.npz",
        centerline=mesh["centerline"],
        dam_line=mesh["dam_line"],
        dam_rc=np.asarray(mesh["dam_rc"]),
        stations_keys=np.asarray([str(k) for k in mesh["stations_km"].keys()]),
        stations_rc=np.asarray([[v[0], v[1]] for v in mesh["stations_km"].values()]),
    )

    db.upsert(
        "mesh_meta",
        {
            "run_id": run_id,
            "centerline_path": paths.rel(run_dir / "mesh.npz"),
            "sections_count": mesh["sections_count"],
            "cells_count": int(z.shape[0] * z.shape[1]),
            "dam_structure": {"dam_rc": list(mesh["dam_rc"]),
                              "line_cells": int(len(mesh["dam_line"])),
                              "crest_length_m": int(len(mesh["dam_line"]) * meta["cell_m"])},
            "meta": {"centerline_length_m": mesh["centerline_length_m"],
                     "stations": {str(k): list(v) for k, v in mesh["stations_km"].items()}},
        },
        conflict="run_id",
    )
    catalog.product_create("mesh", paths.rel(run_dir / "mesh.npz"), run_id=run_id,
                           meta={"sections": mesh["sections_count"],
                                 "centerline_len_m": mesh["centerline_length_m"]})
    ctx.progress(24, f"mesh: centerline {mesh['centerline_length_m']/1000:.1f} km, "
                     f"{mesh['sections_count']} sections")
    return {"sections": mesh["sections_count"]}


def load_mesh(run_id: str) -> dict[str, Any]:
    with np.load(paths.run_dir(run_id) / "mesh.npz", allow_pickle=False) as d:
        return {
            "centerline": d["centerline"],
            "dam_line": d["dam_line"],
            "dam_rc": (int(d["dam_rc"][0]), int(d["dam_rc"][1])),
            "stations_km": {float(k): (int(rc[0]), int(rc[1]))
                            for k, rc in zip(d["stations_keys"], d["stations_rc"])},
        }
