import json, math, os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

DB  = os.path.join(NIYANTA_ROOT, "database", "world_layout.json")
PUB = os.path.join(NIYANTA_ROOT, "frontend", "public", "world_layout.json")

with open(DB) as f:
    layout = json.load(f)

layout['asset_library']['dam_concrete'] = 'assets/structures/dam_concrete.obj'

W, L = 1000, 2000
def terrain_y(x, z):
    y_base = 50.0 - (z / L * 20.0)
    rc = (W/2) + math.sin(z / 200.0) * 100.0
    dist = abs(x - rc)
    return y_base + (dist**1.5)*0.02 + math.sin(x/30)*math.cos(z/30)*5 + math.sin(x/150)*math.cos(z/150)*30

dam_x, dam_z = 500, 300
dam_y = round(terrain_y(dam_x, dam_z) - 2.0, 2)

dam_obj = {
    'id': 'dam_main_01',
    'asset': 'dam_concrete',
    'position': {'x': dam_x, 'y': dam_y, 'z': dam_z},
    'rotation_y': 0,
    'scale': 1.0,
    'material_id': '4'
}

# Remove existing dam if present, insert fresh
layout['objects'] = [o for o in layout['objects'] if o['id'] != 'dam_main_01']
layout['objects'].insert(0, dam_obj)

with open(DB, 'w') as f:
    json.dump(layout, f, indent=2)
with open(PUB, 'w') as f:
    json.dump(layout, f, indent=2)

total = len(layout['objects'])
print(f'Dam placed at X={dam_x} Y={dam_y} Z={dam_z}')
print(f'Total objects in scene: {total}')
