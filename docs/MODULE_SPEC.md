# NIYANTA — Complete Module Specification v1.0
### Companion to `SYSTEM_DESIGN.md` — every module, every flow, every contract
**Rule: nothing may be built that is not specified here. Changes come into this doc first.**

---

# 0. How to read a module spec

Each module entry has fixed fields:
- **Job** — one sentence
- **Inputs** — where data comes from (upload / connector / GEE / product row / user)
- **Pipeline** — ordered stages with the actual algorithm in each
- **Outputs** — product files + DB rows it writes
- **Tables it owns** / **API endpoints** / **Calls →** / **Called by ←**
- **Errors** — failure behavior

---

# 1. Global contracts

## 1.1 `Product` — the universal handoff row
```sql
product(id uuid PK, kind text, run_id uuid null, dataset_id uuid null,
        scenario_id uuid null, path text, meta jsonb, schema_version text, created timestamptz)
-- kinds: terrain_dem · conditioned_dem · mesh · cross_sections · imagery_index · sar_mask
--        change_map · depth_raster · velocity_raster · arrival_raster · max_depth_raster
--        inundation_vector · impact_table · hazard_layer · export_package · report · validation_score
```
**Modules never pass arrays/results in memory across a job boundary — they write a product row + file, next stage reads by id.**

## 1.2 `Job` — background execution
```sql
job(id uuid PK, type text, status text, progress int default 0, params jsonb,
    result jsonb, log text, run_id uuid null, error text,
    created timestamptz, updated timestamptz)
-- status: queued | running | done | failed | cancelled
```

## 1.3 Stage chain (owned by `run/stages.py`, single source of order)
```
stage.terrain → stage.mesh → stage.solve → stage.post → stage.impact
→ stage.validate → stage.export → [stage.alert]        # alert fires via event, not stage
```
Pre-chain (case-specific, runs before a run exists): ingest/processing/risk/scenario.

## 1.4 `ScenarioSpec` / `RunResult`
Defined in `SYSTEM_DESIGN.md` §7, mirrored as JSON Schemas in `schemas/`. Validated on every scenario create and every run completion.

---

# 2. Full DB table inventory (by module)

| Module | Tables |
|---|---|
| `db` (schema owner) | all DDL in `schema.sql`, sections commented per module |
| `catalog` | `dataset`, `product`, `scenario`, `report` |
| `jobs` | `job` |
| `run` | `run`, `run_lifecycle` |
| `proc_*` | `proc_log` (shared: dataset_id, stage, status, msg, ts) |
| `mesh` | `mesh_meta` (run_id, centerline_path, sections_count, cells_count, dam_structure jsonb) |
| `breach` | `breach_solution` (scenario_id, method, width, depth, slope, t_form_hr, hydrograph_path, sensitivity jsonb) |
| `risk` | `risk_assessment` (case, target_id, score, class, factors jsonb, ts), `trigger_event` |
| `gee` | `watch_box`, `gee_job`, `observation`, `change_detection`, `baseline` |
| `alert` | `alert`, `alert_action`, `subscriber` |
| `export` | `export_job` |
| `validate` | `validation_score` |
| `connector` (in catalog tables for P1 simplicity) | `connector_snapshot` |

---

# 3. Complete API surface (all under `/api`)

### system
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{status, db, workers, queue_depth, engine_root}` |
| WS | `/ws/runs/{run_id}` | streams `{kind: lifecycle|job, ...}` diffs every 500 ms until terminal state |
| WS | `/ws/alerts` | new alerts pushed |

### datasets & processing
| Method | Path | Purpose |
|---|---|---|
| POST | `/datasets` | multipart upload → detect kind → enqueue processing job → dataset row |
| GET | `/datasets?kind=` | list + status |
| GET | `/datasets/{id}` | detail + `proc_log` trail |
| DELETE | `/datasets/{id}` | remove row + files |
| POST | `/datasets/{id}/reprocess` | re-run processing stages |
| POST | `/connectors/{name}/sync` | force connector fetch (wris/osm/worldpop/weather/dem) |
| GET | `/connectors` | last sync + counts |

### watch (GEE)
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/watch/boxes` | CRUD watch boxes (AOI presets) |
| GET | `/watch/boxes/{id}/timeline` | change_detection history → sparkline |
| GET | `/watch/boxes/{id}/beforeafter` | observation pairs for comparison slider |
| POST | `/watch/run` | trigger daily sweep now (also runs on schedule) |
| GET | `/watch/jobs` | gee_job list + status |
| GET | `/watch/changes?flagged=true` | recent flagged changes |

### scenarios
| Method | Path | Purpose |
|---|---|---|
| POST | `/scenarios` | validate `ScenarioSpec` → insert (case 1/2/3) |
| GET | `/scenarios?case=` | list |
| GET | `/scenarios/{id}` | spec + breach_solution + risk link |
| POST | `/scenarios/{id}/sensitivity` | breach ±20% sweep → breach_solution.sensitivity |
| POST | `/scenarios/from-risk/{risk_id}` | case1 builder |
| POST | `/scenarios/from-event/{change_id}` | case2 builder (auto) |

