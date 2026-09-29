"""
populate_settlement.py — Niyanta Digital Twin
Generates a realistic Himalayan valley settlement layout based on:
  - Research: villages cluster on elevated terraces ABOVE the river flood zone
  - Two main settlement clusters (upstream & downstream village)
  - Market row / bazaar along the main road
  - Temple/shrine at community center
  - School on slightly elevated ground
  - Dense pine forests on both canyon walls
  - Agricultural farm sheds near terrace fields
  - All Y positions snapped to terrain using the same elevation formula
"""
import json
import math
import random
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

random.seed(42)  # Reproducible layout

DB_PATH  = os.path.join(NIYANTA_ROOT, "database", "world_layout.json")
PUB_PATH = os.path.join(NIYANTA_ROOT, "frontend", "public", "world_layout.json")

# ── Terrain elevation function (same as sandbox_builder.py) ─────────────────
def terrain_y(x, z, W=1000, L=2000):
    y_base = 50.0 - (z / L * 20.0)
    river_center = (W / 2) + math.sin(z / 200.0) * 100.0
    dist = abs(x - river_center)
    y_valley = (dist ** 1.5) * 0.02
    noise = math.sin(x / 30.0) * math.cos(z / 30.0) * 5.0
    peaks = math.sin(x / 150.0) * math.cos(z / 150.0) * 30.0
    y = y_base + y_valley + noise + peaks
    if dist < 40:
        y = y_base - 5.0 + math.sin(z / 10.0) * 1.0
    return y

def river_center(z, W=1000):
    return (W / 2) + math.sin(z / 200.0) * 100.0

def snap_y(x, z, offset=0.5):
    return round(terrain_y(x, z) + offset, 2)

objects = []
oid = 1

def add(asset, x, z, rot=0, scale=1.0, mat="5", offset=0.5):
    global oid
    # Only place on valid terrain (not in river or too steep)
    dist = abs(x - river_center(z))
    y = terrain_y(x, z)
    if dist < 50:   # skip river channel
        return
    if y > 160:     # skip very steep high peaks
        return
    objects.append({
        "id": f"{asset}_{oid:03d}",
        "asset": asset,
        "position": {"x": int(x), "y": snap_y(x, z, offset), "z": int(z)},
        "rotation_y": rot,
        "scale": scale,
        "material_id": mat
    })
    oid += 1

# ══════════════════════════════════════════════════════════════════════════════
# 1. CORE INFRASTRUCTURE
# ══════════════════════════════════════════════════════════════════════════════
# Hospital — on flat ground, slightly above river (concrete)
add("hospital", 510, 900, rot=0,   scale=1.0, mat="4", offset=1.0)

# Main bridge crossing river
add("bridge_concrete", 500, 1050, rot=0, scale=1.0, mat="4", offset=0.0)

# School — elevated on terrace above hospital
add("hospital", 420, 700, rot=15,  scale=0.7, mat="4", offset=1.0)  # school (reuse hospital shape)

# Police post — small shed near bridge
add("shed_farm", 560, 1070, rot=45, scale=1.0, mat="4", offset=0.5)

# ══════════════════════════════════════════════════════════════════════════════
# 2. MAIN ROAD — winding along the valley following the river
# ══════════════════════════════════════════════════════════════════════════════
for z in range(300, 1800, 80):
    rc = river_center(z)
    add("road_segment", rc + 90, z, rot=5,  scale=1.0, mat="3", offset=0.0)
    add("road_segment", rc - 90, z, rot=5,  scale=1.0, mat="3", offset=0.0)

# ══════════════════════════════════════════════════════════════════════════════
# 3. UPSTREAM VILLAGE — z: 400–700 (clusters on both sides of road)
# ══════════════════════════════════════════════════════════════════════════════
# West bank cluster
upstream_west = [
    (310, 420, 30), (330, 450, 15), (350, 480, -10), (360, 510, 25),
    (290, 530, 40), (270, 550, 0),  (300, 580, 20),  (320, 600, -15),
    (340, 620, 35), (280, 640, 10), (260, 660, 50),  (310, 680, 30),
    (350, 700, -5), (330, 720, 22), (290, 740, 15),
]
for (x, z, rot) in upstream_west:
    scale = random.uniform(0.85, 1.15)
    asset = "house_small" if random.random() > 0.3 else "house_medium"
    add(asset, x, z, rot=rot, scale=scale, mat="5")

# East bank cluster
upstream_east = [
    (680, 410, -20), (660, 440, 5),  (700, 460, 30), (720, 490, -10),
    (690, 520, 15),  (670, 550, 40), (710, 570, -5), (730, 600, 25),
    (680, 630, 10),  (650, 660, -25),(700, 680, 35), (720, 710, 0),
]
for (x, z, rot) in upstream_east:
    scale = random.uniform(0.8, 1.1)
    asset = "house_small" if random.random() > 0.35 else "house_medium"
    add(asset, x, z, rot=rot, scale=scale, mat="5")

