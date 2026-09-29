"""XYZ raster tile server: GeoTIFF product → 256px PNG, cached on disk.

Renders the run's canonical rasters (stage.post) into Web-Mercator tiles the
MapLibre layers in the frontend consume. Out-of-range requests are 404 so the
map skips the layer instead of painting garbage.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Response
from PIL import Image

from modules.catalog import catalog
from modules.db import client as db
from modules.storage import paths

router = APIRouter(prefix="/tiles", tags=["tiles"])

TILE = 256
# run rasters are written by stage.post; product kind -> tile kind
RASTER_KIND = {
    "depth": "max_depth",
    "velocity": "max_velocity",
    "arrival": "arrival_time",
    "extent": "inundation_extent",
}
RAMPS: dict[str, list[tuple[float, tuple[int, int, int]]]] = {
    # value -> RGB, ascending
    "depth": [(0.0, (234, 243, 251)), (0.5, (158, 201, 238)), (1.0, (74, 155, 216)),
              (2.0, (31, 111, 178)), (5.0, (13, 74, 134)), (10.0, (91, 42, 134)),
              (20.0, (58, 21, 96))],
    "velocity": [(0.0, (234, 243, 251)), (1.0, (158, 201, 238)), (2.0, (74, 155, 216)),
                 (4.0, (31, 111, 178)), (6.0, (13, 74, 134))],
    "arrival": [(0.0, (91, 42, 134)), (1.0, (13, 74, 134)), (3.0, (31, 111, 178)),
                (6.0, (74, 155, 216)), (12.0, (127, 180, 222)), (24.0, (201, 220, 240))],
    "extent": [(0.0, (255, 255, 255)), (1.0, (74, 155, 216))],
}
# below this the pixel counts as dry and stays transparent
DRY = {"depth": 0.01, "velocity": 0.01, "extent": 0.5, "arrival": -0.5}
# Frame extent uses the same wet threshold the post stage writes into the
# static inundation raster (work_post.EXTENT_THRESHOLD_M).
FRAME_EXTENT_M = 0.1
# run_id -> (mtime, times_s, depth[n,H,W]) — one run at a time; a scrub hits
# every visible tile per frame, and re-decompressing the npz each time would
# make the 2D timeline stutter.
_FRAMES_CACHE: dict[str, tuple[float, np.ndarray, np.ndarray]] = {}
# Diverging ramp for B - A depth/velocity/arrival difference (matches the UI legend).
DIFF_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (-5.0, (13, 74, 134)), (-2.0, (91, 155, 213)), (-1.0, (198, 220, 243)),
    (0.0, (238, 240, 243)), (1.0, (243, 193, 188)), (2.0, (224, 122, 112)),
    (5.0, (180, 35, 24)),
]
# Inundation-extent difference classes: A only / B only / overlap.
EXTENT_A = (11, 107, 203)
EXTENT_B = (180, 35, 24)
EXTENT_BOTH = (91, 42, 134)
ESRI = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/{z}/{y}/{x}")


def merc_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) in lon/lat for a Web-Mercator tile."""
    n = 2**z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0

    def lat(t: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))

    return west, lat(y + 1), east, lat(y)


def _source(run_id: str, kind: str) -> tuple[Path, dict[str, Any]] | None:
    product_kind = RASTER_KIND.get(kind, kind)
    row = catalog.product_latest(product_kind, run_id=run_id)
    if not row or not row.get("path"):
        return None
    fp = Path(paths.abs_path(row["path"]))
    if not fp.exists():
        return None
    return fp, row


def _source_paths(*pairs: tuple[str, str]) -> list[Path]:
    out: list[Path] = []
    for run_id, kind in pairs:
        src = _source(run_id, kind)
        if src:
            out.append(src[0])
    return out


def _cache_fresh(cache: Path, sources: list[Path]) -> bool:
    """A cached PNG is only usable while it is newer than every raster it came from."""
    if not (cache.exists() and cache.stat().st_size):
        return False
    cached = cache.stat().st_mtime
    for src in sources:
        try:
            if src.stat().st_mtime > cached:
                return False
        except OSError:
            return False
    return True


