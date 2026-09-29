# NIYANTA — System Design v2.0
### SIH26161 · Dam Break Inundation Modelling Using Hydrodynamic Modelling of any River · NTRO

> **Architecture pattern:** `virat_offline` DAG layering (strict, no cycles) + `hyperatlas` pipeline/job-queue
> + `damatlas` D-Flow FM engine integration. Local-first: no auth, no capability probing, no deployment machinery.
> UI is ours (flood dashboard), backend pattern mirrors these projects.
>
> **Complete per-module contracts (inputs, pipeline algorithms, tables, API, flows): [`MODULE_SPEC.md`](MODULE_SPEC.md)**
> — nothing gets built that is not specified there.
>
> **Canonical research & roadmap: [`SIH26161_ROADMAP.md`](SIH26161_ROADMAP.md)** — PS
> research, decisions log (D1–D8), gaps, phased plan. **Core philosophy** (Watch &
> Trigger + River Context pub/sub): `AGENTS.md` §2. If this doc drifts from those,
> fix this doc first.

---

## 1. Problem Statement Requirement Traceability

| # | PS Requirement (verbatim) | Have today | Need to build |
|---|---|---|---|
| **i** | "Creation of **generalized modelling framework** to predict/simulate dam break / river blockage analysis providing the necessary inputs on the basis of **sudden water surge** as well as **loss and damage analysis** using **SPH model and Delft3D model**" | toy `sph_delft3d_solver.py`, `delft3d_bridge.py` stub, hardcoded Nepal scenario | Generalized AOI framework; validated engines incl. real D-Flow FM; loss/damage analysis; scenario comparison |
| **ii** | "Customized tool/framework … generate a **flood inundation simulation scenario using different input datasets**" | static generators tied to one dataset | Scenario Builder + per-type processing modules + dataset catalog |
| **iii** | "Dashboard for modelling **input and output visualization (GUI)** … support **large volume of data** … output **`.shp` or `.kml`**" | 3D viewport only; 251 MB JSON; zero SHP/KML | FastAPI backend; tiled/COG serving; 2D+3D views; export center |
| **iv** | "Framework for **near real time flood analysis through Google Earth Engine** with open source data" | absent | Scheduled GEE jobs, watch wall, alert engine |
| **v** | "**Any river and Dam data (open source) of India** during final demonstration" | absent (Nepal tile) | Any-river AOI workflow; Hidkal (Karnataka) demo + benchmark |

### PS background → features
- Natural lake/dam (Rishi Ganga 2021, Wapriyang 2021, Phuktal 2015, Kosi 2008) → Case 2 blockage detection + auto scenario
- Water release from major-river dams → Case 1 reservoir criticality
- "dam breaks → how much water, which areas" → shared post-breach engine
- HADR → alert lifecycle + report + export pack
- "automatically carry out simulation" → visible automation chain (GEE → risk → auto scenario → auto run)

### Judging risks → countermeasures
| Risk | Countermeasure |
|---|---|
| unvalidated physics | Hidkal benchmark % error printed on every run (`validate` module) |
| SPH too heavy at catchment scale | tiered engines: SPH near-field, D-Flow FM/SWE routing, `fast_swe` screening |
| DEM resolution in narrow valleys | conditioning (pit-fill, stream burn, dam-local refinement) logged per run |
| no observed flood extent | GEE observed-vs-model IoU (SAR + Otsu, Tiwari et al. 2020) |

---

## 2. Core Architectural Law: Converge after breach

Three cases differ **only up to the breach**. After breach → one pipeline, one output.

