"""Generate every visual NIYANTA can produce from a fast_swe run + benchmark.

Run from backend/:  python scripts/visualize_results.py

Outputs to docs/benchmarks/viz/ :
  01_max_depth_map.png        02_max_velocity_map.png     03_arrival_time.png
  04_before_after.png         05_cpu_gpu_parity.png       06_benchmark_dashboard.png
  07_station_hydrographs.png  08_inundation_growth.png    09_frame_strip.png
  10_summary_table.png        flood_animation.gif/.mp4    internal_benchmark.html (CPU/GPU, internal)
"""

from __future__ import annotations

import base64
import io
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib

matplotlib.use("Agg")

import numpy as np
from matplotlib import colormaps, pyplot as plt
from matplotlib.colors import LightSource, Normalize

from modules.solvers import fast_swe

N = 256
DX = 30.0
DURATION = 1800.0
FRAMES = 36
WET = 0.05
ROOT = Path(__file__).resolve().parents[2]
VIZ = ROOT / "docs" / "benchmarks" / "viz"
VIZ.mkdir(parents=True, exist_ok=True)

CMAP = colormaps["turbo"]
TERRAIN = colormaps["terrain"]
G = 9.80665


def mesh(n: int = N, stations: dict | None = None) -> dict:
    z = np.zeros((n, n), dtype=np.float32)
    z[:] = np.linspace(40.0, 0.0, n)[:, None] * 0.6
    z[n // 2 - 1 : n // 2 + 2, :] = 62.0
    z[n // 2 :, :] = 58.0
    ys, xs = np.mgrid[0:n, 0:n]
    z -= 6.0 * np.exp(-(((xs - n * 0.25) ** 2 + (ys - n * 0.7) ** 2) / (2 * (n * 0.16) ** 2)))
    st = stations if stations is not None else {
        0.0: (n // 2, n // 2),
        5.0: (int(n * 0.72), int(n * 0.44)),
        10.0: (int(n * 0.88), int(n * 0.60)),
    }
    return {"z": z, "cell_m": DX,
            "breach_cells": (np.array([n // 2]), np.array([n // 2])),
            "stations_km": st}


HG = {"time_s": np.array([0.0, 600.0, 3600.0]),
      "q_cms": np.array([0.0, 2500.0, 800.0])}


def km_axis(n: int) -> tuple[float, float, float, float]:
    return 0.0, n * DX / 1000.0, 0.0, n * DX / 1000.0


def shaded(z: np.ndarray) -> np.ndarray:
    """Terrain RGB (0..1) with a hillshade baked in."""
    ls = LightSource(azdeg=315, altdeg=45)
    norm = Normalize(vmin=float(z.min()), vmax=float(z.max()))
    rgb = TERRAIN(norm(z))[..., :3]
    hs = ls.hillshade(z, vert_exag=2.0, dx=DX, dy=DX)
    return np.clip(rgb * (0.55 + 0.45 * hs[..., None]), 0, 1)


def flood_rgb(z: np.ndarray, depth: np.ndarray, alpha_cap: float = 0.92) -> np.ndarray:
    """Hillshaded terrain with the flood depth composited on top."""
    rgb = shaded(z)
    d = np.nan_to_num(depth.astype(np.float32), nan=0.0)
    a = np.clip(d / 2.5, 0, 1) * alpha_cap
    a = np.where(d > 0.02, a, 0.0)[..., None]
    return np.clip(rgb * (1 - a) + CMAP(np.clip(d / 3.0, 0, 1))[..., :3] * a, 0, 1)


def save(fig, name: str) -> Path:
    p = VIZ / name
    fig.savefig(p, dpi=140, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"   {p.name}")
    return p


def panel_map(ax, arr, extent, title, label, cmap=CMAP, vmin=None, vmax=None,
              fmt="%.1f", grid_labels=True, cbar=True, **kw):
    im = ax.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax, origin="upper",
                   extent=extent, interpolation="nearest", **kw)
    ax.set_title(title, fontsize=11, fontweight="bold")
    if grid_labels:
        ax.set_xlabel("x (km)")
        ax.set_ylabel("y (km)")
    if cbar:
        cb = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
        cb.set_label(label, fontsize=9)
        cb.ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: fmt % v))
    return im


def marks(ax, m, extent):
    # rasters are drawn origin='upper' (row 0 at the top), so a cell's plot-y is
    # (rows - row) * dx — keeps gauges/contours aligned with the depth raster.
    n = int(m["z"].shape[0])

    def y_of(rr: float) -> float:
        return (n - rr - 0.5) * DX / 1000.0

    r, c = m["breach_cells"]
    ax.plot((c[0] + 0.5) * DX / 1000, y_of(r[0]), marker="*",
            markersize=16, color="white", markeredgecolor="k", zorder=5,
            linestyle="None", label="breach")
    for km, (rr, cc) in m["stations_km"].items():
        ax.plot((cc + 0.5) * DX / 1000, y_of(rr), marker="o",
                markersize=7, color="white", markeredgecolor="black", zorder=5,
                linestyle="None")
        ax.annotate(f"CH{float(km):g}", ((cc + 0.5) * DX / 1000, y_of(rr)),
                    textcoords="offset points", xytext=(6, 6), fontsize=8,
                    color="black", fontweight="bold",
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75))
    ax.legend(loc="lower left", fontsize=8, framealpha=0.85)


# ------------------------------------------------------------------ 1. maps
def maps(m, fs) -> dict:
    print("[maps]")
    ext = km_axis(N)
    out: dict = {}

    fig, ax = plt.subplots(figsize=(7.6, 6.4))
    panel_map(ax, fs.max_depth, ext, "Max flood depth — 0.5 h horizon",
              "depth (m)", vmin=0, vmax=max(1.0, float(fs.max_depth.max())))
    marks(ax, m, ext)
    ax.contour(np.linspace(ext[0], ext[1], N), np.linspace(ext[3], ext[2], N),
               m["z"], levels=[58, 60, 62], colors="k", linewidths=0.5, alpha=0.35)
    out["max_depth"] = save(fig, "01_max_depth_map.png")

    fig, ax = plt.subplots(figsize=(7.6, 6.4))
    panel_map(ax, fs.max_vel, ext, "Max flow speed", "speed (m/s)",
              vmin=0, vmax=max(1.0, float(fs.max_vel.max())), fmt="%.1f")
    marks(ax, m, ext)
    out["max_vel"] = save(fig, "02_max_velocity_map.png")

    fig, ax = plt.subplots(figsize=(7.6, 6.4))
    arr = np.where(np.isnan(fs.arrival_s), np.nan, fs.arrival_s / 3600.0)
    im = panel_map(ax, arr, ext, "Flood arrival time (first 5 cm)", "arrival (h)",
                   vmin=0, vmax=DURATION / 3600, fmt="%.1f", cmap=CMAP.reversed())
    dry = np.isnan(arr)
    if dry.any():
        ax.imshow(np.where(dry, 1.0, np.nan), cmap="gray_r", vmin=0, vmax=1.6,
                  extent=ext, origin="upper", interpolation="nearest", alpha=0.35)
    marks(ax, m, ext)
    out["arrival"] = save(fig, "03_arrival_time.png")

    fig, axes = plt.subplots(1, 2, figsize=(13.4, 6.2))
    axes[0].imshow(shaded(m["z"]), extent=ext, origin="upper", interpolation="nearest")
    axes[0].set_title("BEFORE — dry terrain (t = 0)", fontweight="bold", fontsize=11)
    water = flood_rgb(m["z"], fs.max_depth)
    axes[1].imshow(water, extent=ext, origin="upper", interpolation="nearest")
    axes[1].set_title("AFTER — max inundation (t = 30 min)", fontweight="bold", fontsize=11)
    for ax, lab in zip(axes, ("terrain", "depth (m)")):
        ax.set_xlabel("x (km)")
        ax.set_ylabel("y (km)")
    cb = plt.colorbar(plt.cm.ScalarMappable(norm=Normalize(0, 3), cmap=CMAP),
                      ax=axes[1], fraction=0.046, pad=0.03)
    cb.set_label("depth (m)")
    marks(axes[1], m, ext)
    out["before_after"] = save(fig, "04_before_after.png")
    return out


# ------------------------------------------------------------- 2. parity
def parity(m, a, b) -> dict:
    print("[parity]")
    ext = km_axis(N)
    diff = np.abs(a.max_depth - b.max_depth)
    wet_a, wet_b = a.max_depth > WET, b.max_depth > WET
    both = ~np.isnan(a.arrival_s) & ~np.isnan(b.arrival_s)
    met = {
        "max |Δ depth|": f"{diff.max():.3e} m",
        "max |Δ velocity|": f"{np.abs(a.max_vel - b.max_vel).max():.3e} m/s",
        "flood footprint agreement": f"{(wet_a == wet_b).mean() * 100:.4f} %",
        "arrival-mask agreement": f"{(np.isnan(a.arrival_s) == np.isnan(b.arrival_s)).mean() * 100:.4f} %",
        "arrival max gap": f"{np.abs(a.arrival_s[both] - b.arrival_s[both]).max():.1f} s",
        "volume diff": f"{abs(a.meta['stored_hm3'] - b.meta['stored_hm3']) / a.meta['stored_hm3'] * 100:.6f} %",
        "mass balance (cpu / cuda)": f"{a.meta['mass_balance_error_pct']:.2e} / {b.meta['mass_balance_error_pct']:.2e} %",
        "steps (cpu / cuda)": f"{a.meta['steps']} / {b.meta['steps']}",
    }
    fig, axes = plt.subplots(1, 3, figsize=(16.2, 5.6))
    panel_map(axes[0], a.max_depth, ext, "CPU (NumPy) max depth", "depth (m)",
              vmin=0, vmax=max(1.0, float(a.max_depth.max())), grid_labels=False)
    panel_map(axes[1], b.max_depth, ext, "GPU (CUDA / RTX 4060) max depth", "depth (m)",
              vmin=0, vmax=max(1.0, float(b.max_depth.max())), grid_labels=False)
    dmax = max(float(diff.max()), 1e-9)
    panel_map(axes[2], diff * 1000, ext, "|CPU − GPU| (difference)", "diff (mm)",
              vmin=0, vmax=max(dmax * 1000, 0.01), cmap="magma", fmt="%.3f",
              grid_labels=False)
    for ax in axes:
        ax.set_xlabel("x (km)")
    txt = "\n".join(f"{k:<26} {v}" for k, v in met.items())
    fig.text(0.5, -0.04, txt, ha="center", va="top", fontsize=10, family="monospace",
             bbox=dict(boxstyle="round,pad=0.6", fc="#f4f7fb", ec="#c9d4e2"))
    fig.suptitle("CPU vs GPU numerical parity — identical flood footprint", fontsize=13,
                 fontweight="bold")
    out = {"png": save(fig, "05_cpu_gpu_parity.png"), "metrics": met}
    return out


# ---------------------------------------------------------- 3. benchmark
def load_bench() -> dict:
    rows, vram = [], []
    for f in ("cpu_vs_gpu.json", "cpu_vs_gpu_1024.json"):
        p = ROOT / "docs" / "benchmarks" / f
        if p.exists():
            for r in json.loads(p.read_text(encoding="utf-8"))["results"]:
                if r not in rows:
                    rows.append(r)
    rows.sort(key=lambda r: r["cells"])
    for r in rows:
        vram.append((r["grid"], r["cells"], r.get("peak_vram_alloc_mib")))
    return {"rows": rows, "vram": vram}


def benchmark() -> dict:
    print("[benchmark]")
    b = load_bench()
    rows = [r for r in b["rows"] if "cuda_s" in r]
    labels = [r["grid"] for r in rows]
    x = np.arange(len(rows))

    fig, axes = plt.subplots(2, 2, figsize=(13.6, 9.2))
    ax = axes[0][0]
    w = 0.38
    ax.bar(x - w / 2, [r["cpu_s"] for r in rows], w, label="CPU (NumPy)",
           color="#4C78A8", edgecolor="k", linewidth=0.4)
    ax.bar(x + w / 2, [r["cuda_s"] for r in rows], w, label="GPU (CUDA)",
           color="#F58518", edgecolor="k", linewidth=0.4)
    for i, r in enumerate(rows):
        ax.text(i - w / 2, r["cpu_s"], f"{r['cpu_s']:.1f}s", ha="center",
                va="bottom", fontsize=9)
        ax.text(i + w / 2, r["cuda_s"], f"{r['cuda_s']:.1f}s", ha="center",
                va="bottom", fontsize=9)
    ax.set_xticks(x, labels)
    ax.set_ylabel("wall time for 1800 s flood horizon (s)")
    ax.set_title("Execution time: CPU vs GPU", fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(axis="y", alpha=0.3)

    ax = axes[0][1]
    cols = ["#54A24B" if r["speedup_x"] >= 1 else "#E45756" for r in rows]
    bars = ax.bar(x, [r["speedup_x"] for r in rows], 0.55, color=cols,
                  edgecolor="k", linewidth=0.4)
    ax.axhline(1.0, color="k", lw=1, ls="--")
    ax.text(len(rows) - 0.5, 1.15, "break-even", fontsize=8, ha="right")
    for i, r in enumerate(rows):
        ax.text(i, r["speedup_x"], f"{r['speedup_x']:.2f}x", ha="center",
                va="bottom", fontsize=10, fontweight="bold")
    ax.set_xticks(x, labels)
    ax.set_ylabel("CPU time / GPU time")
    ax.set_title("GPU speedup factor (real-time factor gain)", fontweight="bold")
    ax.grid(axis="y", alpha=0.3)

    ax = axes[1][0]
    rtf_c = [r["cpu_rtf"] for r in rows]
    rtf_g = [r["cuda_rtf"] for r in rows]
    ax.bar(x - w / 2, rtf_c, w, label="CPU", color="#4C78A8", edgecolor="k", lw=0.4)
    ax.bar(x + w / 2, rtf_g, w, label="GPU", color="#F58518", edgecolor="k", lw=0.4)
    for i, (c, g) in enumerate(zip(rtf_c, rtf_g)):
        ax.text(i - w / 2, c, f"{c:.0f}x", ha="center", va="bottom", fontsize=9)
        ax.text(i + w / 2, g, f"{g:.0f}x", ha="center", va="bottom", fontsize=9)
    ax.set_xticks(x, labels)
    ax.set_ylabel("× real time (1800 s horizon / wall s)")
    ax.set_title("Real-time factor — how fast the flood is replayed", fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(axis="y", alpha=0.3)

    ax = axes[1][1]
    vm = [(r["grid"], r.get("peak_vram_alloc_mib")) for r in rows]
    ax.bar([v[0] for v in vm], [v[1] for v in vm], 0.5, color="#B279A2",
           edgecolor="k", lw=0.4)
    for i, v in enumerate(vm):
        ax.text(i, v[1], f"{v[1]:.1f} MiB", ha="center", va="bottom",
                fontsize=9, fontweight="bold")
    ax.set_ylabel("peak VRAM allocated (MiB)")
    ax.set_title(f"Peak VRAM on {b.get('gpu', 'RTX 4060')} (8 GiB budget)",
                 fontweight="bold")
    ax.grid(axis="y", alpha=0.3)
    mem = 8192
    ax.axhline(mem, color="r", ls="--", lw=1)
    ax.text(len(vm) - 0.5, mem, "8 GiB", color="r", fontsize=8, ha="right", va="bottom")

    fig.suptitle("fast_swe CPU vs GPU benchmark — RTX 4060", fontsize=15,
                 fontweight="bold")
    png = save(fig, "06_benchmark_dashboard.png")
    return {"png": png, "rows": rows}


# ------------------------------------------------- 4. stations + growth
def series(m, fs) -> dict:
    print("[stations+growth]")
    t = fs.times_s / 3600.0
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 5.2))
    ax = axes[0]
    for km, s in fs.stations.items():
        ax.plot(np.asarray(s["times_s"]) / 3600.0, s["depth_m"], lw=2,
                marker="o", ms=3.5, label=f"CH{km}")
    ax.set_xlabel("time (h)")
    ax.set_ylabel("depth at station (m)")
    ax.set_title("Stage hydrograph — depth vs time", fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)

    ax = axes[1]
    for km, s in fs.stations.items():
        ax.plot(np.asarray(s["times_s"]) / 3600.0, s["q_cms"], lw=2,
                marker="o", ms=3.5, label=f"CH{km}")
    ax.set_xlabel("time (h)")
    ax.set_ylabel("cross-section discharge (m³/s)")
    ax.set_title("Discharge hydrograph at stations", fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)
    hyd = save(fig, "07_station_hydrographs.png")

    d = fs.depth.astype(np.float32)
    wet = (d > WET).reshape(d.shape[0], -1).sum(axis=1) * DX * DX / 1e6
    vol = np.nansum(np.where(d > WET, d, 0), axis=(1, 2)) * DX * DX / 1e6
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 5.2))
    ax = axes[0]
    ax.plot(t, wet, lw=2.5, color="#4C78A8")
    ax.fill_between(t, wet, color="#4C78A8", alpha=0.25)
    ax.set_xlabel("time (h)")
    ax.set_ylabel("inundated area (km²)")
    ax.set_title("Flood growth — wetted footprint over time", fontweight="bold")
    ax.grid(alpha=0.3)
    ax = axes[1]
    ax.plot(t, vol, lw=2.5, color="#54A24B")
    ax.fill_between(t, vol, color="#54A24B", alpha=0.25)
    ax.set_xlabel("time (h)")
    ax.set_ylabel("water on plain (hm³)")
    ax.set_title("Flood volume over time", fontweight="bold")
    ax.grid(alpha=0.3)
    growth = save(fig, "08_inundation_growth.png")
    return {"hydrographs": hyd, "growth": growth, "wet_km2": wet, "t_h": t}


