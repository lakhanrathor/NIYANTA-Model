import json
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

def render_frame():
    print("Loading simulation data...")
    path = os.path.join(NIYANTA_ROOT, "frontend", "public", "simulation_data.json")
    with open(path, "r") as f:
        data = json.load(f)
        
    materials = data["materials"]
    
    # Render frame 0 to see the new organic terrain
    frame_idx = 0
    if len(data["frames"]) <= frame_idx:
        frame_idx = 0
        
    frame = data["frames"][frame_idx]
    particles = frame["particles"]
    
    print(f"Rendering Frame {frame_idx} with {len(particles)} particles...")
    
    fig = plt.figure(figsize=(12, 8))
    ax = fig.add_subplot(111, projection='3d')
    
    # We will separate by material for coloring
    mat_x = {1:[], 3:[], 4:[], 5:[]}
    mat_y = {1:[], 3:[], 4:[], 5:[]}
    mat_z = {1:[], 3:[], 4:[], 5:[]}
    
    colors = {
        1: '#00aaff', # Water
        3: '#3d5c3a', # Bedrock
        4: '#999999', # Concrete
        5: '#8b5a2b'  # Wood
    }
    
    for p in particles:
        # p format: [x, y, z, mat_id, vx, vy, vz]
        x, y, z, mat_id = p[0], p[1], p[2], p[3]
        if mat_id in mat_x:
            # Subsample for faster plotting if needed, but 22k is fine for matplotlib
            mat_x[mat_id].append(x)
            mat_y[mat_id].append(y)
            mat_z[mat_id].append(z)
            
    for mat_id in colors.keys():
        if len(mat_x[mat_id]) > 0:
            s = 20 if mat_id == 1 else 10 # Make water dots slightly larger
            ax.scatter(mat_x[mat_id], mat_z[mat_id], mat_y[mat_id], 
                       c=colors[mat_id], s=s, marker='s', alpha=0.8, 
                       label=materials[str(mat_id)]['name'] if str(mat_id) in materials else str(mat_id))
            
    ax.set_xlabel('X (meters)')
    ax.set_ylabel('Z (meters)')
    ax.set_zlabel('Y (Elevation)')
    ax.set_title(f"Niyanta Digital Twin - Actual Data Plot (Frame {frame_idx})")
    
    # Adjust view angle
    ax.view_init(elev=45, azim=-60)
    
    plt.legend()
    
    out_dir = os.path.join(NIYANTA_ROOT, "frontend", "public")
    out_file = os.path.join(out_dir, "actual_system_render.png")
    plt.savefig(out_file, dpi=300, bbox_inches='tight', facecolor='#1e1e1e')
    print(f"Saved render to {out_file}")

if __name__ == "__main__":
    render_frame()
