"""Flood-impact dashboard: what happens when the dam breaks.

Run from backend/:  python scripts/flood_impact_dashboard.py

Produces docs/benchmarks/viz/:
  20_breach_hydrograph.png   how much water explodes out (Q(t) + volume)
  21_hazard_map.png          depth classes over terrain + inundation outline
  22_depth_extent_overlay.png depth raster + extent outline + contours + gauges
  23_area_and_reach.png      area by hazard class + how far the flood travels
  flood_dashboard.html       interactive: time slider drives map layers + graphs
"""

from __future__ import annotations

import base64
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib

matplotlib.use("Agg")

import numpy as np
from matplotlib import colormaps, pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, ListedColormap, Normalize
from matplotlib.patches import Patch
from matplotlib.ticker import MaxNLocator

from modules.solvers import fast_swe

N = 256
DX = 30.0
DURATION = 3600.0
FRAMES = 30
WET = 0.05
LOW_HI = 0.5
MED_HI = 2.0

ROOT = Path(__file__).resolve().parents[2]
VIZ = ROOT / "docs" / "benchmarks" / "viz"
VIZ.mkdir(parents=True, exist_ok=True)

TURBO = colormaps["turbo"]
HAZARD = ListedColormap(["#ffd75e", "#ff8c1a", "#e8322d"])
HAZARD_NAMES = ["low  0.05–0.5 m", "moderate  0.5–2 m", "high  > 2 m"]