# --------------------------------------------------------- 5. frame strip
def strip(m, fs) -> dict:
    print("[frame strip]")
    picks = np.linspace(0, len(fs.times_s) - 1, 6).astype(int)
    fig, axes = plt.subplots(2, 3, figsize=(14.0, 9.0))
    vmax = max(1.0, float(fs.max_depth.max()))
    for ax, i in zip(axes.ravel(), picks):
        ax.imshow(flood_rgb(m["z"], fs.depth[i]), extent=km_axis(N),
                  origin="upper", interpolation="nearest")
        ax.set_title(f"t = {fs.times_s[i] / 3600:.2f} h ({int(fs.times_s[i])} s)",
                     fontsize=10, fontweight="bold")
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("Flood propagation — 6 snapshots of the 30-minute horizon "
                 f"(colour = depth 0–{vmax:.1f} m)", fontsize=13, fontweight="bold")
    p = save(fig, "09_frame_strip.png")
    return {"png": p, "picks": picks}


# ---------------------------------------------------------- 6. summary table
def table(bench: dict, par: dict, fs, growth) -> dict:
    print("[summary table]")
    rows = bench["rows"]
    fig, ax = plt.subplots(figsize=(14.2, 6.4))
    ax.axis("off")
    cols = ["grid", "cells", "CPU s", "GPU s", "speedup", "CPU RTF", "GPU RTF",
            "peak VRAM", "footprint parity", "mass bal. %"]
    data = []
    for r in rows:
        data.append([
            r["grid"], f"{r['cells']:,}", f"{r['cpu_s']:.2f}", f"{r['cuda_s']:.2f}",
            f"{r['speedup_x']:.2f}x", f"{r['cpu_rtf']:.0f}x", f"{r['cuda_rtf']:.0f}x",
            f"{r.get('peak_vram_alloc_mib', 0):.1f} MiB",
            f"{r['flood_footprint_agreement'] * 100:.4f}%",
            f"{max(r['cpu_mass_balance_pct'], r['cuda_mass_balance_pct']):.1e}",
        ])
    tbl = ax.table(cellText=data, colLabels=cols, loc="center", cellLoc="center")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(10)
    tbl.scale(1.0, 1.9)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("#b9c4d2")
        if r == 0:
            cell.set_facecolor("#2f4b6b")
            cell.set_text_props(color="white", fontweight="bold")
        elif r % 2 == 0:
            cell.set_facecolor("#eef3f9")
    headline = (
        f"1800 s flood horizon · {N}×{N} showcase grid · {fs.meta['steps']} solver steps · "
        f"peak depth {fs.max_depth.max():.2f} m · "
        f"inundation {growth['wet_km2'][-1]:.2f} km² · "
        f"stored {fs.meta['stored_hm3']:.3f} hm³ · mass balance "
        f"{fs.meta['mass_balance_error_pct']:.1e} % · "
        f"CPU/GPU max|Δ| {list(par['metrics'].values())[0]}"
    )
    ax.set_title("NIYANTA fast_swe — CPU vs GPU benchmark & solver quality matrix",
                 fontsize=14, fontweight="bold", pad=18)
    ax.text(0.5, -0.04, headline, transform=ax.transAxes, ha="center", fontsize=10,
            family="monospace",
            bbox=dict(boxstyle="round,pad=0.5", fc="#f4f7fb", ec="#c9d4e2"))
    return {"png": save(fig, "10_summary_table.png")}


