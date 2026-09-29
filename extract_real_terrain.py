"""
extract_real_terrain.py — Extracts real Copernicus DEM & Water Body Mask from Nepal Himalayas (N27 E085)
Outputs real_terrain_data.json used by generate_assets.py and run_flood.py
"""
import rasterio
import numpy as np
import json, os
from scipy.ndimage import zoom

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
DAMATLAS_ROOT = os.path.join(NIYANTA_ROOT, "damatlas")

DEM_PATH = os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N27_00_E085_00_DEM_cog.tif")
WBM_PATH = os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N27_00_E085_00_DEM_wbm.tif")
OUT_JSON = os.path.join(NIYANTA_ROOT, "database", "real_terrain_data.json")

def process_real_dem():
    with rasterio.open(DEM_PATH) as d_src, rasterio.open(WBM_PATH) as w_src:
        dem = d_src.read(1)
        wbm = w_src.read(1)

    # Crop 120 x 60 grid (approx 3.6km x 1.8km in real world)
    r0, c0 = 1400, 500
    crop_dem = dem[r0:r0+120, c0:c0+60]
    crop_wbm = wbm[r0:r0+120, c0:c0+60]

    # Normalize elevation: river floor = 25m, peaks = 160m (fits diorama scale nicely)
    min_el = crop_dem.min()
    max_el = crop_dem.max()
    norm_dem = 25.0 + (crop_dem - min_el) / (max_el - min_el) * 135.0

    # Resample to exact 1000m (width) x 2000m (length) grid on 20m resolution -> 51 x 101 points
    # Note: 51 cols = X from 0 to 1000; 101 rows = Z from 0 to 2000
    grid_x = 51
    grid_z = 101

    scale_z = grid_z / norm_dem.shape[0]
    scale_x = grid_x / norm_dem.shape[1]

    grid_dem = zoom(norm_dem, (scale_z, scale_x), order=1)
    grid_wbm = zoom((crop_wbm > 0).astype(float), (scale_z, scale_x), order=0)

    # Save metadata & heightmap
    data = {
        "width_m": 1000,
        "length_m": 2000,
        "grid_cols": grid_x,
        "grid_rows": grid_z,
        "dx": 1000.0 / (grid_x - 1),
        "dz": 2000.0 / (grid_z - 1),
        "min_raw_m": float(min_el),
        "max_raw_m": float(max_el),
        "heights": grid_dem.tolist(),  # [row][col] -> [z_idx][x_idx]
        "water_mask": (grid_wbm > 0.3).astype(int).tolist()
    }

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump(data, f)

    print(f"Successfully processed Copernicus DEM! Saved -> {OUT_JSON}")
    print(f"  Grid: {grid_x} x {grid_z} ({data['dx']:.1f}m x {data['dz']:.1f}m step)")
    print(f"  Height range: {grid_dem.min():.1f}m to {grid_dem.max():.1f}m (Raw: {min_el:.0f}m - {max_el:.0f}m)")
    print(f"  Water channel pixels: {np.sum(grid_wbm > 0.3)}")

if __name__ == "__main__":
    process_real_dem()