def _colormap(kind: str, arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Value array → (rgb uint8 Hx3, alpha uint8 Hx1)."""
    stops = RAMPS.get(kind, RAMPS["depth"])
    dry = DRY.get(kind, 0.01)
    lo = float(stops[0][0])
    hi = float(stops[-1][0])
    span = (hi - lo) or 1.0
    # normalise onto the stop axis for interpolation
    values = np.clip(arr.astype(np.float64), lo, hi)
    pos = np.interp(values, [s[0] for s in stops],
                    [float(i) for i in range(len(stops))])
    idx = np.clip(pos.astype(np.int32), 0, len(stops) - 2)
    frac = (pos - idx).astype(np.float64)
    colors = np.array([s[1] for s in stops], dtype=np.float64)
    rgb = colors[idx] * (1 - frac)[:, :, None] + colors[idx + 1] * frac[:, :, None]
    valid = np.isfinite(arr) & (arr > dry) if kind != "arrival" else np.isfinite(arr) & (arr >= 0)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    return rgb.round().astype(np.uint8), alpha


def _render_tile(run_id: str, kind: str, z: int, x: int, y: int) -> bytes | None:
    import rasterio
    from rasterio.windows import Window
    from rasterio.warp import transform_bounds

    src = _source(run_id, kind)
    if src is None:
        return None
    fp, _row = src
    w, s, e, n = merc_bounds(z, x, y)
    try:
        with rasterio.open(fp) as ds:
            left, bottom, right, top = transform_bounds("EPSG:4326", ds.crs, w, s, e, n, densify_pts=21)
            window = ds.window(left, bottom, right, top)
            if window.width <= 0 or window.height <= 0:
                return _blank()
            arr = ds.read(1, window=window, boundless=True, fill_value=ds.nodata or 0,
                          out_shape=(max(1, min(TILE, int(window.height))),
                                     max(1, min(TILE, int(window.width)))))
    except Exception:  # noqa: BLE001 - unreadable window paints nothing, not a 500
        return _blank()

    rgb, alpha = _colormap(kind, np.asarray(arr, dtype=np.float64))
    img = np.dstack([rgb, alpha]).astype(np.uint8)
    im = Image.fromarray(img, mode="RGBA").resize((TILE, TILE), Image.Resampling.BILINEAR)
    import io

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _blank() -> bytes:
    import io

    buf = io.BytesIO()
    Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _frames(run_id: str) -> tuple[np.ndarray, np.ndarray] | None:
    """(times_s, depth[n,H,W]) from the run's frames.npz, cached by mtime."""
    fp = paths.run_dir(run_id) / "frames.npz"
    try:
        mtime = fp.stat().st_mtime
    except OSError:
        return None
    hit = _FRAMES_CACHE.get(run_id)
    if hit and hit[0] == mtime:
        return hit[1], hit[2]
    try:
        with np.load(fp) as z:
            times = z["times_s"].copy()
            depth = z["depth"]  # (n, H, W) float16, materialised on access
    except Exception:  # noqa: BLE001 - corrupt/missing frames → 404, not a 500
        return None
    _FRAMES_CACHE.clear()  # only the run being viewed is kept
    _FRAMES_CACHE[run_id] = (mtime, times, depth)
    return times, depth


# A probed cell counts as inundated at/above this depth (5 cm — stricter than
# the 1 cm render floor, looser than the 10 cm domain-area threshold).
PROBE_WET_M = 0.05
PROBE_SERIES_MAX = 120


def _tif_point(fp: Path, lon: float, lat: float) -> tuple[float | None, tuple[int, int] | None]:
    """(value, (row, col)) of one lon/lat cell. Value is None when the point
    falls outside the raster, hits nodata, or is unreadable."""
    import rasterio
    from rasterio.warp import transform

    try:
        with rasterio.open(fp) as ds:
            xs, ys = transform("EPSG:4326", ds.crs, [lon], [lat])
            row, col = (int(v) for v in ds.index(xs[0], ys[0]))
            if not (0 <= row < ds.height and 0 <= col < ds.width):
                return None, None
            val = float(ds.read(1, window=((row, row + 1), (col, col + 1)))[0, 0])
            if not math.isfinite(val):
                return None, (row, col)
            if ds.nodata is not None and val == float(ds.nodata):
                return None, (row, col)
            return val, (row, col)
    except Exception:
        return None, None


def _nearest_water_m(fp: Path, lon: float, lat: float) -> float | None:
    """Distance (m) to the nearest cell above PROBE_WET_M, or None when no
    wet cell is found inside the search rings. Lets the inspector warn
    "flood nearby" for dry cells the water hasn't reached — yet."""
    import rasterio
    from rasterio.warp import transform

    radii = (125, 250, 500, 1000, 2000)
    bearings = 8
    try:
        with rasterio.open(fp) as ds:
            xs, ys = transform("EPSG:4326", ds.crs, [lon], [lat])
            cx, cy = xs[0], ys[0]
            projected = bool(ds.crs and ds.crs.is_projected)
            mx = 1.0 if projected else 111320.0
            my = 1.0 if projected else 110540.0
            nodata = float(ds.nodata) if ds.nodata is not None else None
            for radius in radii:
                for k in range(bearings):
                    ang = math.pi * 2 * k / bearings
                    px = cx + (radius / mx) * math.cos(ang)
                    py = cy + (radius / my) * math.sin(ang)
                    try:
                        row, col = (int(v) for v in ds.index(px, py))
                    except Exception:
                        continue
                    if not (0 <= row < ds.height and 0 <= col < ds.width):
                        continue
                    try:
                        v = float(ds.read(1, window=((row, row + 1), (col, col + 1)))[0, 0])
                    except Exception:
                        continue
                    if not math.isfinite(v):
                        continue
                    if nodata is not None and v == nodata:
                        continue
                    if v > PROBE_WET_M:
                        return float(radius)
    except Exception:
        return None
    return None


def sample_point(run_id: str, lon: float, lat: float) -> dict | None:
    """On-demand probe of one cell: max depth / arrival / velocity / DEM
    elevation + downsampled depth series. Returns None only when the run has
    no depth product at all (the caller renders honest nulls); a sampled but
    dry or out-of-domain cell returns real nulls with an empty series.
    Response numbers mirror the gauge semantics: depth_m = max over the sim,
    arrival_s = first exceedance in seconds, inundated = max above PROBE_WET_M.
    """
    depth_src = _source(run_id, "depth")
    if depth_src is None:
        return None
    depth_fp, _row = depth_src
    _depth_tif, idx = _tif_point(depth_fp, lon, lat)

    series: list[dict[str, float]] = []
    loaded = _frames(run_id)
    if loaded is not None and idx is not None:
        times, depth = loaded
        H, W = int(depth.shape[1]), int(depth.shape[2])
        r, c = idx
        if 0 <= r < H and 0 <= c < W:
            col = np.asarray(depth[:, r, c], dtype=np.float64)
            step = max(1, math.ceil(len(col) / PROBE_SERIES_MAX))
            for i in range(0, len(col), step):
                v = col[i]
                if np.isfinite(v):
                    series.append({"t_s": float(times[i]), "depth_m": round(float(v), 3)})
    wet = [p for p in series if p["depth_m"] > PROBE_WET_M]
    depth_max: float | None = max((p["depth_m"] for p in series), default=None)
    if depth_max is None:
        depth_max = _depth_tif

    arrival_s: float | None = wet[0]["t_s"] if wet else None
    if arrival_s is None:
        arr_src = _source(run_id, "arrival")
        if arr_src is not None:
            # arrival_time.tif stores hours (-1 = never); the API speaks seconds.
            arr_v, _ = _tif_point(arr_src[0], lon, lat)
            if arr_v is not None and arr_v >= 0:
                arrival_s = round(arr_v * 3600.0, 1)

    velocity: float | None = None
    vel_src = _source(run_id, "velocity")
    if vel_src is not None:
        vel_v, _ = _tif_point(vel_src[0], lon, lat)
        if vel_v is not None:
            velocity = round(vel_v, 3)

    elevation: float | None = None
    dem_src = _source(run_id, "conditioned_dem")
    if dem_src is not None:
        dem_v, _ = _tif_point(dem_src[0], lon, lat)
        if dem_v is not None:
            elevation = round(dem_v, 2)

    return {
        "depth_m": round(depth_max, 3) if depth_max is not None else None,
        "arrival_s": arrival_s,
        "velocity_mps": velocity,
        "inundated": (depth_max > PROBE_WET_M) if depth_max is not None else None,
        "elevation_m": elevation,
        "nearest_water_m": (
            0.0
            if (depth_max is not None and depth_max > PROBE_WET_M)
            else _nearest_water_m(depth_fp, lon, lat)
        ),
        "series": series,
    }


def _render_frame_tile(run_id: str, kind: str, frame: int, z: int, x: int, y: int) -> bytes | None:
    """One output instant of depth (or extent) with the static tiles' ramp.

    The frames grid and the max_depth GeoTIFF are written from the same solve
    grid (work_post), so the window computed on the raster indexes the frame
    array directly — no warping, no second grid.
    """
    import rasterio
    from rasterio.warp import transform_bounds

    if kind not in ("depth", "extent"):
        return None
    src = _source(run_id, "depth")
    if src is None:
        return None
    loaded = _frames(run_id)
    if loaded is None:
        return None
    _times, depth = loaded
    if not (0 <= frame < int(depth.shape[0])):
        return None
    w, s, e, n = merc_bounds(z, x, y)
    try:
        with rasterio.open(src[0]) as ds:
            left, bottom, right, top = transform_bounds("EPSG:4326", ds.crs, w, s, e, n, densify_pts=21)
            window = ds.window(left, bottom, right, top)
            r0, c0 = int(window.row_off), int(window.col_off)
            h, wd = int(round(window.height)), int(round(window.width))
            if h <= 0 or wd <= 0:
                return _blank()
            H, W = int(depth.shape[1]), int(depth.shape[2])
            rr0, rr1 = max(0, r0), min(H, r0 + h)
            cc0, cc1 = max(0, c0), min(W, c0 + wd)
            if rr0 >= rr1 or cc0 >= cc1:
                return _blank()
            arr = np.zeros((h, wd), dtype=np.float32)
            arr[rr0 - r0: rr1 - r0, cc0 - c0: cc1 - c0] = depth[frame, rr0:rr1, cc0:cc1]
            arr = arr.astype(np.float32)
    except Exception:  # noqa: BLE001 - unreadable window paints nothing, not a 500
        return _blank()

    if kind == "extent":
        arr = (arr > FRAME_EXTENT_M).astype(np.float32)
    rgb, alpha = _colormap(kind, arr)
    img = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), mode="RGBA").resize(
        (TILE, TILE), Image.Resampling.BILINEAR)
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _read_tile(fp: Path, z: int, x: int, y: int) -> np.ndarray | None:
    """Read one Web-Mercator tile from a GeoTIFF as a TILE x TILE float array."""
    import rasterio
    from rasterio.warp import transform_bounds

    w, s, e, n = merc_bounds(z, x, y)
    try:
        with rasterio.open(fp) as ds:
            left, bottom, right, top = transform_bounds("EPSG:4326", ds.crs, w, s, e, n, densify_pts=21)
            window = ds.window(left, bottom, right, top)
            if window.width <= 0 or window.height <= 0:
                return None
            arr = ds.read(
                1,
                window=window,
                boundless=True,
                fill_value=ds.nodata if ds.nodata is not None else 0,
                out_shape=(TILE, TILE),
            )
            return np.asarray(arr, dtype=np.float64)
    except Exception:  # noqa: BLE001 - unreadable window paints nothing, not a 500
        return None