```
  CASE 1                CASE 2                 CASE 3
 Dam Criticality      Natural Extreme         Human / Wartime
     │                      │                      │
 reservoir level        change detection        damage report/
 rule curve forecast    lake/glacier diff       imagery CV
 seepage trend          rainfall/seismic        attack profile
     ▼                      ▼                      ▼
  f₁ risk score         f₂ event risk          f₃ damage assess
     │                      │                      │
     └────── risk≥M ────────┴── lake detected ─────┘
                            ▼
              ════════════════════════════
              ║  BREACH / RELEASE EVENT   ║  ← CONVERGENCE POINT
              ║  → ScenarioSpec (canonical)
              ════════════════════════════
                            │
      proc_* → mesh → breach → solvers → post → impact → validate → export → alert
                            │
                    ════════════════════
                    ║  RunResult (same) ║  ← ALL CASES RETURN THIS
                    ═════════════════════
```

One input schema (`ScenarioSpec`), one run pipeline, one output schema (`RunResult`).
Cases 1/2/3 are **scenario producers**. Case 3 edits the spec manually; Cases 1/2 generate it.

---

## 3. Harvest Map — what we take from each existing project

| Project | What it is | What NIYANTA takes |
|---|---|---|
| **`damatlas/`** | Direct predecessor: dam-break workbench, FastAPI+React, PostGIS, D-Flow FM | **`pipeline/simulation/engine_runner.py`** → resolves `run_dimr.bat` (3 layouts), subprocess run, stdout progress parse → becomes `solvers/delft3d_fm/runner.py`. **`api/routes/dm3d.py`** → `*_map.nc` / `*_net.nc` discovery + netCDF4 variable reads (water level, velocity) → becomes `solvers/delft3d_fm/netcdf_reader.py` + `post/`. **`pipeline/ingestion/handlers/*`** (tiff/hdf5/lidar/vector/point/envi/safe + format detect + sidecar) → template for our `proc_*` modules. **`engines/delft3d_fm/2026.01/`** kernel layout (`kernels/x64/{bin,lib,share}`, checksums, licences) → engine packaging doc |
| **`dflowfm_2026/`** | Installed Delft3D FM Suite 2026.01 (Deltares folder + MSI) + full user manuals PDF | The actual engine installation to point `EngineRoot` at; manuals as reference (D-Flow FM User/Technical Reference) |
| **`delft3d/`** | Full Delft3D source (engines_gpl: dflowfm, dimr, d_hydro, flow2d3d…; tools: dfmoutput, dfm_volume_tool, mormerge) | Reference for `.mdu`/`.mdf` inputs; CLI tools `dfmoutput`, `dfm_volume_tool` for result extraction; `dimr` coupling; example `01_dflowfm_sequential` |
| **`hyperatlas/`** | Geospatial processing platform | **`pipeline/jobs/queue.py`** (DB-backed thread-pool JobQueue) → our `jobs` module. **`pipeline/ingestion|processing/mod_*` stage pattern** → our `proc_*` stage files. `mod_config.py` (pydantic settings) → our `config.py`. `core/{tile_service,tile_indexer}` COG/tiling → our tile serving. `database/{db_client.py, schema.sql}` style |
| **`virat_offline/`** | ISR intelligence platform | DAG layering (L0–L5), `modules/<name>/{README,tests}`, thin `routers/`, `app.py` boot + `/api/health` + WS, frontend `lib/api.ts` + `wsClient.ts` + Zustand stores. **Dropped:** capabilities probe, auth/RBAC, deployment machinery |
| **`niyanta/` (current)** | 3D viz prototype | React+Three viewport (`Terrain`, `WaterSurface`, `Whitewater`, `PostProcessing`), `terrain_utils` DEM interpolation, `process_dem` conditioning steps, `sph_delft3d_solver` first-pass SPH/SWE math |

**Dropped deliberately (local-first, not a product for sale):** capability registry, RBAC/auth, packaging/deploy.

---

## 4. Module Inventory — 26 modules in 5 groups

### Group 1 — Foundation (4)
| Module | Job | Main API |
|---|---|---|
| `db` | PostGIS client, `schema.sql`, migrations (hyperatlas `db_client` style) | `execute_query`, `ensure_pool` |
| `storage` | Path resolver: `uploads/ products/ tiles/ exports/ runs/` | `dataset_path`, `product_path` |
| `catalog` | CRUD/search: dataset, scenario, run, product, report | `create_dataset`, `list_runs`, `get_run` |
| `jobs` | Thread-pool queue (hyperatlas `queue.py`): job rows `type/status/progress/params`, workers run stages | `add_job`, `cancel`, `get_status` |

