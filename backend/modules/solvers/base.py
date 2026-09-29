"""Solver API: one run() for every engine, one FrameSeries canonical output."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

SOLVER_VERSION = "1"


@dataclass
class FrameSeries:
    times_s: np.ndarray          # (n,) frame times
    depth: np.ndarray            # (n, H, W) float16
    max_depth: np.ndarray        # (H, W) float32
    max_vel: np.ndarray          # (H, W) float32
    arrival_s: np.ndarray        # (H, W) float32, NaN where never wet
    stations: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)
    # SPH only: (n, cap, 4) = grid col, grid row, z m, speed m/s; NaN-padded.
    # Saved beside frames.npz (particles.npz), never inside it.
    particles: np.ndarray | None = None

    @property
    def grid(self) -> tuple[int, int]:
        return int(self.max_depth.shape[0]), int(self.max_depth.shape[1])

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            times_s=self.times_s.astype(np.float64),
            depth=self.depth.astype(np.float16),
            max_depth=self.max_depth.astype(np.float32),
            max_vel=self.max_vel.astype(np.float32),
            arrival_s=self.arrival_s.astype(np.float32),
            stations_json=np.array(json.dumps(self.stations)),
            meta_json=np.array(json.dumps(self.meta)),
        )

    @staticmethod
    def load(path: Path) -> "FrameSeries":
        with np.load(path, allow_pickle=False) as d:
            return FrameSeries(
                times_s=d["times_s"],
                depth=d["depth"].astype(np.float32),
                max_depth=d["max_depth"],
                max_vel=d["max_vel"],
                arrival_s=d["arrival_s"],
                stations=json.loads(str(d["stations_json"])),
                meta=json.loads(str(d["meta_json"])),
            )


Progress = Callable[[int, str], None]


def run(engine: str, mesh: dict[str, Any], hydrograph: dict[str, Any], *,
        duration_s: float, frames: int = 96, progress_cb: Progress | None = None,
        params: dict[str, Any] | None = None) -> FrameSeries:
    if engine == "fast":
        from modules.solvers import fast_swe

        return fast_swe.run(mesh, hydrograph, duration_s=duration_s, frames=frames,
                            progress_cb=progress_cb, device="auto", **(params or {}))
    if engine == "sph":
        from modules.solvers import sph

        # Whole valley, particle spacing ≥ half a DEM cell: a 3 h gorge flood
        # runs in minutes on CPU instead of hours at quarter-cell spacing.
        return sph.run(mesh, hydrograph, duration_s=duration_s, frames=frames,
                       progress_cb=progress_cb, window_m=None, l0_scale=0.5,
                       max_steps=None, **(params or {}))
    if engine == "delft3d":
        from modules.solvers import delft3d_fm

        return delft3d_fm.run(mesh, hydrograph, duration_s=duration_s, frames=frames,
                              progress_cb=progress_cb, params=params)
    raise ValueError(f"unknown engine {engine!r}")