def _ramp_rgb(stops: list[tuple[float, tuple[int, int, int]]], values: np.ndarray) -> np.ndarray:
    pos = np.interp(values, [s[0] for s in stops], [float(i) for i in range(len(stops))])
    idx = np.clip(pos.astype(np.int32), 0, len(stops) - 2)
    frac = pos - idx
    colors = np.array([s[1] for s in stops], dtype=np.float64)
    return colors[idx] * (1 - frac)[:, :, None] + colors[idx + 1] * frac[:, :, None]


def _render_diff_tile(a: str, b: str, kind: str, z: int, x: int, y: int) -> bytes | None:
    """B - A difference tile. `extent` renders the A-only / B-only / overlap classes."""
    src_a = _source(a, kind)
    src_b = _source(b, kind)
    if src_a is None or src_b is None:
        return None
    arr_a = _read_tile(src_a[0], z, x, y)
    arr_b = _read_tile(src_b[0], z, x, y)
    if arr_a is None or arr_b is None:
        return _blank()
    if arr_a.shape != arr_b.shape:
        # Both runs come from the same pipeline grid; a mismatch means no honest diff.
        return _blank()

    if kind == "extent":
        dry = DRY["extent"]
        only_a = (arr_a > dry) & ~(arr_b > dry)
        only_b = (arr_b > dry) & ~(arr_a > dry)
        both = (arr_a > dry) & (arr_b > dry)
        rgb = np.zeros((*arr_a.shape, 3), dtype=np.float64)
        alpha = np.zeros(arr_a.shape, dtype=np.uint8)
        rgb[only_a] = EXTENT_A
        rgb[only_b] = EXTENT_B
        rgb[both] = EXTENT_BOTH
        alpha[only_a | only_b | both] = 255
        img = Image.fromarray(np.dstack([rgb.round().astype(np.uint8), alpha]), mode="RGBA")
        import io

        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    if kind == "arrival":
        valid = (arr_a >= 0) & (arr_b >= 0)
        fill_a = np.where(arr_a >= 0, arr_a, 0.0)
        fill_b = np.where(arr_b >= 0, arr_b, 0.0)
    else:
        dry = DRY.get(kind, 0.01)
        valid = (arr_a > dry) | (arr_b > dry)
        fill_a = np.where(np.isfinite(arr_a), arr_a, 0.0)
        fill_b = np.where(np.isfinite(arr_b), arr_b, 0.0)
    diff = np.clip(fill_b - fill_a, DIFF_RAMP[0][0], DIFF_RAMP[-1][0])
    rgb = _ramp_rgb(DIFF_RAMP, diff)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    img = Image.fromarray(np.dstack([rgb.round().astype(np.uint8), alpha]), mode="RGBA")
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bounds_of(run_id: str) -> tuple[float, float, float, float] | None:
    for product_kind in RASTER_KIND.values():
        row = catalog.product_latest(product_kind, run_id=run_id)
        if not row or not row.get("path"):
            continue
        fp = Path(paths.abs_path(row["path"]))
        if not fp.exists():
            continue
        try:
            import rasterio

            with rasterio.open(fp) as ds:
                b = ds.bounds
                return (b.left, b.bottom, b.right, b.top)
        except Exception:  # noqa: BLE001 - fall through to the next product
            continue
    return None


