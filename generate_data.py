import json
import random
import math
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(NIYANTA_ROOT, "data")

def generate_simulation():
    # Materials
    materials = {
        "1": { "name": "Water", "type": "liquid", "color": 0x00aaff },
        "2": { "name": "Concrete (Dam)", "type": "solid", "color": 0x888888 },
        "3": { "name": "Terrain", "type": "solid", "color": 0x3d5c3a }
    }

    frames = []
    
    # Initialize particles
    particles = []
    pid = 0
    
    # Generate Terrain (fixed slope)
    for x in range(0, 50, 2):
        for z in range(0, 50, 2):
            y = max(0, 20 - x * 0.5) + random.uniform(0, 1)
            particles.append({
                "id": pid, "mat": 3, "x": x, "y": y, "z": z, 
                "vx": 0, "vy": 0, "vz": 0, "fixed": True
            })
            pid += 1

    # Generate Dam (Concrete wall)
    for x in range(20, 24, 2):
        for y in range(10, 25, 2):
            for z in range(10, 40, 2):
                particles.append({
                    "id": pid, "mat": 2, "x": x, "y": y, "z": z,
                    "vx": 0, "vy": 0, "vz": 0, "fixed": False
                })
                pid += 1

    # Generate Water (Block falling)
    water_pids = []
    for x in range(2, 15, 2):
        for y in range(30, 45, 2):
            for z in range(15, 35, 2):
                particles.append({
                    "id": pid, "mat": 1, "x": x, "y": y, "z": z,
                    "vx": 2.0, "vy": -2.0, "vz": 0, "fixed": False
                })
                water_pids.append(pid)
                pid += 1

    # Simulate 60 frames
    dt = 0.1
    gravity = -9.8
    for f in range(100):
        frame_data = []
        
        for p in particles:
            if not p["fixed"]:
                if p["mat"] == 1: # Water
                    p["vy"] += gravity * dt
                    p["x"] += p["vx"] * dt
                    p["y"] += p["vy"] * dt
                    p["z"] += p["vz"] * dt
                    
                    # Floor collision (terrain rough approx)
                    terrain_y = max(0, 20 - p["x"] * 0.5)
                    if p["y"] < terrain_y:
                        p["y"] = terrain_y
                        p["vy"] *= -0.3 # Bounce and lose energy
                        p["vx"] += 0.5 # Flow down slope
                        
                    # Wall collision
                    if 20 <= p["x"] <= 24 and p["y"] < 25 and 10 <= p["z"] <= 40:
                        p["vx"] *= -0.5
                        p["x"] = 19.9 # Push back
                        
                elif p["mat"] == 2: # Dam
                    # If frame > 40, dam breaks due to water pressure
                    if f > 40:
                        p["vx"] += random.uniform(0.5, 2.0)
                        p["vy"] += gravity * dt
                        p["x"] += p["vx"] * dt
                        p["y"] += p["vy"] * dt
                        
                        terrain_y = max(0, 20 - p["x"] * 0.5)
                        if p["y"] < terrain_y:
                            p["y"] = terrain_y
                            p["vy"] = 0
                            p["vx"] *= 0.5

            # Save frame data: [X, Y, Z, MatID]
            frame_data.append([round(p["x"], 2), round(p["y"], 2), round(p["z"], 2), p["mat"]])
            
        frames.append({
            "frame_id": f,
            "particles": frame_data
        })

    # Output to JSON
    output = {
        "materials": materials,
        "frames": frames
    }
    
    with open(os.path.join(DATA_DIR, "simulation_data.json"), "w") as f:
        json.dump(output, f)
        
    print(f"Generated {len(frames)} frames with {len(particles)} particles.")

if __name__ == "__main__":
    generate_simulation()
