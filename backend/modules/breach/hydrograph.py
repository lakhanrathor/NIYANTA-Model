"""Level-pool routing of breach outflow: reservoir storage through growing breach."""

from __future__ import annotations

import math
from dataclasses import dataclass

from modules.breach.equations import BreachGeom


@dataclass
class ReservoirState:
    initial_level_m: float
    bed_level_m: float
    storage_m3: float
    area_m2: float
    inflow_cms: float = 0.0
    # Dam crest. When known: the pool can't rise above it (excess spills over
    # the dam that same step) and breach head is measured from the breach
    # invert (crest − breach depth), not the reservoir bed.
    crest_level_m: float | None = None


def hydrograph(geom: BreachGeom, res: ReservoirState, *, duration_hr: float = 24.0,
               dt_s: float | None = None, mode: str = "overtopping") -> dict:
    """Route reservoir through a breach that grows linearly over t_form.

    Returns dict with time_s/q_cms/level_m arrays and peak metrics.
    """
    tf_s = max(geom.t_form_hr * 3600.0, 60.0)
    if dt_s is None or dt_s <= 0:
        dt_s = max(5.0, min(60.0, tf_s / 120.0))
    total = int(max(duration_hr * 3600.0, tf_s * 1.5) / dt_s)

    area = max(res.area_m2, 1.0)
    depth0 = max(res.initial_level_m - res.bed_level_m, 0.1)
    vol = max(res.storage_m3, 0.0)
    # keep consistency: storage corresponds to depth0 at constant area
    if abs(area * depth0 - vol) > 1e-6 * max(vol, 1.0) and vol > 0:
        area = vol / depth0

    weir_c = 1.7          # metric broad-crested weir coefficient (Cd ~ 0.62)
    orifice_cd = 0.6

    crest = res.crest_level_m
    has_crest = crest is not None and crest > res.bed_level_m
    # breach invert: the lowest point the breach cuts down to
    invert = res.bed_level_m
    if has_crest and geom.depth_m > 0:
        invert = max(res.bed_level_m, crest - geom.depth_m)
    vol_cap = (crest - res.bed_level_m) * area if has_crest else None

    times: list[float] = []
    qs: list[float] = []
    levels: list[float] = []

    for step in range(total + 1):
        t = step * dt_s
        h = res.bed_level_m + vol / area
        head = max(h - invert, 0.0)
        progress = min(1.0, t / tf_s)
        crest_len = max(geom.bottom_width_m * progress, 1.0)
        if mode in ("piping", "attack"):
            # pipe starts as a small orifice, grows with breach; weir governs once formed
            d_pipe = min(geom.bottom_width_m * 0.25, 10.0) * progress
            hole_area = (math.pi / 4.0) * d_pipe ** 2
            q = orifice_cd * hole_area * (2 * 9.80665 * head) ** 0.5
            if progress >= 1.0:
                q = max(q, weir_c * crest_len * head ** 1.5)
        else:
            q = weir_c * crest_len * head ** 1.5
        q = min(q, vol / dt_s + res.inflow_cms) if vol > 0 else 0.0

        vol = vol + (res.inflow_cms - q) * dt_s
        if vol_cap is not None and vol > vol_cap:
            # pool at the crest: inflow the breach can't pass spills over the
            # dam this step (it leaves downstream), so the level never exceeds
            # the crest — the old model let Tehri rise 175 m above it.
            q += (vol - vol_cap) / dt_s
            vol = vol_cap

        times.append(t)
        qs.append(q)
        levels.append(h)

        if vol <= 0:
            vol = 0.0
            if step > int(tf_s / dt_s) and q <= 0.1:
                break

    peak = max(qs) if qs else 0.0
    peak_i = qs.index(peak) if qs else 0
    return {
        "time_s": times,
        "q_cms": qs,
        "level_m": levels,
        "peak_cms": peak,
        "peak_at_hr": times[peak_i] / 3600.0 if times else 0.0,
        "released_hm3": (sum(qs) * dt_s) / 1e6,
        "dt_s": dt_s,
        "duration_hr": times[-1] / 3600.0 if times else 0.0,
    }