@router.get("/{run_id}/meta.json")
def tile_meta(run_id: str) -> dict:
    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")
    bounds = _bounds_of(run_id)
    if bounds is None:
        # Honest empty state: the map shows the base layer only.
        raise HTTPException(404, "no raster products for this run yet")
    w, s, e, n = bounds
    width_deg = max(1e-6, e - w)
    # fit zoom so the raster spans roughly one screenful
    z = int(max(3, min(14, round(14 - math.log2(width_deg / 0.35)))))
    from routers.ui import RAMPS as UI_RAMPS  # noqa: PLC0415

    return {
        "tilejson": "2.2.0",
        "minzoom": max(0, z - 3),
        "maxzoom": min(18, z + 4),
        "bounds": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        "center": [round((w + e) / 2, 6), round((s + n) / 2, 6), z],
        "kind": "depth",
        "ramp": UI_RAMPS["depth"],
        "ramps": UI_RAMPS,
        "tiles": [f"/api/tiles/{run_id}/{{z}}/{{x}}/{{y}}.png"],
    }


@router.get("/{run_id}/{kind}/{z}/{x}/{y}.png")
def tile(run_id: str, kind: str, z: int, x: int, y: int,
         frame: int | None = None) -> Response:
    if not (0 <= z <= 22):
        raise HTTPException(404, "z out of range")
    n = 2**z
    if not (0 <= x < n and 0 <= y < n):
        raise HTTPException(404, "tile out of range")
    if not catalog.run_get(run_id):
        raise HTTPException(404, "run not found")

    if kind == "satellite":
        # Transparent passthrough marker: the frontend uses Esri directly.
        raise HTTPException(404, "use Esri XYZ directly for the base layer")

    if frame is not None:
        # Timeline scrub: ?frame=N renders frames.npz depth[N] (see _render_frame_tile).
        if kind not in ("depth", "extent"):
            raise HTTPException(404, f"no per-frame data for {kind}")
        if frame < 0:
            raise HTTPException(404, "frame out of range")
        cache = paths.tiles_dir(run_id, f"{kind}-f{frame:05d}") / str(z) / str(x) / f"{y}.png"
        depth_src = _source_paths((run_id, "depth"))
        frames_fp = paths.run_dir(run_id) / "frames.npz"
        sources = [p for p in ([depth_src[0]] if depth_src else []) + [frames_fp] if p.exists()]
        if sources and _cache_fresh(cache, sources):
            return Response(content=cache.read_bytes(), media_type="image/png",
                            headers={"Cache-Control": "public, max-age=300"})
        data = _render_frame_tile(run_id, kind, frame, z, x, y)
        if data is None:
            raise HTTPException(404, f"frame {frame} unavailable for this run")
        cache.parent.mkdir(parents=True, exist_ok=True)
        try:
            cache.write_bytes(data)
        except OSError:  # cache is an optimisation; serve even if it cannot persist
            pass
        return Response(content=data, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=300"})

    cache = paths.tiles_dir(run_id, kind) / str(z) / str(x) / f"{y}.png"
    sources = _source_paths((run_id, kind))
    if sources and _cache_fresh(cache, sources):
        return Response(content=cache.read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "public, max-age=300"})

    data = _render_tile(run_id, kind, z, x, y)
    if data is None:
        raise HTTPException(404, f"no {kind} raster for this run")
    cache.parent.mkdir(parents=True, exist_ok=True)
    try:
        cache.write_bytes(data)
    except OSError:  # cache is an optimisation; serve even if it cannot persist
        pass
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=300"})