# ------------------------------------------------------------- 7. animation
def animation(m, fs) -> dict:
    print("[animation]")
    scale = float(min(max(fs.max_depth.max(), 1.0), 3.0))
    ups = 2
    big = (N * ups, N * ups)
    frames_u8 = []
    for i in range(len(fs.times_s)):
        rgb = flood_rgb(m["z"], fs.depth[i])
        img = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
        from PIL import Image

        im = Image.fromarray(img).resize(big, Image.NEAREST)
        canvas = Image.new("RGB", (big[0] + 48, big[1] + 64), "white")
        canvas.paste(im, (48, 40))
        frames_u8.append(np.array(canvas))
        bar = np.full((10, big[0], 3), 255, np.uint8)
        fill = int(big[0] * (i + 1) / len(fs.times_s))
        bar[:, :fill] = (245, 87, 108)
        y0 = 40 + big[1] + 8
        frames_u8[-1][y0:y0 + 10, 48:48 + big[0]] = bar

    import imageio.v2 as imageio

    gif = VIZ / "flood_animation.gif"
    imageio.mimsave(gif, frames_u8, duration=90, loop=0)
    mp4 = VIZ / "flood_animation.mp4"
    try:
        imageio.mimsave(mp4, frames_u8, fps=12, codec="libx264", quality=7)
    except Exception as exc:
        print(f"   mp4 failed: {exc}")
        mp4 = None
    print(f"   {gif.name} ({gif.stat().st_size / 1e6:.1f} MB)"
          + (f" / {mp4.name}" if mp4 else ""))
    return {"gif": gif, "mp4": mp4, "frames_u8": frames_u8}


