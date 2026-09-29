"""Breach equations verified against the HEC-RAS Hydraulic Reference Manual
worked Example Application (fictitious dam):

  V_w = 357.98e6 m3, h_b = h_d = 42.9 m, h_w = 44.26 m,
  crest width C = 9.15 m, upstream/downstream slopes 3.3H:1V,
  overtopping, impervious clay core, low erodibility.

Expected summary (HEC):
  method          bottom width (m)  side slope  t_form (hr)
  froehlich1995   221.4             1.4         2.95
  froehlich2008   179.9             1.0         2.47
  macdonald       249.0             0.5         3.32
  vonthun         144.2             0.5         1.14
  xuzhang         136.7             0.98        13.92
"""

from __future__ import annotations

import pytest

from modules.breach import equations
from modules.breach.equations import BreachInputs, all_methods, cb_reservoir, solve
from modules.breach.hydrograph import ReservoirState, hydrograph


@pytest.fixture
def hec_dam() -> BreachInputs:
    return BreachInputs(
        v_w=357.98e6,
        h_b=42.9,
        h_w=44.26,
        h_d=42.9,
        mode="overtopping",
        dam_type="corewall",
        erodibility="low",
        crest_width_m=9.15,
        upstream_slope=3.3,
        downstream_slope=3.3,
    )


def test_froehlich1995_matches_hec(hec_dam):
    g = solve("froehlich1995", hec_dam)
    assert g.avg_width_m == pytest.approx(281.5, rel=0.01)
    assert g.bottom_width_m == pytest.approx(221.4, rel=0.01)
    assert g.side_slope == pytest.approx(1.4)
    assert g.t_form_hr == pytest.approx(2.95, rel=0.02)


def test_froehlich2008_matches_hec(hec_dam):
    g = solve("froehlich2008", hec_dam)
    assert g.avg_width_m == pytest.approx(222.76, rel=0.01)
    assert g.bottom_width_m == pytest.approx(179.86, rel=0.01)
    assert g.side_slope == pytest.approx(1.0)
    assert g.t_form_hr == pytest.approx(2.47, rel=0.02)


def test_macdonald_matches_hec(hec_dam):
    g = solve("macdonald", hec_dam)
    assert g.volume_eroded_m3 == pytest.approx(1.70556e6, rel=0.01)
    assert g.bottom_width_m == pytest.approx(249.0, rel=0.01)
    assert g.t_form_hr == pytest.approx(3.32, rel=0.02)
    assert g.side_slope == pytest.approx(0.5)


def test_vonthun_matches_hec(hec_dam):
    g = solve("vonthun", hec_dam)
    assert cb_reservoir(hec_dam.v_w) == pytest.approx(54.9)
    assert g.avg_width_m == pytest.approx(165.6, rel=0.01)
    assert g.bottom_width_m == pytest.approx(144.2, rel=0.02)
    assert g.t_form_hr == pytest.approx(1.14, rel=0.02)


def test_xuzhang_matches_hec(hec_dam):
    g = solve("xuzhang", hec_dam)
    assert g.avg_width_m == pytest.approx(178.67, rel=0.01)
    assert g.top_width_m == pytest.approx(220.64, rel=0.01)
    assert g.bottom_width_m == pytest.approx(136.7, rel=0.02)
    assert g.side_slope == pytest.approx(0.98, rel=0.03)
    assert g.t_form_hr == pytest.approx(13.92, rel=0.02)


def test_cb_table_steps():
    assert cb_reservoir(1e6) == 6.1
    assert cb_reservoir(3e6) == 18.3
    assert cb_reservoir(1e7) == 42.7
    assert cb_reservoir(2e7) == 54.9


def test_all_methods_return_positive(hec_dam):
    for g in all_methods(hec_dam):
        assert g.bottom_width_m > 0
        assert g.t_form_hr > 0
        assert 0 < g.side_slope <= 2


def test_piping_narrower_than_overtopping():
    ot = BreachInputs(v_w=1e8, h_b=30, h_w=30, h_d=30, mode="overtopping")
    pp = BreachInputs(v_w=1e8, h_b=30, h_w=30, h_d=30, mode="piping")
    assert solve("froehlich1995", pp).bottom_width_m < solve("froehlich1995", ot).bottom_width_m


def test_manual_override():
    i = BreachInputs(v_w=1e8, h_b=30, h_w=30, h_d=30)
    g = solve("manual", i, width_m=150, depth_m=25, t_form_hr=3, side_slope=1.0)
    assert g.bottom_width_m == 150
    assert g.t_form_hr == 3


def test_hydrograph_level_pool_basics(hec_dam):
    g = solve("froehlich2008", hec_dam)
    res = ReservoirState(initial_level_m=1722.26, bed_level_m=1678.0,
                         storage_m3=357.98e6, area_m2=3.0e6, inflow_cms=50.0)
    out = hydrograph(g, res, duration_hr=24.0, mode="overtopping")
    assert out["peak_cms"] > 1000
    assert out["peak_cms"] < 300000
    assert out["peak_at_hr"] > 0
    assert len(out["time_s"]) == len(out["q_cms"])
    # volume released cannot exceed storage + inflow over duration
    assert out["released_hm3"] < 700
    # monotone-ish: peak occurs before reservoir empties
    assert out["level_m"][-1] <= out["level_m"][0]


def test_hydrograph_piping_starts_slower_than_overtopping(hec_dam):
    g = solve("froehlich2008", hec_dam)
    res = ReservoirState(initial_level_m=600, bed_level_m=570, storage_m3=2e8,
                         area_m2=1.0e7, inflow_cms=0.0)
    ot = hydrograph(g, res, duration_hr=24, mode="overtopping")
    pp = hydrograph(g, res, duration_hr=24, mode="piping")
    dt = ot["dt_s"]
    n30 = int(1800 / dt)
    early_ot = sum(ot["q_cms"][:n30]) * dt
    early_pp = sum(pp["q_cms"][:n30]) * dt
    assert early_pp < early_ot  # pipe releases less in first 30 min than weir


def test_peak_flow_cross_checks(hec_dam):
    q95 = equations.peak_flow_froehlich1995b(hec_dam.v_w, hec_dam.h_w)
    assert 5000 < q95 < 500000
    q_scs = equations.peak_flow_scs(44.26)
    assert q_scs == pytest.approx(16.6 * 44.26 ** 1.85)
