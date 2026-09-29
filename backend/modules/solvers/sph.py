"""sph — near-field WCSPH breach detail engine (MODULE_SPEC 4.15.2).

WCSPH with Tait EOS (P = B((ρ/ρ0)^7 − 1), P clamped ≥ 0), Monaghan artificial
viscosity, Poly6/Spiky/Visc kernels, cell-hash neighbor search (CSR-style,
27-cell stencil, vectorized), terrain as a bilinear heightfield collision
surface. Particles spawn from the routed breach hydrograph Q(t) at the breach
cells (same source term as fast_swe), live in a near-field window around the
dam (default 1.5 km half-width), and are deposited onto the DEM grid per
recorded frame in the canonical FrameSeries format — the cross-engine contract.

Bed friction (Manning C_d|v|v using per-particle column depth) + gravity
collapse develop a quasi-hydrostatic state; CPU runtime stays seconds-scale
for typical breach volumes at particle spacing = one DEM cell.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np

from modules.solvers.base import FrameSeries

RHO0 = 998.0
G = 9.80665


SNAPSHOT_CAP = 6000   # particles kept per recorded frame for the 3D player


def run(mesh: dict[str, Any], hydrograph: dict[str, Any], *, duration_s: float,
        frames: int = 96, n_manning: float = 0.03, l0_scale: float = 0.25,
        window_m: float | None = 1500.0, max_particles: int = 20000,
        max_steps: int | None = 90_000, artificial_alpha: float = 0.12,
        progress_cb: Callable[[int, str], None] | None = None,
        arrival_threshold_m: float = 0.05) -> FrameSeries:
    """`window_m=None` → the whole model grid; `max_steps=None` → sized to
    the horizon. Particle spacing grows past `dx*l0_scale` when the released
    volume would not fit `max_particles` — spawning must never drop water."""
    rng = np.random.default_rng(42)
    z = mesh["z"].astype(np.float64)
    dx = float(mesh["cell_m"])
    h_rows, w_cols = z.shape
    bc_r = np.asarray(mesh["breach_cells"][0], dtype=np.int64)
    bc_c = np.asarray(mesh["breach_cells"][1], dtype=np.int64)
    if bc_r.size == 0:
        raise ValueError("sph: no breach cells")

    hq_t = np.asarray(hydrograph["time_s"], dtype=np.float64)
    hq_q = np.asarray(hydrograph["q_cms"], dtype=np.float64)
    in_horizon = hq_t <= duration_s
    released_m3 = float(np.trapezoid(hq_q[in_horizon], hq_t[in_horizon])) if in_horizon.sum() > 1 else 0.0

    # particle spacing (m): 80% of the budget holds the whole release
    l0 = max(dx * l0_scale, 1.0, (released_m3 / (0.8 * max_particles)) ** (1.0 / 3.0))
    v_p = l0**3                                  # particle volume (m3)
    h_cut = 1.2 * l0                             # kernel support radius
    h_cut2 = h_cut * h_cut
    poly6 = 315.0 / (64.0 * np.pi * h_cut**9)    # 3D Poly6 kernel constant
    spiky_grad = 45.0 / (np.pi * h_cut**6)       # 3D Spiky gradient constant
    # Tait bulk speed from characteristic flood depth (5 m), not spacing:
    # spacing-driven c0 would make dt uselessly small on 100 m DEM cells.
    c0 = max(10.0 * np.sqrt(G * 5.0), 20.0)
    B = RHO0 * c0**2 / 7.0
    m_p = RHO0 * v_p

    if max_steps is None:
        # dt ≥ 0.4·l0/(c0 + 25 m/s velocity cap); 30% headroom for record-time clamps
        max_steps = int(duration_s / (0.4 * l0 / (c0 + 25.0)) * 1.3) + 1000

    breach_x = float(np.mean(bc_c)) * dx
    breach_y = float(np.mean(bc_r)) * dx
    if window_m is None:
        # whole grid: particles leave only through the model boundary
        x_min, x_max = 0.0, (w_cols - 1) * dx
        y_min, y_max = 0.0, (h_rows - 1) * dx
    else:
        x_min, x_max = breach_x - window_m, breach_x + window_m
        y_min, y_max = breach_y - window_m, breach_y + window_m
    spawn_z = float(z[bc_r, bc_c].min()) + l0 * 1.5
    # terrain slope (dz/dx, dz/dy per metre) for contact normals
    dz_dy, dz_dx = np.gradient(z, dx)

    def _bilinear(a: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        c = np.clip(x / dx, 0, w_cols - 1.001)
        r = np.clip(y / dx, 0, h_rows - 1.001)
        r0, c0i = np.floor(r).astype(np.int64), np.floor(c).astype(np.int64)
        fr, fc = r - r0, c - c0i
        return ((1 - fr) * ((1 - fc) * a[r0, c0i] + fc * a[r0, c0i + 1])
                + fr * ((1 - fc) * a[r0 + 1, c0i] + fc * a[r0 + 1, c0i + 1]))

    def terrain(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        return _bilinear(z, x, y)

    # Launch down the real terrain slope at the breach (steepest descent over a
    # few cells around it), not along a grid axis — valleys run any direction.
    br0, bc0 = int(round(bc_r.mean())), int(round(bc_c.mean()))
    win = (slice(max(br0 - 3, 0), br0 + 4), slice(max(bc0 - 3, 0), bc0 + 4))
    down = -np.array([float(dz_dx[win].mean()), float(dz_dy[win].mean())])
    down = down / np.linalg.norm(down) if np.linalg.norm(down) > 1e-6 else np.zeros(2)

    n_frames = max(int(frames), 1)
    record_step = duration_s / n_frames
    record_times = [record_step * (i + 1) for i in range(n_frames)]
    if record_times[-1] < duration_s - 1e-9:
        record_times.append(duration_s)

    px = np.zeros(max_particles)
    py = np.zeros(max_particles)
    pz = np.zeros(max_particles)
    vx = np.zeros(max_particles)
    vy = np.zeros(max_particles)
    vz = np.zeros(max_particles)
    alive = np.zeros(max_particles, dtype=bool)
    n_alloc = 0
    spawned = 0

    injected = 0.0
    exited = 0.0
    spawn_accum = 0.0

    max_depth = np.zeros((h_rows, w_cols), dtype=np.float32)
    max_vel = np.zeros((h_rows, w_cols), dtype=np.float32)
    arrival = np.full((h_rows, w_cols), np.nan, dtype=np.float32)
    station_keys = sorted(mesh.get("stations_km", {}).keys(), key=float)
    stations: dict[str, Any] = {
        str(km): {"times_s": [], "depth_m": [], "q_cms": []} for km in station_keys
    }
    st_cells = {str(km): mesh["stations_km"][km] for km in station_keys}

    def spawn(count: int, q_now: float) -> None:
        nonlocal n_alloc, spawned
        free = np.flatnonzero(~alive)
        take = min(int(count), free.size)
        if take <= 0:
            return
        slots = free[:take]
        for i in slots:
            i = int(i)
            slot = int(bc_r[spawned % bc_r.size]), int(bc_c[spawned % bc_c.size])
            px[i] = slot[1] * dx + (rng.random() - 0.5) * l0
            py[i] = slot[0] * dx + (rng.random() - 0.5) * l0
            tb = terrain(np.array([px[i]]), np.array([py[i]]))[0]
            pz[i] = max(spawn_z, tb + l0 * (1.0 + rng.random()))
            speed0 = min(max(q_now / 50.0, 1.0), 6.0)
            vx[i] = down[0] * speed0 + (rng.random() - 0.5) * 0.5
            vy[i] = down[1] * speed0 + (rng.random() - 0.5) * 0.5
            vz[i] = 0.0
            alive[i] = True
            spawned += 1
        n_alloc = max(n_alloc, int(spawned))

    def neighbor_pairs(idx: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """CSR-style pairs (i, j) with r < h_cut; each particle is receiver i."""
        n = idx.size
        if n < 2:
            return (np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0))
        kx = np.floor(px[idx] / h_cut).astype(np.int64)
        ky = np.floor(py[idx] / h_cut).astype(np.int64)
        kz = np.floor(pz[idx] / (2 * l0)).astype(np.int64)
        keys = (kx * 73856093) ^ (ky * 19349663) ^ (kz * 83492791)
        order = np.argsort(keys, kind="stable")
        keys_sorted = keys[order]
        ukeys, starts, counts = np.unique(keys_sorted, return_index=True,
                                          return_counts=True)
        ii_parts: list[np.ndarray] = []
        jj_parts: list[np.ndarray] = []
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for oz in (-1, 0, 1):
                    nk = ((kx + ox) * 73856093) ^ ((ky + oy) * 19349663) \
                        ^ ((kz + oz) * 83492791)
                    pos = np.searchsorted(ukeys, nk)
                    safe = np.minimum(pos, ukeys.size - 1)
                    ok = (pos < ukeys.size) & (ukeys[safe] == nk)
                    if not np.any(ok):
                        continue
                    sel = np.flatnonzero(ok)
                    cs = counts[safe[sel]]
                    st = starts[safe[sel]]
                    ii = np.repeat(sel, cs)
                    total = int(cs.sum())
                    jj = np.repeat(st, cs) + (
                        np.arange(total) - np.repeat(np.cumsum(cs) - cs, cs))
                    # sel is in original local index space; jj positions are in
                    # sorted space → map through order
                    ii_parts.append(ii)
                    jj_parts.append(order[jj])
        if not ii_parts:
            return (np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0))
        i = np.concatenate(ii_parts)
        j = np.concatenate(jj_parts)
        keep = i != j
        i, j = i[keep], j[keep]
        rij = np.stack([px[idx[i]] - px[idx[j]], py[idx[i]] - py[idx[j]],
                        pz[idx[i]] - pz[idx[j]]], axis=-1)
        r2 = np.einsum("ij,ij->i", rij, rij)
        close = r2 < h_cut2
        i, j, rij, r2 = i[close], j[close], rij[close], r2[close]
        return i, j, rij

    def step(dt: float, t: float) -> None:
        nonlocal injected, exited, spawn_accum
        q_now = float(np.interp(t, hq_t, hq_q))
        injected += q_now * dt
        spawn_accum += q_now * dt
        if spawn_accum >= v_p:
            count = int(spawn_accum / v_p)
            spawn_accum -= count * v_p
            spawn(count, q_now)

        idx = np.flatnonzero(alive)
        if idx.size == 0:
            return
        i, j, rij = neighbor_pairs(idx)

        # Poly6 density: self term + neighbors
        rho = np.full(idx.size, m_p * poly6 * h_cut**6)
        if i.size:
            r2 = np.einsum("ij,ij->i", rij, rij)
            w = poly6 * np.maximum(h_cut2 - r2, 0.0) ** 3
            rho += np.bincount(i, weights=m_p * w, minlength=idx.size)
        np.maximum(rho, RHO0 * 0.4, out=rho)

        # Tait EOS, no tension
        p = B * ((rho / RHO0) ** 7 - 1.0)
        np.maximum(p, 0.0, out=p)

        ax = np.zeros(idx.size)
        ay = np.zeros(idx.size)
        az = np.full(idx.size, -G)
        if i.size:
            r2 = np.einsum("ij,ij->i", rij, rij)
            r = np.sqrt(np.maximum(r2, 1e-12))
            # Spiky pressure gradient: dv_i = -Σ m_j (p/ρ²)∇W, ∇W = -k(h-r)² r̂
            # → force along +rij (repulsive); both pair orders present
            coef = m_p * spiky_grad * (h_cut - r) ** 2 / r
            grad = (coef * (p[i] / rho[i] ** 2 + p[j] / rho[j] ** 2))[:, None] * rij
            np.add.at(ax, i, grad[:, 0])
            np.add.at(ay, i, grad[:, 1])
            np.add.at(az, i, grad[:, 2])
            # Monaghan artificial viscosity (approaching pairs only)
            vij = np.stack([vx[idx[i]] - vx[idx[j]], vy[idx[i]] - vy[idx[j]],
                            vz[idx[i]] - vz[idx[j]]], axis=-1)
            denom = r2 + (0.1 * h_cut) ** 2
            mu = h_cut * np.einsum("ij,ij->i", vij, rij) / denom
            mu = np.minimum(mu, 0.0)
            visc = artificial_alpha * c0 * mu / rho[i]
            np.add.at(ax, i, visc * vij[:, 0])
            np.add.at(ay, i, visc * vij[:, 1])
            np.add.at(az, i, visc * vij[:, 2])

        depth_col = np.maximum(pz[idx] - terrain(px[idx], py[idx]), 1e-3)
        speed = np.hypot(vx[idx], vy[idx])
        c_d = G * n_manning**2 * speed / np.maximum(depth_col ** (4.0 / 3.0), 1e-3)
        vx[idx] += (ax - c_d * speed * vx[idx]) * dt
        vy[idx] += (ay - c_d * speed * vy[idx]) * dt
        vz[idx] += az * dt
        # hard velocity cap: keeps dt meaningful and tames spawn-overlap spikes
        # (fancy-index results are copies → always write back)
        sp = np.hypot(vx[idx], vy[idx])
        over = sp > 25.0
        if np.any(over):
            scale = np.ones_like(sp)
            scale[over] = 25.0 / sp[over]
            vx[idx] = vx[idx] * scale
            vy[idx] = vy[idx] * scale
        vz[idx] = np.clip(vz[idx], -25.0, 25.0)
        px[idx] += vx[idx] * dt
        py[idx] += vy[idx] * dt
        pz[idx] += vz[idx] * dt

        # particle = water cube of side l0: top sits ≥ l0 above its bed contact.
        # On contact, remove the velocity component INTO the terrain along its
        # true normal (+15% restitution). Clamping z alone let particles walk up
        # valley walls for free and never slide off a slope; with the normal
        # projection, gravity resolves into down-slope flow on its own.
        tb = terrain(px[idx], py[idx]) + l0
        below = pz[idx] <= tb
        if np.any(below):
            b = idx[below]
            gx = _bilinear(dz_dx, px[b], py[b])
            gy = _bilinear(dz_dy, px[b], py[b])
            inv = 1.0 / np.sqrt(1.0 + gx * gx + gy * gy)
            nx, ny, nz = -gx * inv, -gy * inv, inv
            vn = np.minimum(vx[b] * nx + vy[b] * ny + vz[b] * nz, 0.0)
            vx[b] -= 1.15 * vn * nx
            vy[b] -= 1.15 * vn * ny
            vz[b] -= 1.15 * vn * nz
            pz[b] = tb[below]

        outside = ((px[idx] < x_min) | (px[idx] > x_max)
                   | (py[idx] < y_min) | (py[idx] > y_max))
        if np.any(outside):
            gone = idx[outside]
            exited += v_p * gone.size
            alive[gone] = False

    def deposit() -> np.ndarray:
        depth = np.zeros((h_rows, w_cols), dtype=np.float64)
        idx = np.flatnonzero(alive)
        if idx.size == 0:
            return depth
        c = px[idx] / dx
        r = py[idx] / dx
        c0i = np.clip(np.floor(c).astype(np.int64), 0, w_cols - 2)
        r0i = np.clip(np.floor(r).astype(np.int64), 0, h_rows - 2)
        fc, fr = np.clip(c - c0i, 0, 1), np.clip(r - r0i, 0, 1)
        # each particle carries exactly v_p = l0^3 of water; splat volume/area
        dcell = np.full(idx.size, (l0 * l0 * l0) / (dx * dx))
        for br, bc, wgt in (
            (r0i, c0i, (1 - fr) * (1 - fc)),
            (r0i, c0i + 1, (1 - fr) * fc),
            (r0i + 1, c0i, fr * (1 - fc)),
            (r0i + 1, c0i + 1, fr * fc),
        ):
            np.add.at(depth, (br, bc), wgt * dcell)
        return depth

    def station_values(depth: np.ndarray, t: float) -> None:
        idx = np.flatnonzero(alive)
        for km, (sr, sc) in st_cells.items():
            key = str(km)
            rr = slice(max(sr - 3, 0), min(sr + 4, h_rows))
            cc = slice(max(sc - 3, 0), min(sc + 4, w_cols))
            band = float(depth[rr, cc].max())
            # Discharge through the gauge: volume flux of the particles inside a
            # circle of radius R around it, Q ≈ Σ|v|·V_p / 2R (m³/s). Speed
            # magnitude, not one grid axis — rivers cross the grid at any angle.
            q_val = 0.0
            if idx.size:
                rad = 4.0 * dx
                near = np.hypot(px[idx] - sc * dx, py[idx] - sr * dx) < rad
                if np.any(near):
                    k = idx[near]
                    q_val = float(np.sum(np.hypot(vx[k], vy[k])) * v_p / (2.0 * rad))
            stations[key]["times_s"].append(round(t, 2))
            stations[key]["depth_m"].append(round(band, 3))
            stations[key]["q_cms"].append(round(q_val, 1))

    def record_frame(t: float, last_t: float) -> None:
        depth = deposit()
        np.maximum(max_depth, depth, out=max_depth)
        wet = depth > arrival_threshold_m
        arrival[wet & np.isnan(arrival)] = t
        idx = np.flatnonzero(alive)
        if idx.size:
            c = np.clip((px[idx] / dx).astype(np.int64), 0, w_cols - 1)
            r = np.clip((py[idx] / dx).astype(np.int64), 0, h_rows - 1)
            spd = np.hypot(vx[idx], vy[idx])
            vel_grid = np.zeros_like(depth)
            np.maximum.at(vel_grid, (r, c), spd)
            np.maximum(max_vel, np.where(depth > 0.1, vel_grid, 0.0), out=max_vel)
        station_values(depth, t)
        frame_list.append(depth.astype(np.float16))
        # particle snapshot (grid col, grid row, z m, speed m/s), NaN-padded;
        # an even stride keeps the subsample spread over the whole flood
        snap = np.full((SNAPSHOT_CAP, 4), np.nan, dtype=np.float32)
        if idx.size:
            pick = idx[:: max(1, int(np.ceil(idx.size / SNAPSHOT_CAP)))][:SNAPSHOT_CAP]
            snap[: pick.size] = np.stack(
                [px[pick] / dx, py[pick] / dx, pz[pick], np.hypot(vx[pick], vy[pick])], axis=-1)
        snap_list.append(snap)

    t = 0.0
    steps = 0
    rec_i = 0
    last_record_t = 0.0
    frame_list: list[np.ndarray] = []
    snap_list: list[np.ndarray] = []

    while t < duration_s and steps < max_steps:
        idx = np.flatnonzero(alive)
        vmax = 0.0
        if idx.size:
            vmax = float(max(np.abs(vx[idx]).max(), np.abs(vy[idx]).max(),
                             np.abs(vz[idx]).max()))
        dt = min(0.4 * l0 / max(c0 + vmax, 1.0), duration_s - t, 0.5)
        if rec_i < len(record_times):
            dt = min(dt, max(record_times[rec_i] - t, 1e-9))
        if dt <= 1e-9:
            dt = 1e-9
        q_now = float(np.interp(t, hq_t, hq_q))
        n_sub = int(np.clip(np.interp(q_now, [0, 500, 5000], [1, 2, 4]), 1, 6))
        for s in range(n_sub):
            step(dt / n_sub, t + (dt / n_sub) * (s + 1))
        t += dt
        steps += 1

        while rec_i < len(record_times) and t >= record_times[rec_i] - 1e-9:
            record_frame(record_times[rec_i], last_record_t)
            last_record_t = record_times[rec_i]
            rec_i += 1
            if progress_cb and rec_i % 16 == 0:
                progress_cb(min(99, int(t / duration_s * 100)),
                            f"sph t={t/3600:.2f}h alive={int(alive.sum())}")

    if rec_i < len(record_times):
        depth = deposit()
        while rec_i < len(record_times):
            record_frame(record_times[rec_i], last_record_t)
            last_record_t = record_times[rec_i]
            rec_i += 1

    if progress_cb:
        progress_cb(100, f"sph done: {steps} steps, {spawned} particles spawned")

    idx = np.flatnonzero(alive)
    stored_hm3 = idx.size * v_p / 1e6
    injected_hm3 = injected / 1e6
    mb_err = (abs(injected_hm3 - exited / 1e6 - stored_hm3) / injected_hm3 * 100.0
              if injected_hm3 > 0 else 0.0)

    return FrameSeries(
        times_s=np.asarray(record_times[:rec_i], dtype=np.float64),
        depth=np.stack(frame_list[:rec_i]) if frame_list
        else np.zeros((0, h_rows, w_cols), np.float16),
        max_depth=max_depth,
        max_vel=max_vel,
        arrival_s=arrival,
        stations=stations,
        particles=np.stack(snap_list[:rec_i]) if snap_list else None,
        meta={
            "engine": "sph",
            "cell_m": dx,
            "particles_spawned": int(spawned),
            "particles_alive": int(idx.size),
            "steps": steps,
            "l0_m": l0,
            "window_m": window_m,
            "injected_hm3": injected_hm3,
            "exited_hm3": exited / 1e6,
            "stored_hm3": stored_hm3,
            "mass_balance_error_pct": mb_err,
            "near_field_only": window_m is not None,
            "truncated": steps >= max_steps,
        },
    )
