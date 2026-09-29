"""Empirical breach geometry equations — all metric (m, m3, hrs).

Sources: HEC-RAS Hydraulic Reference Manual, "Estimating Breach Parameters"
(https://hec.usace.army.mil/confluence/rasdocs/ras1dtechref/latest/.../estimating-breach-parameters)
Worked-example values verified against HEC "Example Application" page:
fictitious dam V_w=357.98e6 m3, h_b=h_d=42.9 m, h_w=44.26 m,
C=9.15 m, Z1=Z2=3.3, overtopping, clay core, low erodibility.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Literal

METHODS = ("froehlich2008", "froehlich1995", "vonthun", "xuzhang", "macdonald", "manual")

G = 9.80665


@dataclass
class BreachGeom:
    method: str
    avg_width_m: float
    bottom_width_m: float
    side_slope: float          # H:1V
    depth_m: float             # h_b, breach height
    t_form_hr: float
    volume_eroded_m3: float | None = None
    top_width_m: float | None = None
    notes: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class BreachInputs:
    """Everything the equations need, resolved from ScenarioSpec + dam record."""
    v_w: float            # water volume above breach invert (m3)
    h_b: float            # breach height, crest to invert (m)
    h_w: float            # water depth above breach invert at failure (m)
    h_d: float            # dam height (m)
    mode: str = "overtopping"   # overtopping | piping | attack | blockage_breach
    dam_type: str = "homogeneous"   # homogeneous | corewall | concrete_faced
    erodibility: str = "medium"     # high | medium | low
    crest_width_m: float = 10.0
    upstream_slope: float = 3.0
    downstream_slope: float = 3.0

    @property
    def overtopping(self) -> bool:
        return self.mode in ("overtopping", "blockage_breach")


# Von Thun & Gillette (1990) reservoir-size coefficient (HEC table, metric)
_CB_TABLE = [
    (1.23e6, 6.1),
    (6.17e6, 18.3),
    (1.23e7, 42.7),
    (float("inf"), 54.9),
]


def cb_reservoir(v_m3: float) -> float:
    for limit, cb in _CB_TABLE:
        if v_m3 < limit:
            return cb
    return 54.9


def froehlich1995(i: BreachInputs) -> BreachGeom:
    k0 = 1.4 if i.overtopping else 1.0
    avg = 0.1803 * k0 * (i.v_w ** 0.32) * (i.h_b ** 0.19)
    tf = 0.00254 * (i.v_w ** 0.53) * (i.h_b ** -0.90)
    z = 1.4 if i.overtopping else 0.9
    return BreachGeom("froehlich1995", avg, avg - z * i.h_b, z, i.h_b, tf,
                      notes="Froehlich (1995a), 63-case regression; Z per Froehlich side-slope guidance")


def froehlich2008(i: BreachInputs) -> BreachGeom:
    k0 = 1.3 if i.overtopping else 1.0
    avg = 0.27 * k0 * (i.v_w ** 0.32) * (i.h_b ** 0.04)
    tf_sec = 63.2 * math.sqrt(i.v_w / (G * i.h_b ** 2))
    z = 1.0 if i.overtopping else 0.7
    return BreachGeom("froehlich2008", avg, avg - z * i.h_b, z, i.h_b, tf_sec / 3600.0,
                      notes="Froehlich (2008), 74-case regression")


def macdonald(i: BreachInputs) -> BreachGeom:
    clay_or_rock = i.dam_type in ("corewall", "concrete_faced")
    if clay_or_rock:
        v_er = 0.00348 * ((i.v_w * i.h_w) ** 0.852)
    else:
        v_er = 0.0261 * ((i.v_w * i.h_w) ** 0.769)
    tf = 0.0179 * (v_er ** 0.364)
    zb = 0.5
    z3 = i.upstream_slope + i.downstream_slope
    num = v_er - (i.h_b ** 2) * (i.crest_width_m * zb + i.h_b * zb * z3 / 3.0)
    den = i.h_b * (i.crest_width_m + i.h_b * z3 / 2.0)
    wb = num / den if den else 0.0
    avg = wb + zb * i.h_b
    return BreachGeom("macdonald", avg, wb, zb, i.h_b, tf, volume_eroded_m3=v_er,
                      notes="MacDonald & Langridge-Monopolis (1984); Wb via State of Washington (1992)")


def vonthun(i: BreachInputs) -> BreachGeom:
    cb = cb_reservoir(i.v_w)
    avg = 2.5 * i.h_w + cb
    cohesive = i.dam_type == "corewall"
    z = 0.5 if cohesive else 1.0
    tf_resistant = 0.02 * i.h_w + 0.25
    tf_erodible = 0.015 * i.h_w
    tf_resistant_b = avg / (4.0 * i.h_w)
    tf_erodible_b = avg / (4.0 * i.h_w + 61.0)
    # cohesive (clay core) -> erosion-resistant bounds; else lower bound
    tf = max(tf_resistant, tf_resistant_b) if cohesive else max(tf_erodible, tf_erodible_b)
    return BreachGeom("vonthun", avg, avg - z * i.h_b, z, i.h_b, tf,
                      notes=f"Von Thun & Gillette (1990), Cb={cb} m for V={i.v_w:.3g} m3")


# Xu & Zhang (2009) dummy-variable coefficients: (b3, b4, b5)
_B3_WIDTH = {"corewall": -0.041, "concrete_faced": 0.026, "homogeneous": -0.226}
_B4_WIDTH = {"overtopping": 0.149, "piping": -0.389}
_B5_WIDTH = {"high": 0.291, "medium": -0.14, "low": -0.391}
_B3_TOP = {"corewall": 0.061, "concrete_faced": 0.088, "homogeneous": -0.089}
_B4_TOP = {"overtopping": 0.299, "piping": -0.239}
_B5_TOP = {"high": 0.411, "medium": -0.062, "low": -0.289}
_B3_TIME = {"corewall": -0.327, "concrete_faced": -0.674, "homogeneous": -0.189}
_B4_TIME = {"overtopping": -0.579, "piping": -0.611}
_B5_TIME = {"high": -1.205, "medium": -0.564, "low": 0.579}


def xuzhang(i: BreachInputs) -> BreachGeom:
    ot = "overtopping" if i.overtopping else "piping"
    ratio = (i.h_d / 15.0)
    vol_ratio = (i.v_w ** (1.0 / 3.0)) / i.h_w
    b3 = _B3_WIDTH[i.dam_type] + _B4_WIDTH[ot] + _B5_WIDTH[i.erodibility]
    b2 = _B3_TOP[i.dam_type] + _B4_TOP[ot] + _B5_TOP[i.erodibility]
    b5 = _B3_TIME[i.dam_type] + _B4_TIME[ot] + _B5_TIME[i.erodibility]
    avg = i.h_b * 0.787 * (ratio ** 0.133) * (vol_ratio ** 0.652) * math.exp(b3)
    top = i.h_b * 1.062 * (ratio ** 0.092) * (vol_ratio ** 0.508) * math.exp(b2)
    tf = 0.304 * (ratio ** 0.707) * (vol_ratio ** 1.228) * math.exp(b5)
    z = max((top - avg) / i.h_b, 0.0)
    wb = avg - z * i.h_b
    return BreachGeom("xuzhang", avg, wb, z, i.h_b, tf, top_width_m=top,
                      notes="Xu & Zhang (2009); tf over-predicts vs other methods (HEC caution)")


def manual(i: BreachInputs, width_m: float, depth_m: float, t_form_hr: float, side_slope: float) -> BreachGeom:
    return BreachGeom("manual", width_m, width_m, side_slope, depth_m, t_form_hr,
                      notes="operator-specified geometry")


def solve(method: str, i: BreachInputs, *, width_m: float = 0.0, depth_m: float = 0.0,
          t_form_hr: float = 0.0, side_slope: float = 0.7) -> BreachGeom:
    if method == "froehlich1995":
        return froehlich1995(i)
    if method == "froehlich2008":
        return froehlich2008(i)
    if method == "macdonald":
        return macdonald(i)
    if method == "vonthun":
        return vonthun(i)
    if method == "xuzhang":
        return xuzhang(i)
    if method == "manual":
        return manual(i, width_m, depth_m, t_form_hr, side_slope)
    raise ValueError(f"unknown breach method {method!r}")


def all_methods(i: BreachInputs) -> list[BreachGeom]:
    return [solve(m, i) for m in ("froehlich1995", "froehlich2008", "macdonald", "vonthun", "xuzhang")]


# ---- peak-flow regression cross-checks (HEC summary, metric) ----
def peak_flow_froehlich1995b(v_w: float, h_w: float) -> float:
    return 0.607 * (v_w ** 0.295) * (h_w ** 1.24)


def peak_flow_macdonald(v_w: float, h_w: float, envelope: bool = False) -> float:
    return (3.85 if envelope else 1.154) * ((v_w * h_w) ** 0.411 if envelope else (v_w * h_w) ** 0.412)


def peak_flow_scs(h_w: float) -> float:
    return 16.6 * (h_w ** 1.85)
