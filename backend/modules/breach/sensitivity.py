"""Breach parameter sensitivity: +/-20% sweeps (width, depth, formation time)."""

from __future__ import annotations

import copy

from modules.breach.equations import BreachGeom, BreachInputs, solve
from modules.breach.hydrograph import ReservoirState, hydrograph

SWEEP = (-0.2, -0.1, 0.0, 0.1, 0.2)


def sweep(method: str, inputs: BreachInputs, res: ReservoirState, *,
          duration_hr: float = 24.0, mode: str = "overtopping") -> dict:
    base = solve(method, inputs)
    out: dict = {"base": {"peak_cms": 0.0}, "width": [], "depth": [], "time": []}
    base_q = hydrograph(base, res, duration_hr=duration_hr, mode=mode)["peak_cms"]
    out["base"] = {"peak_cms": base_q, "geom": base.as_dict()}

    for frac in SWEEP:
        for key, bucket in (("width", "width"), ("depth", "depth"), ("time", "time")):
            g = copy.deepcopy(base)
            factor = 1.0 + frac
            if key == "width":
                g.bottom_width_m *= factor
                g.avg_width_m *= factor
            elif key == "depth":
                g.depth_m *= factor
            else:
                g.t_form_hr = max(g.t_form_hr * factor, 1e-3)
            q = hydrograph(g, res, duration_hr=duration_hr, mode=mode)["peak_cms"]
            out[bucket].append({
                "delta_pct": frac * 100,
                "peak_cms": q,
                "delta_peak_pct": ((q - base_q) / base_q * 100.0) if base_q else 0.0,
            })
    return out
