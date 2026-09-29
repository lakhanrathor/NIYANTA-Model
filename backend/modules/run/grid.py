"""Local metric grid ↔ WGS84 mapping shared by terrain, post, impact, export.

Cell (r, c) center maps to lon/lat via a linearized degree transform anchored
at the AOI top-left; every raster product uses the same EPSG:4326 affine.
"""

from __future__ import annotations

from typing import Any

M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON = 111320.0

DEFAULT_CENTER = (78.0, 22.0)


def make_meta(rows: int, cols: int, cell_m: float,
              bbox: tuple[float, float, float, float] | None = None) -> dict[str, Any]:
    if bbox:
        minx, miny, maxx, maxy = bbox
        lat_mid = (miny + maxy) / 2.0
        dx_deg = (maxx - minx) / cols
        dy_deg = (maxy - miny) / rows
        origin_lon, origin_lat = minx, maxy
    else:
        lon0, lat0 = DEFAULT_CENTER
        lat_mid = lat0
        dx_deg = (cell_m / M_PER_DEG_LAT) / max(abs(__import__("math").cos(__import__("math").radians(lat_mid))), 0.1)
        dy_deg = cell_m / M_PER_DEG_LAT
        origin_lon = lon0 - (cols * dx_deg) / 2.0
        origin_lat = lat0 + (rows * dy_deg) / 2.0
    return {
        "rows": rows,
        "cols": cols,
        "cell_m": cell_m,
        "origin_lon": origin_lon,
        "origin_lat": origin_lat,
        "dx_deg": dx_deg,
        "dy_deg": dy_deg,
        "bbox": list(bbox) if bbox else None,
        "lat_mid": lat_mid,
    }


def cell_to_lonlat(meta: dict[str, Any], r: float, c: float) -> tuple[float, float]:
    lon = meta["origin_lon"] + (c + 0.5) * meta["dx_deg"]
    lat = meta["origin_lat"] - (r + 0.5) * meta["dy_deg"]
    return lon, lat


def lonlat_to_cell(meta: dict[str, Any], lon: float, lat: float) -> tuple[int, int]:
    c = int(round((lon - meta["origin_lon"]) / meta["dx_deg"] - 0.5))
    r = int(round((meta["origin_lat"] - lat) / meta["dy_deg"] - 0.5))
    r = min(max(r, 0), meta["rows"] - 1)
    c = min(max(c, 0), meta["cols"] - 1)
    return r, c


def bounds(meta: dict[str, Any]) -> tuple[float, float, float, float]:
    minx = meta["origin_lon"]
    maxy = meta["origin_lat"]
    maxx = minx + meta["cols"] * meta["dx_deg"]
    miny = maxy - meta["rows"] * meta["dy_deg"]
    return (minx, miny, maxx, maxy)


def geotransform(meta: dict[str, Any]) -> list[float]:
    """Affine (a, b, c, d, e, f) for rasterio: [dx, 0, minx, 0, -dy, maxy]."""
    minx, miny, _, maxy = bounds(meta)
    return [meta["dx_deg"], 0.0, minx, 0.0, -meta["dy_deg"], maxy]
