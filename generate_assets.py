"""
OBJ Asset Generator for Niyanta Digital Twin
Generates all .obj model files from scratch using pure math.
Each asset is a reusable 3D mesh that will be placed by world_layout.json
"""
import os
import math
import sys

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, NIYANTA_ROOT)
PUBLIC = os.path.join(NIYANTA_ROOT, "frontend", "public")

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def write_obj(path, vertices, faces, name="mesh"):
    """Write a list of vertices and faces to a .obj file"""
    ensure_dir(os.path.dirname(path))
    with open(path, "w") as f:
        f.write(f"# Niyanta Digital Twin Asset: {name}\n")
        for v in vertices:
            f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        f.write(f"g {name}\n")
        for face in faces:
            # OBJ faces are 1-indexed
            f.write("f " + " ".join(str(i+1) for i in face) + "\n")
    print(f"  Written: {path}")

def box_obj(w, h, d):
    """Generate vertices and faces for a box of size w x h x d, centered at origin base"""
    hw, hd = w/2, d/2
    v = [
        [-hw, 0,  -hd], [ hw, 0,  -hd], [ hw, h,  -hd], [-hw, h,  -hd],  # front
        [-hw, 0,   hd], [ hw, 0,   hd], [ hw, h,   hd], [-hw, h,   hd],  # back
    ]
    f = [
        [0,1,2,3], [5,4,7,6],  # front, back
        [4,0,3,7], [1,5,6,2],  # left, right
        [3,2,6,7], [4,5,1,0],  # top, bottom
    ]
    return v, f

# ─── TERRAIN ─────────────────────────────────────────────────────────────────
def gen_terrain_valley():
    print("Generating real terrain_valley.obj from Copernicus DEM...")
    from terrain_utils import get_raw_heights_and_mask, get_grid_dimensions
    heights, wbm = get_raw_heights_and_mask()
    cols, rows, dx, dz = get_grid_dimensions()
    BASE_Y = -60.0  # flat base plane

    verts = []
    faces = []

    # ── TOP SURFACE (elevation grid from real DEM) ───────────────────────────
    top_start = 0
    for row in range(rows):
        for col in range(cols):
            x = col * dx
            z = row * dz
            y = heights[row, col]
            verts.append([x, y, z])

    # Top surface quads
    for row in range(rows - 1):
        for col in range(cols - 1):
            tl = row * cols + col
            tr = tl + 1
            bl = (row + 1) * cols + col
            br = bl + 1
            faces.append([tl, tr, br, bl])

    # ── BOTTOM FLAT BASE PLANE ────────────────────────────────────────────────
    bot_start = len(verts)
    for row in range(rows):
        for col in range(cols):
            x = col * dx
            z = row * dz
            verts.append([x, BASE_Y, z])

    # Bottom face (reverse winding so it faces down)
    for row in range(rows - 1):
        for col in range(cols - 1):
            tl = bot_start + row * cols + col
            tr = tl + 1
            bl = bot_start + (row + 1) * cols + col
            br = bl + 1
            faces.append([tl, bl, br, tr])

    # ── SIDE WALLS ────────────────────────────────────────────────────────────
    # Front edge (row=0)
    for col in range(cols - 1):
        t0 = top_start + 0 * cols + col
        t1 = top_start + 0 * cols + col + 1
        b0 = bot_start + 0 * cols + col
        b1 = bot_start + 0 * cols + col + 1
        faces.append([t0, b0, b1, t1])

    # Back edge (row=rows-1)
    for col in range(cols - 1):
        t0 = top_start + (rows - 1) * cols + col
        t1 = top_start + (rows - 1) * cols + col + 1
        b0 = bot_start + (rows - 1) * cols + col
        b1 = bot_start + (rows - 1) * cols + col + 1
        faces.append([t1, b1, b0, t0])

    # Left edge (col=0)
    for row in range(rows - 1):
        t0 = top_start + row * cols + 0
        t1 = top_start + (row + 1) * cols + 0
        b0 = bot_start + row * cols + 0
        b1 = bot_start + (row + 1) * cols + 0
        faces.append([t1, b1, b0, t0])

    # Right edge (col=cols-1)
    for row in range(rows - 1):
        t0 = top_start + row * cols + (cols - 1)
        t1 = top_start + (row + 1) * cols + (cols - 1)
        b0 = bot_start + row * cols + (cols - 1)
        b1 = bot_start + (row + 1) * cols + (cols - 1)
        faces.append([t0, b0, b1, t1])

    write_obj(
        os.path.join(PUBLIC, "assets/terrain/terrain_valley.obj"),
        verts, faces, "terrain_valley"
    )
    print(f"  Terrain: {len(verts)} verts, {len(faces)} faces (real Copernicus DEM terrain block)")


