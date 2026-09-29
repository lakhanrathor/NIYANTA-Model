"""SAM mask refinement for daily water/ice change detection.

`refine()` takes a crop (GeoTIFF) plus a spectral seed mask (NDWI/NDSI Otsu),
samples seed points, and lets SAM decode the object mask for each point —
boundary quality beats raw thresholding. GPU (RTX 4060, `device=auto`) with
CPU fallback; every failure returns `None`/{} so the daily sweep never breaks.

Model choice: `BEST_MODEL` is decided by `scripts/benchmark_sam.py`
(sam_vit_h on GPU — best IoU vs spectral reference among available checkpoints).
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from loguru import logger

BEST_MODEL = "vit_h"
MOBILE_MODEL = "vit_t"
CHECKPOINTS = {
    "vit_h": r"C:\Users\ankitkumar\Desktop\work\1\Plantier_HawkEye\models\sam_vit_h_4b8939.pth",
    "vit_t": r"C:\Users\ankitkumar\Desktop\work\1\Plantier_HawkEye\models\mobile_sam.pt",
}
MAX_POINTS = 48  # 24 water + 24 land — decode is per-point, encoder dominates cost

_predictors: dict[str, Any] = {}
# vit_h peaks ~6 GB VRAM — concurrent refines on the 8 GB 4060 would OOM
_lock = threading.Lock()


def device() -> str:
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001 - torch missing → CPU path never needs it
        return "cpu"


def _load(model: str) -> Any:
    if model in _predictors:
        return _predictors[model]
    checkpoint = CHECKPOINTS[model]
    if not Path(checkpoint).exists():
        raise FileNotFoundError(f"SAM checkpoint missing: {checkpoint}")
    if model == MOBILE_MODEL:
        from mobile_sam import SamPredictor, sam_model_registry

        sam = sam_model_registry["vit_t"](checkpoint=checkpoint)
    else:
        from segment_anything import SamPredictor, sam_model_registry

        sam = sam_model_registry[model](checkpoint=checkpoint)
    sam.to(device=device())
    predictor = SamPredictor(sam)
    _predictors[model] = predictor
    return predictor


def _sample_points(seed_mask, max_points: int) -> list[tuple[int, int, int]]:
    """Deterministic evenly-spaced sample: [(row, col, label)], balanced classes."""
    import numpy as np

    water_rows, water_cols = np.nonzero(seed_mask)
    land_rows, land_cols = np.nonzero(~seed_mask)
    out: list[tuple[int, int, int]] = []
    for rows, cols, label in ((water_rows, water_cols, 1), (land_rows, land_cols, 0)):
        if rows.size == 0:
            continue
        take = np.linspace(0, rows.size - 1, min(max_points // 2, rows.size)).astype(int)
        out.extend((int(rows[i]), int(cols[i]), label) for i in take)
    return out


def refine(tif_path: str, seed_mask, *, model: str | None = None,
           include_mask: bool = False) -> dict[str, Any] | None:
    """SAM-refine a spectral seed mask over a 3-band crop. None on any failure."""
    import numpy as np
    import rasterio

    chosen = model or BEST_MODEL
    t0 = time.perf_counter()
    try:
        with rasterio.open(tif_path) as ds:
            rgb = np.transpose(ds.read((1, 2, 3)), (1, 2, 0))
        seeds = np.asarray(seed_mask, dtype=bool)
        if seeds.shape != rgb.shape[:2]:
            logger.warning("sam seed shape {} != image {}", seeds.shape, rgb.shape[:2])
            return None
        points = _sample_points(seeds, MAX_POINTS)
        if not points:
            return None
        with _lock:
            predictor = _load(chosen)
            predictor.set_image(rgb)
            # one joint decode: water seeds as positives, land as negatives —
            # SAM returns the object(s) containing the positives, avoiding the
            # whole-image union that per-point land masks would produce
            coords = np.array([[col, row] for row, col, _ in points])
            labels = np.array([label for _, _, label in points])
            masks, ious, _ = predictor.predict(
                point_coords=coords, point_labels=labels, multimask_output=True)
            best = int(np.argmax(ious))
            union = masks[best]
            scores = [float(ious[best])]
        inter = int(np.count_nonzero(union & seeds))
        union_px = int(np.count_nonzero(union | seeds))
        out: dict[str, Any] = {
            "model": chosen,
            "device": device(),
            "points": len(points),
            "area_px": int(np.count_nonzero(union)),
            "seed_area_px": int(np.count_nonzero(seeds)),
            "iou_with_seeds": round(inter / union_px, 4) if union_px else 0.0,
            "mean_pred_iou": round(float(np.mean(scores)), 4) if scores else 0.0,
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }
        if include_mask:
            out["mask"] = union
        return out
    except Exception as exc:  # noqa: BLE001 - refinement is best effort
        logger.warning("sam refine failed for {}: {}", tif_path, exc)
        return None