### risk
| Method | Path | Purpose |
|---|---|---|
| POST | `/risk/reservoir` | run f₁ on a dam/series → risk_assessment |
| GET | `/risk?target=` | history |
| GET | `/risk/events` | trigger_event list |

### runs
| Method | Path | Purpose |
|---|---|---|
| POST | `/runs` | scenario_id + engine → run row (DRAFT) |
| POST | `/runs/{id}/execute` | validate preflight → QUEUED → enqueue stage.terrain |
| GET | `/runs/{id}` | run + lifecycle + metrics + products |
| GET | `/runs` | list/filter |
| POST | `/runs/{id}/retry` | FAILED → QUEUED |
| POST | `/runs/{id}/publish` | VALIDATED → PUBLISHED |
| GET | `/runs/{id}/result` | `RunResult` JSON |
| GET | `/runs/{id}/tiles/{layer}/{z}/{x}/{y}.pbf|.mvt` | map tiles for depth/velocity/arrival (or PMTiles manifest) |
| GET | `/runs/{id}/raster/{kind}` | GeoTIFF download (COG) |
| GET | `/runs/{id}/hydrograph?station=` | station hydrograph series (JSON) |
| GET | `/runs/{id}/stations` | station table |

### compare / validate
| Method | Path | Purpose |
|---|---|---|
| GET | `/compare/{a}/{b}` | metrics delta + engine/params diff |
| GET | `/validate/{run_id}` | validation_score detail (benchmark + observed) |
| POST | `/validate/benchmark/{run_id}` | run Hidkal/benchmark check |

### export / report
| Method | Path | Purpose |
|---|---|---|
| POST | `/exports` | `{run_id, formats:[shp,kml,geojson,geotiff,csv,pdf]}` → export_job |
| GET | `/exports/{id}` | status + download URLs |
| GET | `/exports/{id}/download` | ZIP |
| GET | `/reports/{run_id}` | HTML report (print-ready) |

### alerts
| Method | Path | Purpose |
|---|---|---|
| GET | `/alerts?state=` | list |
| POST | `/alerts/{id}/ack` / `/dispatch` | lifecycle transitions |
| GET/POST | `/alerts/rules` | threshold rules CRUD |

---

# 4. Module specifications

═══════════════════════════════════════════════════════════
## GROUP 1 — FOUNDATION
═══════════════════════════════════════════════════════════

### 4.1 `db`
- **Job:** PostGIS access, migrations/seed.
- **API:** `execute_query(sql, params)`, `transaction()`, `ensure_pool()`, `seed(schema.sql)`.
- **Notes:** sync psycopg pool; `seed` idempotent (`CREATE TABLE IF NOT EXISTS`), run once in lifespan. Every module imports `db` — `db` imports nothing from modules.

### 4.2 `storage`
- **Job:** all path decisions.
- **API:** `upload_path(ds, name)`, `product_path(kind, run_id)`, `export_path(run_id, fmt)`, `model_dir(run_id)` (D-Flow FM scratch), `tiles_dir(run_id, layer)`.
- **Layout:** `backend/storage/{uploads,products,tiles,exports,runs}/…`

### 4.3 `catalog`
- **Job:** CRUD/search for `dataset`, `product`, `scenario`, `report`.
- **Pipeline:** validate (JSON Schema) → insert → return id. Soft-delete with file cleanup.
- **API:** routers as in §3. **Called by:** every module (via `catalog.*_create/get/list`).

### 4.4 `jobs`
- **Job:** thread-pool queue (hyperatlas `queue.py` pattern).
- **Pipeline:**
  1. `add_job(type, params, run_id)` → INSERT (queued) → `queue.put`
  2. worker: claim (status=running) → lookup `handlers[type]` → execute with `progress_cb`
  3. handler writes progress via `jobs.progress(id, pct, msg)` → updates row (WS reads)
  4. done → result jsonb / failed → error + log tail (last 60 lines preserved)
  5. cancel via flag checked by progress_cb between steps
- **Tables:** `job`. **Called by:** `run`, `gee`, `export`, `connector sync`, dataset processing.

═══════════════════════════════════════════════════════════
## GROUP 2 — INGEST & PER-TYPE PROCESSING
═══════════════════════════════════════════════════════════
**Common contract for all `proc_*`:** `process(dataset_id, progress_cb) -> product_id`.
All stages log to `proc_log`. All detect format first (extension + magic bytes, hyperatlas `mod_format_detect` style).

### 4.5 `proc_dem`
- **Inputs:** uploaded DEM (GeoTIFF/IMG/ASC; SRTM/Copernicus/Cartosat) OR connector DEM OR **auto-fetch** (default on, `NIYANTA_AUTO_DEM=0` disables).
- **Auto-fetch (`proc_dem/copernicus.py`):** when a scenario has no `terrain_ref` and a bbox AOI, `stage.terrain` resolves the AOI's 1° Copernicus DEM-30m tiles (public S3, ≤16 tiles), streams any missing tiles into the `storage/dem` cache (atomic `.part` rename), mosaics >1 tile, registers the cached file as a ready `dataset(kind=dem)` row, then clips/conditions through the same path as an uploaded DEM. Failure (offline, oversized AOI) falls back to the synthetic valley — terrain acquisition never blocks a run.
- **Pipeline:**
  1. `mod_detect` — format, CRS, resolution, nodata, bbox
  2. `mod_clip` — clip to scenario/AOI bbox (rasterio window), pad 1 cell
  3. `mod_condition` — pit-fill (priority-flood), stream burning (burn known river centerline to banks), fill/smooth, resample to target cell size (default 30 m; configurable 10 m near dam), vertical unit check (m)
  4. `mod_refine` — dam-local refinement window (2–5× finer grid within 2 km of dam, reprojected back to master grid with metadata note)
