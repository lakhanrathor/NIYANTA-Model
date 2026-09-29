"""
terrain_utils.py — Single source of truth for Real Copernicus DEM Terrain & Water Body Mask
Loads database/real_terrain_data.json and provides bilinear interpolation for elevation and water mask lookup.
"""
import json, os
import numpy as np

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

DATA_PATH = os.path.join(NIYANTA_ROOT, "database", "real_terrain_data.json")

_heights = None
_water_mask = None
_cols = 51
_rows = 101
_dx = 20.0
_dz = 20.0
_w_m = 1000.0
_l_m = 2000.0

def load_data():
    global _heights, _water_mask, _cols, _rows, _dx, _dz, _w_m, _l_m
    if _heights is not None:
        return
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Real terrain data missing at {DATA_PATH}. Run extract_real_terrain.py first!")

    with open(DATA_PATH) as f:
        data = json.load(f)

    _heights = np.array(data["heights"])        # shape (101, 51) -> [row_z][col_x]
    _water_mask = np.array(data["water_mask"])  # shape (101, 51)
    _cols = data["grid_cols"]
    _rows = data["grid_rows"]
    _dx = data["dx"]
    _dz = data["dz"]
    _w_m = float(data["width_m"])
    _l_m = float(data["length_m"])

load_data()

def get_grid_dimensions():
    load_data()
    return _cols, _rows, _dx, _dz

def get_raw_heights_and_mask():
    load_data()
    return _heights, _water_mask

def terrain_y(x, z):
    """Bilinear elevation lookup for any continuous (x, z) coordinate"""
    load_data()
    # Clamp to grid bounds
    x = max(0.0, min(_w_m, float(x)))
    z = max(0.0, min(_l_m, float(z)))

    c = x / _dx
    r = z / _dz

    c0 = int(c)
    c1 = min(_cols - 1, c0 + 1)
    r0 = int(r)
    r1 = min(_rows - 1, r0 + 1)

    fc = c - c0
    fr = r - r0

    h00 = _heights[r0, c0]
    h01 = _heights[r0, c1]
    h10 = _heights[r1, c0]
    h11 = _heights[r1, c1]

    top = h00 * (1.0 - fc) + h01 * fc
    bot = h10 * (1.0 - fc) + h11 * fc
    return top * (1.0 - fr) + bot * fr

def terrain_y_vec(x_arr, z_arr):
    """Vectorized bilinear elevation lookup for NumPy arrays x_arr and z_arr"""
    load_data()
    x_c = np.clip(x_arr, 0.0, _w_m)
    z_c = np.clip(z_arr, 0.0, _l_m)

    c = x_c / _dx
    r = z_c / _dz

    c0 = np.floor(c).astype(np.int32)
    c1 = np.minimum(_cols - 1, c0 + 1)
    r0 = np.floor(r).astype(np.int32)
    r1 = np.minimum(_rows - 1, r0 + 1)

    fc = c - c0
    fr = r - r0

    h00 = _heights[r0, c0]
    h01 = _heights[r0, c1]
    h10 = _heights[r1, c0]
    h11 = _heights[r1, c1]

    top = h00 * (1.0 - fc) + h01 * fc
    bot = h10 * (1.0 - fc) + h11 * fc
    return top * (1.0 - fr) + bot * fr

def is_water(x, z):
    """Returns True if coordinate (x, z) is classified in Water Body Mask"""
    load_data()
    x = max(0.0, min(_w_m, float(x)))
    z = max(0.0, min(_l_m, float(z)))
    c = int(round(x / _dx))
    r = int(round(z / _dz))
    c = max(0, min(_cols - 1, c))
    r = max(0, min(_rows - 1, r))
    return bool(_water_mask[r, c] > 0)