DIFF_UI_RAMP = [
    {"v": 5, "label": "+5", "color": "#b42318"},
    {"v": 2, "label": "+2", "color": "#e07a70"},
    {"v": 1, "label": "+1", "color": "#f3c1bc"},
    {"v": 0, "label": "0", "color": "#eef0f3"},
    {"v": -1, "label": "-1", "color": "#c6dcf3"},
    {"v": -2, "label": "-2", "color": "#5b9bd5"},
    {"v": -5, "label": "<-5", "color": "#0d4a86"},
]
EXTENT_UI_RAMP = [
    {"v": -1, "label": "SPH Extent", "color": "#0b6bcb"},
    {"v": 1, "label": "Delft3D Extent", "color": "#b42318"},
    {"v": 2, "label": "Overlap", "color": "#5b2a86"},
]


def _diff_bounds(a: str, b: str) -> tuple[float, float, float, float] | None:
    """Intersection of both runs' raster footprints."""
    ba = _bounds_of(a)
    bb = _bounds_of(b)
    if ba is None or bb is None:
        return None
    box = (max(ba[0], bb[0]), max(ba[1], bb[1]), min(ba[2], bb[2]), min(ba[3], bb[3]))
    if box[0] >= box[2] or box[1] >= box[3]:
        return None
    return box


