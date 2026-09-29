"""scenario.validate — JSON checks + cross-checks before a spec is persisted (MODULE_SPEC 4.19)."""

from __future__ import annotations

from typing import Any

VALID_CASES = ("1", "2", "3")
VALID_MODES = ("overtopping", "piping", "blockage_breach", "breach_height", "manual", "attack")
VALID_ENGINES = ("fast", "sph", "delft3d", "hecras", "auto")


def validate_spec(spec: dict[str, Any]) -> list[str]:
    """Return a list of problems (empty = valid). Raises nothing."""
    problems: list[str] = []
    if spec.get("case") not in VALID_CASES:
        problems.append(f"case must be one of {VALID_CASES}")
    aoi = spec.get("aoi") or {}
    if aoi.get("type") not in ("bbox", "polygon"):
        problems.append("aoi.type must be bbox or polygon")
    elif aoi.get("type") == "bbox":
        coords = aoi.get("coords") or []
        if len(coords) != 4 or not all(isinstance(v, (int, float)) for v in coords):
            problems.append("aoi.coords must be [minx, miny, maxx, maxy]")
        elif coords[0] >= coords[2] or coords[1] >= coords[3]:
            problems.append("aoi bbox has inverted bounds")
    elif aoi.get("type") == "polygon":
        coords = aoi.get("coords") or []
        ring = coords[0] if len(coords) == 1 and isinstance(coords[0], list) else None
        if (
            not ring
            or len(ring) < 4
            or not all(
                isinstance(p, (list, tuple))
                and len(p) == 2
                and all(isinstance(v, (int, float)) for v in p)
                for p in ring
            )
        ):
            problems.append("aoi.coords must be [ring] with >=4 finite [lon, lat] points")
    breach = spec.get("breach") or {}
    if breach.get("mode") not in VALID_MODES:
        problems.append(f"breach.mode must be one of {VALID_MODES}")
    if float(breach.get("width_m") or 0.0) < 0:
        problems.append("breach.width_m must be >= 0")
    engine = spec.get("engine")
    if engine not in VALID_ENGINES:
        problems.append(f"engine must be one of {VALID_ENGINES}")
    horizon = spec.get("horizon") or {}
    if float(horizon.get("duration_hr") or 0.0) <= 0:
        problems.append("horizon.duration_hr must be > 0")
    # cross-checks vs dam record (breach width <= dam crest length)
    dam_id = spec.get("dam_id")
    if dam_id and breach.get("width_m"):
        from modules.db import client as db

        dam = db.query_one("SELECT crest_length_m FROM dam WHERE id = %s", (dam_id,))
        if dam and dam.get("crest_length_m") and float(breach["width_m"]) > float(dam["crest_length_m"]):
            problems.append("breach.width_m exceeds dam crest_length_m")
    return problems


def require_valid(spec: dict[str, Any]) -> dict[str, Any]:
    problems = validate_spec(spec)
    if problems:
        raise ValueError("; ".join(problems))
    return spec
