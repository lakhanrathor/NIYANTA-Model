"""
populate_real_world.py — Populates Niyanta Digital Twin settlement & dam on real Copernicus DEM terrain
Snaps all 3D objects onto the terrain surface y = terrain_y(x, z)
Outputs database/world_layout.json and frontend/public/world_layout.json
"""
import sys, os, json, random, math

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, NIYANTA_ROOT)
from terrain_utils import terrain_y, is_water

random.seed(42)

DB_PATH  = os.path.join(NIYANTA_ROOT, "database", "world_layout.json")
PUB_PATH = os.path.join(NIYANTA_ROOT, "frontend", "public", "world_layout.json")

def build_world():
    objects = []

    # 1. Dam Structure (at Z=480 across the gorge)
    dam_x = 750
    dam_z = 480
    dam_y = terrain_y(dam_x, dam_z) - 2.0
    objects.append({
        "id": "dam_main_01",
        "asset": "dam_concrete",
        "position": {"x": dam_x, "y": dam_y, "z": dam_z},
        "rotation_y": 0,
        "scale": 1.0,
        "material_id": "4"
    })

    # 2. Concrete Bridge (downstream at Z=950 across river channel)
    bridge_x = 850
    bridge_z = 950
    bridge_y = terrain_y(bridge_x, bridge_z) + 1.0
    objects.append({
        "id": "bridge_main_01",
        "asset": "bridge_concrete",
        "position": {"x": bridge_x, "y": bridge_y, "z": bridge_z},
        "rotation_y": 15,
        "scale": 1.0,
        "material_id": "3"
    })

    # 3. Hospital / Emergency Center (on safe elevated terrace at Z=800, X=550)
    hosp_x = 550
    hosp_z = 800
    hosp_y = terrain_y(hosp_x, hosp_z)
    objects.append({
        "id": "hospital_01",
        "asset": "hospital",
        "position": {"x": hosp_x, "y": hosp_y, "z": hosp_z},
        "rotation_y": -10,
        "scale": 1.0,
        "material_id": "4"
    })

    # 4. Village Clusters (Houses & Farm Sheds along valley floor Z=600..1800)
    village_zones = [
        {"z_min": 600,  "z_max": 900,  "count": 16},  # Upper village (near dam)
        {"z_min": 1000, "z_max": 1400, "count": 22},  # Main valley village
        {"z_min": 1500, "z_max": 1850, "count": 18},  # Lower river settlement
    ]

    obj_id = 1
    for zone in village_zones:
        for _ in range(zone["count"]):
            # Place houses on dry land (not in deep river channel)
            for _attempt in range(50):
                z = random.uniform(zone["z_min"], zone["z_max"])
                x = random.uniform(250, 850)
                y = terrain_y(x, z)
                if not is_water(x, z) and y < 110:  # avoid steep upper cliff tops
                    asset = random.choice(["house_small", "house_medium", "shed_farm"])
                    mat_id = random.choice(["5", "4", "3"])
                    rot = random.uniform(-45, 45)
                    objects.append({
                        "id": f"house_{obj_id:03d}",
                        "asset": asset,
                        "position": {"x": round(x, 1), "y": round(y, 1), "z": round(z, 1)},
                        "rotation_y": round(rot, 1),
                        "scale": round(random.uniform(0.9, 1.1), 2),
                        "material_id": mat_id
                    })
                    obj_id += 1
                    break

    # 5. Pine Trees (Forest coverage on lower mountain slopes)
    tree_count = 60
    for i in range(tree_count):
        for _attempt in range(30):
            z = random.uniform(100, 1900)
            x = random.uniform(100, 950)
            y = terrain_y(x, z)
            if not is_water(x, z):
                objects.append({
                    "id": f"tree_{i+1:03d}",
                    "asset": "tree_pine",
                    "position": {"x": round(x, 1), "y": round(y, 1), "z": round(z, 1)},
                    "rotation_y": round(random.uniform(0, 360), 1),
                    "scale": round(random.uniform(0.8, 1.4), 2),
                    "material_id": "6"
                })
                break

    # 6. Road Segments along the valley
    for i in range(12):
        rz = 550 + i * 110
        rx = 620 + math.sin(i * 0.4) * 50
        ry = terrain_y(rx, rz) + 0.2
        objects.append({
            "id": f"road_{i+1:02d}",
            "asset": "road_segment",
            "position": {"x": round(rx, 1), "y": round(ry, 1), "z": round(rz, 1)},
            "rotation_y": round(math.sin(i * 0.4) * 20, 1),
            "scale": 1.0,
            "material_id": "3"
        })

    layout = {
        "metadata": {
            "name": "Niyanta Digital Twin — Real Copernicus DEM Nepal Valley",
            "source": "Copernicus DSM COG 10 (N27 E085)",
            "object_count": len(objects)
        },
        "asset_library": {
            "hospital": "assets/structures/hospital.obj",
            "bridge_concrete": "assets/structures/bridge_concrete.obj",
            "house_small": "assets/structures/house_small.obj",
            "house_medium": "assets/structures/house_medium.obj",
            "shed_farm": "assets/structures/shed_farm.obj",
            "tree_pine": "assets/vegetation/tree_pine.obj",
            "road_segment": "assets/infrastructure/road_segment.obj",
            "dam_concrete": "assets/structures/dam_concrete.obj"
        },
        "objects": objects
    }

    with open(DB_PATH, "w") as f:
        json.dump(layout, f, indent=2)
    with open(PUB_PATH, "w") as f:
        json.dump(layout, f, indent=2)

    print(f"Successfully populated village on real Copernicus DEM! Total objects: {len(objects)}")
    print(f"  Dam placed at X={dam_x}, Y={dam_y:.1f}, Z={dam_z}")

if __name__ == "__main__":
    build_world()
