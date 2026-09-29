"""proc_imagery — optical GeoTIFF → index stats + before/after thumbnail (MODULE_SPEC 4.6)."""

from __future__ import annotations

from typing import Any

import numpy as np

from modules.storage import paths


def process(dataset: dict, progress=None) -> dict[str, Any]:
    import rasterio
    from PIL import Image

    src = paths.abs_path(dataset["path"])
    with rasterio.open(src) as ds:
        arr = ds.read(masked=True)
        bbox = [float(v) for v in ds.bounds]
        bands = int(arr.shape[0])
        stats = []
        for i in range(min(bands, 6)):
            band = arr[i].compressed()
            if band.size == 0:
                stats.append({"band": i + 1, "mean": None})
                continue
            stats.append({"band": i + 1,
                          "mean": round(float(band.mean()), 3),
                          "std": round(float(band.std()), 3),
                          "min": round(float(band.min()), 3),
                          "max": round(float(band.max()), 3)})
        if progress:
            progress(50, f"imagery: {bands} bands {ds.width}x{ds.height}")
        # NDWI-style ratio when we have green + nir (bands 2/4 of S2-like stacks)
        index = None
        if bands >= 4:
            green = np.nan_to_num(arr[1].astype(float))
            nir = np.nan_to_num(arr[3].astype(float))
            denom = green + nir
            with np.errstate(divide="ignore", invalid="ignore"):
                ndwi = np.where(denom == 0, 0.0, (green - nir) / np.where(denom == 0, 1.0, denom))
            index = {"name": "ndwi", "mean": round(float(ndwi.mean()), 4),
                     "water_frac": round(float((ndwi > 0.2).mean()), 4)}
        thumb = _thumbnail(arr[0], src, Image)

    if progress:
        progress(85, "imagery: stats + thumbnail done")
    return {"kind": "imagery_index", "path": thumb,
            "meta": {"bands": bands, "stats": stats, "index": index, "bbox": bbox}}


def _thumbnail(band, src, Image) -> str | None:
    """256px grayscale preview of the first band (before/after slider fallback)."""
    try:
        data = np.nan_to_num(band.filled(0) if hasattr(band, "filled") else band).astype(float)
        lo, hi = float(np.nanmin(data)), float(np.nanmax(data))
        norm = (data - lo) / (hi - lo) if hi > lo else np.zeros_like(data)
        img = Image.fromarray((np.clip(norm, 0, 1) * 255).astype("uint8"))
        img.thumbnail((256, 256))
        out = paths.product_file(f"thumb_{src.stem}", "preview", "png")
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out)
        return paths.rel(out)
    except Exception:
        return None