- **Outputs:** `product(conditioned_dem)`, `proc_log`.
- **Errors:** CRS missing → reject with message; nodata > 40% → reject.

### 4.6 `proc_imagery`
- **Inputs:** uploaded optical (S2/Landsat L2A, .SAFE/.zip/GeoTIFF) OR GEE-exported GeoTIFF pulled by `gee`.
- **Pipeline:** `mod_mask` (cloud/shadow mask, SCL band or QA) → `mod_mosaic` (mosaic multi-tile, cut to AOI) → `mod_indices` (NDWI, NDSI, NDVI, LST if band present) → `mod_diff` (index rasters for date A vs B → difference raster + thresholded change mask) → `mod_thumbnail` (preview PNG for before/after UI).
- **Outputs:** `product(imagery_index)`, `product(change_map)` when paired, thumbnails.

### 4.7 `proc_sar`
- **Inputs:** Sentinel-1 GRD (uploaded or GEE-exported backscatter GeoTIFF).
- **Pipeline:** `mod_speckle` (Lee/Gamma-MAP 5×5) → `mod_calibrate` (σ⁰ dB) → `mod_otsu` (double-Otsu threshold on VV/VH → water mask, Tiwari et al. 2020 method) → `mod_coherence` (if pair: interferometric coherence proxy via local correlation → change mask for damage/terrain).
- **Outputs:** `product(sar_mask)` (observed flood extent), `product(change_map)`.
- **Note:** this mask is `validate.observed`'s ground truth input.

### 4.8 `proc_vector`
- **Inputs:** OSM extract (pbf/xml via osmnx or pyrosm), uploaded SHP/KML/GeoJSON, village boundary files.
- **Pipeline:** `mod_parse` → `mod_normalize` (reproject to EPSG:4326 + project CRS, map to canonical schema: `village(name, pop_ref)`, `road(class, name)`, `building(type)`, `bridge`, `hospital`, `critical facility`) → `mod_index` (GIST spatial index).
- **Outputs:** canonical layers in PostGIS + `product(inundation_vector)` schema reuse.

### 4.9 `proc_dam`
- **Inputs:** WRIS/connector dam record, dam section CSV (chainage-elevation profile), gate/spillway data, rule curve.
- **Pipeline:** `mod_registry` (normalize geometry: dam axis polyline from AOI + section; crest elevation, length, height, type) → `mod_rulecurve` (rule curve + current level + storage-elevation table) → `mod_gates` (spillway capacity, sluice gates, initial gate openings → BC spec).
- **Outputs:** dam record jsonb (linked to scenario), reservoir model (`storage_mcm(level)` interpolation).

### 4.10 `proc_weather`
- **Inputs:** IMD/ERA5 rainfall grids/time-series, historical inflow (WRIS), design flood/PMF hydrograph tables.
- **Pipeline:** `mod_qc` (range checks, gap flags) → `mod_hydrograph` (build inflow hydrograph: observed series | design/PMF shape scaled to catchment) → `mod_boundary` (produce upstream BC file: hydrograph timeseries; downstream normal-depth slope).
- **Outputs:** `product` rows: `bc_upstream`, `bc_downstream` (`.bc` / CSV consumed by solvers).

### 4.11 `proc_population`
- **Inputs:** WorldPop GeoTIFF / census CSV keyed to village polygons (from `proc_vector`).
- **Pipeline:** `mod_align` (reproject/resample population raster to AOI grid) → `mod_zonal` (zonal sum per village polygon → population table).
- **Outputs:** `village_population` table (village_id, count) used by `impact`.

═══════════════════════════════════════════════════════════
## GROUP 3 — DOMAIN / PHYSICS
═══════════════════════════════════════════════════════════

### 4.12 `mesh`
- **Inputs:** `conditioned_dem` product, dam record, optional river centerline (from WRIS/OSM or auto-derived by flow accumulation).
- **Pipeline:**
 1. `centerline.py` — derive thalweg (steepest-descent path from dam downstream) or accept provided line
 2. `cross_sections.py` — cut XS every 100–200 m along centerline (extending 200–500 m banks), station chainage, elevation profile, hydraulic radius/area functions
 3. `grid2d.py` — unstructured triangular mesh (Delft3D FM `*.triang`) over AOI: cell size = DEM cell, refined ×3 near channel/dam; pure-Delaunay + smoothing
 4. `dam_structure.py` — inline structure def: crest elevation, gates, breachable segment, initial storage
