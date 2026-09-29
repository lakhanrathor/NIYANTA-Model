"""fast_swe device selection + CPU/CUDA field parity.

Two parity levels: short runs must match tightly (both backends stay below
threshold-flip noise); long runs may diverge by 0.5-ulp FMA rounding at wet/dry
razor edges, so only physical invariants are asserted there.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.solvers import fast_swe

torch = pytest.importorskip("torch")
cuda = torch.cuda.is_available()


def _mesh(n: int, dx: float = 30.0) -> dict:
    z = np.zeros((n, n), dtype=np.float32)
    z[:] = np.linspace(40.0, 0.0, n)[:, None] * 0.6
    z[n // 2 - 1 : n // 2 + 2, :] = 62.0
    z[n // 2 :, :] = 58.0
    return {
        "z": z,
        "cell_m": dx,
        "breach_cells": (np.array([n // 2]), np.array([n // 2])),
        "stations_km": {},
    }


_HG = {
    "time_s": np.array([0.0, 600.0, 3600.0]),
    "q_cms": np.array([0.0, 2500.0, 800.0]),
}


def test_auto_device_selection():
    assert fast_swe._resolve_device("auto", _mesh(48)) == "cpu"
    assert fast_swe._resolve_device("numpy", _mesh(400)) == "cpu"
    assert fast_swe._resolve_device("cpu", _mesh(400)) == "cpu"
    with pytest.raises(ValueError):
        fast_swe._resolve_device("tpu", _mesh(48))
    if cuda:
        assert fast_swe._resolve_device("auto", _mesh(400)) == "cuda"
        assert fast_swe._resolve_device("cuda", _mesh(48)) == "cuda"
    else:
        with pytest.raises(ValueError):
            fast_swe._resolve_device("cuda", _mesh(48))


@pytest.mark.skipif(not cuda, reason="cuda unavailable")
def test_gpu_cpu_parity_short_run():
    a = fast_swe.run(_mesh(128), _HG, duration_s=600.0, frames=12, device="cpu")
    b = fast_swe.run(_mesh(128), _HG, duration_s=600.0, frames=12, device="cuda")
    assert a.meta["device"] == "cpu" and b.meta["device"] == "cuda"
    np.testing.assert_array_equal(a.times_s, b.times_s)
    np.testing.assert_allclose(a.max_depth, b.max_depth, atol=1e-3)
    np.testing.assert_allclose(a.max_vel, b.max_vel, atol=1e-3)
    wet_a, wet_b = a.max_depth > 0.05, b.max_depth > 0.05
    assert (wet_a == wet_b).mean() >= 0.9999
    assert abs(a.meta["steps"] - b.meta["steps"]) <= 2
    assert a.meta["mass_balance_error_pct"] < 0.5
    assert b.meta["mass_balance_error_pct"] < 0.5
    both = ~np.isnan(a.arrival_s) & ~np.isnan(b.arrival_s)
    np.testing.assert_allclose(a.arrival_s[both], b.arrival_s[both], atol=1e-3)
    assert (np.isnan(a.arrival_s) == np.isnan(b.arrival_s)).mean() >= 0.9999


@pytest.mark.skipif(not cuda, reason="cuda unavailable")
def test_gpu_physical_parity_long_run():
    """Beyond flip-noise horizon: wet footprint, arrival and mass must agree."""
    a = fast_swe.run(_mesh(128), _HG, duration_s=1800.0, frames=24, device="cpu")
    b = fast_swe.run(_mesh(128), _HG, duration_s=1800.0, frames=24, device="cuda")
    assert (a.max_depth > 0.05).mean() > 0.01  # flood actually spread
    wet_a, wet_b = a.max_depth > 0.05, b.max_depth > 0.05
    assert (wet_a == wet_b).mean() >= 0.99
    frame_s = 1800.0 / 24
    both = ~np.isnan(a.arrival_s) & ~np.isnan(b.arrival_s)
    assert both.any()
    arrival_gap = np.abs(a.arrival_s[both] - b.arrival_s[both])
    assert arrival_gap.max() <= frame_s + 1e-6
    assert a.meta["mass_balance_error_pct"] < 5.0
    assert b.meta["mass_balance_error_pct"] < 5.0
    rel_vol = abs(a.meta["stored_hm3"] - b.meta["stored_hm3"]) / max(a.meta["stored_hm3"], 1e-9)
    assert rel_vol < 0.05


def _corner_mesh(n: int, dx: float = 30.0) -> dict:
    """Downhill toward row 0 AND col 0 — forces outflow through the two edges
    whose flux sign once differed between the numpy and torch paths."""
    prof = np.linspace(0.0, 40.0, n) * 0.6
    z = np.minimum(prof[None, :], prof[:, None]).astype(np.float32)
    return {
        "z": z,
        "cell_m": dx,
        "breach_cells": (np.array([n // 2]), np.array([n // 2])),
        "stations_km": {},
    }


def test_torch_path_drains_left_and_bottom_edges():
    """Regression: torch boundary flux must equal np.minimum(u, 0) (negative =
    outflow). An extra .neg() made the left/bottom edges inject mass instead of
    draining — water piled at the boundary, mass balance blew up to hundreds
    of percent on every large (GPU) grid."""
    n = 96
    mesh = _corner_mesh(n)
    np_meta = fast_swe._run_numpy(mesh, _HG, duration_s=1800.0, frames=18).meta
    t_meta = fast_swe._run_torch(mesh, _HG, duration_s=1800.0, frames=18,
                                 device="cpu").meta

    for m in (np_meta, t_meta):
        assert m["exited_hm3"] > 0.01, "water never left through col0/row0 edges"
        assert m["mass_balance_error_pct"] < 1.0, m
    assert abs(t_meta["exited_hm3"] - np_meta["exited_hm3"]) < 0.1 * np_meta["exited_hm3"]
    assert abs(t_meta["stored_hm3"] - np_meta["stored_hm3"]) < 0.1 * np_meta["stored_hm3"]
