"""D-Flow FM engine tests (modules/solvers/delft3d_fm): net writer + full run."""

from __future__ import annotations

from pathlib import Path

import netCDF4
import numpy as np
import pytest

from modules.run.grid import make_meta
from modules.solvers import delft3d_fm
from modules.solvers.delft3d_fm import builder

ENGINE = delft3d_fm.engine_available()
needs_engine = pytest.mark.skipif(
    not ENGINE, reason="delft3d engine not installed")


def test_write_net_nc_one_based_indices(tmp_path: Path) -> None:
    """D-Flow FM reads NetLink/NetElemNode as 1-based (Fortran convention)."""
    h, w = 6, 5
    x_grid, y_grid = np.meshgrid(np.linspace(78.0, 78.004, w + 1),
                                 np.linspace(22.0, 22.005, h + 1))
    z = np.full((h + 1, w + 1), 10.0)
    path = tmp_path / "m_net.nc"
    builder.write_net_nc(path, x_grid, y_grid, z)

    with netCDF4.Dataset(str(path)) as ds:
        n_node = ds.dimensions["nNetNode"].size
        links = np.asarray(ds.variables["NetLink"][:])
        elems = np.asarray(ds.variables["NetElemNode"][:])
    assert links.min() == 1 and links.max() == n_node
    assert elems.min() == 1 and elems.max() == n_node
    assert len(elems) == h * w


@needs_engine
def test_delft3d_run_mapping_ic_and_physics(tmp_path: Path) -> None:
    h, w, dx = 60, 60, 100.0
    z = np.tile(np.linspace(100, 60, h), (w, 1)).T.astype(np.float64)
    z[9:12, :] = np.maximum(z[9:12, :], 105)
    geo = make_meta(h, w, dx)
    mesh = {
        "z": z,
        "cell_m": dx,
        "dam_rc": (10, 28),
        "breach_cells": (np.array([10, 10]), np.array([28, 29])),
        "stations_km": {0.0: (10, 28), 5.0: (15, 30)},
    }
    hydro = {"time_s": [0, 600, 3600], "q_cms": [0, 1500, 300],
             "level_m": [120.0, 119.0, 115.0]}
    fs = delft3d_fm.run(
        mesh, hydro, duration_s=3600, frames=6,
        params={"geo": geo, "work_dir": tmp_path,
                "breach_geom": {"depth_m": 40.0},
                "initial_level_m": 120.0, "dam_height_m": 45.0},
    )
    m = fs.meta
    assert m["engine"] == "delft3d"
    assert m["mapped_elements"] == h * w
    assert fs.depth.shape == (6, h, w)
    assert np.isfinite(fs.max_depth).all()
    assert float(fs.max_depth.max()) < 45.0
    assert float(fs.max_vel.max()) > 0.1
    assert m["mass_balance_error_pct"] < 5.0
    # wave leaves the breach and reaches downstream
    late = np.asarray(fs.depth[-1])
    assert late[15:].max() > 0.1
    assert max(fs.stations["5.0"]["depth_m"]) > 0.1

    # native t=0 initial condition: reservoir wet, crest dry, downstream dry
    with netCDF4.Dataset(str(tmp_path / "output" / "niyanta_map.nc")) as ds:
        d0e = np.clip(np.asarray(ds.variables["waterdepth"][0],
                                 dtype=np.float64), 0, None)
        lon = np.asarray(ds.variables["FlowElem_xcc"][:], dtype=np.float64)
        lat = np.asarray(ds.variables["FlowElem_ycc"][:], dtype=np.float64)
    col = np.rint((lon - geo["origin_lon"]) / geo["dx_deg"] - 0.5).astype(np.int64)
    row_s = np.rint((lat - (geo["origin_lat"] - h * geo["dy_deg"]))
                    / geo["dy_deg"] - 0.5).astype(np.int64)
    ok = (col >= 0) & (col < w) & (row_s >= 0) & (row_s < h)
    cells = list(zip((h - 1 - row_s[ok]).tolist(), col[ok].tolist()))
    assert ok.sum() == h * w and len(set(cells)) == h * w, "element mapping broken"
    d0 = np.zeros((h, w))
    np.maximum.at(d0, (h - 1 - row_s[ok], col[ok]), d0e[ok])
    assert d0[:9].max() > 5.0, "reservoir dry at t=0"
    assert d0[10:12, 20:26].max() < 0.01, "dam crest/face wet at t=0"
    assert d0[9:11, 28:30].max() > 5.0, "breach gap not primed at t=0"
    assert d0[12:].max() < 0.01, "downstream flooded at t=0"