### Group 2 — Ingest & Per-Type Processing (7)
Each module: detect → normalize → write `product` row → continue chain. Stage files follow `mod_*` naming.

| Module | Inputs | Stages |
|---|---|---|
| `proc_dem` | DEM .tif/.img (SRTM/Copernicus/Cartosat) | `mod_detect` → `mod_clip` (AOI) → `mod_condition` (pit-fill, stream burn, resample) → `mod_refine` (dam-local) |
| `proc_imagery` | Sentinel-2, Landsat, optical | `mod_mask` (cloud) → `mod_mosaic` → `mod_indices` (NDWI/NDSI/NDVI) → `mod_diff` (before/after) → `mod_thumbnail` |
| `proc_sar` | Sentinel-1 GRD | `mod_speckle` → `mod_calibrate` → `mod_otsu` (flood mask) → `mod_coherence` (LOS change) |
| `proc_vector` | OSM, SHP, KML, GeoJSON | `mod_parse` → `mod_normalize` (CRS, schema: roads/villages/buildings/bridges) → `mod_index` |
| `proc_dam` | WRIS/registry, dam section CSV, gates | `mod_registry` (geometry) → `mod_rulecurve` → `mod_gates` (spillway/sluice) → reservoir model |
| `proc_weather` | IMD/ERA5 rainfall, inflow series | `mod_qc` → `mod_hydrograph` (design/PMF) → `mod_boundary` (BC builder) |
| `proc_population` | WorldPop/census | `mod_align` to AOI → `mod_zonal` lookup per village |

### Group 3 — Domain / Physics (7)
| Module | Job | Notes |
|---|---|---|
| `mesh` | conditioned DEM → river centerline → cross-sections (1D) + unstructured grid (2D) + dam inline structure | feeds all engines |
| `breach` | 5 empirical equations (Froehlich 08/95, Von Thun, Xu-Zhang, MacDonald), modes piping/overtopping/attack/blockage, ±20% sensitivity, breach outflow hydrograph Q_b(t) | Bharath et al. 2021 Table 6 = fixtures |
| `risk` | f₁ reservoir condition scoring (rule curve, freeboard, seepage trend); f₂ event scoring (change/rain/seismic) | pre-breach only |
| `solvers` | **4 engines, one `run(spec, mesh) -> FrameSeries` API:** `fast_swe` (screening), `delft3d_fm` (production), `sph` (near-field), `hecras` (1D fallback) | see §6 for Delft3D sub-structure |
| `post` | FrameSeries → 4 canonical rasters (depth, velocity, arrival, max-depth) + station hydrographs/stage tables + tile packaging | |
| `impact` | vectorize → zonal population → infra intersect → hazard classes → village ranking with lead time | |
| `validate` | Hidkal benchmark (paper Tables 2–5 → % error on peak Q/arrival/extent), observed-vs-model IoU | `bench/hidkal/` |

### Group 4 — Orchestration (5)
| Module | Job |
|---|---|
| `scenario` | build/validate `ScenarioSpec`; builders `case1` (from risk), `case2` (auto from event), `case3` (manual) |
| `run` | lifecycle DRAFT→DATA_READY→QUEUED→RUNNING→POST_PROCESSING→VALIDATED→PUBLISHED; owns stage order in `stages.py`; drives chain |
| `gee` | watch boxes, scheduled GEE jobs, baselines, change timeline (PS iv) |
| `alert` | rules → alerts NEW→ACK→DISPATCH, district notify queue |
| `export` | SHP/KML/GeoJSON/GeoTIFF/CSV packaging + PDF/HTML HADR report (calls `validate` first) |

