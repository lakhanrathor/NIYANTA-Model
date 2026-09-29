import numpy as np
import json
import time
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

def build_fsi_prototype():
    print("Initializing FSI Engine Prototype...")
    
    # 1. Particle Types / Chemistry
    MAT_WATER = 1
    MAT_HOUSE = 4 # Breakable solid
    MAT_ROCK = 3 # Unbreakable solid
    
    particles = []
    
    # Generate Mountain (Slope)
    # A ramp from z=0 (height=0) to z=100 (height=30)
    print("Generating Mountain lattice...")
    terrain_z = np.arange(0, 100, 2)
    terrain_x = np.arange(0, 50, 2)
    for z in terrain_z:
        for x in terrain_x:
            y = (z / 100.0) * 30.0 # Slope
            particles.append({
                "type": MAT_ROCK, "x": float(x), "y": float(y), "z": float(z),
                "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": True, "broken": False
            })
            
    # Generate House (Breakable)
    # Placed at x=20..30, z=20..30, sitting on the terrain
    print("Generating House structures...")
    house_z_start = 20
    house_z_end = 30
    house_x_start = 20
    house_x_end = 30
    base_y = (house_z_start / 100.0) * 30.0
    
    for z in range(house_z_start, house_z_end, 2):
        for x in range(house_x_start, house_x_end, 2):
            for y in range(int(base_y), int(base_y) + 10, 2):
                particles.append({
                    "type": MAT_HOUSE, "x": float(x), "y": float(y), "z": float(z),
                    "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": True, "broken": False
                })

    # Generate Water Wall
    print("Generating Water fluid...")
    water_z_start = 80
    water_z_end = 95
    water_base_y = (water_z_start / 100.0) * 30.0
    
    for z in range(water_z_start, water_z_end, 2):
        for x in range(15, 35, 2):
            for y in range(int(water_base_y), int(water_base_y) + 20, 2):
                particles.append({
                    "type": MAT_WATER, "x": float(x), "y": float(y), "z": float(z),
                    "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": False, "broken": True # Fluid is always broken
                })
                
    print(f"Total Particles: {len(particles)}")
    
    frames = []
    dt = 0.05
    gravity = -9.8
    num_frames = 200
    
    print("Running Physics Computation...")
    start_time = time.time()
    
    for f in range(num_frames):
        frame_data = []
        
        # O(N^2) naive collision is too slow for python, we use a simple grid spatial hash
        grid = {}
        for p in particles:
            if p["type"] != MAT_ROCK: # Don't hash rocks to save time, we know they form a ramp
                gx = int(p["x"] // 2)
                gy = int(p["y"] // 2)
                gz = int(p["z"] // 2)
                key = (gx, gy, gz)
                if key not in grid: grid[key] = []
                grid[key].append(p)
                
        for p in particles:
            if not p["fixed"] or p["broken"]:
                # Apply gravity
                p["vy"] += gravity * dt
                
                # Move
                p["x"] += p["vx"] * dt
                p["y"] += p["vy"] * dt
                p["z"] += p["vz"] * dt
                
                # Terrain Collision (Ramp constraint)
                terrain_height = max(0.0, (p["z"] / 100.0) * 30.0)
                if p["y"] < terrain_height:
                    p["y"] = terrain_height
                    # Slide down the slope (negative Z direction)
                    p["vz"] -= 20.0 * dt
                    p["vy"] *= -0.5 # bounce
                    p["vx"] *= 0.9 # friction
                    p["vz"] *= 0.9
                    
                # Fluid-Structure Collision
                # Check neighbors
                gx = int(p["x"] // 2)
                gy = int(p["y"] // 2)
                gz = int(p["z"] // 2)
                
                # Check 27 neighboring cells
                for dx in [-1,0,1]:
                    for dy in [-1,0,1]:
                        for dz in [-1,0,1]:
                            nkey = (gx+dx, gy+dy, gz+dz)
                            if nkey in grid:
                                for neighbor in grid[nkey]:
                                    if neighbor is not p:
                                        dist = ((p["x"]-neighbor["x"])**2 + (p["y"]-neighbor["y"])**2 + (p["z"]-neighbor["z"])**2)**0.5
                                        if dist < 2.0:
                                            # Collision response
                                            overlap = 2.0 - dist
                                            if dist > 0.001:
                                                nx = (p["x"] - neighbor["x"]) / dist
                                                ny = (p["y"] - neighbor["y"]) / dist
                                                nz = (p["z"] - neighbor["z"]) / dist
                                                
                                                # Push apart
                                                push = overlap * 0.5
                                                p["x"] += nx * push
                                                p["y"] += ny * push
                                                p["z"] += nz * push
                                                
                                                # FRACTURE MECHANIC (The Chemistry)
                                                # If water hits a FIXED house particle with high momentum, break the bond
                                                if p["type"] == MAT_WATER and neighbor["type"] == MAT_HOUSE and neighbor["fixed"]:
                                                    impact_force = (p["vx"]**2 + p["vy"]**2 + p["vz"]**2)**0.5
                                                    if impact_force > 5.0: # Bond Strength Threshold
                                                        neighbor["fixed"] = False
                                                        neighbor["broken"] = True
                                                        # Transfer momentum (shatter)
                                                        neighbor["vx"] += p["vx"] * 0.5
                                                        neighbor["vy"] += p["vy"] * 0.5
                                                        neighbor["vz"] += p["vz"] * 0.5
            
            # Save output (Culling logic: don't save static rocks)
            if p["type"] != MAT_ROCK:
                frame_data.append([round(p["x"], 2), round(p["y"], 2), round(p["z"], 2), p["type"]])
                
        frames.append({
            "frame_id": f,
            "particles": frame_data
        })
        if f % 10 == 0:
            print(f"Computed frame {f}/200")
            
    print(f"Physics computed in {time.time() - start_time:.2f} seconds.")
    
    materials = {
        "1": { "name": "Water", "type": "liquid", "color": 0x00aaff },
        "3": { "name": "DEM Terrain", "type": "solid", "color": 0x3d5c3a },
        "4": { "name": "Wood Structure", "type": "solid", "color": 0x8b5a2b }
    }
    
    output_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")
    print(f"Writing to {output_path}...")
    with open(output_path, "w") as f:
        json.dump({"materials": materials, "frames": frames}, f)
        
    print("Done!")

if __name__ == "__main__":
    build_fsi_prototype()