def mesh(n: int = N) -> dict:
    z = np.zeros((n, n), dtype=np.float32)
    z[:] = np.linspace(40.0, 0.0, n)[:, None] * 0.6
    z[n // 2 - 1 : n // 2 + 2, :] = 62.0
    z[n // 2 :, :] = 58.0
    ys, xs = np.mgrid[0:n, 0:n]
    z -= 6.0 * np.exp(-(((xs - n * 0.25) ** 2 + (ys - n * 0.7) ** 2) / (2 * (n * 0.16) ** 2)))
    return {"z": z, "cell_m": DX,
            "breach_cells": (np.array([n // 2]), np.array([n // 2])),
            "stations_km": {0.0: (n // 2, n // 2),
                            5.0: (int(n * 0.72), int(n * 0.44)),
                            10.0: (int(n * 0.88), int(n * 0.60))}}


HG = {"time_s": np.array([0.0, 600.0, 3600.0]),
      "q_cms": np.array([0.0, 2500.0, 800.0])}


def extent_km(n: int = N) -> tuple[float, float, float, float]:
    return 0.0, n * DX / 1000.0, 0.0, n * DX / 1000.0


def hillshade_rgb(z: np.ndarray) -> np.ndarray:
    from matplotlib.colors import LightSource

    ls = LightSource(azdeg=315, altdeg=45)
    rgb = colormaps["terrain"](Normalize(float(z.min()), float(z.max()))(z))[..., :3]
    hs = ls.hillshade(z, vert_exag=2.0, dx=DX, dy=DX)
    return np.clip(rgb * (0.55 + 0.45 * hs[..., None]), 0, 1)


def classes(depth: np.ndarray) -> np.ndarray:
    """0 dry, 1 low, 2 moderate, 3 high."""
    c = np.zeros(depth.shape, dtype=np.uint8)
    c[depth > WET] = 1
    c[depth > LOW_HI] = 2
    c[depth > MED_HI] = 3
    return c


def flood_rgb(z: np.ndarray, depth: np.ndarray, base: np.ndarray | None = None) -> np.ndarray:
    rgb = base if base is not None else hillshade_rgb(z)
    d = np.nan_to_num(depth, nan=0.0)
    a = np.clip(d / 2.5, 0, 1) * 0.92
    a = np.where(d > 0.02, a, 0.0)[..., None]
    return np.clip(rgb * (1 - a) + TURBO(np.clip(d / 3.5, 0, 1))[..., :3] * a, 0, 1)


def save(fig, name: str) -> Path:
    p = VIZ / name
    fig.savefig(p, dpi=140, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"   {p.name}")
    return p


def marks(ax, m, labels: dict[str, str] | None = None):
    # rasters use origin='upper' (row 0 at the top) → plot y = (rows - row) * dx,
    # otherwise gauges/contours land mirrored against the depth raster.
    n = int(m["z"].shape[0])

    def y_of(rr: int) -> float:
        return (n - rr - 0.5) * DX / 1000.0

    r, c = m["breach_cells"]
    ax.plot((c[0] + 0.5) * DX / 1000, y_of(r[0]), marker="*", markersize=18,
            color="white", markeredgecolor="k", zorder=6, linestyle="None", label="breach")
    for km, (rr, cc) in m["stations_km"].items():
        x, y = (cc + 0.5) * DX / 1000, y_of(rr)
        ax.plot(x, y, marker="o", markersize=8, color="white", markeredgecolor="black",
                zorder=6, linestyle="None")
        txt = labels.get(str(km), f"CH{float(km):g}") if labels else f"CH{float(km):g}"
        ax.annotate(txt, (x, y), textcoords="offset points", xytext=(7, 7), fontsize=8.5,
                    fontweight="bold", zorder=6,
                    bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.8))


# --------------------------------------------------------------- analytics
def analyse(fs, m) -> dict:
    d = fs.depth.astype(np.float32)
    n_f = d.shape[0]
    wet = d > WET
    cls = np.stack([classes(d[i]) for i in range(n_f)])

    area = np.zeros((n_f, 4))
    for i in range(n_f):
        for k in (1, 2, 3):
            area[i, k] = int((cls[i] == k).sum()) * DX * DX / 1e6
        area[i, 0] = area[i, 1:].sum()

    r0, c0 = m["breach_cells"][0][0], m["breach_cells"][1][0]
    yy, xx = np.mgrid[0:N, 0:N]
    dist = np.sqrt(((yy - r0) * DX) ** 2 + ((xx - c0) * DX) ** 2)
    reach = np.array([float(dist[wet[i]].max()) / 1000.0 if wet[i].any() else 0.0
                      for i in range(n_f)])

    pond = np.array([float(d[i][wet[i]].sum()) * DX * DX / 1e6 for i in range(n_f)])

    t_fine = np.linspace(0, DURATION, 1201)
    q_fine = np.interp(t_fine, HG["time_s"], HG["q_cms"])
    dt = t_fine[1] - t_fine[0]
    vol_rel = np.concatenate([[0.0], np.cumsum(0.5 * (q_fine[1:] + q_fine[:-1]) * dt) / 1e6])

    peak_i = int(np.argmax(q_fine))
    st = {}
    for km, s in fs.stations.items():
        arr = next((t for t, dep in zip(s["times_s"], s["depth_m"]) if dep > WET), None)
        st[str(km)] = {"t_h": [round(x / 3600, 4) for x in s["times_s"]],
                       "d": [round(float(x), 3) for x in s["depth_m"]],
                       "q": [round(float(x), 1) for x in s["q_cms"]],
                       "arrival_h": None if arr is None else round(arr / 3600, 3),
                       "max_d": float(max(s["depth_m"])) if s["depth_m"] else 0.0}

    return {
        "times_s": [round(float(t), 1) for t in fs.times_s],
        "times_h": [round(float(t) / 3600, 4) for t in fs.times_s],
        "area_km2": [round(float(a), 4) for a in area[:, 0]],
        "area_low": [round(float(a), 4) for a in area[:, 1]],
        "area_med": [round(float(a), 4) for a in area[:, 2]],
        "area_high": [round(float(a), 4) for a in area[:, 3]],
        "reach_km": [round(float(x), 4) for x in reach],
        "ponded_hm3": [round(float(x), 4) for x in pond],
        "maxdepth_m": [round(float(np.nanmax(d[i])), 3) for i in range(n_f)],
        "q_t_h": [round(float(t) / 3600, 4) for t in t_fine],
        "q_cms": [round(float(x), 1) for x in q_fine],
        "vol_hm3": [round(float(x), 4) for x in vol_rel],
        "stations": st,
        "peak_q_cms": float(q_fine[peak_i]),
        "peak_q_h": round(float(t_fine[peak_i]) / 3600, 3),
        "released_hm3": float(vol_rel[-1]),
        "final_area_km2": float(area[-1, 0]),
        "final_high_km2": float(area[-1, 3]),
        "max_depth_m": float(np.nanmax(d)),
        "max_reach_km": float(reach.max()),
        "final_ponded_hm3": float(pond[-1]),
        "arrival_min_h": min((v["arrival_h"] for v in st.values()
                              if v["arrival_h"] is not None), default=None),
    }


# ------------------------------------------------------------- static maps
def breach_hydrograph(a: dict) -> Path:
    print("[20 breach hydrograph]")
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 5.2))
    ax = axes[0]
    ax.plot(np.array(a["q_t_h"]), np.array(a["q_cms"]), color="#d62728", lw=2.4)
    ax.fill_between(np.array(a["q_t_h"]), np.array(a["q_cms"]), color="#d62728", alpha=0.22)
    ax.axvline(a["peak_q_h"], color="k", ls="--", lw=1)
    ax.annotate(f"peak {a['peak_q_cms']:.0f} m³/s\nat {a['peak_q_h'] * 60:.0f} min",
                (a["peak_q_h"], a["peak_q_cms"]), xytext=(-100, -40),
                textcoords="offset points", fontsize=10, fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.3", fc="#fff3f3", ec="#d62728"))
    ax.set_xlabel("time after breach (h)")
    ax.set_ylabel("breach outflow Q (m³/s)")
    ax.set_title("How much water explodes out of the breach", fontweight="bold")
    ax.grid(alpha=0.3)

    ax = axes[1]
    ax.plot(a["q_t_h"], a["vol_hm3"], color="#1f77b4", lw=2.4, label="cumulative released")
    ax.plot(a["times_h"], a["ponded_hm3"], color="#2ca02c", lw=2.2, ls="--",
            label="water standing on the plain")
    ax.fill_between(a["q_t_h"], a["vol_hm3"], color="#1f77b4", alpha=0.15)
    ax.set_xlabel("time after breach (h)")
    ax.set_ylabel("volume (hm³)")
    ax.set_title(f"Volume released: {a['released_hm3']:.2f} hm³ in "
                 f"{DURATION / 60:.0f} min", fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)
    return save(fig, "20_breach_hydrograph.png")


def hazard_map(fs, m, base) -> Path:
    print("[21 hazard map]")
    fig, ax = plt.subplots(figsize=(7.8, 6.6))
    ax.imshow(base, extent=extent_km(), origin="upper", interpolation="nearest")
    cls_final = classes(fs.max_depth)
    arr = np.ma.masked_where(cls_final == 0, cls_final)
    ax.imshow(arr, extent=extent_km(), origin="upper", cmap=HAZARD, vmin=0.5, vmax=3.5,
              interpolation="nearest", alpha=0.82)
    wet = cls_final > 0
    if wet.any():
        X = np.linspace(0, N * DX / 1000, N)
        Y = np.linspace(N * DX / 1000, 0, N)
        ax.contour(X, Y, wet.astype(float), levels=[0.5], colors="k", linewidths=1.4)
    marks(ax, m)
    ax.legend(handles=[Patch(facecolor="#ffd75e", ec="k", lw=0.5, label=HAZARD_NAMES[0]),
                       Patch(facecolor="#ff8c1a", ec="k", lw=0.5, label=HAZARD_NAMES[1]),
                       Patch(facecolor="#e8322d", ec="k", lw=0.5, label=HAZARD_NAMES[2]),
                       Patch(facecolor="none", ec="k", lw=1.4, label="inundation outline")],
              loc="lower left", fontsize=9, framealpha=0.9)
    ax.set_xlabel("x (km)")
    ax.set_ylabel("y (km)")
    ax.set_title(f"Maximum flood hazard classes — worst-case extent "
                 f"{a_final(fs):.2f} km²", fontweight="bold")
    return save(fig, "21_hazard_map.png")


def a_final(fs) -> float:
    return float((fs.max_depth > WET).sum()) * DX * DX / 1e6


def overlay_map(fs, m, base, an: dict) -> Path:
    print("[22 depth overlay]")
    fig, ax = plt.subplots(figsize=(8.0, 6.6))
    ax.imshow(base, extent=extent_km(), origin="upper", interpolation="nearest")
    depth = np.where(fs.max_depth > WET, fs.max_depth, np.nan)
    im = ax.imshow(depth, extent=extent_km(), origin="upper", cmap=TURBO, vmin=0, vmax=3.5,
                   interpolation="nearest", alpha=0.88)
    wet = fs.max_depth > WET
    X = np.linspace(0, N * DX / 1000, N)
    Y = np.linspace(N * DX / 1000, 0, N)
    if wet.any():
        ax.contour(X, Y, wet.astype(float), levels=[0.5], colors="white", linewidths=1.8)
    cb = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    cb.set_label("depth (m)")
    labels = {}
    for km, v in an["stations"].items():
        if v["arrival_h"] is not None:
            labels[km] = (f"CH{float(km):g}  ▸ {v['arrival_h'] * 60:.0f} min, "
                          f"{v['max_d']:.1f} m")
        else:
            labels[km] = f"CH{float(km):g}  ▸ dry"
    marks(ax, m, labels)
    ax.contour(X, Y, m["z"], levels=[58, 60, 62], colors="k", linewidths=0.6, alpha=0.45)
    ax.set_xlabel("x (km)")
    ax.set_ylabel("y (km)")
    ax.set_title("Maximum inundation depth + extent outline over terrain",
                 fontweight="bold")
    return save(fig, "22_depth_extent_overlay.png")


def area_reach(a: dict) -> Path:
    print("[23 area + reach]")
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 5.2))
    ax = axes[0]
    th = np.array(a["times_h"])
    ax.stackplot(th, np.array(a["area_low"]), np.array(a["area_med"]),
                 np.array(a["area_high"]),
                 labels=[HAZARD_NAMES[0], HAZARD_NAMES[1], HAZARD_NAMES[2]],
                 colors=["#ffd75e", "#ff8c1a", "#e8322d"], alpha=0.9)
    ax.set_xlabel("time after breach (h)")
    ax.set_ylabel("inundated area (km²)")
    ax.set_title(f"Area affected by depth class — {a['final_area_km2']:.2f} km² total "
                 f"({a['final_high_km2']:.2f} km² high hazard)", fontweight="bold")
    ax.legend(fontsize=9, loc="upper left")
    ax.grid(alpha=0.3)

    ax = axes[1]
    ax.plot(th, a["reach_km"], color="#9467bd", lw=2.6)
    ax.fill_between(th, a["reach_km"], color="#9467bd", alpha=0.2)
    ax.set_xlabel("time after breach (h)")
    ax.set_ylabel("farthest wet cell from the breach (km)")
    ax.set_title(f"Flood front advance — {a['max_reach_km']:.2f} km in "
                 f"{DURATION / 60:.0f} min", fontweight="bold")
    ax.grid(alpha=0.3)
    for km, v in a["stations"].items():
        if v["arrival_h"] is not None:
            ax.axvline(v["arrival_h"], ls=":", lw=1.3, color="k", alpha=0.7)
            ax.text(v["arrival_h"], ax.get_ylim()[1] * 0.96, f" CH{float(km):g}",
                    fontsize=8.5, va="top", fontweight="bold")
    return save(fig, "23_area_and_reach.png")


# -------------------------------------------------------- dashboard assets
def u8(x: np.ndarray, scale: float) -> bytes:
    return np.clip(x / scale * 255.0, 0, 255).astype(np.uint8).tobytes()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def png_b64(arr: np.ndarray) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def base_png(z: np.ndarray) -> str:
    """Hillshade + contour lines rendered at exactly N×N pixels."""
    fig = plt.figure(figsize=(N / 100, N / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(hillshade_rgb(z), extent=(0, N, N, 0), interpolation="nearest")
    ax.contour(np.arange(N), np.arange(N), z, levels=[58, 60, 62],
               colors="k", linewidths=0.6, alpha=0.5)
    ax.set_xlim(0, N)
    ax.set_ylim(N, 0)
    ax.axis("off")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def flood_dashboard(fs, m, an: dict) -> Path:
    print("[flood_dashboard.html]")
    d = fs.depth.astype(np.float32)
    scale = float(max(4.0, np.nanmax(d)))
    frames = b64(b"".join(u8(d[i], scale) for i in range(d.shape[0])))

    arr = fs.arrival_s
    dur = max(float(np.nanmax(arr)), 1.0) if np.isfinite(arr).any() else DURATION
    a8 = np.full(arr.shape, 255, np.uint8)
    ok = np.isfinite(arr)
    a8[ok] = np.clip(arr[ok] / dur * 254.0, 0, 254).astype(np.uint8)

    vel_scale = float(max(fs.max_vel.max(), 1e-6))
    z16 = np.clip(m["z"] * 1000.0, 0, 65535).astype("<u2")

    payload = {
        "n": N, "dx": DX, "nF": d.shape[0], "scaleM": scale,
        "durS": DURATION, "durH": DURATION / 3600, "velScale": vel_scale,
        "frames": frames, "base": base_png(m["z"]),
        "arrival": b64(a8.tobytes()), "arrDur": dur,
        "vel": b64(np.clip(fs.max_vel / vel_scale * 255, 0, 255).astype(np.uint8).tobytes()),
        "z": b64(z16.tobytes()),
        "turbo": [[int(c * 255) for c in rgb[:3]]
                  for rgb in TURBO(np.linspace(0, 1, 33))],
        "breach": [int(m["breach_cells"][0][0]), int(m["breach_cells"][1][0])],
        "gauges": [[float(km), int(rc[0]), int(rc[1])]
                   for km, rc in m["stations_km"].items()],
        "s": an,
        "meta": {
            "steps": fs.meta["steps"], "mass": fs.meta["mass_balance_error_pct"],
            "cell_m": DX, "grid": f"{N}×{N}", "engine": "fast_swe (Bates 2010 LISFLOOD)",
        },
    }

    tpl = (Path(__file__).with_name("_flood_dashboard_tpl.html")).read_text(encoding="utf-8")
    html = tpl.replace("__PAYLOAD__", json.dumps(payload))
    out = VIZ / "flood_dashboard.html"
    out.write_text(html, encoding="utf-8")
    print(f"   {out.name} ({out.stat().st_size / 1e6:.1f} MB)")
    return out


def main() -> int:
    t0 = time.perf_counter()
    m = mesh()
    t = time.perf_counter()
    fs = fast_swe.run(m, HG, duration_s=DURATION, frames=FRAMES, device="auto")
    print(f"solved {fs.meta['steps']} steps in {time.perf_counter() - t:.2f}s "
          f"(device={fs.meta['device']})")

    an = analyse(fs, m)
    breach_hydrograph(an)
    base = hillshade_rgb(m["z"])
    hazard_map(fs, m, base)
    overlay_map(fs, m, base, an)
    area_reach(an)
    page = flood_dashboard(fs, m, an)

    print("-" * 64)
    print(f"peak breach discharge : {an['peak_q_cms']:.0f} m³/s at {an['peak_q_h'] * 60:.0f} min")
    print(f"water released        : {an['released_hm3']:.2f} hm³ in {DURATION / 60:.0f} min")
    print(f"standing on the plain : {an['final_ponded_hm3']:.2f} hm³ "
          f"(mass balance err {fs.meta['mass_balance_error_pct']:.1e} %)")
    print(f"area flooded          : {an['final_area_km2']:.2f} km² "
          f"(high hazard {an['final_high_km2']:.2f} km²)")
    print(f"farthest reach        : {an['max_reach_km']:.2f} km")
    print(f"max depth             : {an['max_depth_m']:.2f} m")
    print(f"done in {time.perf_counter() - t0:.1f}s")
    print(f"open: {page}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
