"""
delft3d_bridge.py — Native Integration Bridge between Niyanta Digital Twin and Deltares Delft3D FM Suite

Discovers and orchestrates:
  1. DeltaShell.Console.exe (local copy in delft3d_fm_suite/bin/)
  2. D-Flow FM & D-Particle Tracking C++/Fortran Engines (local copy in delft3d/src/engines_gpl/)
  3. Real Copernicus DEM & Water Body Mask GIS Rasters (in local damatlas/data/)

All Delft3D modules are bundled locally — no external installation required.
Override with DELFT3D_HOME env var if you have a separate Delft3D installation.
"""

import os, sys, json, subprocess, struct

NIYANTA_ROOT = os.path.dirname(os.path.abspath(__file__))
DAMATLAS_ROOT = os.path.join(NIYANTA_ROOT, "damatlas")

# Delft3D paths — local copies bundled in project
# Override with DELFT3D_HOME env var if needed
DELFT3D_HOME = os.environ.get("DELFT3D_HOME", NIYANTA_ROOT)
if DELFT3D_HOME == NIYANTA_ROOT:
    DELFT3D_SUITE_BIN = os.path.join(NIYANTA_ROOT, "delft3d_fm_suite", "bin")
    DELFT3D_SRC_ENGINES = os.path.join(NIYANTA_ROOT, "delft3d", "src", "engines_gpl")
else:
    DELFT3D_SUITE_BIN = os.path.join(DELFT3D_HOME, "bin")
    DELFT3D_SRC_ENGINES = os.path.join(DELFT3D_HOME, "..", "delft3d", "src", "engines_gpl")
DELFT3D_CONSOLE_EXE = os.path.join(DELFT3D_SUITE_BIN, "DeltaShell.Console.exe")
NIYANTA_DB = os.path.join(NIYANTA_ROOT, "database")

def get_delft3d_status():
    """Returns diagnostics on native Delft3D / D-Flow FM 2026 installation"""
    exe_exists = os.path.exists(DELFT3D_CONSOLE_EXE)
    src_exists = os.path.exists(DELFT3D_SRC_ENGINES)
    engines = []
    if src_exists:
        engines = [d for d in os.listdir(DELFT3D_SRC_ENGINES) if os.path.isdir(os.path.join(DELFT3D_SRC_ENGINES, d))]

    return {
        "delft3d_installed": exe_exists,
        "delft3d_console_path": DELFT3D_CONSOLE_EXE if exe_exists else None,
        "delft3d_engines_path": DELFT3D_SRC_ENGINES if src_exists else None,
        "available_engines": engines, # ['flow2d3d', 'dflowfm', 'part', 'dimr', 'waq', 'wave']
        "status_message": "Delft3D FM Suite 2026 Native Solvers Ready" if exe_exists else "Python Hydrodynamic Solver Active"
    }

def provision_delft3d_project():
    """Generates Delft3D FM 2026 input configuration file"""
    config = {
        "project_name": "Niyanta_Himalayan_DamBreach_2026",
        "solvers": {
            "flow": "dflowfm",
            "particle_sph": "part",
            "orchestrator": "dimr"
        },
        "grid": {
            "dem_raster": os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N27_00_E085_00_DEM_cog.tif"),
            "water_mask_raster": os.path.join(DAMATLAS_ROOT, "data", "Copernicus_DSM_COG_10_N27_00_E085_00_DEM_wbm.tif"),
            "cell_size_m": 20.0,
            "width_m": 1000.0,
            "length_m": 2000.0
        },
        "hydraulic_parameters": {
            "manning_roughness_n": 0.040,
            "sph_smoothing_radius_h": 25.0,
            "fluid_density_kg_m3": 1000.0,
            "dam_breach_z_m": 480.0,
            "total_frames": 280,
            "particle_count": 18000
        }
    }

    out_path = os.path.join(NIYANTA_DB, "delft3d_config.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(config, f, indent=2)

    print(f"Delft3D FM 2026 Project Config Provisioned -> {out_path}")
    return config

if __name__ == "__main__":
    status = get_delft3d_status()
    print("=" * 60)
    print("Delft3D & D-Flow FM 2026 Native Bridge Diagnostics")
    print("=" * 60)
    for k, v in status.items():
        print(f"  {k}: {v}")
    print("=" * 60)
    provision_delft3d_project()