# ---------------------------------------------------------------- 8. HTML
def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def jpeg_b64(arr: np.ndarray, q: int = 82) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=q)
    return base64.b64encode(buf.getvalue()).decode()


def png_b64_arr(arr: np.ndarray) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def html(m, fs, bench, par, growth, assets) -> Path:
    print("[html dashboard]")
    before = (shaded(m["z"]) * 255).astype(np.uint8)
    after = (flood_rgb(m["z"], fs.max_depth) * 255).astype(np.uint8)
    before_b64 = png_b64_arr(before)
    after_b64 = png_b64_arr(after)

    frame_b64 = []
    for i in range(len(fs.times_s)):
        rgb = (flood_rgb(m["z"], fs.depth[i]) * 255).astype(np.uint8)
        from PIL import Image

        frame_b64.append(jpeg_b64(np.asarray(Image.fromarray(rgb).resize(
            (N * 2, N * 2), Image.NEAREST))))

    mm = np.clip(np.nan_to_num(fs.max_depth, nan=0.0) * 1000.0, 0, 65535).astype("<u2")
    mm_b64 = base64.b64encode(mm.tobytes()).decode()

    depth_chart = b64(assets["series"]["hydrographs"])
    growth_chart = b64(assets["series"]["growth"])
    bench_chart = b64(bench["png"])
    parity_chart = b64(assets["parity"]["png"])
    strip_chart = b64(assets["strip"]["png"])

    wet_final = float(growth["wet_km2"][-1])
    kpis = [
        ("Peak depth", f"{fs.max_depth.max():.2f} m"),
        ("Peak speed", f"{fs.max_vel.max():.2f} m/s"),
        ("Inundation", f"{wet_final:.2f} km²"),
        ("Volume stored", f"{fs.meta['stored_hm3']:.3f} hm³"),
        ("Mass injected", f"{fs.meta['injected_hm3']:.3f} hm³"),
        ("Mass balance err", f"{fs.meta['mass_balance_error_pct']:.1e} %"),
        ("Solver steps", f"{fs.meta['steps']}"),
        ("CPU wall time", f"{bench['rows'][0]['cpu_s']:.2f} s @256²"),
        ("GPU wall time", f"{bench['rows'][0]['cuda_s']:.2f} s @256²"),
        ("GPU speedup 512²", f"{[r for r in bench['rows'] if r['grid']=='512x512'][0]['speedup_x']:.2f}×"),
        ("Peak VRAM 512²", f"{[r for r in bench['rows'] if r['grid']=='512x512'][0]['peak_vram_alloc_mib']:.1f} MiB"),
        ("CPU↔GPU parity", par["metrics"]["flood footprint agreement"]),
    ]

    rows_html = "".join(
        "<tr>" + "".join(
            f"<td>{v}</td>" for v in (
                r["grid"], f"{r['cells']:,}", f"{r['cpu_s']:.2f}", f"{r['cuda_s']:.2f}",
                f"<b>{r['speedup_x']:.2f}×</b>", f"{r['cpu_rtf']:.0f}×", f"{r['cuda_rtf']:.0f}×",
                f"{r.get('peak_vram_alloc_mib', 0):.1f}",
                f"{r['flood_footprint_agreement'] * 100:.4f}%",
                f"{max(r['cpu_mass_balance_pct'], r['cuda_mass_balance_pct']):.2e}",
                "PASS" if r.get("parity_ok") else "—",
            )) + "</tr>"
        for r in bench["rows"])

    payload = {
        "n": N, "dx": DX, "mm": mm_b64,
        "frames": frame_b64,
        "times": [round(float(t), 1) for t in fs.times_s],
        "before": before_b64, "after": after_b64,
        "wet": [round(float(w), 4) for w in growth["wet_km2"]],
        "vol": [round(float(v), 5) for v in
                np.nansum(np.where(fs.depth.astype(np.float32) > WET,
                                   fs.depth.astype(np.float32), 0),
                          axis=(1, 2)) * DX * DX / 1e6],
        "stations": {k: {"t": [round(float(x) / 3600, 4) for x in v["times_s"]],
                         "d": v["depth_m"], "q": v["q_cms"]}
                     for k, v in fs.stations.items()},
        "par": par["metrics"],
    }

    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>NIYANTA · fast_swe flood dashboard</title>
