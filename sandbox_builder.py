import json
import os
import numpy as np
import time

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
DATABASE = os.path.join(NIYANTA_ROOT, "database")

def build_sandbox():
    print("Reading Database...")
    
    with open(os.path.join(DATABASE, "materials.json"), "r") as f:
        materials = json.load(f)
        
    with open(os.path.join(DATABASE, "world_layout.json"), "r") as f:
        layout = json.load(f)
        
    world = layout["world_settings"]["dimensions"]
    res = 10.0 # Force 10m resolution so JSON isn't 1GB
    
    particles = []
    
    print(f"Generating Terrain ({world['width_m']}m x {world['length_m']}m)...")
    # Procedural Valley
    for z in np.arange(0, world['length_m'], res):
        for x in np.arange(0, world['width_m'], res):
            # Organic Valley Math
            # 1. Base slope downhill
            y_base = 50.0 - (z / world['length_m'] * 20.0)
            
            # 2. Winding river (sine wave on the X axis)
            river_center = (world['width_m'] / 2) + np.sin(z / 200.0) * 100.0
            
            # 3. Canyon walls (exponential curve instead of straight V)
            dist_from_river = abs(x - river_center)
            y_valley = (dist_from_river ** 1.5) * 0.02
            
            # 4. Organic bumpiness (high-frequency noise)
            noise = (np.sin(x / 30.0) * np.cos(z / 30.0)) * 5.0
            
            # 5. Massive mountain peaks on the edges (low-frequency noise)
            peaks = (np.sin(x / 150.0) * np.cos(z / 150.0)) * 30.0
            
            y = y_base + y_valley + noise + peaks
            
            # Keep the riverbed relatively flat
            if dist_from_river < 40:
                y = y_base - 5.0 + (np.sin(z / 10.0) * 1.0)
            
            particles.append([round(x, 1), round(y, 1), round(z, 1), 3, 0.0, 0.0, 0.0]) # 3 is rock
            
    print("Spawning Structures from Database...")
    for struct in layout["structures"]:
        mat_id = int(struct["material_id"])
        pos = struct["position"]
        size = struct["size"]
        
        sx = pos["x"] - size["width"]/2
        ex = pos["x"] + size["width"]/2
        sy = pos["y"]
        ey = pos["y"] + size["height"]
        sz = pos["z"] - size["depth"]/2
        ez = pos["z"] + size["depth"]/2
        
        # Structure resolution can be finer
        struct_res = 5.0
        for z in np.arange(sz, ez, struct_res):
            for x in np.arange(sx, ex, struct_res):
                for y in np.arange(sy, ey, struct_res):
                    particles.append([round(x, 1), round(y, 1), round(z, 1), mat_id, 0.0, 0.0, 0.0])

    print("Spawning Disaster Payload (Water)...")
    if "disaster_payload" in layout:
        payload = layout["disaster_payload"]
        p_mat = int(payload["material_id"])
        pos = payload["spawn_position"]
        size = payload["size"]
        
        sx = pos["x"] - size["width"]/2
        ex = pos["x"] + size["width"]/2
        sy = pos["y"]
        ey = pos["y"] + size["height"]
        sz = pos["z"] - size["depth"]/2
        ez = pos["z"] + size["depth"]/2
        
        water_res = 10.0 # 10m cubes of water
        water_count = 0
        for z in np.arange(sz, ez, water_res):
            for x in np.arange(sx, ex, water_res):
                for y in np.arange(sy, ey, water_res):
                    particles.append([round(x, 1), round(y, 1), round(z, 1), p_mat, 0.0, 0.0, 0.0])
                    water_count += 1
        print(f"Spawned {water_count} water particles.")

    print(f"Total Particles Generated: {len(particles)}")
    
    # We only output Frame 0 (Static Scene)
    output_data = {
        "materials": materials,
        "frames": [
            {
                "frame_id": 0,
                "particles": particles
            }
        ]
    }
    
    out_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")
    print(f"Writing to {out_path}...")
    with open(out_path, "w") as f:
        json.dump(output_data, f)
        
    print("Done! The 3D Sandbox is ready for visualization.")

if __name__ == "__main__":
    build_sandbox()
