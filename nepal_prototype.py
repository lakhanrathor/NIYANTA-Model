import numpy as np
import json
import time
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

def build_nepal_prototype():
    print("Initializing Nepal (Gyirong Port) 10km Prototype...")
    
    # Chemistry / Materials
    MAT_GLACIER_WATER = 1
    MAT_CONCRETE = 4 # Breakable solid (Gyirong Port)
    MAT_ROCK = 3 # Unbreakable solid (Langtang Valley)
    
    particles = []
    
    # 1. Procedural 10km Valley (Scale: 1 unit = 100 meters to keep particle count low for prototype)
    # So 100 units = 10km length (z-axis)
    print("Generating Langtang Lirung slope (10km scale)...")
    terrain_z = np.arange(0, 100, 2)
    terrain_x = np.arange(0, 40, 2)
    
    # Valley shape: Steep V-shape, descending rapidly
    for z in terrain_z:
        for x in terrain_x:
            # Elevation decreases as Z increases. Center (x=20) is the lowest point (riverbed)
            y_base = 50.0 - (z * 0.5) # Steep descent
            y_valley = abs(x - 20.0) * 0.8 # V-shape walls
            y = y_base + y_valley
            
            particles.append({
                "type": MAT_ROCK, "x": float(x), "y": float(y), "z": float(z),
                "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": True, "broken": False
            })
            
    # 2. Gyirong Port / Immigration Office
    # Placed at the bottom of the valley (z = 80 to 85) in the center (x = 15 to 25)
    print("Constructing Gyirong Port Infrastructure...")
    port_z_start = 80
    port_z_end = 86
    port_x_start = 16
    port_x_end = 24
    base_y = (50.0 - (port_z_start * 0.5)) + 1.0 # Just above the riverbed
    
    for z in range(port_z_start, port_z_end, 2):
        for x in range(port_x_start, port_x_end, 2):
            for y in range(int(base_y), int(base_y) + 8, 2):
                particles.append({
                    "type": MAT_CONCRETE, "x": float(x), "y": float(y), "z": float(z),
                    "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": True, "broken": False
                })

    # 3. Glacier Collapse Payload
    # Placed at the very top of the mountain (z = 0 to 10)
    print("Spawning Glacier Outburst payload...")
    water_z_start = 0
    water_z_end = 10
    water_base_y = (50.0 - (water_z_start * 0.5)) + 10.0 # High up
    
    for z in range(water_z_start, water_z_end, 2):
        for x in range(12, 28, 2):
            for y in range(int(water_base_y), int(water_base_y) + 15, 2):
                particles.append({
                    "type": MAT_GLACIER_WATER, "x": float(x), "y": float(y), "z": float(z),
                    "vx": 0.0, "vy": 0.0, "vz": 10.0, # Initial momentum down the valley
                    "fixed": False, "broken": True 
                })
                
    print(f"Total Particles: {len(particles)}")
    
    frames = []
    dt = 0.05
    gravity = -9.8
    num_frames = 250
    
    print("Running Physics Computation (Calculating kinetic forces)...")
    start_time = time.time()
    
    for f in range(num_frames):
        frame_data = []
        
        # Spatial Hash
        grid = {}
        for p in particles:
            if p["type"] != MAT_ROCK: 
                gx = int(p["x"] // 2)
                gy = int(p["y"] // 2)
                gz = int(p["z"] // 2)
                key = (gx, gy, gz)
                if key not in grid: grid[key] = []
                grid[key].append(p)
                
        for p in particles:
            if not p["fixed"] or p["broken"]:
                # Gravity
                p["vy"] += gravity * dt
                
                # Integration
                p["x"] += p["vx"] * dt
                p["y"] += p["vy"] * dt
                p["z"] += p["vz"] * dt
                
                # Terrain Collision Equation
                y_base = 50.0 - (p["z"] * 0.5)
                y_valley = abs(p["x"] - 20.0) * 0.8
                terrain_height = y_base + y_valley
                
                if p["y"] < terrain_height:
                    p["y"] = terrain_height
                    # Gravity assists the flow down the valley (positive Z)
                    p["vz"] += 5.0 * dt
                    # Funnel into the center of the V-shape
                    if p["x"] < 20.0: p["vx"] += 3.0 * dt
                    if p["x"] > 20.0: p["vx"] -= 3.0 * dt
                    
                    p["vy"] *= -0.5 # bounce
                    p["vx"] *= 0.95 
                    p["vz"] *= 0.98 # low friction for water on steep slopes
                    
                # Fluid-Structure Fracture Mechanics
                gx = int(p["x"] // 2)
                gy = int(p["y"] // 2)
                gz = int(p["z"] // 2)
                
                for dx in [-1,0,1]:
                    for dy in [-1,0,1]:
                        for dz in [-1,0,1]:
                            nkey = (gx+dx, gy+dy, gz+dz)
                            if nkey in grid:
                                for neighbor in grid[nkey]:
                                    if neighbor is not p:
                                        dist = ((p["x"]-neighbor["x"])**2 + (p["y"]-neighbor["y"])**2 + (p["z"]-neighbor["z"])**2)**0.5
                                        if dist < 2.0:
                                            overlap = 2.0 - dist
                                            if dist > 0.001:
                                                nx = (p["x"] - neighbor["x"]) / dist
                                                ny = (p["y"] - neighbor["y"]) / dist
                                                nz = (p["z"] - neighbor["z"]) / dist
                                                
                                                push = overlap * 0.5
                                                p["x"] += nx * push
                                                p["y"] += ny * push
                                                p["z"] += nz * push
                                                
                                                # FRACTURE (Gyirong Port breaks if hit hard enough)
                                                if p["type"] == MAT_GLACIER_WATER and neighbor["type"] == MAT_CONCRETE and neighbor["fixed"]:
                                                    impact_force = (p["vx"]**2 + p["vy"]**2 + p["vz"]**2)**0.5
                                                    if impact_force > 15.0: # High threshold for Concrete
                                                        neighbor["fixed"] = False
                                                        neighbor["broken"] = True
                                                        neighbor["vx"] += p["vx"] * 0.8
                                                        neighbor["vy"] += p["vy"] * 0.8
                                                        neighbor["vz"] += p["vz"] * 0.8
            
            # Cull static rocks
            if p["type"] != MAT_ROCK:
                frame_data.append([round(p["x"], 2), round(p["y"], 2), round(p["z"], 2), p["type"]])
                
        frames.append({
            "frame_id": f,
            "particles": frame_data
        })
        if f % 25 == 0:
            print(f"Computed frame {f}/250")
            
    print(f"Physics computed in {time.time() - start_time:.2f} seconds.")
    
    materials = {
        "1": { "name": "Glacier Outburst", "type": "liquid", "color": 0xcceeff },
        "3": { "name": "Langtang Slopes", "type": "solid", "color": 0x4a4a4a },
        "4": { "name": "Gyirong Port Concrete", "type": "solid", "color": 0x999999 }
    }
    
    output_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")
    print(f"Writing to {output_path}...")
    with open(output_path, "w") as f:
        json.dump({"materials": materials, "frames": frames}, f)
        
    print("Done!")

if __name__ == "__main__":
    build_nepal_prototype()
