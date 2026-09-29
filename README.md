# NIYANTA — Tactical 3D Dam-Break Flood Simulation Platform
# SIH26161 — NTRO HADR Mission System

## Quick Start
1. Install Python 3.10+ and Node.js 18+
2. Double-click `start.bat` (auto-detects and runs)
3. OR manually: `cd frontend && npm install && npm run dev`

## Structure
- `frontend/` — React + Three.js 3D dashboard (source + built app)
- `damatlas/data/` — 3 Copernicus DEM tiles for terrain
- `database/` — Config files (Delft3D, world layout)
- `docs/` — Architecture documentation
- `*.py` — Python solver scripts (SPH, Delft3D, terrain gen)
- `requirements.txt` — Python dependencies

## Python Scripts
- `sph_delft3d_solver.py` — SPH + Delft3D hydrodynamic solver
- `delft3d_bridge.py` — Delft3D FM Suite integration (optional)
- `run_flood.py` / `run_real_flood.py` — Flood simulation runners
- `generate_terrain.py` — Terrain mesh generation
- `terrain_utils.py` — Terrain height utilities

## Delft3D (Optional)
Set `DELFT3D_HOME` env var to use native Delft3D solvers.
Without it, the Python solver works standalone.
