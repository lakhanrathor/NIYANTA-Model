# NIYANTA: MASTER SYSTEM ARCHITECTURE & FSI ENGINE SPECIFICATION
> **SUPERSEDED (2026-09-25).** This document was an early blueprint for a
> universal particle/DEM/FSI engine that was never built. The implemented
> system is the ScenarioSpec + seven-stage pipeline with the
> fast/sph/delft3d solvers described in [`ARCHITECTURE.md`](ARCHITECTURE.md)
> and specified in [`MODULE_SPEC.md`](MODULE_SPEC.md). Kept for history only —
> do not implement against it.

**Version:** 1.0 (Hyper-Detailed Blueprint)
**Project Core:** Multi-Phase Fluid-Structure Interaction (FSI) & Granular Discrete Element Method (DEM) Engine

---

## 1. Executive Summary & The "God View"
Project Niyanta is an offline-computed, hardware-accelerated physics engine coupled with a lightweight, browser-based tactical visualization dashboard. 

The core philosophy of Niyanta is the **Universal Particle Theory**. In this system, there are no static polygon meshes. Every object in the world—mountains, dams, bridges, houses, water, and air—is represented exclusively by billions of discrete particles. 
The unique physical properties of these objects are defined entirely by their **Chemical Bond Strength** (tensile, compressive, and shear stress tolerances).

This document is the absolute blueprint for any agent or engineer constructing the simulation backend.

---

## 2. The Chemistry of the Universal Particle

### 2.1 The Particle Data Schema
Every single particle in the simulation is tracked via a massive 1D array on the GPU, storing the following state vectors:
*   `ID` (UInt64)
*   `Position [X, Y, Z]` (Float32)
*   `Velocity [Vx, Vy, Vz]` (Float32)
*   `Mass / Density` (Float32)
*   `Material_ID` (UInt8) -> Links to chemical bond properties.
*   `Active_Bonds` (Array of UInt64) -> Tracks IDs of neighboring particles it is chemically bound to.

### 2.2 Material Classification & Bond Thresholds
1.  **Gas (Air/Mist):** 
    *   *Chemistry:* Zero tensile strength. Highly repulsive when compressed.
    *   *Behavior:* Air particles are used to create realistic cavitation and mist when water crashes with high velocity.
2.  **Liquid (Water):**
    *   *Chemistry:* Extremely low tensile strength, high compressive resistance (incompressible). Viscosity is determined by the kernel smoothing function in SPH (Navier-Stokes).
    *   *Behavior:* Particles slide past each other seamlessly. When velocity exceeds a critical threshold, liquid particles can phase-shift into "Mist/Gas" particles.
3.  **Solid (Mountains/Terrain):**
    *   *Chemistry:* `MAX_ROCK_BOND`. Extreme tensile and shear strength.
    *   *Behavior:* These particles are locked in a rigid lattice. However, if extreme hydrostatic pressure or kinetic bombardment from floodwater exceeds their shear threshold, the `Active_Bonds` array is severed. The particle breaks free and becomes a loose "Debris/Boulder" particle.
4.  **Structures (Houses/Concrete/Dams):**
    *   *Chemistry:* `MED_CONCRETE` or `LOW_WOOD`. Medium bond strength.
    *   *Behavior:* Houses are clusters of bonded particles. When the flood wave hits the house, the physics engine calculates the stress tensor. The joints snap, the house shatters into individual debris particles, and is swept away.

---

## 3. End-to-End Pipeline & Directory Structure

The system is strictly decoupled. The massive physics computations occur offline (on a dedicated CUDA GPU), and the results are compressed and streamed to the React frontend.

```text
niyanta/
├── 1_inputs/                 # Raw GIS Data Layer
│   ├── terrain.tif           # High-res Copernicus DEM / QGIS Heightmaps
│   ├── dam_structure.glb     # CAD/Blender models of the Dam
│   └── city_layout.osm       # OpenStreetMap/GML data for house placements
├── 2_voxelization/           # The World Builder (Python)
│   └── world_gen.py          # Converts TIF/GLB into the Universal Particle Lattice
├── 3_simulation/             # The GPU Core
│   ├── physics_engine.cu     # C++/CUDA or Taichi script for Navier-Stokes + DEM
│   ├── config.json           # Simulation parameters (gravity, viscosity, time-step)
│   └── raw_output/           # Multi-gigabyte binary output per frame
├── 4_postprocessing/         # Data Compression (Python)
│   └── compress_to_json.py   # Culls inactive particles, outputs web-safe JSON
└── 5_frontend/               # The React + Three.js Viewer
    ├── public/
    │   ├── simulation_data.json # The compressed cinematic payload
    │   └── heightmap.png     # Visual terrain texture
    └── src/                  # React dashboard and SSFR fluid shaders
```