### Group 5 — API (2 + boot)
`routers/{datasets,processing,scenarios,runs,watch,alerts,exports,system}.py` (thin) + `app.py` (boot, lifespan starts job workers, `/api/health`, WS for run status/alerts).

---

## 5. Handoff Mechanics — only 3 mechanisms

**1. Fast steps → direct API call** (VIRAT style)
```python
risk.reservoir_condition(levels) -> score
risk → scenario.build_from_risk(score) -> spec
scenario → run.execute(spec) -> run_id
```

**2. Heavy steps → `jobs` queue, chain continues on completion** (hyperatlas style; API never blocks)
```python
run.execute(spec):  jobs.add_job("stage.terrain", {run_id}); return run_id
# worker chain:
stage.terrain  → proc_dem.condition + mesh.build        → set_stage done → jobs.add_job("stage.solve")
stage.solve    → solvers.run(spec, mesh) + post.rasters →                 jobs.add_job("stage.impact")
stage.impact   → impact.build → validate.score → export.package → alert.on_run_complete
                 run.set_status("VALIDATED")
```
Every job writes `progress` + `log` rows → WS streams → UI live stage bar. Stage order lives in **one place**: `run/stages.py`.

**3. Product rows = data contract** (never pass big arrays)
`product(id, kind, path, meta)` in PostGIS + file under `storage/`. Next module reads by product id. Kills the 251 MB JSON problem.

**Scheduled chain (GEE daily):**
```
gee.scheduler → proc_imagery/proc_sar results → risk.score_event
  → (HIGH) scenario.build_from_event → run.execute → …same chain… → alert.raise_alert
```

---

## 6. Delft3D / Solver Module Structure (the engines)

```
modules/solvers/
├── base.py                    run(spec, mesh) -> FrameSeries  (one API for all engines)
├── fast_swe.py                our vectorized shallow-water screening solver (minutes, no deps)
├── sph.py                     near-field SPH breach (evolved from sph_delft3d_solver.py)
├── hecras.py                  1D fallback (HEC-RAS geometry/result IO, if binary present)
└── delft3d_fm/
    ├── engine.py              EngineRoot resolution (damatlas resolve_run_dimr layout logic)
    │                          <root>/plugins/DeltaShell.Dimr/kernels/x64/bin/run_dimr.bat
    │                          <root>/bin/run_dimr.bat  |  root itself
    ├── mdu_writer.py          ScenarioSpec + mesh → .mdu/.mdf, flow input file, dimr_config.xml
    │                          (pattern: delft3d repo example 01_dflowfm_sequential)
    ├── runner.py              subprocess run_dimr.bat in model dir, stdout tail,
    │                          progress % parse, timeout, log persistence  [port damatlas engine_runner]
    ├── netcdf_reader.py       *_map.nc / *_net.nc discovery + netCDF4 reads
    │                          (waterlevel, velocity, discharge per cell/timestep) [port damatlas dm3d]
    └── dfm_tools.py           optional wrappers: dfmoutput, dfm_volume_tool (from delft3d/src/tools_gpl)
```
- Engine binaries live **outside** the repo (point `config.py` `engine_root` at `dflowfm_2026/...` install or
  `damatlas/engines/delft3d_fm/2026.01/kernels`); repo tracks only README + checksums (damatlas convention).
- Community/licence-free mode noted for smoke runs; production licence file under `licenses/` if needed.
- Engine output (`*_map.nc`) → `post` module; comparison across engines happens on `RunResult.metrics`.

---

## 7. Canonical Schemas (only shared contracts in `schemas/`)

