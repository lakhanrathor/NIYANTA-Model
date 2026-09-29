"""
Convert Copernicus DEM (.tif) to:
  1. heightmap.png — grayscale displacement map for Three.js
  2. satellite.png — false-color terrain texture
  3. Updated simulation_data.json with velocity per particle + terrain grid
"""
import rasterio
import numpy as np
from PIL import Image
import json, os, sys

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
DAMATLAS_ROOT = os.path.join(NIYANTA_ROOT, "damatlas")

DEM_PATH = os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N36_00_E073_00_DEM_cog.tif")
OUT_DIR = os.path.join(NIYANTA_ROOT, "frontend", "public")
GRID_SIZE = 128  # heightmap resolution (power of 2 for GPU)

os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. Read DEM and resample to GRID_SIZE × GRID_SIZE ────────────────
print(f"Reading DEM: {DEM_PATH}")
with rasterio.open(DEM_PATH) as src:
    w, h = src.width, src.height
    x_off = w // 2 - GRID_SIZE // 2
    y_off = h // 2 - GRID_SIZE // 2
    window = rasterio.windows.Window(x_off, y_off, GRID_SIZE, GRID_SIZE)
    elevation = src.read(1, window=window).astype(np.float32)

# Replace nodata
elevation[elevation < -1000] = np.nanmin(elevation[elevation > -1000])
print(f"DEM shape: {elevation.shape}, range: {np.nanmin(elevation):.1f} – {np.nanmax(elevation):.1f} m")

# ── 2. Generate heightmap PNG (16-bit grayscale) ──────────────────────
el_min, el_max = np.nanmin(elevation), np.nanmax(elevation)
el_norm = (elevation - el_min) / (el_max - el_min + 1e-8)  # 0..1
el_16 = (el_norm * 65535).astype(np.uint16)

img_heightmap = Image.fromarray(el_16, mode="I;16")
img_heightmap.save(os.path.join(OUT_DIR, "heightmap.png"))
print(f"Saved heightmap.png ({GRID_SIZE}x{GRID_SIZE}, 16-bit)")

# ── 3. Generate satellite-like texture (color ramp) ──────────────────
def color_ramp(val, colors):
    """val in 0..1, colors = list of (r,g,b) stops"""
    n = len(colors) - 1
    idx = min(int(val * n), n - 1)
    t = (val * n) - idx
    r = int(colors[idx][0] + (colors[idx+1][0] - colors[idx][0]) * t)
    g = int(colors[idx][1] + (colors[idx+1][1] - colors[idx][1]) * t)
    b = int(colors[idx][2] + (colors[idx+1][2] - colors[idx][2]) * t)
    return (r, g, b)

terrain_colors = [
    (30, 60, 20),    # low valley — dark green
    (50, 100, 35),   # green
    (80, 130, 50),   # mid green
    (120, 150, 70),  # light green
    (160, 160, 100), # transition
    (140, 120, 80),  # brown
    (120, 100, 70),  # rock
    (180, 180, 180), # high rock
    (240, 240, 245), # snow
]

sat_pixels = np.zeros((GRID_SIZE, GRID_SIZE, 3), dtype=np.uint8)
for y in range(GRID_SIZE):
    for x in range(GRID_SIZE):
        sat_pixels[y, x] = color_ramp(el_norm[y, x], terrain_colors)

img_sat = Image.fromarray(sat_pixels, "RGB")
img_sat_up = img_sat.resize((512, 512), Image.LANCZOS)
img_sat_up.save(os.path.join(OUT_DIR, "satellite.png"))
print(f"Saved satellite.png (512x512)")

# ── 4. Compute terrain grid for physics + export ─────────────────────
# Normalize elevation to Three.js world coords (0..GRID_SIZE range, Y = height * scale)
height_scale = 30.0 / (el_max - el_min + 1e-8)  # map to ~30 units tall
terrain_grid = el_norm * 30.0  # world Y

# Compute slope for each cell (for water flow direction)
slope_x = np.zeros_like(terrain_grid)
slope_z = np.zeros_like(terrain_grid)
slope_x[1:-1, :] = (terrain_grid[2:, :] - terrain_grid[:-2, :]) / 2.0
slope_z[:, 1:-1] = (terrain_grid[:, 2:] - terrain_grid[:, :-2]) / 2.0

terrain_meta = {
    "grid_size": GRID_SIZE,
    "el_min": float(el_min),
    "el_max": float(el_max),
    "height_scale": float(height_scale),
    "world_size": GRID_SIZE,
}

# ── 5. Update simulation_data.json with velocity + terrain ────────────
print("Loading existing simulation_data.json...")
sim_path = os.path.join(OUT_DIR, "simulation_data.json")
with open(sim_path) as f:
    sim_data = json.load(f)

# Add terrain metadata
sim_data["terrain"] = terrain_meta

# Add velocity to each particle
print("Computing velocities per frame...")
for fi, frame in enumerate(sim_data["frames"]):
    particles = frame["particles"]
    if fi == 0:
        # First frame: velocity = 0 for all
        for p in particles:
            p.extend([0.0, 0.0, 0.0])  # vx, vy, vz
        continue
    
    prev_particles = sim_data["frames"][fi - 1]["particles"]
    # Match particles by index (they're in same order)
    for i, p in enumerate(particles):
        if i < len(prev_particles):
            vx = p[0] - prev_particles[i][0]
            vy = p[1] - prev_particles[i][1]
            vz = p[2] - prev_particles[i][2]
            p.extend([round(vx, 3), round(vy, 3), round(vz, 3)])
        else:
            p.extend([0.0, 0.0, 0.0])

print(f"Updated {len(sim_data['frames'])} frames with velocity data")

# Save updated data
with open(sim_path, "w") as f:
    json.dump(sim_data, f)
print(f"Saved updated simulation_data.json")

# File sizes
for fn in ["heightmap.png", "satellite.png", "simulation_data.json"]:
    fp = os.path.join(OUT_DIR, fn)
    sz = os.path.getsize(fp) / (1024*1024)
    print(f"  {fn}: {sz:.1f} MB")

print("\nDone! All assets generated.")
