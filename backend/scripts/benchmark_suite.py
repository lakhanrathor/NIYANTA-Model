"""Benchmark suite: hardware, engine comparison, GPU scaling, GEE live latency.

Run from backend/:  python scripts/benchmark_suite.py
Writes docs/benchmarks/suite.json. Combine with sam.json and pytest
--durations output to assemble docs/BENCHMARKS.md.
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from config import settings
from modules.db import client as db
from modules.db import seed
from modules.jobs import handlers as job_handlers
from modules.jobs import queue as jobs
from modules.run import execute as run_execute
from modules.solvers import fast_swe
from modules.catalog import catalog
from schemas.scenario import ScenarioSpec

# published engine numbers were measured on the synthetic valley grid; pin the
# methodology instead of re-downloading Copernicus tiles on every re-benchmark
settings.auto_dem = False

OUT = Path(__file__).resolve().parents[2] / "docs" / "benchmarks" / "suite.json"


def cpu_name() -> str:
    try:
        out = subprocess.run(["wmic", "cpu", "get", "name"], capture_output=True,
                             text=True, timeout=15).stdout
        line = [x.strip() for x in out.splitlines() if x.strip()][1]
        if line:
            return line
    except Exception:
        pass
    return platform.processor() or "unknown"


def hardware() -> dict:
    import torch

    info = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu": cpu_name(),
        "cores": __import__("os").cpu_count(),
        "numpy": np.__version__,
        "torch": torch.__version__,
        "cuda_available": bool(torch.cuda.is_available()),
        "benchmarked_at": datetime.now().isoformat(timespec="seconds"),
    }
    if torch.cuda.is_available():
        p = torch.cuda.get_device_properties(0)
        info["gpu"] = p.name
        info["gpu_vram_gb"] = round(p.total_memory / 1e9, 1)
    return info


# ---------------------------------------------------------------- engines

def _spec(engine: str, name: str) -> dict:
    return ScenarioSpec.model_validate({
        "case": "1",
        "name": name,
        "engine": engine,
        "breach": {"mode": "overtopping", "method": "froehlich2008"},
        "reservoir": {"storage_mcm": 286.0, "initial_level_m": 620.0,
                      "dam_height_m": 45.0, "area_km2": 12.0},
        "horizon": {"duration_hr": 1.0},
        "stations_km": [0.0, 5.0, 10.0, 15.0],
    }).model_dump(mode="json")


def stage_seconds(run_id: str) -> dict:
    # lifecycle stores lifecycle rows as "stage:status" (see lifecycle.set_stage)
    rows = db.query(
        "SELECT stage, ts FROM run_lifecycle WHERE run_id = %s AND stage IS NOT NULL "
        "ORDER BY ts, id", (run_id,))
    first: dict = {}
    out: dict = {}
    for r in rows:
        st = r["stage"].split(":")[0]
        first.setdefault(st, r["ts"])
        out[st] = round((r["ts"] - first[st]).total_seconds(), 2)
    return out


def run_engine(engine: str) -> dict:
    sc = catalog.scenario_create(_spec(engine, f"bench {engine}"))
    rid = run_execute.create_run(sc["id"])["id"]
    t0 = time.perf_counter()
    run_execute.execute(rid)
    deadline = time.time() + 900
    row = None
    while time.time() < deadline:
        row = catalog.run_get(rid)
        if row["state"] in ("VALIDATED", "FAILED", "PUBLISHED"):
            break
        time.sleep(1)
    wall = round(time.perf_counter() - t0, 2)
    assert row and row["state"] == "VALIDATED", f"{engine}: {row and row['state']} {row and row['error']}"
    return {
        "engine": engine,
        "wall_s": wall,
        "metrics": {k: row["metrics"].get(k) for k in
                    ("peak_discharge_cms", "max_depth_m", "inundation_km2",
                     "mass_balance_error_pct")},
        "grade": ((row["result"] or {}).get("validation") or {}).get("grade"),
        "stages_s": stage_seconds(rid),
        "run_id": rid,
    }


def engines() -> list[dict]:
    out = []
    for engine in ("fast", "sph", "delft3d"):
        print(f"[engines] {engine} ...", flush=True)
        out.append(run_engine(engine))
        print(f"[engines] {engine} {out[-1]['wall_s']}s", flush=True)
    return out


# ---------------------------------------------------------------- gpu

def _mesh(n: int, dx: float = 30.0) -> dict:
    z = np.zeros((n, n), dtype=np.float32)
    z[:] = np.linspace(40.0, 0.0, n)[:, None] * 0.6
    z[n // 2 - 1 : n // 2 + 2, :] = 62.0
    z[n // 2 :, :] = 58.0
    return {"z": z, "cell_m": dx,
            "breach_cells": (np.array([n // 2]), np.array([n // 2])),
            "stations_km": {}}


_HG = {"time_s": np.array([0.0, 600.0, 3600.0]),
       "q_cms": np.array([0.0, 2500.0, 800.0])}


def gpu() -> dict:
    import torch

    if not torch.cuda.is_available():
        return {"skipped": "cuda unavailable"}
    fast_swe.run(_mesh(64), _HG, duration_s=60.0, frames=4, device="cuda")  # warm
    rows = []
    for n in (128, 256, 512, 1024):
        print(f"[gpu] {n}x{n} ...", flush=True)
        mesh = _mesh(n)
        t0 = time.perf_counter()
        a = fast_swe.run(mesh, _HG, duration_s=600.0, frames=12, device="cpu")
        ta = round(time.perf_counter() - t0, 3)
        fast_swe.run(mesh, _HG, duration_s=60.0, frames=4, device="cuda")  # warm per size
        t0 = time.perf_counter()
        b = fast_swe.run(mesh, _HG, duration_s=600.0, frames=12, device="cuda")
        tb = round(time.perf_counter() - t0, 3)
        wet_a, wet_b = a.max_depth > 0.05, b.max_depth > 0.05
        rows.append({
            "grid": f"{n}x{n}",
            "cells": n * n,
            "cpu_s": ta,
            "cuda_s": tb,
            "speedup": round(ta / tb, 2),
            "parity_maxdiff_m": round(float(np.abs(a.max_depth - b.max_depth).max()), 6),
            "wet_mask_agreement": round(float((wet_a == wet_b).mean()), 6),
            "cpu_steps": a.meta["steps"],
            "cuda_steps": b.meta["steps"],
            "auto_device": "cuda" if fast_swe._resolve_device("auto", mesh) == "cuda" else "cpu",
        })
        print(f"[gpu]   {rows[-1]['speedup']}x", flush=True)
    return {"threshold_cells": fast_swe._AUTO_MIN_CELLS, "rows": rows}


# ---------------------------------------------------------------- gee

def gee() -> dict:
    from modules.gee import client as gee_client, live

    if settings_gee_mode() != "online" or not gee_client.ready():
        return {"skipped": "gee offline"}
    box = db.query_one("SELECT * FROM watch_box ORDER BY created LIMIT 1")
    if not box:
        return {"skipped": "no watch box"}
    live._cache.clear()
    out: dict = {"box_id": str(box["id"])}
    fetchers = [
        ("s2_water_quicklook", lambda: live.s2_water(box)),
        ("s1_water_90d", lambda: live.s1_water(box)),
        ("jrc_permanent", lambda: live.jrc_permanent(box)),
        ("lst_yearly", lambda: live.lst(box)),
        ("glacier_quicklook", lambda: live.glacier(box, quicklook=True)),
    ]
    for name, fn in fetchers:
        print(f"[gee] {name} ...", flush=True)
        try:
            payload = fn()
            out[name] = {
                "elapsed_ms": payload.get("elapsed_ms"),
                "cache_hit": payload.get("cache_hit"),
                "source": payload.get("source", "live"),
            }
        except Exception as exc:  # noqa: BLE001 - benchmark must not die on one fetch
            out[name] = {"error": str(exc)[:200]}
            print(f"[gee]   {name} failed: {exc}", flush=True)
    return out


def settings_gee_mode() -> str:
    from config import settings

    return settings.gee_mode


# ---------------------------------------------------------------- sam

def sam() -> dict:
    path = OUT.parents[1] / "benchmarks" / "sam.json"
    if not path.exists():
        return {"skipped": "run scripts/benchmark_sam.py first"}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "best": data.get("best"),
        "iou_vs_jrc": {m: r.get("iou_jrc") for m, r in data.get("models", {}).items()},
        "warm_s": {m: r.get("warm_s") for m, r in data.get("models", {}).items()},
        "source": "benchmarks/sam.json",
    }


def main() -> None:
    seed.seed()
    db.ensure_pool()
    job_handlers.register_all()
    jobs.start_workers(3)
    try:
        out: dict = {"hardware": hardware()}
        out["engines"] = engines()
        out["gpu"] = gpu()
        out["gee"] = gee()
        out["sam"] = sam()
    finally:
        jobs.stop_workers()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("hardware", "sam")}, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
