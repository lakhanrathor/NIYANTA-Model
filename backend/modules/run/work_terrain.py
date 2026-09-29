"""stage.terrain — resolve grid (terrain_ref dataset, auto Copernicus DEM for
any AOI, or synthetic valley), condition it, place the dam cell, persist
dem.npz + conditioned_dem product."""

from __future__ import annotations

import hashlib
import json
import warnings
from typing import Any

import numpy as np
from loguru import logger
from shapely import wkb

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.proc_dem import mod_condition, mod_detect
from modules.run import grid as grid_mod
from modules.storage import paths

DEFAULT_CELL_M = 100.0
TARGET_SIDE = 240


def _synthetic_grid(spec: dict[str, Any]) -> tuple[np.ndarray, dict, tuple[int, int]]:
    bbox = tuple(spec.get("aoi", {}).get("coords") or []) if spec.get("aoi", {}).get("type") == "bbox" else None
    if bbox and len(bbox) == 4:
        lat_mid = (bbox[1] + bbox[3]) / 2.0
        width_m = (bbox[2] - bbox[0]) * grid_mod.M_PER_DEG_LON * max(abs(np.cos(np.radians(lat_mid))), 0.2)
        height_m = (bbox[3] - bbox[1]) * grid_mod.M_PER_DEG_LAT
        cell = float(np.clip(min(width_m, height_m) / 140.0, 30.0, 250.0))
        cols = int(np.clip(round(width_m / cell), 40, 400))
        rows = int(np.clip(round(height_m / cell), 40, 400))
    else:
        bbox = None
        cell = DEFAULT_CELL_M
        rows = cols = TARGET_SIDE

    seed = int(hashlib.sha256(str(spec.get("scenario_id", "demo")).encode()).hexdigest()[:8], 16)
    z, _ = mod_condition.synthetic_valley(height=rows, width=cols, cell_m=cell, seed=seed % (2**31))
    z = mod_condition.condition(z)

    meta = grid_mod.make_meta(rows, cols, cell, bbox)
    # dam: upstream quarter, on the channel (min elevation along that row)
    dam_row = max(4, int(0.12 * rows))
    dam_col = int(np.argmin(z[dam_row]))
    return z, meta, (dam_row, dam_col)


def _grid_from_tif(src: Path, bbox, spec) -> tuple[np.ndarray, dict, tuple[int, int]]:
    """Read a GeoTIFF (clip to AOI), decimate to a sane grid, place the dam cell."""
    z, raw_meta = mod_detect.read(src, bbox)
    # decimate huge grids — cell size must scale with stride or volumes/depths break
    stride = 1
    max_dim = max(z.shape)
    if max_dim > 500:
        stride = int(np.ceil(max_dim / 500))
        z = z[::stride, ::stride]
        raw_meta["width"] = z.shape[1]
        raw_meta["height"] = z.shape[0]

    tr = raw_meta["transform"]
    lat_mid = bbox[1] if bbox else 22.0
    if bbox:
        meta = grid_mod.make_meta(z.shape[0], z.shape[1],
                                  abs(tr[0]) * grid_mod.M_PER_DEG_LON
                                  * np.cos(np.radians(lat_mid)) * stride, bbox)
    else:
        cell_m = abs(tr[0]) * grid_mod.M_PER_DEG_LON * np.cos(np.radians(22.0)) if abs(tr[0]) < 0.01 else abs(tr[0])
        meta = grid_mod.make_meta(z.shape[0], z.shape[1], float(cell_m) * stride, None)

    # dam cell: from dam record, else upstream channel. The registry stores
    # the point as WKB hex or GeoJSON text depending on ingest path — accept
    # both so a custom dam point can never silently force a synthetic valley.
    dam_rc = None
    if spec.get("dam_id"):
        row = db.query_one("SELECT * FROM dam WHERE id = %s", (spec["dam_id"],))
        loc = (row or {}).get("location")
        lon, lat = None, None
        if loc:
            try:
                lon, lat = wkb.loads(loc).coords[0]
            except Exception:  # noqa: BLE001 - try GeoJSON text instead
                try:
                    coords = (json.loads(loc) if isinstance(loc, str) else {}).get("coordinates") or []
                    lon, lat = float(coords[0]), float(coords[1])
                except Exception:  # noqa: BLE001 - unparseable → channel fallback
                    lon, lat = None, None
        if lon is not None and lat is not None:
            try:
                dam_rc = grid_mod.lonlat_to_cell(meta, lon, lat)
            except Exception:  # noqa: BLE001 - point outside grid → fallback
                dam_rc = None
    if dam_rc is None:
        dam_row = max(4, int(0.12 * z.shape[0]))
        dam_rc = (dam_row, int(np.argmin(z[dam_row])))
    return z, meta, dam_rc


def _aoi_ring(spec: dict[str, Any]) -> list[tuple[float, float]] | None:
    """River-following domain ring ([[lon, lat], ...]) or None.

    The Build page saves the reach buffered at the corridor width as a polygon
    AOI — the domain follows the river instead of spanning the envelope box.
    """
    aoi = spec.get("aoi") or {}
    coords = aoi.get("coords") or []
    if aoi.get("type") != "polygon" or len(coords) != 1 or not isinstance(coords[0], list):
        return None
    ring = [
        (float(p[0]), float(p[1]))
        for p in coords[0]
        if isinstance(p, (list, tuple)) and len(p) == 2
    ]
    return ring if len(ring) >= 4 else None