**`ScenarioSpec`**
```jsonc
{
  "schema_version": "1.0", "scenario_id": "uuid", "case": "1|2|3",
  "aoi": { "type": "bbox|polygon", "crs": "EPSG:4326", "coords": [] },
  "terrain_ref": "dataset_id",
  "breach": { "mode": "piping|overtopping|attack|blockage_breach",
              "chainage_m": 0, "width_m": 0, "depth_m": 0, "side_slope": 0.7,
              "formation_time_hr": 0,
              "method": "froehlich2008|froehlich1995|vonthun|xuzhang|macdonald|manual",
              "timing": { "start_iso": "", "instantaneous": false } },
  "reservoir": { "initial_level_m": 0, "storage_mcm": 0, "area_km2": 0, "inflow_hydrograph_ref": null },
  "boundary": { "upstream": {}, "downstream": { "type": "normal_depth", "slope": 0.0004 } },
  "engine": "fast|delft3d|sph|hecras",
  "horizon": { "dt_s": 0, "duration_hr": 0 },
  "provenance": { "producer": "scenario", "trigger": "manual|f1|f2|f3", "inputs": [] }
}
```

**`RunResult`**
```jsonc
{
  "schema_version": "1.0", "run_id": "uuid", "scenario_id": "uuid",
  "engine": "...", "solver_version": "...",
  "metrics": { "peak_discharge_cms": 0, "peak_at_hr": 0, "max_depth_m": 0,
               "inundation_km2": 0, "volume_hm3": 0, "mass_balance_error_pct": 0 },
  "rasters": { "depth": "tiles://...", "velocity": "...", "arrival": "...", "max_depth": "..." },
  "stations": [ { "km": 0, "peak_cms": 0, "arrival_hr": 0, "max_stage_m": 0, "max_depth_m": 0 } ],
  "impact": { "population_exposed": 0, "villages_affected": 0,
              "infra": { "roads_km": 0, "bridges": 0, "hospitals": 0 }, "by_village": [] },
  "hazard": { "layer_id": "", "classes": ["high","medium","low"] },
  "exports": { "shp": "", "kml": "", "geojson": "", "geotiff": "", "report": "" },
  "validation": { "benchmark": "hidkal2021|null", "error_peak_pct": 0, "extent_iou": 0 }
}
```

---

## 8. Folder Structure

```
niyanta/
├── docs/SYSTEM_DESIGN.md            ← this file (source of truth)
├── docs/archive/                    ← old ARCHITECTURE.md + GPU particle doc
├── schemas/                         scenario_spec · run_result · dataset
│
├── backend/
│   ├── app.py                       boot + lifespan (start job workers) + /api/health + WS
│   ├── config.py                    pydantic settings: db, paths, engine_root, workers
│   ├── schema.sql                   authoritative DDL
│   ├── routers/                     datasets · processing · scenarios · runs · watch · alerts · exports · system
│   │
│   ├── modules/
│   │   ├── db/                      client.py, seed.py, migrations/
│   │   ├── storage/                 paths.py
│   │   ├── catalog/                 datasets.py, scenarios.py, runs.py, products.py
│   │   ├── jobs/                    queue.py, handlers.py
│   │   │
│   │   ├── proc_dem/                mod_detect.py mod_clip.py mod_condition.py mod_refine.py
│   │   ├── proc_imagery/            mod_mask.py mod_mosaic.py mod_indices.py mod_diff.py mod_thumbnail.py
│   │   ├── proc_sar/                mod_speckle.py mod_calibrate.py mod_otsu.py mod_coherence.py
│   │   ├── proc_vector/             mod_parse.py mod_normalize.py mod_index.py
│   │   ├── proc_dam/                mod_registry.py mod_rulecurve.py mod_gates.py
│   │   ├── proc_weather/            mod_qc.py mod_hydrograph.py mod_boundary.py
│   │   ├── proc_population/         mod_align.py mod_zonal.py
│   │   │
│   │   ├── mesh/                    centerline.py cross_sections.py grid2d.py dam_structure.py
│   │   ├── breach/                  equations.py modes.py sensitivity.py hydrograph.py
│   │   ├── risk/                    reservoir.py (f1), event.py (f2)
│   │   ├── solvers/
│   │   │   ├── base.py  fast_swe.py  sph.py  hecras.py
│   │   │   └── delft3d_fm/          engine.py mdu_writer.py runner.py netcdf_reader.py dfm_tools.py
│   │   ├── post/                    rasters.py stations.py tiles.py
│   │   ├── impact/                  vectorize.py zonal.py infra.py hazard.py
│   │   ├── validate/                hidkal.py observed.py metrics.py
│   │   │
│   │   ├── scenario/                spec.py validate.py builders/{case1,case2,case3}.py
│   │   ├── run/                     lifecycle.py stages.py execute.py
│   │   ├── gee/                     scheduler.py boxes.py baselines.py jobs/ (GEE scripts)
│   │   ├── alert/                   rules.py lifecycle.py notify.py
│   │   └── export/                  gis.py report.py
│   │
│   ├── storage/                     uploads/ products/ tiles/ exports/ runs/
│   └── tests/                       cross-module e2e
│
├── bench/hidkal/                    paper Tables 2–5 fixtures + regression tests
├── data/demo/                       Hidkal DEM, WRIS, OSM extract (PS v)
├── frontend/src/                    lib/{api.ts,wsClient.ts} · store/ · pages/{MissionHub,DamWatch,
│                                    WatchWall,WarRoom,Builder,RunDetail,Compare,Validation,Alerts}
│                                    viewport3d/ (existing Three.js) · map2d/ · charts/ · panels/
└── scripts/                         run_dev.bat, seed_demo.py
```

