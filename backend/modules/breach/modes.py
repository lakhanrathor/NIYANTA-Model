"""Breach mode presets (MODULE_SPEC 4.13 step 2): how each mode seeds geometry."""

from __future__ import annotations

from typing import Any

# side slope Z defaults per mode (HEC-RAS convention: piping flatter, overtopping steeper)
MODE_DEFAULTS: dict[str, dict[str, float]] = {
    "overtopping": {"side_slope": 1.0, "start_frac_of_height": 1.0},
    "piping": {"side_slope": 0.7, "start_frac_of_height": 0.15},
    "attack": {"side_slope": 1.0, "start_frac_of_height": 1.0},
    "blockage_breach": {"side_slope": 0.9, "start_frac_of_height": 0.8},
}


def apply(mode: str, breach: dict[str, Any]) -> dict[str, Any]:
    """Fill mode-dependent defaults into a breach spec dict (non-destructive)."""
    out = dict(breach)
    defaults = MODE_DEFAULTS.get(mode, MODE_DEFAULTS["overtopping"])
    out.setdefault("mode", mode)
    out.setdefault("side_slope", defaults["side_slope"])
    return out


def is_instant(mode: str, formation_time_hr: float) -> bool:
    """attack profiles and zero-time breaches release as an impulse."""
    return mode == "attack" or formation_time_hr <= 0.0