def _aoi_bbox(spec: dict[str, Any]) -> tuple[float, float, float, float] | None:
    aoi = spec.get("aoi") or {}
    coords = aoi.get("coords") or []
    if aoi.get("type") == "bbox" and len(coords) == 4:
        return tuple(float(v) for v in coords)  # type: ignore[return-value]
    ring = _aoi_ring(spec)
    if ring:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return (min(xs), min(ys), max(xs), max(ys))
    return None


def _mask_to_ring(
    z: np.ndarray, meta: dict, ring: list[tuple[float, float]]
) -> tuple[np.ndarray, int]:
    """Wall off grid cells outside the domain ring.

    The DEM is read over the ring's small envelope box; cells the flood can
    never reach become high walls (max + 50 m) so the mesh, the solver and the
    rasters spend nothing on them. A degenerate ring skips masking honestly.
    """
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from shapely.geometry import Polygon

    try:
        poly = Polygon(ring).buffer(0)
        if poly.is_empty or poly.area <= 0:
            return z, 0
    except Exception:  # noqa: BLE001 - bad ring → unmasked grid, never a crash
        return z, 0
    transform = from_origin(
        meta["origin_lon"], meta["origin_lat"], meta["dx_deg"], meta["dy_deg"]
    )
    inside = rasterize(
        [(poly, 1)],
        out_shape=(meta["rows"], meta["cols"]),
        transform=transform,
        fill=0,
        dtype="uint8",
    )
    peak = 0.0
    if z.size:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            top = np.nanmax(z)
        if np.isfinite(top):
            peak = float(top)
    wall = np.float32(peak + 50.0)
    masked = int((inside == 0).sum())
    return np.where(inside == 1, z, wall), masked


def _load_real_dem(spec: dict[str, Any]) -> tuple[np.ndarray, dict, tuple[int, int]] | None:
    terrain_ref = spec.get("terrain_ref")
    if not terrain_ref:
        return None
    ds = catalog.dataset_get(terrain_ref)
    if not ds or not ds.get("path"):
        raise ValueError(f"terrain_ref dataset {terrain_ref} missing path")
    prod = catalog.product_latest("conditioned_dem", dataset_id=terrain_ref)
    bbox = _aoi_bbox(spec)
    src = paths.abs_path(prod["path"]) if prod else paths.abs_path(ds["path"])
    return _grid_from_tif(src, bbox, spec)


def _auto_dem(spec: dict[str, Any], progress) -> tuple[np.ndarray, dict, tuple[int, int]] | None:
    """Any-river default: fetch/cache the AOI's Copernicus DEM-30m tiles.

    None (→ synthetic) when disabled, no usable AOI, or the network or
    tile math fails — a run must never block on terrain acquisition.
    """
    from config import settings

    if not settings.auto_dem:
        return None
    bbox = _aoi_bbox(spec)
    if bbox is None:
        return None
    from modules.proc_dem import copernicus

    try:
        src = copernicus.ensure_dem(bbox, progress=progress)
        copernicus.dataset_for(src, bbox)
        z, meta, dam_rc = _grid_from_tif(src, bbox, spec)
        ring = _aoi_ring(spec)
        if ring is not None:
            z, n_masked = _mask_to_ring(z, meta, ring)
            meta["domain"] = "ring"
            meta["masked_cells"] = n_masked
            logger.info("terrain: masked {} cells outside the domain ring", n_masked)
    except Exception as exc:  # noqa: BLE001 - offline / oversized AOI → synthetic
        logger.warning("auto DEM failed for bbox {} ({}); using synthetic valley", bbox, exc)
        return None
    return mod_condition.condition(z), meta, dam_rc


def handle_terrain(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    spec = catalog.scenario_get(run["scenario_id"])["spec"]
    ctx.progress(2, "terrain: resolving grid")

    def fetch_progress(pct: int, msg: str) -> None:
        ctx.progress(min(int(pct), 12), msg)

    got = _load_real_dem(spec)
    source = "dataset"
    if got is None:
        got = _auto_dem(spec, fetch_progress)
        source = "copernicus_auto"
    if got is None:
        z, meta, dam_rc = _synthetic_grid(spec)
        source = "synthetic"
    else:
        z, meta, dam_rc = got

    meta["source"] = source
    meta["dam_rc"] = list(dam_rc)
    meta["n"] = 0.03

    run_dir = paths.run_dir(run_id)
    np.savez_compressed(run_dir / "dem.npz", z=z.astype(np.float32),
                        meta_json=np.array(json.dumps(meta)))

    tif = run_dir / "conditioned_dem.tif"
    mod_detect.write_geotiff(tif, z, {"transform": grid_mod.geotransform(meta),
                                      "crs": "EPSG:4326", "width": z.shape[1], "height": z.shape[0], "nodata": None})
    catalog.product_create("conditioned_dem", paths.rel(tif), run_id=run_id,
                           meta={"source": source, "shape": [int(z.shape[0]), int(z.shape[1])]})
    ctx.progress(14, f"terrain: {source} grid {z.shape[1]}x{z.shape[0]} @ {meta['cell_m']:.0f}m")
    return {"terrain": source, "rows": int(z.shape[0]), "cols": int(z.shape[1])}


def load_dem(run_id: str) -> tuple[np.ndarray, dict[str, Any]]:
    with np.load(paths.run_dir(run_id) / "dem.npz", allow_pickle=False) as d:
        return d["z"], json.loads(str(d["meta_json"]))