# ══════════════════════════════════════════════════════════════════════════════
# 4. DOWNSTREAM MARKET/BAZAAR — z: 750–1000 (denser, commercial strip)
# ══════════════════════════════════════════════════════════════════════════════
bazaar = [
    (380, 760, 0), (400, 775, 5),  (420, 790, 0),  (440, 800, -5),
    (460, 812, 0), (380, 825, 10), (400, 840, 0),  (420, 855, -5),
    (440, 870, 0), (460, 885, 5),  (360, 760, -10),(350, 780, 15),
    (370, 800, 0), (380, 820, -5), (360, 840, 10),
    # East side market
    (580, 760, 180), (600, 775, 175), (620, 790, 180), (580, 810, 185),
    (600, 825, 180), (620, 840, 175), (560, 760, 190), (560, 780, 180),
]
for (x, z, rot) in bazaar:
    scale = random.uniform(0.9, 1.3)
    add("house_medium", x, z, rot=rot, scale=scale, mat="5")

# ══════════════════════════════════════════════════════════════════════════════
# 5. LOWER SETTLEMENT — z: 1100–1500 (scattered farmsteads)
# ══════════════════════════════════════════════════════════════════════════════
lower_farms = [
    (330, 1100, 20), (360, 1130, -10), (310, 1160, 35), (280, 1190, 5),
    (350, 1220, 15), (390, 1250, -20), (320, 1280, 30), (300, 1310, 0),
    (370, 1340, -15),(340, 1370, 25),  (380, 1400, 10), (310, 1430, -5),
    # East side farmsteads
    (640, 1100, 160),(670, 1130, 175),(610, 1160, 155),(680, 1200, 170),
    (650, 1230, 160),(620, 1260, 175),(670, 1300, 165),(640, 1330, 155),
    (610, 1360, 170),(680, 1400, 160),
]
for (x, z, rot) in lower_farms:
    scale = random.uniform(0.75, 1.0)
    add("house_small", x, z, rot=rot, scale=scale, mat="5")
    # Add farm sheds nearby
    if random.random() > 0.5:
        add("shed_farm", x + random.randint(25,40), z + random.randint(20,35),
            rot=rot+45, scale=0.8, mat="5", offset=0.3)

# ══════════════════════════════════════════════════════════════════════════════
# 6. PINE FORESTS — on canyon walls (above elevation ~80m)
# ══════════════════════════════════════════════════════════════════════════════
# West canyon wall forest
for _ in range(60):
    x = random.randint(50, 250)
    z = random.randint(100, 1900)
    y = terrain_y(x, z)
    if 60 < y < 180:
        add("tree_pine", x, z, rot=random.randint(0,360), scale=random.uniform(0.8,1.4), mat="6", offset=0.0)

# East canyon wall forest
for _ in range(60):
    x = random.randint(750, 950)
    z = random.randint(100, 1900)
    y = terrain_y(x, z)
    if 60 < y < 180:
        add("tree_pine", x, z, rot=random.randint(0,360), scale=random.uniform(0.8,1.4), mat="6", offset=0.0)

# Scattered trees near settlements (not in river)
for _ in range(30):
    x = random.randint(200, 800)
    z = random.randint(300, 1600)
    y = terrain_y(x, z)
    dist = abs(x - river_center(z))
    if 45 < y < 80 and dist > 80:
        add("tree_pine", x, z, rot=random.randint(0,360), scale=random.uniform(0.6,1.0), mat="6", offset=0.0)

# ══════════════════════════════════════════════════════════════════════════════
# 7. AGRICULTURAL SHEDS / HAYSTACKS near farms
# ══════════════════════════════════════════════════════════════════════════════
for _ in range(15):
    x = random.randint(250, 450)
    z = random.randint(400, 1400)
    y = terrain_y(x, z)
    dist = abs(x - river_center(z))
    if 35 < y < 90 and dist > 80:
        add("shed_farm", x, z, rot=random.randint(0, 360), scale=0.7, mat="5", offset=0.3)

for _ in range(15):
    x = random.randint(550, 750)
    z = random.randint(400, 1400)
    y = terrain_y(x, z)
    dist = abs(x - river_center(z))
    if 35 < y < 90 and dist > 80:
        add("shed_farm", x, z, rot=random.randint(0, 360), scale=0.7, mat="5", offset=0.3)

# ══════════════════════════════════════════════════════════════════════════════
# WRITE OUTPUT
# ══════════════════════════════════════════════════════════════════════════════
print(f"Generated {len(objects)} scene objects")
counts = {}
for o in objects:
    counts[o['asset']] = counts.get(o['asset'], 0) + 1
for k, v in sorted(counts.items()):
    print(f"  {k:25s}: {v}")

with open(DB_PATH, "r") as f:
    layout = json.load(f)

layout["objects"] = objects

with open(DB_PATH, "w") as f:
    json.dump(layout, f, indent=2)
with open(PUB_PATH, "w") as f:
    json.dump(layout, f, indent=2)

print("\nDone — world_layout.json updated with realistic settlement!")