- **Outputs:** `product(mesh)` = model dir files + `mesh_meta` row.
- **Used by:** all solvers (1D engines use XS; 2D engines use grid).

### 4.13 `breach`
- **Inputs:** `ScenarioSpec.breach` + dam record + reservoir model.
- **Pipeline:**
  1. `equations.py` — 5 empirical methods, exactly per **HEC-RAS Hydraulic Reference Manual** ("Estimating Breach Parameters" + worked Example Application), fixture-tested against HEC's worked example (V_w=357.98e6 m³, h_b=42.9 m, h_w=44.26 m):
  - Froehlich 1995a: `B = 0.1803·K₀·V^0.32·h_b^0.19` (K₀=1.4 overtopping / 1.0 piping), `t_f = 0.00254·V^0.53·h_b^-0.90` hr, side slope Z=1.4/0.9
  - Froehlich 2008: `B = 0.27·K₀·V^0.32·h_b^0.04` (K₀=1.3/1.0), `t_f = 63.2·sqrt(V/(g·h_b²))` s→hr, Z=1.0/0.7
  - MacDonald & Langridge-Monopolis 1984: `V_er = 0.00348·(V·h_w)^0.852` (clay core/rockfill) or `0.0261·(V·h_w)^0.769` (earthfill), `t_f = 0.0179·V_er^0.364` hr, Z_b=0.5, Wb from State of Washington (1992) trapezoid geometry
  - Von Thun & Gillette 1990: `B = 2.5·h_w + C_b` with C_b by reservoir volume table (6.1/18.3/42.7/54.9 m), `t_f = max(0.02h_w+0.25, B/(4h_w))` resistant or `max(0.015h_w, B/(4h_w+61))` erodible, Z=0.5
  - Xu & Zhang 2009: published dummy-variable regression tables for avg width / top width / formation time by dam type (corewall / concrete-faced / homogeneous) × mode × erodibility; `Z=(B_t−B_avg)/h_b`, `Wb = B_avg − Z·h_b`
  (constants named, source comment, fixture-tested; `manual` method = direct width/depth/time override)
  2. `modes.py` — piping (breach starts at elevation ≈ base, side slope 0.7) vs overtopping (starts at crest, slope 1.0) vs attack (instant/wide per profile) vs blockage_breach (lake volume from `gee` → breach of natural dam)
  3. `hydrograph.py` — breach outflow hydrograph Q_b(t): reservoir routing (level-pool) with breach weir/orifice equation `Q = c·L·h^1.5` (c=1.7 metric) growing linearly B(t), orifice `Q = 0.6·A·sqrt(2gh)` for piping (pipe grows with breach, weir governs once formed), h(t) from constant-area storage balance → outputs hydrograph series (this Q_b(t) becomes D-Flow FM BC / fast_swe source / SPH initial condition)
  4. `sensitivity.py` — ±20% step sweep on width/depth/t_form → table of peak Q (paper's Fig 17 reproduction)
- **Outputs:** `breach_solution` row + hydrograph product.
- **Called by:** `scenario` (build), `run` stage pre-solve, `export` (comparison tables).

### 4.14 `risk` (f₁ / f₂ scorers — pure)
- **f₁ `reservoir.py`:** inputs = level time-series, rule curve, forecast inflow, dam geometry.
 - freeboard deficit = forecast_peak_level − (crest − min_freeboard)
 - storage % of capacity, rule-curve deviation z-score, seepage proxy (level-drop anomaly vs outflow)
 - weighted score → class LOW/MODERATE/HIGH/CRITICAL + factors jsonb
 - **rule:** class ≥ MODERATE → calls `scenario.build_from_risk`
- **f₂ `event.py`:** inputs = `change_detection` rows for box + rainfall anomaly + seismic events + lake area trend.
 - weighted model (configurable weights): lake_area_delta, snow_cover_delta, LST anomaly, coherence change, rainfall return period, seismic proximity
 - → class + factors + `trigger_event` row
 - **rule:** class ≥ HIGH or lake detected → calls `scenario.build_from_event`
- **Tables:** `risk_assessment`, `trigger_event`. **API:** §3 `/risk`.

### 4.15 `solvers` — four engines, ONE API
```python
# solvers/base.py
def run(spec: ScenarioSpec, mesh: MeshRef, progress_cb) -> FrameSeries
# FrameSeries: times[], grid (cells), depth[t,i], vx[t,i], vy[t,i], stations hydrographs
```

**Engine selection:** `spec.engine ∈ {fast, delft3d, sph, hecras}`; `auto` → sph near-field + delft3d routing if available else fast.

#### 4.15.1 `fast_swe` (screening, seconds–minutes, zero external deps)
- Structured grid from conditioned DEM; 2D shallow water, finite volume, HLLC flux, Manning friction (`n` from LULC table), wet/dry limiter.
- Breach source: Q_b(t) injected at breach cells (or reservoir as filled cells released by weir).
- Vectorized numpy; CFL-limited adaptive dt; outputs downsampled frames (config stride).
- **Use:** instant preview, sensitivity sweeps, fallback when engines absent.

#### 4.15.2 `sph` (near-field breach detail)
- WCSPH: Tait EOS `P = B((ρ/ρ0)^7 − 1)`, artificial viscosity, Poly6/Spiky/Visc kernels.
- Particles: reservoir volume sampled on grid above initial water surface; terrain as heightfield collision (not particles) → cheap; optional bonded "dam body" particles that fail at shear threshold to visualize breach growth.
- Spatial hash neighbor search; substeps for stability; GPU optional (cupy) — CPU path mandatory.
- Domain: dam + 1–3 km near-field only; output particles → deposited onto DEM grid → per-frame **depth raster** in same canonical format as other engines (convergence preserved).
- **Use:** breach outflow detail + demo visuals (particle frames also convertible to frontend playback).

#### 4.15.3 `delft3d_fm` (production routing — the flagship)
- **Files:**
 - `engine.py` — resolve `run_dimr.bat` from `config.engine_root` (layouts: `<root>/plugins/DeltaShell.Dimr/kernels/x64/bin/…`, `<root>/bin/…`, or root itself) — ported from damatlas `resolve_run_dimr`; raise "engine not configured" if absent (run falls back per policy).
 - `mdu_writer.py` — build model dir `backend/storage/runs/{run_id}/model/`:
 - `flow2d3d.mdu` — Keyword include: `triangulated.ini` (grid), `structures.ini` (dam/gates), time ref (starting date = spec timing), `Keyword` timestep `dt` (e.g. 1–10 s), output: map every N steps (`rsttype_map`), his stations
 - `bc/` files — upstream inflow hydrograph **and breach Q_b(t)** as time-series discharge BC at breach/river nodes; downstream normal depth (`zs04m`/slope from spec)
 - `dimr_config.xml` — single controller running `dflowfm` (pattern: `01_dflowfm_sequential` from delft3d repo)
 - `runner.py` — ported damatlas `DFlowEngineRunner`: subprocess `run_dimr.bat dimr_config.xml` in model dir, stdout tail 60 lines, `%` progress parse → `jobs.progress`, timeout, non-zero rc → error with log tail.
 - `netcdf_reader.py` — find `output/*_map.nc` (+ `*_net.nc`, `his.nc`); read vars: `waterlevel`, `velocity_x/y` or `water_depth`, `discharge` per cell/time; station series from his.
 - `dfm_tools.py` — optional wrappers for `dfmoutput` / `dfm_volume_tool` (if on PATH from `delft3d` tools) → volume/balance metrics.
- **Breach coupling strategy (documented choice):** breach enters as **imposed Q_b(t) hydrograph BC** (robust, engine-version independent). Alternative `dambreak` structure noted as future upgrade.
- **Outputs:** raw NetCDF in model dir → handed to `post`.

#### 4.15.4 `hecras` (1D fallback, optional)
- Detect HEC-RAS installation; else mark unavailable (health shows engine missing; run refuses or falls back to fast per spec policy).
- Build geometry (XS from `mesh`), unsteady plan with breach as inline structure/BC (per HEC-RAS dam-break practice), run headless, read DSS/HDF results.
- **Use:** cross-engine comparison (`/compare`), benchmark reproduction of Bharath paper numbers.

### 4.16 `post`
- **Inputs:** `FrameSeries` (any engine) or NetCDF path.
- **Pipeline:**
 1. `rasters.py` — canonical rasters per timestep: `depth`, `velocity`; aggregates: `max_depth`, `max_velocity`, `arrival_time` (first t where depth > threshold, default 0.1 m), `inundation_extent` (max_depth > threshold)
 2. `stations.py` — extract hydrograph + stage at configured chainages (0, 5, 10, 15, 20, 22 km style) → peak Q, arrival time, max depth per station (paper Table 3/4 format)
 3. `tiles.py` — GeoTIFF (COG with overviews) → vector tiles (MVT) per layer for web + PMTiles option; small runs may serve plain GeoTIFF + client-side canvas
- **Outputs:** 4 raster products + stations JSON + metrics dict (`peak_discharge_cms`, `peak_at_hr`, `max_depth_m`, `inundation_km2`, `volume_hm3`, `mass_balance_error_pct`).

### 4.17 `impact`
- **Inputs:** `inundation_extent` + `max_depth` rasters, canonical vector layers (`proc_vector`), `village_population` (`proc_population`).
- **Pipeline:**
 1. `vectorize.py` — raster → polygon (gdal_polygonize equivalent), simplify, area calc
 2. `zonal.py` — per village: depth stats (max/mean), area flooded, population exposed (zonal pop ∩ inundation)
 3. `infra.py` — intersect: roads (km flooded per class), bridges (count + status by depth threshold), hospitals/schools/critical (count, depth)
 4. `hazard.py` — per cell/village hazard class from depth × velocity × arrival rules (HIGH: d>2 or v>2; MODERATE: d>0.5; LOW: else) + **lead time = arrival_time per village** (min over polygon)
- **Outputs:** `inundation_vector` product, impact table product, `impact_records` rows, hazard layer product. **Metrics:** `population_exposed`, `villages_affected`, infra counts.

### 4.18 `validate`
- **Inputs:** `RunResult.metrics`, `inundation_vector`, optional `sar_mask` observed, benchmark fixtures.
- **Pipeline:**
 1. `hidkal.py` — if scenario tagged `benchmark:hidkal2021`: compare peak Q (piping 72,085.45 / overtopping 78,454.82 m³/s), arrival times (Table 3), inundation area (75.224 / 79.205 km²), per-station attenuation → % error table
 2. `observed.py` — if observed mask exists: IoU, precision, recall, critical success index
 3. `metrics.py` — assemble `validation_score` row (grade A/B/C by error bands) → written into `RunResult.validation`
- **Outputs:** `validation_score` table + report section.

═══════════════════════════════════════════════════════════
## GROUP 4 — ORCHESTRATION
═══════════════════════════════════════════════════════════

### 4.19 `scenario`
- **Job:** build/validate `ScenarioSpec`.
- **Pipeline:** `spec.py` assemble defaults (BC slope 0.0004, horizon, engine) → `validate.py` JSON-Schema + cross-checks (dam exists, terrain product exists, breach width ≤ dam length) → `builders/case1.py` (from `risk_assessment`: uses current/forecast level as initial_level, mode from risk factors) / `case2.py` (from `change_detection`: lake area→volume→breach seed, blockage_breach mode) / `case3.py` (manual editor payload incl. attack profile) → insert scenario.
- **Called by:** risk, watch automation, routers. **Calls:** `breach` (precompute solution + sensitivity), then `run.execute` if auto.

### 4.20 `run`
- **Job:** lifecycle + stage driving.
- **`lifecycle.py` (pure):** transition table DRAFT→…→PUBLISHED (+FAILED, retry); `next_state(state, event)`.
- **`stages.py`:** ordered stage list + per-stage handler type + preflight requirements per engine (terrain? mesh? bc? engine present?).
- **`execute.py`:**
 1. POST execute → preflight check → run row DRAFT → DATA_READY → QUEUED
 2. `jobs.add_job("stage.terrain", {run_id})`
 3. each stage handler on success: `run_lifecycle` insert (stage done) → enqueue next; last stage → status VALIDATED → `alert.on_run_complete`
 4. any failure → status FAILED + stage + error; retry re-enqueues from failed stage.
 5. **auto-imagery** (default on, `NIYANTA_AUTO_IMAGERY=0` disables): after enqueueing, ensure an active `watch_box` covers the scenario AOI (create `preset="auto"` row if none) and queue one `gee.daily` sweep job — imagery downloads in the background, deduplicated per (box, kind, day); the run never waits on it.
- **Tables:** `run`, `run_lifecycle`. **API:** §3 `/runs`.

### 4.21 `gee` (near-real-time framework — PS iv)
- **Job:** scheduled satellite monitoring + change detection orchestration.
- **Tables:** `watch_box(id, name, bbox, dam_ref, active, schedule_hour)`, `gee_job(id, box_id, script, status, export_paths, started, done, error)`, `observation(id, box_id, date, sensor, kind, product_id)`, `change_detection(id, box_id, metric, value, baseline_value, delta, flagged, ts, product_id)`, `baseline(box_id, metric, value, updated)`.
- **Pipeline (`run_daily` — called by scheduler thread in `app` lifespan + `POST /watch/run`):**
 1. for each active box: enqueue `gee_job(script="s2_indices")`, `("s1_watermask")`, `("lst_snow")`, `("seismic_sync")`
 2. each job: run GEE JS/Py via `earthengine` CLI (service account in `deploy/ee/`), export GeoTIFFs to Drive/Cloud Storage → local pull → register as `dataset` (kind=sentinel) → **calls `proc_imagery`/`proc_sar` to process** → products back
 3. `change_detection` computed by comparing products vs `baseline` (NDWI lake area, NDSI snow, LST anomaly, coherence/water-mask delta) → insert rows, `flagged` if beyond threshold
 4. baseline updated (rolling median window) unless flagged
 5. flagged → **calls `risk.score_event(box)`** → (HIGH) `scenario.build_from_event` → auto `run.execute` → result → `alert.raise`
- **GEE scripts (`modules/gee/jobs/`):**
 - `s2_indices.js` — S2 SR: cloud mask, NDWI/NDSI/NDVI, export index GeoTIFF + date pair
 - `s1_watermask.js` — S1 GRD → Otsu water mask (flood extent) export
 - `lst_snow.js` — LST from Landsat/S2 thermal proxy + snow cover area export
 - `change_pairs.js` — pre/post asset pair for before/after slider + difference mask
 - `flood_extent.js` — validated observed extent for `validate.observed`
- **Fallback (no GEE credentials):** jobs run on uploaded/local rasters through same `change_detection` math; UI shows "GEE: offline mode".
- **Any-river auto coverage:** `run.execute` (§4.20.5) creates an `auto` watch box for a scenario AOI when no active box covers it, so every river run gets the satellite monitoring chain without manual box setup.

### 4.22 `alert`
- **Tables:** `alert(id, kind, severity, run_id, risk_id, change_id, title, body, state, created)`, `alert_action(alert_id, action, ts, note)`, `subscriber` (district contacts, local-only initially).
- **Pipeline:** `rules.py` — rules: risk class ≥ X, run metrics (pop_exposed > N, arrival < T), flagged change → create alert. Triggers: `risk`, `run` complete, `gee` flagged.
- **Lifecycle:** NEW → ACK → DISPATCH (+audit rows). Delivery P1: in-app + WS; optional webhook/mail stub in `notify.py`.
- **Called by:** risk, run, gee. **Calls:** `export.build_report` (attach HADR report to alert).

### 4.23 `export`
- **Job:** packaging + reports (PS iii deliverable).
- **`gis.py`:** given run products →
 - `.shp` (zip with .shp/.shx/.dbf/.prj + cpg) — inundation extent, hazard zones, stations, infra affected (pyshp or geopandas)
 - `.kml`/`.kmz` — placemarks per village with depth/arrival attributes, flood polygon styling (simplekml/fastkml)
 - `.geojson` — same layers
 - `.tif` — COG rasters (depth max, arrival) with CRS
 - `.csv` — station table, village impact table, sensitivity table
 - packaged under `storage/exports/{run_id}/…` → `export_job` row → ZIP
- **`report.py` (`HADRReport`):** HTML template (Jinja2) → print/PDF:
 1. Cover (title, run id, engine, timestamp, AOI map thumbnail)
 2. Scenario parameters (breach table incl. method + sensitivity summary)
 3. Flood metrics KPIs (peak Q, area, depth, volume, mass balance)
 4. Inundation map (static render of layers) + velocity + arrival maps
 5. Station table (paper Table 3/4 style) + hydrograph chart (plotly/matplotlib PNG)
 6. Impact: villages ranked by risk with lead time; infra list; population exposed
 7. Validation: benchmark % error / observed IoU
 8. Export manifest + recommendation bullets
- **Called by:** run (final), alert (attach), routers.

═══════════════════════════════════════════════════════════
## GROUP 5 — API / BOOT
═══════════════════════════════════════════════════════════

### 4.24 `routers/*` — thin: parse → module call → response. No logic.

### 4.25 `app.py`
- `create_app()`: CORS (localhost dev), seed → pool → `JobQueue(workers)` + register handlers → register GEE scheduler thread (if enabled) → mount routers → WS endpoints.
- Lifespan shutdown: drain queue, join workers, close pool.
- `/api/health`: db ping, queue depth, worker count, engine_root resolution, GEE mode (online/offline).

### 4.26 Frontend (`frontend/src/`) — pages → APIs → WS
| Page | Consumes | Purpose |
|---|---|---|
| `MissionHub` | static + `/health` | 3-case entry cards (design slide) |
| `DataHub` | `/datasets`, `/connectors`, `/watch/jobs` | uploads (drag-drop), processing logs, connector sync, GEE job status |
| `WatchWall` (`case2`) | `/watch/boxes`, `/watch/changes`, `/watch/boxes/{id}/timeline`, `/watch/boxes/{id}/beforeafter` | risk chips, sparklines, **before/after slider**, lake trend, auto-run alerts |
| `DamWatch` (`case1`) | `/risk`, `/datasets?kind=dam`, `/risk/reservoir` | level vs rule curve chart, freeboard gauge, risk card, "simulate breach" CTA |
| `WarRoom` (`case3`) | `/scenarios`, `/datasets`, `/runs` | imagery pre/post upload → damage inputs, **breach editor** (click dam, width/depth/time sliders), engine pick, execute |
| `Builder` | `/scenarios`, `/breach/sensitivity` | shared scenario form + method comparison table (5 equations) + sensitivity tornado |
| `RunDetail` | `/runs/{id}` + **WS `/ws/runs/{id}`** + `/tiles/*`, `/hydrograph`, `/stations`, `/compare`, `/validate`, `/exports` | live stage bar; **3D viewport (existing Three.js)**; 2D map layer switch (depth/velocity/arrival/hazard/infra); timeline scrubber; KPI strip; hydrograph chart; impact tables; export center |
| `Compare` | `/compare/{a}/{b}` | engine A vs B / piping vs overtopping / method vs method |
| `Validation` | `/validate/{run}` | benchmark error table, observed-vs-model map |
| `Alerts` | `/alerts`, **WS `/ws/alerts`** | feed, ACK/DISPATCH buttons, district notify |
| `Reports` | `/reports/{run}` | HTML/PDF viewer |

State: Zustand `appStore` (runs, scenarios, alerts) + `mapStore` (layers, camera, timeline). Data access **only** via `lib/api.ts` (bearer-free local) + `lib/wsClient.ts`.

---

# 5. End-to-end data-flow narratives

## Flow A — Case 2 daily automation (the "GEE records it → process → change detected → …" story)
```
07:00 scheduler
 └► gee.run_daily()
     ├► for box in active_watch_boxes:
     │    gee_job(s2_indices) ─► GEE export GeoTIFF ─► pull ─► catalog.dataset
     │        └► proc_imagery.process() ─► product(imagery_index + change_map)
     │    gee_job(s1_watermask) ─► pull ─► proc_sar.process() ─► product(sar_mask)
     │    gee_job(lst_snow) ─► pull ─► product(lst, snow_area)
     ├► change_detection: compare vs baseline → rows (+flagged)
     ├► baseline refresh (if not flagged)
     └► if flagged:
          risk.score_event(box) ─► risk_assessment
           └► class≥HIGH ─► scenario.build_from_event(change_id) ─► ScenarioSpec
                └► run.execute(spec) ─► stages: terrain→mesh→solve→post→impact→validate→export
                     └► alert.raise(rule: auto-sim ready) ─► WS push ─► user opens RunDetail
```

## Flow B — Case 1 reservoir watch
```
connector_sync.fetch_wris_levels (daily/on-demand) ─► reservoir_level rows
 └► risk.reservoir_condition() ─► risk_assessment
      └► ≥MODERATE ─► scenario.build_from_risk ─► (…) same run chain ─► alert
UI: DamWatch level chart + freeboard + risk card + "run breach now" → Builder prefilled
```

## Flow C — Case 3 manual / wartime
```
WarRoom: user uploads pre/post imagery ─► proc_imagery.mod_diff (damage/change map)
 user draws breach (chainage, width, depth, mode=attack, timing)
 └► scenario.create_manual ─► breach.equations/manual override ─► breach_solution
      └► run.execute ─► full chain ─► RunDetail (3D + arrival ribbon + impact)
           └► export pack + report
```

## Flow D — engine internals (stage.solve)
```
stage.solve(run_id):
  spec = catalog.get_scenario; mesh = product(mesh)
  breach.hydrograph(spec) → Q_b(t)
  match spec.engine:
    fast     → fast_swe.run(spec, mesh, cb)
    delft3d  → mdu_writer.build(model_dir, spec, mesh, Q_b)
               runner.run(model_dir) [stdout → job.progress]
               netcdf_reader.read(map.nc) → FrameSeries
    sph      → sph.run(near-field particles) → deposit → FrameSeries
    hecras   → geometry+plan write → run → read → FrameSeries
  post.process(FrameSeries) → 4 rasters + stations + metrics → product rows
  enqueue stage.impact
```

---

# 6. Compare (redesigned — TIME comparison, decision D3)

**Primary page semantics** (`/compare`): compare **two times of the same run** — flood
progression, waterlogging growth, roads cut between T1 and T2 (roadmap §6). Data:
`GET /runs/{id}/series` extended with per-frame `{area, roads_km, roads_cut_ids,
wet_gauges}` (or sibling `GET /runs/{id}/series/roads`), rendered over
`/tiles/{run}/{kind}/{z}/{x}/{y}.png?frame=`. Export: Δ CSV + newly-cut roads SHP/KML.

**Run-vs-run matrix** `GET /compare/{a}/{b}` remains as an API capability for the PS
"compare the scenario" wording: any two runs (engine-vs-engine, piping-vs-overtopping,
method-vs-method) → metrics delta table + extent difference layer + params diff. It is
*not* the framing of the Compare page (D3).

---

# 7. Build phases (now full-scope; each phase ends runnable)

| Phase | Modules delivered (complete specs above) | Demo proof |
|---|---|---|
| **P1** | `db` `storage` `catalog` `jobs` `run(lifecycle/execute)` + routers skeleton + `app` + WS + schemas | run executes with stub stages, WS live |
| **P2** | `proc_dem` `proc_vector` `proc_dam` + connectors (`connector_sync`: wris/osm/worldpop/dem) + `mesh` | upload DEM → conditioned product → mesh |
| **P3** | `breach` + `solvers/fast_swe` + `solvers/delft3d_fm` + `post` | breach hydrograph → real flood rasters (2 engines) |
| **P4** | `solvers/sph` (+`hecras` if present) + `impact` + `validate` + `export` (SHP/KML/GeoTIFF/CSV/PDF) | full chain → export pack + Hidkal benchmark % |
| **P5** | frontend core: `lib/api` `wsClient` stores, DataHub, Builder, RunDetail (3D+2D+timeline) | live dashboard on real run |
| **P6** | `risk` f₁ + `scenario` builders case1/case3 + `proc_weather` | Case 1 & Case 3 end-to-end |
| **P7** | `gee` full + `proc_imagery` `proc_sar` + `alert` + WatchWall + DamWatch + alerts UI | Case 2 automation + PS (iv) |
| **P8** | `proc_population` + `impact` extras, Compare/Validation/Report pages, Hidkal demo (`data/demo/`), polish | judging-ready demo of all 3 cases |

**Every phase updates this spec first if reality diverges.**

---

# 8. Open decisions (defaults chosen; change here before coding)
| Decision | Default |
|---|---|
| DB driver | sync psycopg pool (simple, local) |
| Tiles | GeoTIFF/COG first, MVT when layer sizes demand |
| PDF engine | Jinja2 HTML → Playwright print (already in frontend toolchain) |
| GEE auth | service-account JSON in `deploy/ee/`; graceful offline mode |
| D-Flow FM breach coupling | imposed Q_b(t) hydrograph BC |
| Scheduler | threading scheduler in app lifespan (no celery) |
| Auth | none (local single-user) |