---

## 4. Module Specifications

### Module A: World Voxelizer (`world_gen.py`)
This script initializes the Universe at Frame 0.
1.  **Terrain Generation:** Reads `terrain.tif` using `rasterio`. Spawns a 3D grid of particles underneath the elevation map. Assigns them `Material_ID: SOLID_ROCK` and bonds them to their neighbors.
2.  **Dam Placement:** Reads `dam_structure.glb` using `trimesh`. Voxelizes the mesh into particles. Places them at the correct GIS coordinates. Assigns `Material_ID: CONCRETE`.
3.  **City/House Generation:** Spawns clusters of particles in the shape of houses in the valley. Assigns `Material_ID: WOOD/BRICK`.
4.  **Water Spawning:** Fills the reservoir area behind the dam with millions of particles. Assigns `Material_ID: LIQUID`.
5.  **Output:** Saves the initial state to a `.h5` (HDF5) or numpy `.npy` binary file for the GPU.

### Module B: The Physics Engine (`physics_engine.cu` or Taichi)
This is the core mathematical solver. It must run on an NVIDIA GPU (e.g., RTX 4060) utilizing CUDA for massive parallelization.

**The Main Loop (executed every $\Delta t = 0.0001$ seconds):**
1.  **Spatial Hashing:** Sort all particles into a grid to find neighbors in $O(n)$ time.
2.  **Fluid Mechanics (SPH):** For all LIQUID particles, compute density, pressure gradients, and viscosity based on the Navier-Stokes equations.
3.  **Solid Mechanics (DEM):** For all SOLID particles, compute the stress tensor. Evaluate the forces applied by surrounding water and debris.
4.  **Fracture Mechanics (The Chemistry):** Check the calculated stress against the chemical bond threshold. If `Applied_Force > Bond_Strength`, delete the bond. The solid structure begins to crumble.
5.  **Integration:** Apply Gravity (-9.81 $m/s^2$). Update Velocity and Position using Symplectic Euler or Velocity Verlet integration.
6.  **Frame Export:** Every 16.6ms of simulated time (60 FPS), write the particle state to the `raw_output/` folder.

### Module C: Data Compressor (`compress_to_json.py`)
A massive simulation creates ~15-50 GB of raw binary data. A web browser cannot load this.
1.  **Culling:** The compressor scans the frames. Any SOLID particle (mountain) that never broke its bonds and never moved is DELETED from the output stream. The frontend already renders the static terrain via `PlaneGeometry`, so we do not need to send static mountain particles over the network.
2.  **Velocity Quantization:** Floating-point coordinates and velocities are rounded to 2 decimal places to save string space in JSON.
3.  **Payload Creation:** Writes `simulation_data.json` containing only the moving water, broken rocks, and shattered house particles.

### Module D: The Visualizer (Frontend)
The React + Three.js application.
1.  **Terrain Mapping:** Uses `heightmap.png` to displace a flat plane into the 3D mountain valley.
2.  **Cinematic Fluid Rendering:** Uses Screen Space Fluid Rendering (SSFR) or Marching Cubes to wrap the water particles in a continuous, reflective, transparent GLSL shader skin.
3.  **Foam/Whitewater Generation:** A shader checks particle velocity. Particles exceeding a speed threshold are rendered as bright white mist/foam using a highly performant `InstancedMesh`.
4.  **Tactical Dashboard:** Reads metadata from the JSON (max depth, total area flooded) and updates the React gauges in real-time as the user scrubs the timeline.

---

## 5. Hardware & Computational Requirements
To run this pipeline effectively:
*   **Prototyping (1-2 Million Particles):** Can be computed locally on the target hardware (AMD Ryzen, 16GB RAM, 200GB Storage, **NVIDIA RTX 4060 8GB**). Simulation time: 2-6 hours.
*   **Production (20-50 Million Particles):** Requires a dedicated workstation (RTX 4090 24GB or A6000, 128GB RAM). Simulation time: 10-24 hours.
*   **Web Viewer:** Because of the aggressive Module C compression, the final visualization runs flawlessly on any standard laptop or iPad at 60 FPS.
