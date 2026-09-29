"""Benchmark SAM checkpoints on a real watch-box crop.

Accuracy vs external ground truth (JRC permanent water), threshold baseline,
latency (warm), VRAM, and parameter counts → docs/benchmarks/sam.json.

Run: python scripts/benchmark_sam.py
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from modules.db import client as db  # noqa: E402
from modules.gee import client as gee_client  # noqa: E402
from modules.gee import live  # noqa: E402
from modules.gee.handlers import _otsu  # noqa: E402
from modules.seg import sam  # noqa: E402
from modules.storage import paths  # noqa: E402

MODELS = ("vit_h", "vit_t")
RUNS = 3


def main() -> None:
    db.ensure_pool()
    if not gee_client.ready():
        raise SystemExit(f"ee not ready: {gee_client.peek()}")
    box = db.query_one("SELECT * FROM watch_box WHERE name LIKE %s LIMIT 1", ("Rishiganga%",))
    metrics = live.s2_water(box)  # same-day cache; downloads the RGB quicklook
    tif = paths.ROOT / metrics["path"]
    jrc = _jrc_gt(box, tif)

    import rasterio

    with rasterio.open(tif) as ds:
        rgb = np.transpose(ds.read((1, 2, 3)), (1, 2, 0)).astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    idx = (b - r) / (b + r + 1e-6)
    finite = idx[np.isfinite(idx)]
    # same high-precision seed rule as modules.gee.handlers._sam_refine
    seeds = idx > max(_otsu(finite), float(np.quantile(finite, 0.99)))

    import torch

    results: dict[str, dict] = {}
    for model in MODELS:
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
        t0 = time.perf_counter()
        first = sam.refine(str(tif), seeds, model=model, include_mask=True)
        load_s = round(time.perf_counter() - t0, 2)  # first call: disk + CUDA init
        warm = []
        stats = first
        for _ in range(RUNS - 1):
            t0 = time.perf_counter()
            stats = sam.refine(str(tif), seeds, model=model, include_mask=True)
            warm.append(time.perf_counter() - t0)
        mask = stats.pop("mask")
        results[model] = {
            **stats,
            "iou_jrc": _prf(mask, jrc)["iou"],
            "precision_jrc": _prf(mask, jrc)["precision"],
            "recall_jrc": _prf(mask, jrc)["recall"],
            "load_s": load_s,
            "warm_s": round(statistics.median(warm), 2) if warm else None,
            "vram_mb": round(torch.cuda.max_memory_allocated() / 1e6)
            if torch.cuda.is_available() else 0,
            "params_m": _params_m(model),
        }
    base_prf = _prf(seeds, jrc)
    baseline = {"iou_jrc": base_prf["iou"], "precision_jrc": base_prf["precision"],
                "recall_jrc": base_prf["recall"], "model": "threshold_only"}

    out = {
        "date": str(live.date.today()),
        "box": box["name"],
        "image": str(tif.name),
        "image_px": int(rgb.shape[0] * rgb.shape[1]),
        "jrc_water_frac": round(float(jrc.mean()), 4),
        "seed_water_frac": round(float(seeds.mean()), 4),
        "device": sam.device(),
        "baseline": baseline,
        "models": results,
        "best": max(results, key=lambda m: results[m]["iou_jrc"]),
    }
    dest = Path(__file__).resolve().parents[2] / "docs" / "benchmarks" / "sam.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    print("\n| model | IoU vs JRC | precision | recall | warm s | load s | VRAM MB | params M |")
    print("|---|---|---|---|---|---|---|---|")
    for m, r in results.items():
        print(f"| {m} | {r['iou_jrc']:.4f} | {r['precision_jrc']:.4f} | {r['recall_jrc']:.4f} | "
              f"{r['warm_s']} | {r['load_s']} | {r['vram_mb']} | {r['params_m']} |")
    print(f"| threshold baseline | {baseline['iou_jrc']:.4f} | {baseline['precision_jrc']:.4f} | "
          f"{baseline['recall_jrc']:.4f} | — | — | — | — |")
    print(f"\nbest: {out['best']} -> {dest}")


def _jrc_gt(box: dict, tif: Path) -> np.ndarray:
    """JRC occurrence>50 mask on the quicklook grid (external ground truth)."""
    import math

    import httpx

    bbox = live._bbox_of(box)
    with rasterio_open(tif) as ds:
        shape = (ds.height, ds.width)
    # same grid math as live._download_quicklook (EE download grid = region/scale)
    w, s, e, n = bbox
    mid_lat = math.radians((s + n) / 2)
    width_m = (e - w) * 111320 * math.cos(mid_lat)
    height_m = (n - s) * 110540
    scale = max(max(width_m, height_m) / 1400, 10)
    import ee

    occ = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence")
    mask_img = occ.gt(50).multiply(255).toUint8()
    url = mask_img.getDownloadURL({
        "region": [bbox[0], bbox[1], bbox[2], bbox[3]],
        "scale": scale,
        "crs": "EPSG:4326",
        "format": "GEO_TIFF",
    })
    dest = paths.ROOT / "gee" / "_benchmark_jrc.tif"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    with rasterio_open(dest) as ds:
        arr = ds.read(1)
    if arr.shape != shape:
        rr = (np.arange(shape[0]) * arr.shape[0] / shape[0]).astype(int)
        cc = (np.arange(shape[1]) * arr.shape[1] / shape[1]).astype(int)
        arr = arr[rr][:, cc]
    return arr > 127


def rasterio_open(path):
    import rasterio

    return rasterio.open(path)


def _prf(a, b) -> dict:
    inter = int(np.count_nonzero(a & b))
    union = int(np.count_nonzero(a | b))
    a_n = int(np.count_nonzero(a))
    b_n = int(np.count_nonzero(b))
    return {
        "iou": round(inter / union, 4) if union else 0.0,
        "precision": round(inter / a_n, 4) if a_n else 0.0,
        "recall": round(inter / b_n, 4) if b_n else 0.0,
    }


def _params_m(model: str) -> float:
    predictor = sam._load(model)  # noqa: SLF001
    return round(sum(p.numel() for p in predictor.model.parameters()) / 1e6, 1)


if __name__ == "__main__":
    main()