@router.get("/diff/{a}/{b}/meta.json")
def diff_meta(a: str, b: str) -> dict:
    if not catalog.run_get(a):
        raise HTTPException(404, "run A not found")
    if not catalog.run_get(b):
        raise HTTPException(404, "run B not found")
    box = _diff_bounds(a, b)
    if box is None:
        raise HTTPException(404, "the two runs share no overlapping raster products")
    w, s, e, n = box
    width_deg = max(1e-6, e - w)
    z = int(max(3, min(14, round(14 - math.log2(width_deg / 0.35)))))
    return {
        "tilejson": "2.2.0",
        "minzoom": max(0, z - 3),
        "maxzoom": min(18, z + 4),
        "bounds": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        "center": [round((w + e) / 2, 6), round((s + n) / 2, 6), z],
        "kind": "diff",
        "ramp": DIFF_UI_RAMP,
        "extent_ramp": EXTENT_UI_RAMP,
        "tiles": [f"/api/tiles/diff/{a}/{b}/{{z}}/{{x}}/{{y}}.png"],
    }


@router.get("/diff/{a}/{b}/{kind}/{z}/{x}/{y}.png")
def diff_tile(a: str, b: str, kind: str, z: int, x: int, y: int) -> Response:
    if not (0 <= z <= 22):
        raise HTTPException(404, "z out of range")
    n = 2**z
    if not (0 <= x < n and 0 <= y < n):
        raise HTTPException(404, "tile out of range")
    if kind not in RASTER_KIND:
        raise HTTPException(404, f"unknown tile kind {kind}")
    if not catalog.run_get(a):
        raise HTTPException(404, "run A not found")
    if not catalog.run_get(b):
        raise HTTPException(404, "run B not found")

    cache = paths.tiles_dir(a, f"diff-{b}") / kind / str(z) / str(x) / f"{y}.png"
    sources = _source_paths((a, kind), (b, kind))
    if len(sources) == 2 and _cache_fresh(cache, sources):
        return Response(content=cache.read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "public, max-age=300"})

    data = _render_diff_tile(a, b, kind, z, x, y)
    if data is None:
        raise HTTPException(404, f"no {kind} raster pair for these runs")
    cache.parent.mkdir(parents=True, exist_ok=True)
    try:
        cache.write_bytes(data)
    except OSError:  # cache is an optimisation; serve even if it cannot persist
        pass
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=300"})
