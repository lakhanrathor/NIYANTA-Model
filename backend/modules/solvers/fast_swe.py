"""fast_swe — structured-grid 2D shallow water (local-inertial / LISFLOOD scheme).

Bates, Horritt & Fewtrell (2010) momentum solver on a Cartesian grid:
  u^{t+1} = (u^t - g·dH/dx·dt) / (1 + g·n²·|u^t|·dt/h_face)
Face depth from the higher-surface side (upwind), wet/dry limiter at h<1e-4,
outflow-only transmissive boundaries, breach Q_b(t) injected as volume source
over breach cells.

Mass safety: every step each cell's total export is scaled down to its current
content (donor-volume limiting) — water can never be created or over-drained,
so the only clamp residue is float noise. CFL-limited adaptive dt with a 1 m
depth floor for early dry states; downsampled frames output.

device: "auto" (default) picks torch/cuda for grids >= _AUTO_MIN_CELLS cells
and the NumPy loop otherwise; "cpu"/"numpy" force NumPy, "cuda" forces the
torch loop (raises when CUDA is missing). The two loops are exact mirrors —
`tests/test_solvers_gpu.py` asserts field-level parity between them.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np

from modules.solvers.base import FrameSeries

G = 9.80665
H_MIN = 1e-4
_AUTO_MIN_CELLS = 10_000


def run(mesh: dict[str, Any], hydrograph: dict[str, Any], *, duration_s: float,
        frames: int = 96, n_manning: float = 0.03, cfl: float = 0.45,
        max_steps: int = 200_000, progress_cb: Callable[[int, str], None] | None = None,
        arrival_threshold_m: float = 0.05, device: str = "auto") -> FrameSeries:
    dev = _resolve_device(device, mesh)
    args = dict(duration_s=duration_s, frames=frames, n_manning=n_manning, cfl=cfl,
                max_steps=max_steps, progress_cb=progress_cb,
                arrival_threshold_m=arrival_threshold_m)
    if dev == "cuda":
        return _run_torch(mesh, hydrograph, device=dev, **args)
    return _run_numpy(mesh, hydrograph, **args)


def _resolve_device(device: str, mesh: dict[str, Any]) -> str:
    want = device or "auto"
    if want == "numpy":
        return "cpu"
    if want not in ("auto", "cpu", "cuda"):
        raise ValueError(f"unknown device {device!r}")
    if want == "cpu":
        return "cpu"
    try:
        import torch
    except ImportError:
        if want == "cuda":
            raise ValueError("device='cuda' requested but torch is not installed") from None
        return "cpu"  # auto without torch → the NumPy solver

    if want == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("device='cuda' requested but CUDA is unavailable")
        return "cuda"
    cells = int(np.prod(mesh["z"].shape))
    return "cuda" if cells >= _AUTO_MIN_CELLS and torch.cuda.is_available() else "cpu"


def _run_numpy(mesh: dict[str, Any], hydrograph: dict[str, Any], *, duration_s: float,
               frames: int = 96, n_manning: float = 0.03, cfl: float = 0.45,
               max_steps: int = 200_000, progress_cb: Callable[[int, str], None] | None = None,
               arrival_threshold_m: float = 0.05) -> FrameSeries:
    z = mesh["z"].astype(np.float32)
    dx = float(mesh["cell_m"])
    h_rows, w_cols = z.shape
    if h_rows < 4 or w_cols < 4:
        raise ValueError("grid too small for solver")
    bc_r = np.asarray(mesh["breach_cells"][0], dtype=np.int64)
    bc_c = np.asarray(mesh["breach_cells"][1], dtype=np.int64)

    hq_t = np.asarray(hydrograph["time_s"], dtype=np.float64)
    hq_q = np.asarray(hydrograph["q_cms"], dtype=np.float64)

    n_frames = max(int(frames), 1)
    record_step = duration_s / n_frames
    record_times = [record_step * (i + 1) for i in range(n_frames)]
    if record_times[-1] < duration_s - 1e-9:
        record_times.append(duration_s)

    h = np.zeros((h_rows, w_cols), dtype=np.float32)
    qx = np.zeros((h_rows, w_cols + 1), dtype=np.float32)
    qy = np.zeros((h_rows + 1, w_cols), dtype=np.float32)

    max_depth = np.zeros((h_rows, w_cols), dtype=np.float32)
    max_vel = np.zeros((h_rows, w_cols), dtype=np.float32)
    arrival = np.full((h_rows, w_cols), np.nan, dtype=np.float32)

    z_cols_l, z_cols_r = z[:, :-1], z[:, 1:]
    z_rows_b, z_rows_t = z[:-1, :], z[1:, :]

    station_keys = sorted(mesh.get("stations_km", {}).keys(), key=float)
    stations: dict[str, Any] = {
        str(km): {"times_s": [], "depth_m": [], "q_cms": []} for km in station_keys
    }
    st_cells = {str(km): mesh["stations_km"][km] for km in station_keys}

    injected = 0.0
    exited = 0.0
    t = 0.0
    steps = 0
    rec_i = 0
    frame_list: list[np.ndarray] = []

    def record(state_t: float) -> None:
        nonlocal rec_i
        np.maximum(max_depth, h, out=max_depth)
        wet = h > arrival_threshold_m
        arrival[wet & np.isnan(arrival)] = state_t
        uc = 0.5 * (qx[:, :-1] + qx[:, 1:]) / np.maximum(h, H_MIN)
        vc = 0.5 * (qy[:-1, :] + qy[1:, :]) / np.maximum(h, H_MIN)
        speed = np.minimum(np.sqrt(uc * uc + vc * vc), 30.0)  # dry-front spikes capped
        np.maximum(max_vel, np.where(h > 0.1, speed, 0.0), out=max_vel)
        for km, (r, c) in st_cells.items():
            key = str(km)
            rr = slice(max(r - 3, 0), min(r + 4, h_rows))
            cc = slice(max(c - 3, 0), min(c + 4, w_cols))
            wet_count = int(np.count_nonzero(h[rr, cc] > arrival_threshold_m))
            wet_width = max(wet_count * dx / 7.0, dx)
            # cross-section discharge: y-faces along station row over ±10 cols
            fc = slice(max(c - 10, 0), min(c + 11, w_cols))
            q_station = float(np.abs(qy[r + 1, fc]).sum()) * dx
            stations[key]["times_s"].append(round(state_t, 2))
            stations[key]["depth_m"].append(round(float(h[r, c]), 3))
            stations[key]["q_cms"].append(round(q_station, 1))
            stations[key]["wet_width_m"] = round(wet_width, 1)
        frame_list.append(h.astype(np.float16, copy=True))
        rec_i += 1

    while t < duration_s and steps < max_steps:
        hmax = float(h.max())
        umax = max(float(np.abs(qx).max()), float(np.abs(qy).max())) / max(hmax, H_MIN)
        dt = cfl * dx / (float(np.sqrt(G * max(hmax, 1.0))) + umax)
        dt = min(float(dt), duration_s - t)
        if rec_i < len(record_times):
            dt = min(dt, max(record_times[rec_i] - t, 1e-6))
        if dt <= 1e-6:
            if rec_i < len(record_times) and t >= record_times[rec_i] - 1e-9:
                record(record_times[rec_i])
                continue
            break

        q_in = float(np.interp(t, hq_t, hq_q))
        injected += q_in * dt

        surf = z + h

        # ---- x interior faces
        HL, HR = surf[:, :-1], surf[:, 1:]
        hfx = np.where(HL >= HR, np.maximum(HL - z_cols_r, 0.0), np.maximum(HR - z_cols_l, 0.0))
        u_old = np.where(hfx > H_MIN, qx[:, 1:-1] / np.maximum(hfx, H_MIN), 0.0)
        ux = (u_old - G * (HR - HL) / dx * dt) / (
            1.0 + G * n_manning * n_manning * np.abs(u_old) * dt / np.maximum(hfx, H_MIN)
        )
        ux = np.where(hfx > H_MIN, ux, 0.0)
        qx_int = ux * hfx

        # ---- y interior faces
        HB, HT = surf[:-1, :], surf[1:, :]
        hfy = np.where(HB >= HT, np.maximum(HB - z_rows_t, 0.0), np.maximum(HT - z_rows_b, 0.0))
        v_old = np.where(hfy > H_MIN, qy[1:-1, :] / np.maximum(hfy, H_MIN), 0.0)
        uy = (v_old - G * (HT - HB) / dx * dt) / (
            1.0 + G * n_manning * n_manning * np.abs(v_old) * dt / np.maximum(hfy, H_MIN)
        )
        uy = np.where(hfy > H_MIN, uy, 0.0)
        qy_int = uy * hfy

        # ---- outflow-only boundary faces (velocity donor = adjacent cell)
        u0 = np.where(h[:, 0] > H_MIN, ux[:, 0], 0.0)
        left_q = np.minimum(u0, 0.0) * h[:, 0]
        u1 = np.where(h[:, -1] > H_MIN, ux[:, -1], 0.0)
        right_q = np.maximum(u1, 0.0) * h[:, -1]
        v0 = np.where(h[0, :] > H_MIN, uy[0, :], 0.0)
        bottom_q = np.minimum(v0, 0.0) * h[0, :]
        v1 = np.where(h[-1, :] > H_MIN, uy[-1, :], 0.0)
        top_q = np.maximum(v1, 0.0) * h[-1, :]

        # ---- donor-volume limiting: scale exports to current cell content
        out_v = np.zeros_like(h)
        pos_x = np.maximum(qx_int, 0.0) * dx * dt
        neg_x = np.maximum(-qx_int, 0.0) * dx * dt
        out_v[:, :-1] += pos_x
        out_v[:, 1:] += neg_x
        pos_y = np.maximum(qy_int, 0.0) * dx * dt
        neg_y = np.maximum(-qy_int, 0.0) * dx * dt
        out_v[:-1, :] += pos_y
        out_v[1:, :] += neg_y
        out_v[:, 0] += np.maximum(-left_q, 0.0) * dx * dt
        out_v[:, -1] += np.maximum(right_q, 0.0) * dx * dt
        out_v[0, :] += np.maximum(-bottom_q, 0.0) * dx * dt
        out_v[-1, :] += np.maximum(top_q, 0.0) * dx * dt

        scale = np.ones_like(h)
        available = h * dx * dx
        viol = out_v > available
        np.divide(available, np.maximum(out_v, 1e-30), out=scale, where=viol)

        qx_int = np.where(qx_int > 0, qx_int * scale[:, :-1], qx_int * scale[:, 1:])
        qy_int = np.where(qy_int > 0, qy_int * scale[:-1, :], qy_int * scale[1:, :])
        left_q = left_q * scale[:, 0]
        right_q = right_q * scale[:, -1]
        bottom_q = bottom_q * scale[0, :]
        top_q = top_q * scale[-1, :]

        out_rate = float(
            np.maximum(-left_q, 0.0).sum() + np.maximum(right_q, 0.0).sum()
            + np.maximum(-bottom_q, 0.0).sum() + np.maximum(top_q, 0.0).sum()
        )
        exited += out_rate * dx * dt

        # ---- assemble full faces + continuity
        qx[:, 0] = left_q
        qx[:, 1:-1] = qx_int
        qx[:, -1] = right_q
        qy[0, :] = bottom_q
        qy[1:-1, :] = qy_int
        qy[-1, :] = top_q
        div_x = (qx[:, 1:] - qx[:, :-1]) / dx
        div_y = (qy[1:, :] - qy[:-1, :]) / dx
        h = h - (div_x + div_y) * dt

        # ---- breach source
        if q_in > 0 and bc_r.size:
            dh_cell = np.float32((q_in * dt) / (dx * dx * bc_r.size))
            np.add.at(h, (bc_r, bc_c), dh_cell)

        np.maximum(h, 0.0, out=h)
        t += dt
        steps += 1

        while rec_i < len(record_times) and t >= record_times[rec_i] - 1e-9:
            record(record_times[rec_i])
            if progress_cb and rec_i % 16 == 0:
                progress_cb(min(99, int(t / duration_s * 100)), f"solving t={t/3600:.2f}h")

    if rec_i < len(record_times):
        record(t)

    stored = float(h.sum()) * dx * dx
    mb_err = abs(injected - exited - stored) / injected * 100.0 if injected > 0 else 0.0

    if progress_cb:
        progress_cb(100, f"solved {steps} steps")

    return FrameSeries(
        times_s=np.asarray(record_times[:rec_i], dtype=np.float64),
        depth=np.stack(frame_list[:rec_i]) if frame_list else np.zeros((0, h_rows, w_cols), np.float16),
        max_depth=max_depth,
        max_vel=max_vel,
        arrival_s=arrival,
        stations=stations,
        meta={
            "engine": "fast",
            "device": "cpu",
            "cell_m": dx,
            "steps": steps,
            "injected_hm3": injected / 1e6,
            "exited_hm3": exited / 1e6,
            "stored_hm3": stored / 1e6,
            "mass_balance_error_pct": mb_err,
            "truncated": steps >= max_steps,
        },
    )


def _run_torch(mesh: dict[str, Any], hydrograph: dict[str, Any], *, device: str,
               duration_s: float, frames: int = 96, n_manning: float = 0.03,
               cfl: float = 0.45, max_steps: int = 200_000,
               progress_cb: Callable[[int, str], None] | None = None,
               arrival_threshold_m: float = 0.05) -> FrameSeries:
    import torch

    dev = torch.device(device)

    def f32(a: Any) -> torch.Tensor:
        return torch.as_tensor(a, dtype=torch.float32, device=dev)

    z = f32(mesh["z"])
    dx = float(mesh["cell_m"])
    h_rows, w_cols = z.shape
    if h_rows < 4 or w_cols < 4:
        raise ValueError("grid too small for solver")
    bc_r = torch.as_tensor(np.asarray(mesh["breach_cells"][0]), dtype=torch.int64, device=dev)
    bc_c = torch.as_tensor(np.asarray(mesh["breach_cells"][1]), dtype=torch.int64, device=dev)
    n_breach = int(bc_r.numel())

    hq_t = np.asarray(hydrograph["time_s"], dtype=np.float64)
    hq_q = np.asarray(hydrograph["q_cms"], dtype=np.float64)

    n_frames = max(int(frames), 1)
    record_step = duration_s / n_frames
    record_times = [record_step * (i + 1) for i in range(n_frames)]
    if record_times[-1] < duration_s - 1e-9:
        record_times.append(duration_s)

    h = torch.zeros((h_rows, w_cols), dtype=torch.float32, device=dev)
    qx = torch.zeros((h_rows, w_cols + 1), dtype=torch.float32, device=dev)
    qy = torch.zeros((h_rows + 1, w_cols), dtype=torch.float32, device=dev)

    max_depth = torch.zeros_like(h)
    max_vel = torch.zeros_like(h)
    arrival = torch.full((h_rows, w_cols), float("nan"), dtype=torch.float32, device=dev)

    z_cols_l, z_cols_r = z[:, :-1], z[:, 1:]
    z_rows_b, z_rows_t = z[:-1, :], z[1:, :]

    station_keys = sorted(mesh.get("stations_km", {}).keys(), key=float)
    stations: dict[str, Any] = {
        str(km): {"times_s": [], "depth_m": [], "q_cms": []} for km in station_keys
    }
    st_cells = {str(km): mesh["stations_km"][km] for km in station_keys}

    injected = 0.0
    exited = 0.0
    t = 0.0
    steps = 0
    rec_i = 0
    frame_list: list[np.ndarray] = []

    def record(state_t: float) -> None:
        nonlocal rec_i, max_depth, max_vel
        max_depth = torch.maximum(max_depth, h)
        wet = h > arrival_threshold_m
        arrival[wet & torch.isnan(arrival)] = state_t
        uc = 0.5 * (qx[:, :-1] + qx[:, 1:]) / h.clamp_min(H_MIN)
        vc = 0.5 * (qy[:-1, :] + qy[1:, :]) / h.clamp_min(H_MIN)
        speed = torch.sqrt(uc * uc + vc * vc).clamp_max(30.0)
        max_vel = torch.maximum(max_vel, torch.where(h > 0.1, speed, torch.zeros_like(h)))
        for km, (r, c) in st_cells.items():
            key = str(km)
            rr = slice(max(r - 3, 0), min(r + 4, h_rows))
            cc = slice(max(c - 3, 0), min(c + 4, w_cols))
            wet_count = int((h[rr, cc] > arrival_threshold_m).sum())
            wet_width = max(wet_count * dx / 7.0, dx)
            # cross-section discharge: y-faces along station row over ±10 cols
            fc = slice(max(c - 10, 0), min(c + 11, w_cols))
            q_station = float(qy[r + 1, fc].abs().sum()) * dx
            stations[key]["times_s"].append(round(state_t, 2))
            stations[key]["depth_m"].append(round(float(h[r, c]), 3))
            stations[key]["q_cms"].append(round(q_station, 1))
            stations[key]["wet_width_m"] = round(wet_width, 1)
        frame_list.append(h.to(torch.float16).cpu().numpy())
        rec_i += 1

    while t < duration_s and steps < max_steps:
        hmax, qx_a, qy_a = torch.stack(
            (h.max(), qx.abs().max(), qy.abs().max())
        ).cpu().tolist()
        umax = max(qx_a, qy_a) / max(hmax, H_MIN)
        dt = cfl * dx / (float(np.sqrt(G * max(hmax, 1.0))) + umax)
        dt = min(float(dt), duration_s - t)
        if rec_i < len(record_times):
            dt = min(dt, max(record_times[rec_i] - t, 1e-6))
        if dt <= 1e-6:
            if rec_i < len(record_times) and t >= record_times[rec_i] - 1e-9:
                record(record_times[rec_i])
                continue
            break

        q_in = float(np.interp(t, hq_t, hq_q))
        injected += q_in * dt

        surf = z + h

        # ---- x interior faces
        HL, HR = surf[:, :-1], surf[:, 1:]
        hfx = torch.where(HL >= HR, (HL - z_cols_r).clamp_min(0.0), (HR - z_cols_l).clamp_min(0.0))
        u_old = torch.where(hfx > H_MIN, qx[:, 1:-1] / hfx.clamp_min(H_MIN), torch.zeros_like(hfx))
        ux = (u_old - G * (HR - HL) / dx * dt) / (
            1.0 + G * n_manning * n_manning * u_old.abs() * dt / hfx.clamp_min(H_MIN)
        )
        ux = torch.where(hfx > H_MIN, ux, torch.zeros_like(ux))
        qx_int = ux * hfx

        # ---- y interior faces
        HB, HT = surf[:-1, :], surf[1:, :]
        hfy = torch.where(HB >= HT, (HB - z_rows_t).clamp_min(0.0), (HT - z_rows_b).clamp_min(0.0))
        v_old = torch.where(hfy > H_MIN, qy[1:-1, :] / hfy.clamp_min(H_MIN), torch.zeros_like(hfy))
        uy = (v_old - G * (HT - HB) / dx * dt) / (
            1.0 + G * n_manning * n_manning * v_old.abs() * dt / hfy.clamp_min(H_MIN)
        )
        uy = torch.where(hfy > H_MIN, uy, torch.zeros_like(uy))
        qy_int = uy * hfy

        # ---- outflow-only boundary faces (velocity donor = adjacent cell)
        # left/bottom: np.minimum(u, 0) ≡ clamp_max(0) — NEGATIVE flux = outflow.
        # (an extra .neg() flipped the sign → boundary injected mass instead of
        # draining it; downstream out_v/exited accounting assumes the negative sign.)
        u0 = torch.where(h[:, 0] > H_MIN, ux[:, 0], torch.zeros_like(ux[:, 0]))
        left_q = u0.clamp_max(0.0) * h[:, 0]
        u1 = torch.where(h[:, -1] > H_MIN, ux[:, -1], torch.zeros_like(ux[:, -1]))
        right_q = u1.clamp_min(0.0) * h[:, -1]
        v0 = torch.where(h[0, :] > H_MIN, uy[0, :], torch.zeros_like(uy[0, :]))
        bottom_q = v0.clamp_max(0.0) * h[0, :]
        v1 = torch.where(h[-1, :] > H_MIN, uy[-1, :], torch.zeros_like(uy[-1, :]))
        top_q = v1.clamp_min(0.0) * h[-1, :]

        # ---- donor-volume limiting: scale exports to current cell content
        out_v = torch.zeros_like(h)
        pos_x = qx_int.clamp_min(0.0) * dx * dt
        neg_x = qx_int.clamp_max(0.0).neg() * dx * dt
        out_v[:, :-1] += pos_x
        out_v[:, 1:] += neg_x
        pos_y = qy_int.clamp_min(0.0) * dx * dt
        neg_y = qy_int.clamp_max(0.0).neg() * dx * dt
        out_v[:-1, :] += pos_y
        out_v[1:, :] += neg_y
        out_v[:, 0] += left_q.clamp_max(0.0).neg() * dx * dt
        out_v[:, -1] += right_q.clamp_min(0.0) * dx * dt
        out_v[0, :] += bottom_q.clamp_max(0.0).neg() * dx * dt
        out_v[-1, :] += top_q.clamp_min(0.0) * dx * dt

        available = h * dx * dx
        scale = torch.where(out_v > available, available / out_v.clamp_min(1e-30),
                            torch.ones_like(h))

        qx_int = torch.where(qx_int > 0, qx_int * scale[:, :-1], qx_int * scale[:, 1:])
        qy_int = torch.where(qy_int > 0, qy_int * scale[:-1, :], qy_int * scale[1:, :])
        left_q = left_q * scale[:, 0]
        right_q = right_q * scale[:, -1]
        bottom_q = bottom_q * scale[0, :]
        top_q = top_q * scale[-1, :]

        out_rate = float(
            left_q.clamp_max(0.0).neg().sum() + right_q.clamp_min(0.0).sum()
            + bottom_q.clamp_max(0.0).neg().sum() + top_q.clamp_min(0.0).sum()
        )
        exited += out_rate * dx * dt

        # ---- assemble full faces + continuity
        qx[:, 0] = left_q
        qx[:, 1:-1] = qx_int
        qx[:, -1] = right_q
        qy[0, :] = bottom_q
        qy[1:-1, :] = qy_int
        qy[-1, :] = top_q
        div_x = (qx[:, 1:] - qx[:, :-1]) / dx
        div_y = (qy[1:, :] - qy[:-1, :]) / dx
        h = h - (div_x + div_y) * dt

        # ---- breach source
        if q_in > 0 and n_breach > 0:
            dh_cell = (q_in * dt) / (dx * dx * n_breach)
            h.index_put_((bc_r, bc_c),
                         torch.full((n_breach,), dh_cell, dtype=torch.float32, device=dev),
                         accumulate=True)

        h.clamp_min_(0.0)
        t += dt
        steps += 1

        while rec_i < len(record_times) and t >= record_times[rec_i] - 1e-9:
            record(record_times[rec_i])
            if progress_cb and rec_i % 16 == 0:
                progress_cb(min(99, int(t / duration_s * 100)), f"solving t={t/3600:.2f}h")

    if rec_i < len(record_times):
        record(t)

    stored = float(h.sum()) * dx * dx
    mb_err = abs(injected - exited - stored) / injected * 100.0 if injected > 0 else 0.0

    if progress_cb:
        progress_cb(100, f"solved {steps} steps")

    return FrameSeries(
        times_s=np.asarray(record_times[:rec_i], dtype=np.float64),
        depth=np.stack(frame_list[:rec_i]) if frame_list else np.zeros((0, h_rows, w_cols), np.float16),
        max_depth=max_depth.cpu().numpy(),
        max_vel=max_vel.cpu().numpy(),
        arrival_s=arrival.cpu().numpy(),
        stations=stations,
        meta={
            "engine": "fast",
            "device": "cuda",
            "cell_m": dx,
            "steps": steps,
            "injected_hm3": injected / 1e6,
            "exited_hm3": exited / 1e6,
            "stored_hm3": stored / 1e6,
            "mass_balance_error_pct": mb_err,
            "truncated": steps >= max_steps,
        },
    )
