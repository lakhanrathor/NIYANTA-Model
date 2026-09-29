"""Direct CPU (NumPy) vs GPU (PyTorch CUDA) benchmark for fast_swe.

Run from backend/:  python scripts/benchmark_cpu_vs_gpu.py

Synthetic 2D shallow-water flood grid at 256x256 and 512x512 cells over a
1800 s (0.5 h) flood horizon; reports wall time, real-time factor, speedup,
peak VRAM on the RTX 4060, and CPU/CUDA field parity.
"""

from __future__ import annotations

import json
import os
import platform
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from modules.solvers import fast_swe

GRIDS = tuple(int(a) for a in sys.argv[1:]) or (256, 512)
DURATION_S = 1800.0
FRAMES = 24
DX = 30.0
WET_M = 0.05
OUT = Path(__file__).resolve().parents[2] / "docs" / "benchmarks" / "cpu_vs_gpu.json"
if GRIDS != (256, 512):
    OUT = OUT.with_name(f"cpu_vs_gpu_{'-'.join(str(g) for g in GRIDS)}.json")


def _mesh(n: int) -> dict:
    z = np.zeros((n, n), dtype=np.float32)
    z[:] = np.linspace(40.0, 0.0, n)[:, None] * 0.6
    z[n // 2 - 1 : n // 2 + 2, :] = 62.0
    z[n // 2 :, :] = 58.0
    return {
        "z": z,
        "cell_m": DX,
        "breach_cells": (np.array([n // 2]), np.array([n // 2])),
        "stations_km": {},
    }


_HG = {
    "time_s": np.array([0.0, 600.0, 3600.0]),
    "q_cms": np.array([0.0, 2500.0, 800.0]),
}


def _fmt_bytes(b: float) -> str:
    return f"{b / 1024 ** 2:.1f} MiB" if b < 1024 ** 3 else f"{b / 1024 ** 3:.3f} GiB"


def verify_cuda() -> dict:
    import torch

    print("=" * 78)
    print("1) PyTorch CUDA device verification")
    print("=" * 78)
    avail = torch.cuda.is_available()
    info: dict = {
        "torch": torch.__version__,
        "cuda_available": avail,
        "cuda_runtime": torch.version.cuda,
        "cudnn": torch.backends.cudnn.version(),
    }
    print(f"   torch                     : {torch.__version__} (CUDA {torch.version.cuda})")
    print(f"   torch.cuda.is_available() : {avail}")
    if not avail:
        print("   !! CUDA unavailable — GPU leg cannot run")
        return info

    name = torch.cuda.get_device_name(0)
    p = torch.cuda.get_device_properties(0)
    vram = p.total_memory
    info.update({
        "device_name": name,
        "device_index": 0,
        "vram_bytes": int(vram),
        "vram_gib": round(vram / 1024 ** 3, 2),
        "compute_capability": f"{p.major}.{p.minor}",
        "sm_count": p.multi_processor_count,
    })
    print(f"   get_device_name(0)        : {name}")
    print(f"   VRAM capacity             : {_fmt_bytes(vram)} ({vram / 1024 ** 3:.2f} GiB)")
    print(f"   compute capability        : sm_{p.major}{p.minor}, {p.multi_processor_count} SMs")
    print(f"   driver / CUDA (nvidia-smi): see nvidia-smi header above")
    return info


def system_info() -> dict:
    import torch

    info: dict = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu": platform.processor() or "unknown",
        "cores_physical": os.cpu_count(),
        "numpy": np.__version__,
        "torch": torch.__version__,
        "torch_cpu_threads": torch.get_num_threads(),
        "benchmarked_at": datetime.now().isoformat(timespec="seconds"),
    }
    try:
        from threadpoolctl import threadpool_info

        pools = threadpool_info()
        info["blas_pools"] = [
            {k: p.get(k) for k in ("internal_api", "num_threads", "prefix", "filepath")}
            for p in pools
        ]
        for p in pools:
            if "blas" in (p.get("internal_api") or "") or "openblas" in (p.get("prefix") or ""):
                info["blas"] = f"{p.get('prefix')} {p.get('version') or ''}".strip()
                info["blas_threads"] = p.get("num_threads")
    except Exception:
        pass
    print("-" * 78)
    print(f"   CPU cores                 : {info['cores_physical']}")
    print(f"   NumPy                     : {np.__version__}")
    print(f"   NumPy BLAS threads        : {info.get('blas_threads', 'n/a')}"
          f" ({info.get('blas', 'n/a')})")
    print(f"   torch CPU threads         : {info['torch_cpu_threads']}")
    print("-" * 78)
    return info


def parity(a, b) -> dict:
    """Field-level agreement between the NumPy and CUDA FrameSeries."""
    d_md = float(np.abs(a.max_depth.astype(np.float64) - b.max_depth.astype(np.float64)).max())
    d_mv = float(np.abs(a.max_vel.astype(np.float64) - b.max_vel.astype(np.float64)).max())
    wet_a, wet_b = a.max_depth > WET_M, b.max_depth > WET_M
    agree = float((wet_a == wet_b).mean())
    flooded_a = float(wet_a.mean())
    both = ~np.isnan(a.arrival_s) & ~np.isnan(b.arrival_s)
    arr_gap = float(np.abs(a.arrival_s[both] - b.arrival_s[both]).max()) if both.any() else float("nan")
    arr_mask = float((np.isnan(a.arrival_s) == np.isnan(b.arrival_s)).mean())
    fa = a.depth.astype(np.float32).astype(np.float64)
    fb = b.depth.astype(np.float32).astype(np.float64)
    frame_gap = float(np.abs(fa - fb).max())
    rel_vol = abs(a.meta["stored_hm3"] - b.meta["stored_hm3"]) / max(a.meta["stored_hm3"], 1e-9)
    return {
        "max_depth_absdiff_m": d_md,
        "max_vel_absdiff_ms": d_mv,
        "flood_footprint_agreement": agree,
        "flooded_area_fraction": flooded_a,
        "frame_depth_absdiff_m": frame_gap,
        "arrival_mask_agreement": arr_mask,
        "arrival_max_gap_s": arr_gap,
        "rel_volume_diff": rel_vol,
        "cpu_mass_balance_pct": a.meta["mass_balance_error_pct"],
        "cuda_mass_balance_pct": b.meta["mass_balance_error_pct"],
        "cpu_steps": a.meta["steps"],
        "cuda_steps": b.meta["steps"],
        "cpu_injected_hm3": a.meta["injected_hm3"],
        "cuda_injected_hm3": b.meta["injected_hm3"],
        "cpu_stored_hm3": a.meta["stored_hm3"],
        "cuda_stored_hm3": b.meta["stored_hm3"],
    }


def bench_grid(n: int) -> dict:
    import torch

    mesh = _mesh(n)
    cells = n * n
    row: dict = {"grid": f"{n}x{n}", "cells": cells}

    print("=" * 78)
    print(f"2) {n}x{n} cells ({cells:,} cells, dx={DX:g} m) — horizon {DURATION_S:.0f} s "
          f"({DURATION_S / 3600:.2f} h), {FRAMES} frames")
    print("=" * 78)

    # ---- CPU leg (NumPy vectorized, single-process; BLAS threads as reported)
    t0 = time.perf_counter()
    a = fast_swe.run(mesh, _HG, duration_s=DURATION_S, frames=FRAMES, device="cpu")
    cpu_s = time.perf_counter() - t0
    row["cpu_s"] = round(cpu_s, 3)
    row["cpu_rtf"] = round(DURATION_S / cpu_s, 1)
    row["cpu_steps"] = a.meta["steps"]
    print(f"   CPU  (numpy)   : {cpu_s:8.3f} s  |  {a.meta['steps']} steps  |  "
          f"real-time {DURATION_S / cpu_s:6.1f}x")

    # ---- GPU leg (PyTorch CUDA)
    if not torch.cuda.is_available():
        row["skipped"] = "cuda unavailable"
        return row

    # fair warmup: same grid, kernels compiled + clocks ramped, untimed
    fast_swe.run(mesh, _HG, duration_s=300.0, frames=4, device="cuda")
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats(0)
    t0 = time.perf_counter()
    b = fast_swe.run(mesh, _HG, duration_s=DURATION_S, frames=FRAMES, device="cuda")
    torch.cuda.synchronize()
    gpu_s = time.perf_counter() - t0

    peak_alloc = torch.cuda.max_memory_allocated(0)
    peak_res = torch.cuda.max_memory_reserved(0)
    row.update({
        "cuda_s": round(gpu_s, 3),
        "cuda_rtf": round(DURATION_S / gpu_s, 1),
        "cuda_steps": b.meta["steps"],
        "speedup_x": round(cpu_s / gpu_s, 2),
        "peak_vram_alloc_mib": round(peak_alloc / 1024 ** 2, 1),
        "peak_vram_reserved_mib": round(peak_res / 1024 ** 2, 1),
        "auto_device": "cuda" if fast_swe._resolve_device("auto", mesh) == "cuda" else "cpu",
    })
    print(f"   GPU  (cuda)    : {gpu_s:8.3f} s  |  {b.meta['steps']} steps  |  "
          f"real-time {DURATION_S / gpu_s:6.1f}x")
    print(f"   speedup        : {row['speedup_x']}x faster on GPU "
          f"(auto device for {cells:,} cells -> {row['auto_device']})")
    print(f"   peak VRAM      : {_fmt_bytes(peak_alloc)} allocated, "
          f"{_fmt_bytes(peak_res)} reserved")

    # ---- parity
    p = parity(a, b)
    row.update(p)
    ok = (
        p["flood_footprint_agreement"] >= 0.99
        and p["max_depth_absdiff_m"] < 5e-3
        and p["arrival_mask_agreement"] >= 0.999
        and p["cpu_mass_balance_pct"] < 5.0
        and p["cuda_mass_balance_pct"] < 5.0
        and p["rel_volume_diff"] < 0.05
        and abs(p["cpu_steps"] - p["cuda_steps"]) <= 4
    )
    row["parity_ok"] = bool(ok)
    print("   --- numerical parity ---")
    print(f"   max |d max_depth|         : {p['max_depth_absdiff_m']:.3e} m")
    print(f"   max |d max_vel|           : {p['max_vel_absdiff_ms']:.3e} m/s")
    print(f"   max |d frame depth|       : {p['frame_depth_absdiff_m']:.3e} m")
    print(f"   flood footprint agreement : {p['flood_footprint_agreement'] * 100:.4f} % "
          f"(flooded {p['flooded_area_fraction'] * 100:.2f} % of grid)")
    print(f"   arrival-mask agreement    : {p['arrival_mask_agreement'] * 100:.4f} %, "
          f"max gap {p['arrival_max_gap_s']:.1f} s")
    print(f"   stored volume diff        : {p['rel_volume_diff'] * 100:.3f} % "
          f"(cpu {p['cpu_stored_hm3']:.3f} hm3 / cuda {p['cuda_stored_hm3']:.3f} hm3)")
    print(f"   mass balance              : cpu {p['cpu_mass_balance_pct']:.3f} %, "
          f"cuda {p['cuda_mass_balance_pct']:.3f} %")
    print(f"   PARITY                    : {'PASS' if ok else 'FAIL'}")
    return row


def main() -> int:
    print("fast_swe CPU vs GPU benchmark")
    print(f"horizon: {DURATION_S:.0f} s ({DURATION_S / 3600:.2f} h) | grids: "
          + ", ".join(f"{g}x{g}" for g in GRIDS))
    hw = verify_cuda()
    sysinfo = system_info()
    if not hw.get("cuda_available"):
        print("CUDA unavailable — aborting before the GPU leg.")
        return 2

    rows = [bench_grid(n) for n in GRIDS]

    print("=" * 78)
    print("3) Summary")
    print("=" * 78)
    hdr = (f"   {'grid':>9} {'cells':>9} {'cpu_s':>9} {'gpu_s':>9} {'speedup':>9} "
           f"{'cpu RTF':>9} {'gpu RTF':>9} {'peakVRAM':>11} {'parity':>7}")
    print(hdr)
    print("   " + "-" * (len(hdr) - 3))
    for r in rows:
        if "cuda_s" not in r:
            print(f"   {r['grid']:>9} {r['cells']:>9,} {r['cpu_s']:>9.3f} {'-':>9} {'-':>9} "
                  f"{r['cpu_rtf']:>9.1f} {'-':>9} {'-':>11} {'-':>7}")
            continue
        print(f"   {r['grid']:>9} {r['cells']:>9,} {r['cpu_s']:>9.3f} {r['cuda_s']:>9.3f} "
              f"{r['speedup_x']:>8.2f}x {r['cpu_rtf']:>9.1f} {r['cuda_rtf']:>9.1f} "
              f"{r['peak_vram_alloc_mib']:>9.1f}Mi {'PASS' if r['parity_ok'] else 'FAIL':>7}")

    out = {
        "hardware": {**hw, **sysinfo},
        "config": {"grids": list(GRIDS), "duration_s": DURATION_S, "frames": FRAMES,
                   "cell_m": DX, "wet_threshold_m": WET_M},
        "results": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n   wrote {OUT}")

    failed = [r for r in rows if r.get("parity_ok") is not True]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
