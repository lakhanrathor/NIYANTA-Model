"""
run_flood.py — Niyanta Dam Breach Flood Simulation
Simulates a dam breach event: water bursts through the notch,
flows downstream following the real terrain elevation formula,
floods the valley, inundates buildings.

Output: frontend/public/flood_frames.json
  { "total_frames": N, "frames": [ [[x,y,z], ...], ... ] }
"""
import json, math, random
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

random.seed(0)

OUT = os.path.join(NIYANTA_ROOT, "frontend", "public", "flood_frames.json")

W, L = 1000, 2000

def terrain_y(x, z):
    y_base = 50.0 - (z / L * 20.0)
    river_center = (W/2) + math.sin(z / 200.0) * 100.0
    dist = abs(x - river_center)
    y_valley = (dist ** 1.5) * 0.02
    noise = math.sin(x/30.0) * math.cos(z/30.0) * 5.0
    peaks = math.sin(x/150.0) * math.cos(z/150.0) * 30.0
    y = y_base + y_valley + noise + peaks
    if dist < 40:
        y = y_base - 5.0 + math.sin(z/10.0) * 1.0
    return y

# Dam is at z=150, centered at x=500
DAM_Z      = 300
DAM_CX     = 500
BREACH_W   = 60
RESERVOIR_Z_MIN = 0
RESERVOIR_Z_MAX = 300

# ── Spawn water particles in reservoir behind dam ─────────────────────────
print("Spawning reservoir particles...")
particles = []  # [x, y, z, vx, vy, vz, alive]
N_PARTICLES = 18000

for _ in range(N_PARTICLES):
    x = random.uniform(DAM_CX - 200, DAM_CX + 200)
    z = random.uniform(RESERVOIR_Z_MIN, RESERVOIR_Z_MAX - 5)
    y = terrain_y(x, z) + random.uniform(0, 35)  # water piled up behind dam
    # Initially mostly still, slight downstream drift
    vx = random.uniform(-1, 1)
    vy = random.uniform(-0.5, 0.5)
    vz = random.uniform(0, 0.5)
    particles.append([x, y, z, vx, vy, vz])

# ── Physics constants ────────────────────────────────────────────────────────
GRAVITY    = -12.0
DT         = 0.12
DAMPING    = 0.82
FRICTION   = 0.78
TOTAL_FRAMES = 280

print(f"Simulating {TOTAL_FRAMES} frames × {N_PARTICLES} particles...")

all_frames = []

# Save frame 0 (reservoir full, dam intact)
all_frames.append([[round(p[0],1), round(p[1],1), round(p[2],1)] for p in particles])

for frame in range(1, TOTAL_FRAMES + 1):
    if frame % 30 == 0:
        print(f"  Frame {frame}/{TOTAL_FRAMES}  ...")

    # Breach opens gradually over first 20 frames
    breach_open = min(1.0, frame / 20.0)
    breach_flow = 80.0 * breach_open   # max flow speed through breach

    new_particles = []
    for p in particles:
        x, y, z, vx, vy, vz = p

        # ── Gravity ─────────────────────────────────────────────────────────
        vy += GRAVITY * DT

        # ── Dam force: particles behind dam (z < DAM_Z) near breach get sucked through
        if z < DAM_Z + 5:
            dist_from_breach_cx = abs(x - DAM_CX)
            if dist_from_breach_cx < BREACH_W * 0.8 * breach_open:
                # Through the breach — accelerate forward (downstream)
                vz += breach_flow * DT
                vy += 5.0 * DT   # slight upward jet
            else:
                # Dam wall stops movement — push back
                if z > DAM_Z - 2:
                    z = DAM_Z - 2
                    vz = min(0, vz) * -0.2

        # ── Terrain slope forces — water flows downhill ──────────────────────
        # Sample terrain gradient (finite difference)
        gy_dz = (terrain_y(x, z+5) - terrain_y(x, z-5)) / 10.0  # slope in Z
        gy_dx = (terrain_y(x+5, z) - terrain_y(x-5, z)) / 10.0  # slope in X
        vz += gy_dz * 18.0 * DT   # flow downhill in Z
        vx += gy_dx * 18.0 * DT   # flow downhill in X

        # ── Apply velocity ───────────────────────────────────────────────────
        x += vx * DT
        y += vy * DT
        z += vz * DT

        # ── Terrain collision ─────────────────────────────────────────────────
        ground = terrain_y(x, z)
        if y < ground:
            y = ground
            vy = abs(vy) * 0.15      # very slight bounce, mostly absorb
            vx *= FRICTION
            vz *= FRICTION
        
        # ── Velocity damping ─────────────────────────────────────────────────
        vx *= DAMPING
        vy *= DAMPING
        vz *= DAMPING

        # ── Bounds clamp ─────────────────────────────────────────────────────
        x = max(10, min(990, x))
        z = max(0, min(1990, z))

        new_particles.append([x, y, z, vx, vy, vz])

    particles = new_particles
    all_frames.append([[round(p[0],1), round(p[1],1), round(p[2],1)] for p in particles])

print("Writing flood_frames.json ...")
output = {
    "total_frames": TOTAL_FRAMES,
    "particle_count": N_PARTICLES,
    "dam_z": DAM_Z,
    "frames": all_frames
}
with open(OUT, "w") as f:
    json.dump(output, f, separators=(',', ':'))  # compact — no spaces

import os
size_mb = os.path.getsize(OUT) / 1024 / 1024
print(f"Done! {TOTAL_FRAMES+1} frames written → flood_frames.json ({size_mb:.1f} MB)")
print("Refresh the browser — press PLAY to watch the flood.")
