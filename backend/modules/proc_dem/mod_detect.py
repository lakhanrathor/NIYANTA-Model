"""DEM ingestion: read any raster with rasterio, bbox clip, metadata."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from modules.db import client as db


def read(path: Path, bbox: tuple[float, float, float, float] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """Return (z array, meta) with meta: transform, crs, width, height, nodata."""
    with rasterio.open(path) as src:
        window = None
        if bbox and src.crs and src.crs.to_epsg() == 4326:
            window = from_bounds(bbox[0], bbox[1], bbox[2], bbox[3], src.transform)
        if window is not None:
            data = src.read(1, window=window, boundless=True, fill_value=src.nodata or 0)
            transform = src.window_transform(window)
        else:
            data = src.read(1)
            transform = src.transform
        z = data.astype(np.float32)
        nodata = src.nodata
        if nodata is not None:
            z = np.where(z == nodata, np.nan, z)
        meta = {
            "transform": list(transform)[:6],
            "crs": src.crs.to_string() if src.crs else "EPSG:4326",
            "width": int(z.shape[1]),
            "height": int(z.shape[0]),
            "nodata": None if nodata is None else float(nodata),
        }
    return z, meta


def write_geotiff(path: Path, z: np.ndarray, meta: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    from rasterio.transform import Affine

    transform = Affine(*meta["transform"][:6])
    with rasterio.open(
        path, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1,
        dtype="float32", crs=meta.get("crs", "EPSG:4326"), transform=transform,
        nodata=meta.get("nodata"), compress="deflate",
    ) as dst:
        dst.write(z.astype(np.float32), 1)


def log(dataset_id: str | None, stage: str, status: str, msg: str = "") -> None:
    db.insert("proc_log", {"dataset_id": dataset_id, "stage": stage, "status": status, "msg": msg})
