import rasterio
import numpy as np
import json
import math
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
DAMATLAS_ROOT = os.path.join(NIYANTA_ROOT, "damatlas")

dem_path = os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N36_00_E073_00_DEM_cog.tif")
output_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")

def process_and_simulate():
    print(f"Reading DEM: {dem_path}")
    with rasterio.open(dem_path) as src:
        # Read a small 200x200 window from the center of the DEM
        width, height = src.width, src.height
        w, h = 100, 100
        x_off, y_off = width // 2 - w // 2, height // 2 - h // 2
        
        window = rasterio.windows.Window(x_off, y_off, w, h)
        elevation = src.read(1, window=window)
        
    # Normalize elevation for 3D visualization (0 to 30 range approx)
    min_el = np.min(elevation)
    max_el = np.max(elevation)
    elevation = (elevation - min_el) / (max_el - min_el + 1e-5) * 30.0
    
    # We will use this elevation grid as our "Terrain Particles" for collision.
    print("Initializing Terrain Particles...")
    particles = []
    pid = 0
    
    # Store terrain heights for fast collision lookup
    terrain_grid = np.zeros((w, h))
    
    for y in range(h):
        for x in range(w):
            z = float(elevation[y, x])
            terrain_grid[x, y] = z
            # We don't need to send 10,000 terrain particles to the frontend every frame,
            # but for the sake of the current frontend particle visualizer, we can.
            # Actually, to save bandwidth, we will just simulate water particles here.
            # The frontend will render the terrain separately if needed.
            # But the user asked for full particle representation.
            # Let's send a subset of terrain particles so it doesn't crash the browser.
            if x % 2 == 0 and y % 2 == 0:
                particles.append({
                    "id": pid, "mat": 3, "x": float(x), "y": float(z), "z": float(y),
                    "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": True
                })
                pid += 1
                
    terrain_particle_count = pid
    
    print("Initializing Water Particles behind 'Dam'...")
    # Spawn a massive block of water particles at (x=20..40, y=50, z=20..40)
    for x in range(20, 40, 2):
        for y in range(30, 50, 2):
            for z in range(20, 40, 2):
                particles.append({
                    "id": pid, "mat": 1, "x": float(x), "y": float(y), "z": float(z),
                    "vx": 0.0, "vy": 0.0, "vz": 0.0, "fixed": False
                })
                pid += 1

    print(f"Total Particles: {len(particles)}")
    
    frames = []
    dt = 0.1
    gravity = -9.8
    damping = 0.8
    friction = 0.9

    # Simulate 150 frames
    print("Running Physics Simulation over DEM...")
    for f in range(150):
        frame_data = []
        for p in particles:
            if not p["fixed"]:
                # Apply gravity
                p["vy"] += gravity * dt
                
                # Move
                p["x"] += p["vx"] * dt
                p["y"] += p["vy"] * dt
                p["z"] += p["vz"] * dt
                
                # Check collision with DEM terrain
                grid_x = int(round(p["x"]))
                grid_z = int(round(p["z"]))
                
                # Keep in bounds
                if 0 <= grid_x < w and 0 <= grid_z < h:
                    ground_y = terrain_grid[grid_x, grid_z]
                    if p["y"] < ground_y:
                        # Collision! Push up and calculate slope vector to slide down
                        p["y"] = ground_y
                        
                        # Very simple normal calculation based on neighbors
                        nx = (terrain_grid[min(w-1, grid_x+1), grid_z] - terrain_grid[max(0, grid_x-1), grid_z]) / 2.0
                        nz = (terrain_grid[grid_x, min(h-1, grid_z+1)] - terrain_grid[grid_x, max(0, grid_z-1)]) / 2.0
                        
                        # Push velocity down the slope
                        p["vx"] -= nx * dt * 50.0
                        p["vz"] -= nz * dt * 50.0
                        p["vy"] *= -damping # Bounce
                        
                        p["vx"] *= friction
                        p["vz"] *= friction
                else:
                    # Out of bounds, let it fall
                    pass
            
            # Save frame data
            frame_data.append([round(p["x"], 2), round(p["y"], 2), round(p["z"], 2), p["mat"]])
            
        frames.append({
            "frame_id": f,
            "particles": frame_data
        })
        if f % 10 == 0:
            print(f"Computed frame {f}")

    materials = {
        "1": { "name": "Water", "type": "liquid", "color": 0x00aaff },
        "2": { "name": "Concrete (Dam)", "type": "solid", "color": 0x888888 },
        "3": { "name": "DEM Terrain", "type": "solid", "color": 0x3d5c3a }
    }
    
    print("Writing JSON...")
    with open(output_path, "w") as f:
        json.dump({"materials": materials, "frames": frames}, f)
    
    print("Done!")

if __name__ == "__main__":
    process_and_simulate()
