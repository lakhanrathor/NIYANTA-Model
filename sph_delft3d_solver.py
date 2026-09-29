"""
sph_delft3d_solver.py — Fast Vectorized Hydrodynamic Solver combining SPH & Delft3D Shallow Water Equations.

SPH Physics Equations:
  1. Fluid Density (Poly6 Kernel): rho_i = RHO_0 + m * sum(W_poly6(r, h))
  2. Tait Equation of State: P_i = B * ((rho_i / RHO_0)^7 - 1)
  3. Pressure Repulsion Force (Spiky Kernel Gradient)
  4. Delft3D Manning Bed Resistance Drag: f_manning = -g * n^2 * v * |v| / h^(4/3)
"""
import numpy as np
import math, sys, os

RHO_0    = 1000.0      # Reference density (kg/m^3)
MASS     = 2.5         # Particle mass (kg)
H_SMOOTH = 25.0        # Smoothing radius (meters)
H2       = H_SMOOTH * H_SMOOTH
GAMMA    = 7.0
C_0      = 40.0        # Sound speed in fluid
B_EOS    = (RHO_0 * C_0 * C_0) / GAMMA
MANNING_N = 0.040      # Manning coefficient for Himalayan boulder riverbed
GRAVITY_G = 9.81

POLY6_CONST = 315.0 / (64.0 * np.pi * (H_SMOOTH ** 9))
SPIKY_CONST = -45.0 / (np.pi * (H_SMOOTH ** 6))

def compute_sph_delft3d_forces(pos, vel, terrain_fn, is_water_fn, dt):
    """
    Fast Vectorized SPH Navier-Stokes (Pressure Gradient + Density)
    + Delft3D Shallow Water Manning Bed Friction.
    """
    N = pos.shape[0]

    # Subsample 250 spatial center points for ultra-fast 60FPS SPH density field evaluation
    sample_indices = np.random.choice(N, size=min(250, N), replace=False)
    sub_pos = pos[sample_indices]

    # Pairwise SPH distance matrix (N x N_sub)
    dx = pos[:, 0:1] - sub_pos[:, 0].T
    dy = pos[:, 1:2] - sub_pos[:, 1].T
    dz = pos[:, 2:3] - sub_pos[:, 2].T
    r2 = dx*dx + dy*dy + dz*dz

    # Poly6 Kernel Density: rho = RHO_0 + sum(Poly6(r, h))
    in_kernel = (r2 < H2) & (r2 > 1e-4)
    r2_masked = np.where(in_kernel, r2, H2)
    poly6_kernel = POLY6_CONST * ((H2 - r2_masked) ** 3)
    poly6_kernel[~in_kernel] = 0.0

    densities = RHO_0 + (MASS * (N / len(sample_indices))) * np.sum(poly6_kernel, axis=1)

    # Tait Equation of State Pressure: P = B * ((rho / rho_0)^7 - 1)
    rho_ratio = densities / RHO_0
    pressures = B_EOS * np.maximum(0.0, np.power(rho_ratio, GAMMA) - 1.0)

    # Spiky Kernel Gradient Pressure Repulsion Force
    r_dist = np.sqrt(r2_masked)
    spiky_mag = SPIKY_CONST * ((H_SMOOTH - r_dist) ** 2) / (r_dist + 1e-3)
    spiky_mag[~in_kernel] = 0.0

    p_avg = (pressures[:, np.newaxis] + pressures[sample_indices].T) * 0.5
    f_press_x = np.sum(p_avg * (dx / (r_dist + 1e-3)) * spiky_mag, axis=1)
    f_press_z = np.sum(p_avg * (dz / (r_dist + 1e-3)) * spiky_mag, axis=1)

    # SPH Accelerations
    sph_acc_x = -f_press_x / (densities + 1e-3) * 0.05
    sph_acc_z = -f_press_z / (densities + 1e-3) * 0.05

    # Delft3D Manning Bed Friction Drag
    from terrain_utils import terrain_y_vec
    v_speed = np.sqrt(vel[:, 0]**2 + vel[:, 2]**2) + 1e-4
    t_elev  = terrain_y_vec(pos[:, 0], pos[:, 2])
    h_water = np.maximum(0.5, pos[:, 1] - t_elev)
    manning_drag = (GRAVITY_G * (MANNING_N ** 2) * v_speed) / (np.power(h_water, 4.0/3.0))

    forces = np.zeros_like(pos, dtype=np.float32)
    forces[:, 0] = sph_acc_x - vel[:, 0] * manning_drag
    forces[:, 2] = sph_acc_z - vel[:, 2] * manning_drag

    return forces, densities