# ─── STRUCTURES ───────────────────────────────────────────────────────────────
def gen_house_small():
    print("Generating house_small.obj ...")
    v, f = box_obj(20, 10, 20)
    # Add a simple roof (triangular prism on top)
    hw = 10
    roof = [
        [-hw, 10, -hw], [hw, 10, -hw], [hw, 10, hw], [-hw, 10, hw],
        [0, 17, -hw], [0, 17, hw]
    ]
    # extend verts
    base = len(v)
    v = v + roof
    # roof faces
    f = f + [
        [base, base+1, base+4],        # front triangle
        [base+2, base+3, base+5],      # back triangle
        [base+3, base, base+4, base+5],# left slope
        [base+1, base+2, base+5, base+4], # right slope
    ]
    write_obj(os.path.join(PUBLIC, "assets/structures/house_small.obj"), v, f, "house_small")

def gen_house_medium():
    print("Generating house_medium.obj ...")
    v, f = box_obj(30, 14, 25)
    hw = 15
    roof = [
        [-hw, 14, -12.5], [hw, 14, -12.5], [hw, 14, 12.5], [-hw, 14, 12.5],
        [0, 22, -12.5], [0, 22, 12.5]
    ]
    base = len(v)
    v = v + roof
    f = f + [
        [base, base+1, base+4],
        [base+2, base+3, base+5],
        [base+3, base, base+4, base+5],
        [base+1, base+2, base+5, base+4],
    ]
    write_obj(os.path.join(PUBLIC, "assets/structures/house_medium.obj"), v, f, "house_medium")

def gen_shed_farm():
    print("Generating shed_farm.obj ...")
    v, f = box_obj(12, 6, 10)
    write_obj(os.path.join(PUBLIC, "assets/structures/shed_farm.obj"), v, f, "shed_farm")

def gen_hospital():
    print("Generating hospital.obj ...")
    # Main block
    v, f = box_obj(60, 30, 40)
    # Wing left
    wl_v, wl_f = box_obj(20, 20, 15)
    base = len(v)
    wl_v = [[x - 40, y, z - 12.5] for x, y, z in wl_v]
    v = v + wl_v
    f = f + [[i + base for i in face] for face in wl_f]
    # Wing right
    wr_v, wr_f = box_obj(20, 20, 15)
    base2 = len(v)
    wr_v = [[x + 40, y, z - 12.5] for x, y, z in wr_v]
    v = v + wr_v
    f = f + [[i + base2 for i in face] for face in wr_f]
    write_obj(os.path.join(PUBLIC, "assets/structures/hospital.obj"), v, f, "hospital")

def gen_bridge():
    print("Generating bridge_concrete.obj ...")
    # Bridge deck
    v, f = box_obj(120, 3, 15)
    # Left pillar
    lp_v, lp_f = box_obj(5, 18, 5)
    base = len(v)
    lp_v = [[x - 40, y - 18, z] for x, y, z in lp_v]
    v = v + lp_v
    f = f + [[i + base for i in face] for face in lp_f]
    # Right pillar
    rp_v, rp_f = box_obj(5, 18, 5)
    base2 = len(v)
    rp_v = [[x + 40, y - 18, z] for x, y, z in rp_v]
    v = v + rp_v
    f = f + [[i + base2 for i in face] for face in rp_f]
    write_obj(os.path.join(PUBLIC, "assets/structures/bridge_concrete.obj"), v, f, "bridge")

# ─── VEGETATION ───────────────────────────────────────────────────────────────
def gen_tree_pine():
    print("Generating tree_pine.obj ...")
    v = []
    f = []
    # Trunk: narrow box
    trunk_v, trunk_f = box_obj(2, 8, 2)
    v += trunk_v
    f += trunk_f
    # 3 layers of cone-like foliage (wider at bottom, narrower at top)
    foliage_layers = [
        (12, 8,  12),   # bottom foliage
        (9,  13, 9),    # mid foliage
        (6,  18, 6),    # top foliage
    ]
    for (w, base_y, d) in foliage_layers:
        hw, hd = w/2, d/2
        top_y = base_y + 8
        fv = [
            [-hw, base_y, -hd], [hw, base_y, -hd],
            [hw, base_y,  hd],  [-hw, base_y, hd],
            [0,  top_y,   0]   # apex
        ]
        base = len(v)
        v += fv
        # 4 triangular faces for the cone
        f += [
            [base+0, base+1, base+4],
            [base+1, base+2, base+4],
            [base+2, base+3, base+4],
            [base+3, base+0, base+4],
            [base+0, base+3, base+2, base+1],  # bottom quad
        ]
    write_obj(os.path.join(PUBLIC, "assets/vegetation/tree_pine.obj"), v, f, "tree_pine")

