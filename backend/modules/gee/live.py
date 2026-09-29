"""Live Earth Engine fetchers — real imagery metrics for the daily watch sweep.

Each fetcher bundles its computation into 1–2 `getInfo()` round trips and
caches same-day results per box (the sweep runs 6 kinds × every box, so
repeat runs inside a day are free). Callers catch `LiveError`/any exception
and fall back to local rasters or simulation — live failures never break a
job.

Kind → fetcher map (handlers._live):
    s2_indices   → s2_water      Sentinel-2 MNDWI + Otsu water area + quicklook
    s1_watermask → s1_water      Sentinel-1 VV dB + Otsu water area (flat only)
    flood_extent → flood         recent S1 open water over JRC permanent
    lst_snow     → lst           MODIS LST, year-over-year anomaly
    glacier_ice  → glacier       S2 NDSI snow/ice cover (glacier proxy)
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any, Callable

from loguru import logger

from config import settings
from modules.gee import client

BBox = tuple[float, float, float, float]
_cache: dict[tuple, dict] = {}


class LiveError(RuntimeError):
    """EE fetch unavailable (no auth, no scenes, network) — callers fall back."""


def _geometry(bbox: BBox):
    import ee

    w, s, e, n = bbox
    return ee.Geometry.Rectangle([w, s, e, n])


def _cached(key: tuple, fn: Callable[[], dict]) -> dict:
    """Same-day memo: (date, key) → result (elapsed_ms added once)."""
    cache_key = (date.today().isoformat(),) + key
    hit = _cache.get(cache_key)
    if hit is not None:
        return {**hit, "cache_hit": True}
    t0 = time.perf_counter()
    out = dict(fn())
    out["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out["cache_hit"] = False
    _cache[cache_key] = out
    return dict(out)


def _require_ready() -> None:
    if settings.gee_mode != "online":
        raise LiveError("gee_mode=offline")
    if not client.ready():
        raise LiveError(client.peek().get("error") or "ee not initialized")


def _otsu(centers: Any, counts: Any) -> float:
    """Otsu threshold over bucket centers/counts arrays."""
    import numpy as np

    centers = np.asarray(centers, dtype=np.float64)
    counts = np.asarray(counts, dtype=np.float64)
    if centers.size < 2 or counts.sum() <= 0:
        return float(centers[centers.size // 2]) if centers.size else 0.0
    width = centers[1] - centers[0]
    edges = np.append(centers - width / 2.0, centers[-1] + width / 2.0)
    total = counts.sum()
    mids = (edges[:-1] + edges[1:]) / 2.0
    sum_all = float(np.dot(counts, mids))
    sum_b = w_b = 0.0
    best, best_thr = -1.0, float(mids[0])
    for i in range(centers.size):
        w_b += counts[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += counts[i] * mids[i]
        m_b, m_f = sum_b / w_b, (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best:
            best, best_thr = var, float(edges[i + 1])
    return best_thr


def _hist_pair(payload: dict, band: str) -> tuple[list[float], list[float]]:
    """reduceRegion histogram output → (bucketMeans, counts).

    Handles both the structured shape {band: {bucketMeans, histogram}} and a
    plain {center_str: count} dictionary.
    """
    node = payload.get(band, payload)
    if isinstance(node, dict) and "bucketMeans" in node:
        return list(node["bucketMeans"]), list(node["histogram"])
    if isinstance(node, dict):
        centers = sorted(node, key=float)
        return [float(k) for k in centers], [float(node[k]) for k in centers]
    raise LiveError(f"unexpected histogram payload: {str(payload)[:120]}")


def _area_km2(mask, geom, scale: int) -> Any:
    import ee

    return (mask.multiply(ee.Image.pixelArea()).rename("area")
            .reduceRegion(ee.Reducer.sum(), geom, scale=scale,
                          bestEffort=True, maxPixels=1e9)
            .get("area"))


def _bbox_of(box: dict) -> BBox:
    from modules.db import client as db

    row = db.query_one(
        "SELECT ST_XMin(bbox) w, ST_YMin(bbox) s, ST_XMax(bbox) e, "
        "ST_YMax(bbox) n FROM watch_box WHERE id = %s", (box["id"],))
    if not row:
        raise LiveError(f"watch box {box.get('id')} not found")
    return float(row["w"]), float(row["s"]), float(row["e"]), float(row["n"])


# ---------------------------------------------------------------- Sentinel-2

def s2_water(box: dict, *, days: int = 30, cloud: int = 30,
             quicklook: bool = True) -> dict[str, Any]:
    """Least-cloudy S2 SR composite → NDWI Otsu water area + scene log."""
    _require_ready()
    bbox = _bbox_of(box)
    return _cached(("s2_water", box["id"], days, cloud), lambda: _s2_water_uncached(
        bbox, str(box["id"]), days, cloud, quicklook))


def _s2_water_uncached(bbox: BBox, box_id: str, days: int, cloud: int,
                       quicklook: bool) -> dict[str, Any]:
    import ee

    geom = _geometry(bbox)
    end = date.today()
    start = end - timedelta(days=days)
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterBounds(geom)
           .filterDate(start.isoformat(), end.isoformat())
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud))
           .sort("CLOUDY_PIXEL_PERCENTAGE"))
    size = col.size().getInfo()
    if not size:
        raise LiveError(f"no S2 scene over box in {days}d (cloud<{cloud}%)")
    scene = col.first()
    comp = col.limit(10).median()
    # MNDWI (green−SWIR) separates water from vegetation/soil; plain NDWI does not
    mndwi = comp.normalizedDifference(["B3", "B11"]).rename("MNDWI")
    payload = ee.Dictionary({
        "hist": mndwi.reduceRegion(ee.Reducer.histogram(maxBuckets=256), geom,
                                   scale=30, bestEffort=True, maxPixels=1e9),
        "mndwi_mean": mndwi.reduceRegion(ee.Reducer.mean(), geom, scale=30,
                                         bestEffort=True, maxPixels=1e9).get("MNDWI"),
        "scene_id": scene.get("PRODUCT_ID"),
        "scene_date": scene.date().format("YYYY-MM-dd"),
        "cloud": scene.get("CLOUDY_PIXEL_PERCENTAGE"),
        "scenes": size,
    }).getInfo()
    hist = payload.get("hist") or {}
    if not hist or "MNDWI" not in hist:
        raise LiveError("empty MNDWI histogram for box")
    thr = _otsu(*_hist_pair(hist, "MNDWI"))
    water = mndwi.gt(thr).rename("water")
    area = _area_km2(water, geom, 30).getInfo()
    out: dict[str, Any] = {
        "area_km2": round(float(area or 0.0) / 1e6, 4),
        "mndwi_mean": float(payload.get("mndwi_mean") or 0.0),
        "threshold": round(thr, 4),
        "index": "MNDWI",
        "scene_id": payload.get("scene_id"),
        "scene_date": payload.get("scene_date"),
        "cloud_pct": payload.get("cloud"),
        "scenes_available": size,
    }
    if quicklook:
        try:
            out["path"] = _download_quicklook(comp, bbox, box_id, "s2")
        except Exception as exc:  # noqa: BLE001 - imagery is best effort
            logger.warning("gee quicklook failed for box {}: {}", box_id, exc)
            out["path"] = None
    return out


def _download_quicklook(image, bbox: BBox, box_id: str, tag: str,
                        bands: tuple[str, ...] = ("B4", "B3", "B2")) -> str | None:
    """RGB GeoTIFF of the box → storage/gee/<box>/<date>_<tag>.tif → rel path.

    Display-scaled uint8 at ~1400 px max dimension — EE caps single request
    downloads at 50 MB, which float64 native-scale exports blow past.
    """
    import math

    import httpx

    from modules.storage import paths

    w, s, e, n = bbox
    mid_lat = math.radians((s + n) / 2)
    width_m = (e - w) * 111320 * math.cos(mid_lat)
    height_m = (n - s) * 110540
    scale = max(max(width_m, height_m) / 1400, 10)
    rgb = (image.select(list(bands)).unitScale(0, 4000)
           .multiply(255).round().toUint8())
    url = rgb.getDownloadURL({
        "region": [w, s, e, n],
        "scale": scale,
        "crs": "EPSG:4326",
        "format": "GEO_TIFF",
    })
    dest = paths.ROOT / "gee" / box_id / f"{date.today().isoformat()}_{tag}.tif"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    # browser-displayable PNG next to the analysis GeoTIFF (watch image endpoint)
    png_url = rgb.getThumbURL({"region": [w, s, e, n], "dimensions": 1600,
                               "format": "png"})
    with httpx.stream("GET", png_url, timeout=60.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest.with_suffix(".png"), "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return paths.rel(dest)


# --------------------------------------------------------------- Sentinel-1

def s1_water(box: dict, *, days: int = 90) -> dict[str, Any]:
    """S1 GRD VV median → dB Otsu dark-water area."""
    _require_ready()
    bbox = _bbox_of(box)
    return _cached(("s1_water", box["id"], days), lambda: _s1_water_uncached(bbox, days))


def _s1_water_uncached(bbox: BBox, days: int) -> dict[str, Any]:
    import ee

    geom = _geometry(bbox)
    end = date.today()
    col = (ee.ImageCollection("COPERNICUS/S1_GRD")
           .filterBounds(geom)
           .filterDate((end - timedelta(days=days)).isoformat(), end.isoformat())
           .filter(ee.Filter.eq("instrumentMode", "IW"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")))
    size = col.size().getInfo()
    if not size:
        raise LiveError(f"no S1 VV scene over box in {days}d")
    vv = col.select("VV").median().rename("VV")
    # terrain shadow is radar-dark too — restrict to near-flat pixels
    slope = ee.Terrain.slope(ee.Image("NASA/NASADEM_HGT/001").select("elevation"))
    vv = vv.updateMask(slope.lt(15)).rename("VV")
    payload = ee.Dictionary({
        "hist": vv.reduceRegion(ee.Reducer.histogram(maxBuckets=256), geom,
                                scale=30, bestEffort=True, maxPixels=1e9),
        "vv_mean": vv.reduceRegion(ee.Reducer.mean(), geom, scale=30,
                                   bestEffort=True, maxPixels=1e9).get("VV"),
        "scenes": size,
    }).getInfo()
    hist = payload.get("hist") or {}
    if not hist or "VV" not in hist:
        raise LiveError("no flat terrain in box for S1 water mask")
    thr = _otsu(*_hist_pair(hist, "VV"))
    water = vv.lt(thr).rename("water")  # open water is radar-dark
    area = _area_km2(water, geom, 30).getInfo()
    return {
        "area_km2": round(float(area or 0.0) / 1e6, 4),
        "vv_mean_db": float(payload.get("vv_mean") or 0.0),
        "threshold_db": round(thr, 2),
        "scenes_available": size,
    }


# --------------------------------------------------------------- JRC + flood

def jrc_permanent(box: dict) -> dict[str, Any]:
    """JRC Global Surface Water occurrence>50 permanent water area (static)."""
    _require_ready()
    bbox = _bbox_of(box)
    return _cached(("jrc", box["id"]), lambda: _jrc_uncached(bbox))


def _jrc_uncached(bbox: BBox) -> dict[str, Any]:
    import ee

    geom = _geometry(bbox)
    occ = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence")
    area = _area_km2(occ.gt(50), geom, 30).getInfo()
    return {"permanent_km2": round(float(area or 0.0) / 1e6, 4)}


def flood(box: dict) -> dict[str, Any]:
    """Flood extent = recent S1 open water minus JRC permanent water."""
    _require_ready()
    recent = s1_water(box)
    perm = jrc_permanent(box)
    excess = max(float(recent["area_km2"]) - float(perm["permanent_km2"]), 0.0)
    return {
        "area_km2": round(excess, 4),
        "open_water_km2": recent["area_km2"],
        "permanent_km2": perm["permanent_km2"],
        "threshold_db": recent.get("threshold_db"),
        "scenes_available": recent.get("scenes_available"),
        "elapsed_ms": recent.get("elapsed_ms", 0) + perm.get("elapsed_ms", 0),
        "cache_hit": recent.get("cache_hit") and perm.get("cache_hit"),
    }


# --------------------------------------------------------------------- LST

def lst(box: dict) -> dict[str, Any]:
    """MODIS day LST now vs same window last year → real YoY anomaly (°C)."""
    _require_ready()
    bbox = _bbox_of(box)
    return _cached(("lst", box["id"]), lambda: _lst_uncached(bbox))


def _lst_uncached(bbox: BBox) -> dict[str, Any]:
    import ee

    geom = _geometry(bbox)
    end = date.today()

    def window(start_d: date, end_d: date):
        return (ee.ImageCollection("MODIS/061/MOD11A2")
                .filterBounds(geom)
                .filterDate(start_d.isoformat(), end_d.isoformat())
                .select("LST_Day_1km")
                .mean()
                .multiply(0.02)
                .subtract(273.15))

    now = window(end - timedelta(days=16), end)
    past = window(end - timedelta(days=16) - timedelta(days=365),
                  end - timedelta(days=365))
    payload = ee.Dictionary({
        "now": now.reduceRegion(ee.Reducer.mean(), geom, scale=1000,
                                bestEffort=True).get("LST_Day_1km"),
        "past": past.reduceRegion(ee.Reducer.mean(), geom, scale=1000,
                                  bestEffort=True).get("LST_Day_1km"),
    }).getInfo()
    now_c = float(payload.get("now") or 0.0)
    past_c = float(payload.get("past") or 0.0)
    return {"lst_c": round(now_c, 2),
            "anomaly_c": round(now_c - past_c, 2)}


# ------------------------------------------------------------------ glacier

def glacier(box: dict, *, days: int = 30, quicklook: bool = True) -> dict[str, Any]:
    """S2 NDSI snow/ice cover area (glacier/cryosphere proxy) + mean NDSI."""
    _require_ready()
    bbox = _bbox_of(box)
    return _cached(("glacier", box["id"], days),
                   lambda: _glacier_uncached(bbox, str(box["id"]), days, quicklook))


def _glacier_uncached(bbox: BBox, box_id: str, days: int, quicklook: bool) -> dict[str, Any]:
    import ee

    geom = _geometry(bbox)
    end = date.today()
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterBounds(geom)
           .filterDate((end - timedelta(days=days)).isoformat(), end.isoformat())
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40)))
    if not col.size().getInfo():
        raise LiveError(f"no clear S2 scene for NDSI in {days}d")
    comp = col.sort("CLOUDY_PIXEL_PERCENTAGE").limit(10).median()
    ndsi = comp.normalizedDifference(["B3", "B11"]).rename("NDSI")
    payload = ee.Dictionary({
        "hist": ndsi.reduceRegion(ee.Reducer.histogram(maxBuckets=256), geom,
                                  scale=30, bestEffort=True, maxPixels=1e9),
        "ndsi_mean": ndsi.reduceRegion(ee.Reducer.mean(), geom, scale=30,
                                       bestEffort=True, maxPixels=1e9).get("NDSI"),
    }).getInfo()
    thr = _otsu(*_hist_pair(payload["hist"], "NDSI"))
    # snow/ice: bright in green, dark in SWIR → keep Otsu upper class but
    # never below the physical minimum (NDSI>0.2 separates ice/snow)
    thr = max(thr, 0.2)
    ice = ndsi.gt(thr).rename("ice")
    area = _area_km2(ice, geom, 30).getInfo()
    out: dict[str, Any] = {
        "area_km2": round(float(area or 0.0) / 1e6, 4),
        "ndsi_mean": float(payload.get("ndsi_mean") or 0.0),
        "threshold": round(thr, 4),
    }
    if quicklook:
        try:
            # (B3, B11, B4) = (green, SWIR, red): handlers derive NDSI from bands 1/2
            out["path"] = _download_quicklook(comp, bbox, box_id, "glacier",
                                              bands=("B3", "B11", "B4"))
        except Exception as exc:  # noqa: BLE001 - imagery is best effort
            logger.warning("gee glacier quicklook failed for box {}: {}", box_id, exc)
            out["path"] = None
    return out
