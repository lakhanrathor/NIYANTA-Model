"""proc_sar — backscatter GeoTIFF → Otsu water mask (MODULE_SPEC 4.7).

The mask doubles as `validate.observed` ground truth (product kind observed_extent).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from modules.storage import paths


def process(dataset: dict, progress=None) -> dict[str, Any]:
    import rasterio

    from modules.gee.handlers import _otsu

    src = paths.abs_path(dataset["path"])
    with rasterio.open(src) as ds:
        arr = ds.read(1, masked=True)
        data = np.asarray(arr.filled(np.nan), dtype=float)
        finite = data[np.isfinite(data)]
        if finite.size == 0:
            raise ValueError("SAR raster empty")
        thr = _otsu(finite)
        water = np.where(np.isfinite(data), data <= thr, False)
        px_area = abs(ds.transform.a * ds.transform.e)
        area_km2 = float(np.count_nonzero(water)) * px_area / 1e6
        if progress:
            progress(60, f"sar: otsu water mask {area_km2:.2f} km2")
        out = paths.product_file("sar_mask", str(dataset["id"]), "tif")
        out.parent.mkdir(parents=True, exist_ok=True)
        profile = ds.profile.copy()
        profile.update(dtype="uint8", count=1, nodata=0)
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(water.astype("uint8"), 1)

    return {"kind": "observed_extent", "path": paths.rel(out),
            "meta": {"area_km2": round(area_km2, 3), "threshold": float(thr),
                     "method": "otsu_single_band"}}
