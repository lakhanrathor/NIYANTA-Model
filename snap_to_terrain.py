"""
Terrain Snap Script — Niyanta Digital Twin
Reads world_layout.json, calculates the exact terrain elevation at each object's X,Z
coordinate using the same formula as sandbox_builder.py, then sets each object's Y
to terrain_elevation + a small offset (so it sits ON the ground, not in/above it).
Like dropping objects from the sky and letting gravity place them on the terrain.
"""
import json
import math
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

# ── Same elevation function used in sandbox_builder.py ──────────────────────
def terrain_y(x, z, width_m=1000, length_m=2000):
    y_base = 50.0 - (z / length_m * 20.0)
    river_center = (width_m / 2) + math.sin(z / 200.0) * 100.0
    dist_from_river = abs(x - river_center)
    y_valley = (dist_from_river ** 1.5) * 0.02
    noise = (math.sin(x / 30.0) * math.cos(z / 30.0)) * 5.0
    peaks = (math.sin(x / 150.0) * math.cos(z / 150.0)) * 30.0
    y = y_base + y_valley + noise + peaks
    # Flat riverbed
    if dist_from_river < 40:
        y = y_base - 5.0 + (math.sin(z / 10.0) * 1.0)
    return y

# ── Small Y offset per asset type (object sits ON the surface) ───────────────
GROUND_OFFSET = {
    "hospital":        1.0,   # large base, sits directly on ground
    "bridge_concrete": 0.0,   # bridge pillars go into ground
    "house_small":     0.5,
    "house_medium":    0.5,
    "shed_farm":       0.5,
    "tree_pine":       0.0,   # trunk base is at ground
    "road_segment":    0.0,   # road is flush with ground
}

# ── Main ─────────────────────────────────────────────────────────────────────
DB_PATH = os.path.join(NIYANTA_ROOT, "database", "world_layout.json")
PUB_PATH = os.path.join(NIYANTA_ROOT, "frontend", "public", "world_layout.json")

print("Loading world_layout.json...")
with open(DB_PATH, "r") as f:
    layout = json.load(f)

print(f"Snapping {len(layout['objects'])} objects to terrain...")
for obj in layout["objects"]:
    x = obj["position"]["x"]
    z = obj["position"]["z"]
    ground = terrain_y(x, z)
    offset = GROUND_OFFSET.get(obj["asset"], 0.5)
    new_y = round(ground + offset, 2)
    old_y = obj["position"]["y"]
    obj["position"]["y"] = new_y
    print(f"  {obj['id']:20s}  X={x:6.0f} Z={z:6.0f}  terrain_y={ground:7.2f}  old_y={old_y:6.1f}  new_y={new_y:7.2f}")

print("\nWriting updated positions back to database...")
with open(DB_PATH, "w") as f:
    json.dump(layout, f, indent=2)

with open(PUB_PATH, "w") as f:
    json.dump(layout, f, indent=2)

print("Done! All objects are now snapped to the terrain surface.")
