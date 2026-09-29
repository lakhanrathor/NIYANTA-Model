import json
import time
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

def compute():
    print("Loading Frame 0...")
    out_path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")
    
    with open(out_path, "r") as f:
        data = json.load(f)
        
    frame_0 = data["frames"][0]["particles"]
    
    water_particles = []
    solid_particles = []
    
    for p in frame_0:
        if p[3] == 1:
            water_particles.append(p)
        else:
            solid_particles.append(p)
            
    print(f"Loaded {len(water_particles)} Water Particles.")
    
    frames = data["frames"]
    
    dt = 0.05
    gravity = -9.8
    total_frames = 200
    
    print(f"Crunching {total_frames} Frames of Physics...")
    
    for f in range(1, total_frames + 1):
        if f % 10 == 0:
            print(f"Computing Frame {f}/{total_frames}...")
            
        new_water = []
        for p in water_particles:
            x, y, z, mat, vx, vy, vz = p
            
            # Gravity
            vy += gravity * dt
            
            # Very Basic Flow Dynamics (pushing towards center of valley and downhill)
            if y < 100:
                vz += 2.0 * dt  # flow downhill (positive Z)
                
                # Push towards center (x=500)
                if x < 500:
                    vx += 1.0 * dt
                elif x > 500:
                    vx += -1.0 * dt
            
            # Apply velocity
            x += vx * dt
            y += vy * dt
            z += vz * dt
            
            # Terrain Collision (V-shape valley logic)
            y_base = 50.0 - (z / 2000.0 * 20.0)
            y_valley = abs(x - 500) * 0.3
            ground_y = y_base + y_valley
            
            if y < ground_y:
                y = ground_y
                vy *= -0.3 # damp bounce
                vx *= 0.9 # friction
                vz *= 0.9
                
            new_water.append([round(x, 2), round(y, 2), round(z, 2), mat, round(vx, 2), round(vy, 2), round(vz, 2)])
            
        water_particles = new_water
        
        # Save frame
        frames.append({
            "frame_id": f,
            "particles": solid_particles + water_particles
        })
        
    print("Writing Physics output...")
    with open(out_path, "w") as f:
        json.dump(data, f)
        
    print("Done! Open the browser and press PLAY.")

if __name__ == "__main__":
    compute()
