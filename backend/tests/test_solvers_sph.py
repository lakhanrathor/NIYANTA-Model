"""SPH near-field engine tests (modules/solvers/sph.py)."""

from __future__ import annotations

import numpy as np

from modules.solvers import sph


def _mesh() -> dict:
    h, w, dx = 60, 60, 100.0
    z = np.tile(np.linspace(100, 60, h), (w, 1)).T.astype(np.float64)
    z[9:12, :] = np.maximum(z[9:12, :], 105)
    return {
        "z": z,
        "cell_m": dx,
        "breach_cells": (np.array([10, 10]), np.array([28, 29])),
        "stations_km": {0.0: (10, 28), 5.0: (15, 30), 10.0: (20, 32)},
    }


def _hg() -> dict:
    return {"time_s": [0, 600, 3600, 7200], "q_cms": [0, 1800, 900, 100]}


def test_sph_run_shapes_and_physics() -> None:
    fs = sph.run(_mesh(), _hg(), duration_s=1200, frames=6, window_m=1500,
                 max_steps=60000)
    m = fs.meta
    assert m["engine"] == "sph"
    assert fs.depth.shape == (6, 60, 60)
    assert np.isfinite(fs.max_depth).all()
    assert np.isfinite(fs.max_vel).all()
    assert fs.max_depth.max() > 0.05
    assert not m["truncated"]
    assert m["mass_balance_error_pct"] < 5.0
    assert m["particles_alive"] > 0
    # flood must leave the breach and travel downstream
    wet = np.argwhere(fs.max_depth > 0.05)
    assert wet[:, 0].max() > 12
    # downstream station records a wet depth band
    assert max(fs.stations["5.0"]["depth_m"]) > 0.1
    assert len(fs.stations["0.0"]["times_s"]) == 6


def test_sph_empty_run_is_zero_frames() -> None:
    fs = sph.run(_mesh(), {"time_s": [0, 7200], "q_cms": [0, 0]},
                 duration_s=600, frames=4, window_m=1500, max_steps=5000)
    assert fs.depth.shape == (4, 60, 60)
    assert fs.meta["particles_spawned"] == 0
    assert float(fs.max_depth.max()) == 0.0
    assert np.isnan(fs.arrival_s).all()