<style>
:root{{--bg:#0d1420;--card:#151f30;--line:#253349;--tx:#e8eef7;--dim:#93a4bd;--acc:#4cc2ff;--hot:#ff6b6b}}
*{{box-sizing:border-box}}
body{{margin:0;background:linear-gradient(180deg,#0b111b,#111a29);color:var(--tx);
font:14px/1.5 "Segoe UI",system-ui,sans-serif}}
header{{padding:20px 28px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}}
h1{{margin:0;font-size:20px;letter-spacing:.4px}}
h1 small{{color:var(--dim);font-weight:400;font-size:13px;margin-left:10px}}
.badge{{background:#0e3b2e;border:1px solid #1f7a5c;color:#7dffc7;border-radius:99px;padding:4px 12px;font-size:12px}}
.wrap{{padding:20px 28px 60px;max-width:1500px;margin:0 auto}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-bottom:22px}}
.kpi{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}}
.kpi b{{display:block;font-size:20px;margin-top:2px}}
.kpi span{{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.7px}}
section{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:22px}}
h2{{margin:0 0 4px;font-size:16px}}
.hint{{color:var(--dim);font-size:12px;margin-bottom:14px}}
.ba{{position:relative;width:min(100%,860px);aspect-ratio:1/1;overflow:hidden;border-radius:10px;border:1px solid var(--line);margin:0 auto;user-select:none}}
.ba img{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}}
.ba .top{{clip-path:inset(0 0 0 var(--x,50%))}}
.ba .bar{{position:absolute;top:0;bottom:0;width:3px;background:#fff;left:var(--x,50%);transform:translateX(-1.5px);box-shadow:0 0 8px rgba(0,0,0,.6)}}
.ba .knob{{position:absolute;top:50%;left:var(--x,50%);width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#fff;color:#111;display:grid;place-items:center;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.5)}}
.ba .tag{{position:absolute;bottom:10px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.65);font-size:12px}}
.ba .tag.l{{left:10px}} .ba .tag.r{{right:10px}}
input[type=range]{{width:min(100%,860px);margin:14px auto 0;display:block;accent-color:var(--acc)}}
.row{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
@media(max-width:980px){{.row{{grid-template-columns:1fr}}}}
canvas{{width:100%;display:block;border-radius:10px;border:1px solid var(--line);background:#fff;cursor:crosshair}}
.readout{{font-family:Consolas,monospace;font-size:12px;color:var(--acc);min-height:18px;margin-top:6px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th,td{{padding:7px 9px;border-bottom:1px solid var(--line);text-align:right}}
th{{background:#101a2a;color:var(--dim);font-weight:600;text-align:right}}
th:first-child,td:first-child{{text-align:left}}
tr:hover td{{background:#1a2740}}
.pass{{color:#7dffc7;font-weight:700}}
img.chart{{width:100%;border-radius:10px;background:#fff}}
.tabs{{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}}
.tab{{background:#101a2a;border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:6px 13px;cursor:pointer;font-size:13px}}
.tab.on{{background:var(--acc);border-color:var(--acc);color:#04121d;font-weight:700}}
.g{{height:250px;position:relative}}
.g .lay{{position:absolute;inset:0;height:100%;object-fit:fill}}
.meta{{color:var(--dim);font-size:12px;font-family:Consolas,monospace}}
</style></head><body>
<header>
 <h1>NIYANTA · fast_swe flood simulation <small>{N}×{N} grid · {DURATION:.0f} s horizon · dx {DX:g} m · {fs.meta['steps']} steps · device cpu/cuda</small></h1>
 <span class="badge">CPU ↔ GPU parity {list(par['metrics'].values())[1]}</span>
</header>
<div class="wrap">

<div class="kpis">{''.join(f'<div class="kpi"><span>{k}</span><b>{v}</b></div>' for k, v in kpis)}</div>

<section>
 <h2>1 · Before ⇄ After flood — drag the slider</h2>
 <div class="hint">Left of the handle: dry terrain (hillshaded DEM). Right: maximum inundation depth after the 30-minute horizon. Breach ★ and gauging stations ●.</div>
 <div class="ba" id="ba" style="--x:50%">
   <img src="data:image/png;base64,{before_b64}" alt="before">
   <img class="top" src="data:image/png;base64,{after_b64}" alt="after">
   <div class="bar"></div><div class="knob">⟷</div>
   <div class="tag l">BEFORE · t=0</div><div class="tag r">AFTER · t=1800 s</div>
 </div>
 <input type="range" min="0" max="100" value="50" id="baS">
</section>

<section>
 <h2>2 · Time-lapse playback — scrub the flood</h2>
 <div class="hint">Drag to step through {len(fs.times_s)} saved frames ({fs.times_s[0]:.0f}–{fs.times_s[-1]:.0f} s). Hover the map for an approximate depth readout.</div>
 <div class="tabs" id="tabs"></div>
 <canvas id="cv" width="{N * 2}" height="{N * 2}"></canvas>
 <input type="range" min="0" max="{len(fs.times_s) - 1}" value="0" id="frS">
 <div class="readout" id="ro"></div>
</section>

<section>
 <h2>3 · Station hydrographs</h2>
 <div class="hint">Depth and cross-section discharge at each gauging station (CH0 / CH5 / CH10).</div>
 <div class="row">
   <img class="chart" src="data:image/png;base64,{depth_chart}" alt="depth">
   <img class="chart" src="data:image/png;base64,{growth_chart}" alt="growth">
 </div>
</section>

<section>
 <h2>4 · CPU vs GPU benchmark</h2>
 <div class="hint">Wall time, speedup, real-time factor and peak VRAM on the RTX 4060 for the 1800 s flood horizon.</div>
 <img class="chart" src="data:image/png;base64,{bench_chart}" alt="benchmark">
 <h2 style="margin-top:20px">5 · Numerical parity CPU ⇄ CUDA</h2>
 <img class="chart" src="data:image/png;base64,{parity_chart}" alt="parity">
 <h2 style="margin-top:20px">6 · Flood snapshots</h2>
 <img class="chart" src="data:image/png;base64,{strip_chart}" alt="strip">
</section>

<section>
 <h2>7 · Result matrix</h2>
 <table>
  <thead><tr><th>grid</th><th>cells</th><th>CPU s</th><th>GPU s</th><th>speedup</th>
  <th>CPU RTF</th><th>GPU RTF</th><th>VRAM MiB</th><th>footprint</th><th>mass %</th><th>parity</th></tr></thead>
  <tbody>{rows_html}</tbody>
 </table>
 <div class="meta" style="margin-top:12px">inputs: mesh(z, cell_m, breach_cells, stations_km) + hydrograph(time_s, q_cms) + duration/frames/device → FX: {fs.meta['steps']} flux steps (Bates 2010 local-inertial) → outputs: FrameSeries(times_s, depth, max_depth, max_vel, arrival_s, stations, meta) → RunResult(metrics, rasters, stations, impact).</div>
</section>
</div>
<script>
const P = {json.dumps(payload)};
const baS = document.getElementById('baS');
baS.oninput = () => document.getElementById('ba').style.setProperty('--x', baS.value + '%');
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const imgs = P.frames.map(src => {{ const i = new Image(); i.src = 'data:image/jpeg;base64,' + src; return i; }});
const frS = document.getElementById('frS'), ro = document.getElementById('ro');
const tabs = document.getElementById('tabs');
function draw(i) {{
  const im = imgs[i];
  const go = () => {{ ctx.drawImage(im, 0, 0, cv.width, cv.height);
    document.title = `NIYANTA · t=${{P.times[i]}} s`; }};
  im.complete ? go() : im.onload = go;
}}
imgs[0].onload = () => draw(0);
frS.oninput = () => draw(+frS.value);
P.times.forEach((t, i) => {{
  const b = document.createElement('button'); b.className = 'tab'; b.textContent = (t/60).toFixed(1) + ' min';
  b.onclick = () => {{ frS.value = i; draw(i); }};
  tabs.appendChild(b);
}});
const u16 = new DataView(Uint8Array.from(atob(P.mm), c => c.charCodeAt(0)).buffer);
const hex2rgb = h => [1, 8, 5].map((s, i) => parseInt(h.substr(i * 2 + 1, 2), 16));
const TURBO = ['#30123b','#4145ab','#4675ed','#39a2fc','#1bcfd4','#62fc6b','#d2e935','#fb8022','#ca3c18','#93003a'];
function depthColor(mm) {{
  const p = Math.min(0.9999, mm / 3000), seg = p * (TURBO.length - 1), i = Math.floor(seg), f = seg - i;
  const a = hex2rgb(TURBO[i]), b = hex2rgb(TURBO[Math.min(TURBO.length - 1, i + 1)]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}}
cv.onmousemove = e => {{
  const r = cv.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left) / r.width * P.n),
        gy = Math.floor((e.clientY - r.top) / r.height * P.n);
  if (gx < 0 || gy < 0 || gx >= P.n || gy >= P.n) {{ ro.textContent = ''; return; }}
  const mmv = u16.getUint16((gy * P.n + gx) * 2, true);
  const c = depthColor(mmv);
  ro.textContent = `cell (${{(gx * P.dx / 1000).toFixed(2)}} km, ${{(gy * P.dx / 1000).toFixed(2)}} km) · max depth ${{(mmv / 1000).toFixed(3)}} m · rgb(${{c}})`;
}};
</script></body></html>"""

    out = VIZ / "internal_benchmark.html"
    out.write_text(doc, encoding="utf-8")
    print(f"   {out.name} ({out.stat().st_size / 1e6:.1f} MB)")
    return out


def main() -> int:
    t0 = time.perf_counter()
    print("running fast_swe showcase ...")
    m = mesh()
    t = time.perf_counter()
    fs_cpu = fast_swe.run(m, HG, duration_s=DURATION, frames=FRAMES, device="cpu")
    print(f"   cpu {time.perf_counter() - t:.2f}s")
    fs = fs_cpu
    fs_gpu = None
    try:
        import torch

        if torch.cuda.is_available():
            t = time.perf_counter()
            fs_gpu = fast_swe.run(m, HG, duration_s=DURATION, frames=FRAMES, device="cuda")
            print(f"   cuda {time.perf_counter() - t:.2f}s")
    except Exception as exc:
        print(f"   cuda skipped: {exc}")

    assets: dict = {}
    assets["maps"] = maps(m, fs)
    if fs_gpu is not None:
        assets["parity"] = parity(m, fs_cpu, fs_gpu)
    bench = benchmark()
    assets["series"] = series(m, fs)
    assets["strip"] = strip(m, fs)
    assets["table"] = table(bench, assets.get("parity", {"metrics": {"max |Δ depth|": "n/a"}}),
                            fs, assets["series"])
    anim = animation(m, fs)
    page = html(m, fs, bench, assets["parity"], assets["series"], assets)

    print("-" * 60)
    print(f"done in {time.perf_counter() - t0:.1f}s -> {VIZ}")
    for p in sorted(VIZ.iterdir()):
        print(f"   {p.name:34s} {p.stat().st_size / 1e6:8.2f} MB")
    print(f"\nopen: {page}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