### Rules
- `schemas/` is the only cross-module contract; otherwise import only **downward** in the DAG.
- L1-style pure units (`breach`, `risk`, `solvers/*`, `post`, `impact`, `validate` internals): no DB, no HTTP — testable offline.
- DB writes only through `db` module; each module owns its tables.
- `routers/` thin: parse → call module API → return.
- Frontend talks only to `/api/*`.
- One `README.md` per module: job, public API, owned tables, calls/called-by.

---

## 9. Build Phases

| Phase | Scope | Unlocks |
|---|---|---|
| **P1** | `schemas/` + `app.py` + `config.py` + `db`/`storage`/`catalog`/`jobs` + `run/lifecycle` + routers skeleton + `/api/health` + WS | contracts + running API |
| **P2** | `proc_dem` + `proc_vector` + `proc_dam` + `mesh` | any-river inputs |
| **P3** | `breach` + `solvers` (fast_swe → delft3d_fm → sph) + `post` + `run` full stage chain | PS (i) core |
| **P4** | `impact` + `export` (SHP/KML/GeoTIFF/PDF) + `validate` (Hidkal) | PS (iii) formats + credibility |
| **P5** | Frontend rewire: api client, WS, Builder, RunDetail (3D+2D+timeline) | PS (iii) GUI |
| **P6** | `risk` + `scenario` builders → Case 1 + Case 3 end-to-end | cases 1/3 |
| **P7** | `gee` + `proc_imagery`/`proc_sar` + `alert` → Case 2 auto-scenario | PS (iv) + case 2 |
| **P8** | `proc_weather`/`proc_population`, Compare/Validation/Report UI, Hidkal Indian demo | PS (v) + judging |

---

## 10. Retirements

| Item | Action | Status |
|---|---|---|
| `docs/ARCHITECTURE.md` "No Backend" | rewrite/supersede | done — rewritten as current-state map (2026-09-25) |
| `docs/niyanta_master_architecture.md` GPU particles | supersede, keep as history | done — banner added; implement against `MODULE_SPEC.md` instead |
| `frontend/public/flood_frames.json` (240 MB) | replace with tiles/COG | noted — not fetched by any code; regenerable intermediate of `run_real_flood.py` that produces the served `.bin` |
| Hardcoded Nepal generators | fold into `proc_dem` + `scenario` AOI flow | backend flow uses spec AOI; legacy generator scripts remain at repo root, unused by the API |
| Direct `public/*.json` reads | replace with `frontend/src/lib/api.ts` | done for catalog/compute/alerts/exports; scene demo assets (`swept_objects.json`, `frames/`) still static by design |