# ─── INFRASTRUCTURE ───────────────────────────────────────────────────────────
def gen_road_segment():
    print("Generating road_segment.obj ...")
    v, f = box_obj(12, 1, 50)
    write_obj(os.path.join(PUBLIC, "assets/infrastructure/road_segment.obj"), v, f, "road_segment")

# ─── DAM ──────────────────────────────────────────────────────────────────────
def gen_dam():
    """
    Concrete gravity dam spanning the valley gorge.
    400m wide, 60m tall, 30m thick at base.
    Has a central notch (breach point) where water will burst through.
    """
    print("Generating dam_concrete.obj ...")
    verts = []
    faces = []

    W  = 400   # dam width (spans the river gorge)
    H  = 60    # dam height
    T  = 30    # base thickness (tapers to 10 at top)
    NOTCH_W = 60   # breach notch width
    NOTCH_H = 30   # breach notch height

    def add_box(x0, x1, y0, y1, z0, z1):
        base = len(verts)
        verts.extend([
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],  # front
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],  # back
        ])
        faces.extend([
            [base+0,base+1,base+2,base+3],  # front
            [base+5,base+4,base+7,base+6],  # back
            [base+4,base+0,base+3,base+7],  # left
            [base+1,base+5,base+6,base+2],  # right
            [base+3,base+2,base+6,base+7],  # top
            [base+4,base+5,base+1,base+0],  # bottom
        ])

    hw = W / 2
    hn = NOTCH_W / 2

    # Left section (left of breach notch)
    add_box(-hw, -hn,   0, H,        0, T)
    # Right section (right of breach notch)
    add_box( hn,  hw,   0, H,        0, T)
    # Top section above breach notch (lintel)
    add_box(-hn,  hn,   NOTCH_H, H,  0, T)
    # Stepped base buttress
    add_box(-hw,  hw,  -8,  0,       -10, T+10)

    write_obj(os.path.join(PUBLIC, "assets/structures/dam_concrete.obj"), verts, faces, "dam_concrete")

# ─── VEHICLE TRUCK ────────────────────────────────────────────────────────────
def gen_vehicle_truck():
    """Pickup delivery truck (cab + trailer + wheels)"""
    print("Generating vehicle_truck.obj ...")
    verts = []
    faces = []

    def add_box(x0, x1, y0, y1, z0, z1):
        base = len(verts)
        verts.extend([
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        ])
        faces.extend([
            [base+0,base+1,base+2,base+3], [base+5,base+4,base+7,base+6],
            [base+4,base+0,base+3,base+7], [base+1,base+5,base+6,base+2],
            [base+3,base+2,base+6,base+7], [base+4,base+5,base+1,base+0],
        ])

    # Wheels / Chassis
    add_box(-3.5, 3.5, 0, 1.2, -7, 7)
    # Front Cab
    add_box(-3.2, 3.2, 1.2, 5.0, 1.5, 6.5)
    # Rear Cargo Container / Bed
    add_box(-3.5, 3.5, 1.2, 5.8, -6.8, 1.2)

    write_obj(os.path.join(PUBLIC, "assets/vehicles/vehicle_truck.obj"), verts, faces, "vehicle_truck")

# ─── CARGO CONTAINER ─────────────────────────────────────────────────────────
def gen_cargo_container():
    """Corrugated metallic shipping cargo container"""
    print("Generating cargo_container.obj ...")
    v, f = box_obj(6.0, 5.0, 14.0)
    write_obj(os.path.join(PUBLIC, "assets/structures/cargo_container.obj"), v, f, "cargo_container")

# ─── TIMBER LOGS ─────────────────────────────────────────────────────────────
def gen_timber_logs():
    """Bundle of wooden forestry logs"""
    print("Generating timber_logs.obj ...")
    v, f = box_obj(5.0, 3.0, 12.0)
    write_obj(os.path.join(PUBLIC, "assets/vegetation/timber_logs.obj"), v, f, "timber_logs")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("Niyanta OBJ Asset Generator")
    print("=" * 50)
    gen_terrain_valley()
    gen_house_small()
    gen_house_medium()
    gen_shed_farm()
    gen_hospital()
    gen_bridge()
    gen_tree_pine()
    gen_road_segment()
    gen_dam()
    gen_vehicle_truck()
    gen_cargo_container()
    gen_timber_logs()
    print("=" * 50)
    print("All assets generated! Ready to load in frontend.")

