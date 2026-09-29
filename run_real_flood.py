"""
run_real_flood.py — Vectorized 18,000 Particle Flood Simulation on Real Copernicus DEM
Simulates a catastrophic dam breach event down the real Himalayan river valley.
Outputs frontend/public/flood_frames.json
"""
import sys, os, json, random, math, struct
import numpy as np

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, NIYANTA_ROOT)
from terrain_utils import terrain_y, is_water, get_raw_heights_and_mask

OUT_JSON = os.path.join(NIYANTA_ROOT, "frontend", "public", "flood_frames.json")

# Simulation parameters
N_PARTICLES  = 18000
TOTAL_FRAMES = 280
DT           = 0.12
GRAVITY      = -14.0
DAMPING      = 0.84
FRICTION     = 0.76

# Dam geometry on real DEM
DAM_Z        = 480.0
DAM_CX       = 750.0
BREACH_W     = 70.0
RESERVOIR_MIN_Z = 100.0
RESERVOIR_MAX_Z = 475.0

def run_simulation():
    print(f"Initializing 10x Flood Simulation ({N_PARTICLES} particles x {TOTAL_FRAMES} frames)...")
    np.random.seed(42)

    # 1. Spawn 18,000 reservoir particles behind the dam
    # Position: x, y, z; Velocity: vx, vy, vz
    pos = np.zeros((N_PARTICLES, 3), dtype=np.float32)
    vel = np.zeros((N_PARTICLES, 3), dtype=np.float32)

    # Reservoir bounds
    pos[:, 0] = np.random.uniform(DAM_CX - 150.0, DAM_CX + 150.0, N_PARTICLES)
    pos[:, 2] = np.random.uniform(RESERVOIR_MIN_Z, RESERVOIR_MAX_Z, N_PARTICLES)

    # Snap Y to terrain + depth profile
    for i in range(N_PARTICLES):
        x, z = pos[i, 0], pos[i, 2]
        ty = terrain_y(x, z)
        # Deepest near dam, shallow at reservoir tail
        depth = (z / DAM_Z) * 35.0 + np.random.uniform(0.5, 5.0)
        pos[i, 1] = ty + depth

    # Initial slight downstream movement
    vel[:, 0] = np.random.uniform(-0.5, 0.5, N_PARTICLES)
    vel[:, 2] = np.random.uniform(0.1, 0.8, N_PARTICLES)

    # ── Spawn Dynamic Swept-Away Rigid Body Objects ────────────────────────────
    # 10 Trucks, 12 Cargo Containers, 15 Timber Logs
    swept_objects_def = []
    
    # 10 Delivery Trucks parked near village roads & riverbank
    for i in range(10):
        ox = random.uniform(320.0, 580.0)
        oz = random.uniform(620.0, 920.0)
        swept_objects_def.append({
            "id": f"truck_{i+1:02d}", "asset": "vehicle_truck",
            "pos": [ox, terrain_y(ox, oz), oz],
            "vel": [0.0, 0.0, 0.0],
            "rot_y": random.uniform(0, 360),
            "rot_v": 0.0,
            "scale": 1.1, "mat": "5"
        })

    # 12 Cargo Containers stacked near hospital & bridge
    for i in range(12):
        ox = random.uniform(480.0, 820.0)
        oz = random.uniform(720.0, 1020.0)
        swept_objects_def.append({
            "id": f"container_{i+1:02d}", "asset": "cargo_container",
            "pos": [ox, terrain_y(ox, oz), oz],
            "vel": [0.0, 0.0, 0.0],
            "rot_y": random.uniform(0, 360),
            "rot_v": 0.0,
            "scale": 1.0, "mat": "1"
        })

    # 15 Timber Log Bundles stacked near logging area
    for i in range(15):
        ox = random.uniform(220.0, 480.0)
        oz = random.uniform(550.0, 880.0)
        swept_objects_def.append({
            "id": f"logs_{i+1:02d}", "asset": "timber_logs",
            "pos": [ox, terrain_y(ox, oz), oz],
            "vel": [0.0, 0.0, 0.0],
            "rot_y": random.uniform(0, 360),
            "rot_v": 0.0,
            "scale": 0.9, "mat": "5"
        })

    swept_frames = []

    def get_swept_frame_data():
        return [
            {
                "id": o["id"], "asset": o["asset"],
                "x": round(float(o["pos"][0]), 2),
                "y": round(float(o["pos"][1]), 2),
                "z": round(float(o["pos"][2]), 2),
                "rot_y": round(float(o["rot_y"]), 1),
                "scale": o["scale"], "mat": o["mat"]
            } for o in swept_objects_def
        ]

    swept_frames.append(get_swept_frame_data())

    all_frames = []
    
    # Store frame 0
    f0 = np.round(pos, 1).tolist()
    all_frames.append(f0)

    print("Running vectorized physics iteration with rigid body swept-away objects...")

    for frame in range(1, TOTAL_FRAMES + 1):
        if frame % 40 == 0:
            print(f"  Frame {frame}/{TOTAL_FRAMES} complete ...")

        # Progressive Dam Structure Failure: Breach widens over first 45 frames
        failure_progress = min(1.0, frame / 45.0)
        current_breach_w = BREACH_W + failure_progress * 250.0  # Widens from 70m to 320m (full gorge width)
        breach_flow      = 110.0 * min(1.0, frame / 15.0)       # Hydrostatic surge velocity

        # Gravity
        vel[:, 1] += GRAVITY * DT

        # Dam Wall Collision & Failure Physics
        behind_dam  = (pos[:, 2] < DAM_Z + 15.0) & (pos[:, 2] > DAM_Z - 60.0)
        near_breach = np.abs(pos[:, 0] - DAM_CX) < (current_breach_w * 0.5)

        # Accelerated surge through breach
        breach_mask = behind_dam & near_breach
        vel[breach_mask, 2] += breach_flow * DT
        vel[breach_mask, 1] += 3.0 * DT

        # Intact wall sections block remaining water
        wall_mask = behind_dam & (~near_breach) & (pos[:, 2] > DAM_Z - 5.0)
        pos[wall_mask, 2] = DAM_Z - 5.0
        vel[wall_mask, 2] = np.minimum(0.0, vel[wall_mask, 2]) * -0.2

        # Hydrostatic Reservoir Pressure Push (water at back is pushed forward by reservoir head)
        hydrostatic_push = np.maximum(0.0, (DAM_Z - pos[:, 2]) / DAM_Z) * 65.0 * DT
        vel[:, 2] += hydrostatic_push

        # Vectorized Terrain Gradient Force (Slope-following flow down real DEM valley)
        from terrain_utils import terrain_y_vec
        eps = 4.0
        x_pts = pos[:, 0]
        z_pts = pos[:, 2]

        y_center = terrain_y_vec(x_pts, z_pts)
        y_xp     = terrain_y_vec(x_pts + eps, z_pts)
        y_xm     = terrain_y_vec(x_pts - eps, z_pts)
        y_zp     = terrain_y_vec(x_pts, z_pts + eps)
        y_zm     = terrain_y_vec(x_pts, z_pts - eps)

        grad_x = (y_xp - y_xm) / (2.0 * eps)
        grad_z = (y_zp - y_zm) / (2.0 * eps)

        # Downhill slope acceleration + river channel momentum
        vel[:, 0] -= grad_x * 35.0 * DT
        vel[:, 2] -= grad_z * 35.0 * DT

        # Downstream river channel propulsion
        past_dam = pos[:, 2] > DAM_Z
        vel[past_dam, 2] += 24.0 * DT

        # ── SPH (Smoothed Particle Hydrodynamics) & Delft3D Hydrodynamic Solver ──
        from sph_delft3d_solver import compute_sph_delft3d_forces
        sph_forces, SPH_densities = compute_sph_delft3d_forces(pos, vel, terrain_y, is_water, DT)

        # Apply SPH Pressure Gradient & Viscosity accelerations + Delft3D Manning Friction
        vel += sph_forces * DT

        # Update position
        pos += vel * DT

        # Terrain Surface Collision & Ground Sliding Friction
        hit_ground = pos[:, 1] < y_center
        pos[hit_ground, 1] = y_center[hit_ground]
        vel[hit_ground, 1] = np.abs(vel[hit_ground, 1]) * 0.1
        vel[hit_ground, 0] *= 0.94
        vel[hit_ground, 2] *= 0.96

        # Fluid momentum retention (minimal damping: 0.985 instead of 0.84)
        vel *= 0.985

        # Bounds clamp (0..1000m X, 0..2000m Z)
        pos[:, 0] = np.clip(pos[:, 0], 5.0, 995.0)
        pos[:, 2] = np.clip(pos[:, 2], 0.0, 1995.0)

        # ── RIGID BODY FLUID-STRUCTURE COUPLING (Sweeping Away Objects) ──────────
        for obj in swept_objects_def:
            ox, oy, oz = obj["pos"]
            ovx, ovy, ovz = obj["vel"]

            # Find water particles near this object
            dist2 = (pos[:, 0] - ox)**2 + (pos[:, 2] - oz)**2
            near_water = dist2 < 1600.0  # 40m influence radius
            
            if np.any(near_water):
                water_near_pos = pos[near_water]
                water_near_vel = vel[near_water]
                
                avg_w_y = np.mean(water_near_pos[:, 1])
                avg_w_vx = np.mean(water_near_vel[:, 0])
                avg_w_vz = np.mean(water_near_vel[:, 2])

                ground_y = terrain_y(ox, oz)
                water_depth = max(0.0, avg_w_y - ground_y)

                # Swept away condition: Water depth > 1.2m
                if water_depth > 1.2:
                    # Fluid drag acceleration
                    drag_fx = (avg_w_vx - ovx) * 1.8 * DT
                    drag_fz = (avg_w_vz - ovz) * 2.2 * DT

                    # Buoyancy lift force
                    buoyancy_y = (ground_y + min(water_depth * 0.8, 6.0) - oy) * 4.0 * DT

                    obj["vel"][0] += drag_fx
                    obj["vel"][1] += buoyancy_y
                    obj["vel"][2] += drag_fz

                    # Tumbling rotation
                    obj["rot_y"] += (avg_w_vz + avg_w_vx) * 1.2
            
            # Update object position & damping
            obj["vel"][1] += GRAVITY * 0.3 * DT  # lighter effective gravity when floating
            obj["pos"][0] += obj["vel"][0] * DT
            obj["pos"][1] += obj["vel"][1] * DT
            obj["pos"][2] += obj["vel"][2] * DT

            # Terrain ground collision
            t_y = terrain_y(obj["pos"][0], obj["pos"][2])
            if obj["pos"][1] < t_y:
                obj["pos"][1] = t_y
                obj["vel"][1] = 0.0
                obj["vel"][0] *= 0.85
                obj["vel"][2] *= 0.85

        # Save rigid body frame data
        swept_frames.append(get_swept_frame_data())

        # Save fluid particle frame data
        all_frames.append(np.round(pos, 1).tolist())

    # Save swept objects JSON data
    swept_out = os.path.join(NIYANTA_ROOT, "frontend", "public", "swept_objects.json")
    with open(swept_out, "w") as f:
        json.dump({"total_frames": TOTAL_FRAMES, "objects_per_frame": swept_frames}, f)

    # Verification metric: Water mask alignment score
    aligned_count = sum(1 for p in pos if is_water(p[0], p[2]))
    alignment_pct = (aligned_count / N_PARTICLES) * 100.0

    # Save lightweight JSON metadata
    meta = {
        "total_frames": TOTAL_FRAMES,
        "particle_count": N_PARTICLES,
        "dam_z": DAM_Z,
        "alignment_score_pct": round(alignment_pct, 1)
    }
    meta_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "flood_meta.json")
    bin_path  = os.path.join(NIYANTA_ROOT, "frontend", "public", "flood_frames.bin")

    os.makedirs(os.path.dirname(bin_path), exist_ok=True)
    with open(meta_path, "w") as f:
        json.dump(meta, f)

    # Save 57MB Float32 ArrayBuffer binary file: [n_frames (uint32), n_particles (uint32), float32_data...]
    arr = np.array(all_frames, dtype=np.float32)
    with open(bin_path, "wb") as f:
        header = struct.pack("<II", TOTAL_FRAMES + 1, N_PARTICLES)
        f.write(header)
        f.write(arr.tobytes())

    bin_size_mb = os.path.getsize(bin_path) / (1024 * 1024)
    print(f"Simulation Complete! Binary buffer saved -> flood_frames.bin ({bin_size_mb:.1f} MB)")
    print(f"  Swept Objects Animation saved -> swept_objects.json ({len(swept_objects_def)} dynamic rigid bodies)")
    print(f"  Water Mask Alignment Score: {alignment_pct:.1f}%")

if __name__ == "__main__":
    run_simulation()

