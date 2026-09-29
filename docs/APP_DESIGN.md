# NIYANTA — App Design v2 (frontend rebuild)

### SIH26161 · NTRO · Dam Break Inundation Modelling of any River
> Contract for the `frontend/app` rebuild + the backend additions that feed it.
> Backend, engines, jobs, tests are unchanged. Only the shell is new.
> **Theme: light.** Every pixel is evidence. The real satellite map is the canvas.
>
> Canonical research/decisions: [`SIH26161_ROADMAP.md`](SIH26161_ROADMAP.md) ·
> core philosophy: `AGENTS.md` §2 (Watch & Trigger + River Context pub/sub) ·
> Compare = **time** comparison (D3).

---

## 0. Decisions (locked)

| Concern | Choice | Why |
|---|---|---|
| 2D map | **MapLibre GL JS** | free, no API key, WebGL raster + vector; v5 supports **globe projection** (satisfies "globe" without Cesium) |
| Raster output on map | **backend-tiled XYZ PNG** (rasterio) | time-series depth/velocity/arrival as 256px tiles; browser never loads a 57MB blob — this *is* deliverable iii ("large volume of data") |
| 3D | **three.js** | existing scene works; rebuild content not engine |
| Water in 3D | **depth raster → displaced, colour-ramped surface mesh** | water = real solver output, not decoration |
| Particles | **GPGPU (`THREE.Points` + ping-pong FBO)** | 18k → 250k–1M @ 60fps; spawn mask from wet cells of the actual run |
| Basemap | **Esri World Imagery** + local Sentinel-2 mosaics (GEE) | free with attribution; local mosaic for 3D texture and offline |
| River path | **OSM Overpass + HydroRIVERS**, DEM trace as fallback | real named-river geometry |
| Dam registry | **GeoDAR + GRanD + CWC/GOODD** → local tables | India/Pak/China coordinates, one-time ingest |
| Charts | **ECharts** | light, fast time series |
| Data layer | **TanStack Query + zustand** | |
| Replace strategy | **new `frontend/app/`, swap at parity** | old 46-test app stays as fallback |
| Theme | light: paper `#fbfbfd` · slate text · ONE accent `#0b6bcb` · 11–13px · tabular monospace numerals with units | officers read light UIs |
| **Compare semantics** | **TIME comparison** (T1 vs T2 flood progression, roads included) — *not* SPH-vs-Delft3D | decision D3, `docs/SIH26161_ROADMAP.md` §6 |
| **System split** | Part 1 Watch & Trigger · Part 2 River Context pub/sub (all pages) | decision D1, roadmap §0 |
| **Evacuation routing** | OSM road network already ingested (`infra_footprint`) — no straight-line shortcuts | decision D5 |

**Terminology** (use these names in code and UI):
- **corridor** — a selected river + its buffered bbox + every asset fetched for it
- **arrival-time isochrone** — concentric time bands of flood arrival (the "circular increasing" colouring)
- **depth ramp** — bathymetric tint of water depth
- **inundation front** — the animated edge of wetting

---

## 1. The core — two systems, one product (governing model)

> Canonical: `docs/SIH26161_ROADMAP.md` §0. If this section and any wireframe
> disagree, this section wins and the wireframe gets fixed.

**Part 1 — Watch & Trigger.** Fixed target areas (watch boxes) are swept daily via
Google Earth Engine; change detection (glacier/ice, water extent, rainfall, natural-dam
blockage, seismic) → risk → alert → **trigger** a precomputed scenario into Part 2.
Always-on means a real-time UX: live feed (WebSocket), sweep-health status, jobs progress.

**Part 2 — River Context (pub/sub spine).** The analyst selects a river; its context
(corridor, DEM, dams, population, OSM, runs) is built once. **Every other page
subscribes and publishes to this context:**
- *Discover* publishes the selection (river + corridor + buffer width)
- *Build* publishes scenario config bound to the context
- *Run / Results / Compare / Player / Evacuation* subscribe to the context and publish
  run outputs back (attributed to the river)
- *Watch* publishes events (box ↔ river linkage)

No page keeps private river state; the frontend holds one context store (zustand +
React context), the API sources are `/rivers/{id}`, `/corridors/{id}`,
`/rivers/{id}/availability`.

### The spine — search a river, get everything

```
[search "Alaknanda"]
  → ① river path (OSM/HydroRIVERS/DEM)      real centerline + bbox + length
  → ② select it → corridor created
  → ③ dams along path (registry ∩ corridor)  list with cached/missing status
  → ④ download missing Copernicus tiles      Range-resume, cached forever
  → ⑤ GEE Sentinel-2 mosaic for corridor     local GeoTIFF (3D texture / 2D fallback)
  → ⑥ OSM + WorldPop clipped to corridor     real buildings/bridges/roads/population
  → ⑦ scenario prefilled (dam, breach, Q)    → run → results → compare → 3D
```

**Caching rule:** every download is per-bbox and persistent. Re-running never re-fetches; only *missing* tiles are requested. The dam registry is local and always complete.

---

## 2. Wireframes

### Shell (all screens)
```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◼ NIYANTA   NTRO │ [🔍 river / dam / scenario…      ]  Discover  Watch      │
│                        Build  Run  Results  Compare  3D  Alerts(●3)        │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                     (content — satellite map is the canvas)                │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ provenance bar: DEM Copernicus-30m N22E077×4 · S2 2026-09-22 cloud 8%      │
│                 river OSM+HydroRIVERS · dam Tapovan · engine Delft3D       │
└────────────────────────────────────────────────────────────────────────────┘
```

### A · Discover (entry point — new)
```
┌───────────────┬────────────────────────────────────────────────────────────┐
│ SEARCH        │                REAL SATELLITE MAP                         │
│ "Alaknanda"   │                                                            │
│ 🌊 Alaknanda  │        ════════════════  river path                        │
│   285 km      │           ▲        ▲        dam icons: ● cached ○ missing  │
│ 🌊 Bhagirathi │                                                            │
│ 🌊 Kosi ◀     │   corridor buffer (dashed)                                 │
│ ── DAMS ──    │                                                            │
│ Nandprayag  ● │   [fit path] [layers ⊞] [globemap ⤢]                       │
│ Tapovan     ● │                                                            │
│ Pala-1      ○ │                                                            │
│ 4/7 cached    │                                                            │
│ [GET MISSING] │                                                            │
│ → 3 tiles 84MB│                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

### B · Watch (landing — deliverable iv)
```
┌──────────────────────────────────────────────────────────────┬─────────────┐
│ India satellite map · dam inventory · watch boxes            │ ALERT FEED  │
│ GEE change markers (red = flagged)                           │ ⚠ Kosi …    │
│ click marker ──────────────────► auto-generated scenario     │ ⚠ Phuktal … │
├──────────────────────────────────────────────────────────────┴─────────────┤
│ CASE 2 — GLACIER & CHANGE TRACKING                                          │
│ box list │ before/after pair │ NDSI glacier trend │ lake-area chart        │
│ delta heatmap │ [auto-generate scenario]                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### C · Build / Inputs (deliverables i + ii)
```
┌──────────────┬──────────────────────────────────────┬──────────────────────┐
│ INPUT LAYERS │  hillshade + contours + path + dam   │ PROVENANCE           │
│ ☑ DEM        │  axis + reservoir + breach window    │ DEM   Copernicus-30m │
│ ☑ Contours   │                                      │       N22E077 ×4     │
│ ☑ River path │  ┌────────────────────────────┐      │       167.8 MB       │
│ ☑ Dam axis   │  │ upstream hydrograph (chart)│      │ IMAG  S2 09-22 8%    │
│ ☑ Reservoir  │  └────────────────────────────┘      │ RIVER OSM+HydroRIVERS│
│ ☑ Breach     │                                      │ DAM   Tapovan 52m    │
│ ☑ Q upstream │                                      │ ─────────────────    │
│ ☑ Villages   │                                      │ erodibility [medium▾]│
│ ☑ Infra      │                                      │ breach   [froehlich▾]│
│ ☑ WorldPop   │                                      │ engine   [Delft3D▾]  │
│ + add dataset│                                      │ [VALIDATE SPEC ✓]    │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

### D · Run (watchable automation)
```
 terrain ── mesh ── breach ── solve ── post ── impact ── validate
   ✓1.2s     ✓0.8s   ✓0.3s    ▓▓▓░ 62%    ·        ·        ·
 ┌────────────────────────────────────────────────────────────┐
 │ live artifacts: mesh preview │ hydrograph solving │ log    │
 └────────────────────────────────────────────────────────────┘
 t=2h14m/6h · 148/240 steps · 432² @ 57.4m · GPU RTX4060
```

### E · Results (2D — deliverable iii)
```
┌────────────┬─────────────────────────────────────────────┬─────────────────┐
│ OUTPUT     │ depth GeoTIFF over satellite imagery        │ INSPECTOR       │
│ ☑ max depth│ legend ▮▮▮▮▮ 0 ──────────── 15 m           │ 📍 30.1245N      │
│ ☑ isochron.│                                             │    79.0123E      │
│ ☑ velocity │ [◀ SWIPE before │ after ▶]                  │ depth   4.31 m   │
│ ☑ extent   │                                             │ vel     2.10 m/s │
│ ☑ villages │ ⏮ ──●────────── t = 2.5 h  ⏩ ×1 ×4 ×16     │ arrival 1.8 hr   │
│ ☑ infra    │                                             │ ─────────────── │
│ [SHP][KML] │                                             │ villages 12 hit │
│ [PDF]      │                                             │ pop     8,412    │
└────────────┴─────────────────────────────────────────────┴─────────────────┘
```

### F · Compare (the TIME comparison — "what changed between T1 and T2")

> Redesigned 2026-09-27 (decision D3, roadmap §6). The page answers: *at T1 nothing /
> this much waterlogging; at T2 this much — what changed in the area, including roads?*
> Engine-vs-engine framing (SPH vs Delft3D) is **removed** from this page.

```
 T1: [◀ 03:00 ▶]  ════●────────  T2: [◀ 07:30 ▶]  [▶ play 0.5× 1× 2× 4×]
 ┌───────────────────────┬───────────────────────┐
 │  MAP @ T1  (frame N)  │  MAP @ T2  (frame M)  │  [◧ Swipe] [⊞ Side] [Δ Diff]
 │  synced pan/zoom · layers: depth · extent ·   │
 │  arrival front · roads (red = cut) · population│
 ├───────────────────────┴───────────────────────┤
 │  Δ PANEL (the point of the page)              │
 │  water area   0.0 km² →  12.6 km²   Δ +12.6   │
 │  by class     low / moderate / high at T1, T2  │
 │  ROADS        0 km cut →  9.4 km cut  (+9.4)  │
 │               newly-cut segments [name ▾ list]│
 │  people       0 → 18,400 newly affected       │
 │  gauges       CH0 0.00→2.41 m  CH5 0.00→1.02 m│
 └───────────────────────────────────────────────┘
```

- Two time cursors on the shared run timeline; presentation modes (Swipe/Side/Diff)
  kept, but both panes are **times of the same run**, not two engines.
- Per-frame road inundation (depth ≥ 0.30 m over `infra_footprint` roads) is computed
  once and cached like `/series` (`GET /runs/{id}/series/roads` or extended series).
- Longitudinal profile (depth along river at T1 vs T2) and arrival-isochrone panel stay.
- Exports: Δ table CSV; newly-cut roads as SHP/KML.

### G · 3D Player (video-player chrome; 3D lives only here)
```
 ┌──────────────────────────────────────────────────────────────┐
 │ real DEM terrain + Sentinel-2 orthophoto texture             │
 │ dam → breach → water SURFACE from depth raster (colour ramp) │
 │ + GPU plume 250k particles                                   │
 │ instanced buildings from OSM footprints, WorldPop density    │
 │                                                              │
 │ ▶ ⏸  ──────●──────────  00:04:32 / 06:00:00   ×1 ×4 ×16      │
 │ [2D│3D] [SPH│Delft3D│Both]  buildings ▓▓▓░ ×0.5–×4 (live)    │
 │ particles 250k · fps 60 · wet cells 41,203                   │
 └──────────────────────────────────────────────────────────────┘
```
The **buildings slider** writes `scenario.spec.scene.overrides` (view state, not a table) → instanced-mesh count updates live. Base counts come from real OSM/WorldPop, never hardcoded.

---

## 3. Backend additions

### 3.1 Schema delta (append to `backend/schema.sql`, idempotent)

```sql
-- ============================================================
-- discover (APP_DESIGN §1): river · corridor · infra_footprint
-- ============================================================
CREATE TABLE IF NOT EXISTS river (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  name_alt        text[] DEFAULT '{}',
  kind            text,                          -- river|stream|tributary
  country         text DEFAULT 'IN',
  state           text,
  osm_id          bigint,
  hydro_rivers_id text,
  path            geometry(LineString, 4326),
  bbox            geometry(Polygon, 4326),
  length_km       double precision,
  drainage_km2    double precision,
  source          text NOT NULL DEFAULT 'osm',   -- osm|hydro_rivers|dem|manual
  prepared_at     timestamptz,
  created         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_river_name ON river using gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_river_gist ON river USING gist (bbox);

CREATE TABLE IF NOT EXISTS corridor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  river_id        uuid NOT NULL,
  buffer_m        int NOT NULL DEFAULT 3000,
  dam_total       int NOT NULL DEFAULT 0,
  dam_cached      int NOT NULL DEFAULT 0,
  dam_missing     int NOT NULL DEFAULT 0,
  bytes           bigint NOT NULL DEFAULT 0,
  imagery_status  text NOT NULL DEFAULT 'idle',   -- idle|fetching|ready|failed
  osm_status      text NOT NULL DEFAULT 'idle',
  pop_status      text NOT NULL DEFAULT 'idle',
  status          text NOT NULL DEFAULT 'draft',  -- draft|preparing|ready|failed
  created         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (river_id)
);

CREATE TABLE IF NOT EXISTS infra_footprint (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  river_id     uuid,
  kind         text NOT NULL,                     -- building|bridge|road|hospital|school|power
  name         text,
  geom         geometry(Geometry, 4326),
  attrs        jsonb NOT NULL DEFAULT '{}',
  model_count  int NOT NULL DEFAULT 1,            -- 3D slider multiplier target
  source       text NOT NULL DEFAULT 'osm',       -- osm|worldpop|manual
  created      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_infra_river ON infra_footprint(river_id, kind);

-- dam extensions (existing columns kept)
ALTER TABLE dam ADD COLUMN IF NOT EXISTS river_id       uuid;
ALTER TABLE dam ADD COLUMN IF NOT EXISTS registry_source text;  -- cwc|goodd|grand|geodar|demo
ALTER TABLE dam ADD COLUMN IF NOT EXISTS purpose         text;
ALTER TABLE dam ADD COLUMN IF NOT EXISTS dem_status      text NOT NULL DEFAULT 'none'; -- none|partial|cached
ALTER TABLE dam ADD COLUMN IF NOT EXISTS imagery_status  text NOT NULL DEFAULT 'none';

-- dataset extensions
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS river_id    uuid;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS dam_id      uuid;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS source_url  text;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS bytes       bigint;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS checksum    text;
ALTER TABLE dataset ADD COLUMN IF NOT EXISTS fetch_status text NOT NULL DEFAULT 'ready'; -- queued|downloading|ready|failed
```
`gin_trgm_ops` requires `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (add beside postgis).

### 3.2 Endpoints (new router `routers/discover.py`, prefix `/api`)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/rivers/search?q=&limit=10` | `[{id?, name, state, length_km, source, bbox, path?}]` — local table first, then Overpass + HydroRIVERS |
| `POST` | `/rivers` | ingest/confirm a candidate → `river` row |
| `POST` | `/rivers/{id}/prepare` | enqueues `river.prepare` job → `{job_id}` |
| `GET` | `/rivers/{id}` | `{river, corridor, dams:[{id,name,location,dem_status,...}]}` |
| `GET` | `/rivers/{id}/dams` | gap analysis: `[{dam, has_dem, tiles, bytes}]` |
| `GET` | `/corridors` | list prepared corridors |
| `POST` | `/datasets/fetch` | `{url, kind, bbox?, river_id?, dam_id?}` → resumable download job |
| `GET` | `/tiles/{run_id}/{kind}/{z}/{x}/{y}.png` | tiled output raster (`kind` ∈ `depth\|velocity\|arrival\|extent`, optional `?frame=`) |
| `GET` | `/runs/{id}/frames.json` | ~2KB: `{count, dt_s, duration_s, kind_index, min, max}` — replaces the 57MB blob |

### 3.3 Job types (register in `modules/jobs`)

| type | does |
|---|---|
| `river.prepare` | corridor row → dam gap analysis → download missing Copernicus tiles → GEE S2 mosaic export → OSM extract → WorldPop clip → `status: ready` |
| `dataset.fetch` | single URL, HTTP Range resume, writes `dataset` row (`fetch_status`) |
| `tile.build` | writes XYZ pyramid for a run's rasters (cached under `storage/tiles/`) |

### 3.4 One-time ingest scripts (`backend/scripts/`)

| script | source | writes |
|---|---|---|
| `ingest_dams.py` | GeoDAR (global) + GRanD (major) + CWC/GOODD (India detail) | `dam` with `registry_source`, `river` FK when name-matched |
| `ingest_rivers.py` | HydroRIVERS (Asia shapefile) + OSM Overpass on demand | `river` with `path`/`bbox` |
| `ingest_osm.py` | Overpass `waterway`/`building`/`highway`/`bridge`/`amenity=hospital` | `river.path`, `infra_footprint`, `vector_feature` |
| `ingest_worldpop.py` | WorldPop GeoTIFF clip per corridor | `dataset(kind=population)` + `village_population` zonal |

All downloads go through the same Range-resume helper as `proc_dem/copernicus._fetch`.

---

## 4. Frontend structure

```
frontend/app/
├─ index.html
├─ package.json              maplibre-gl, echarts, @tanstack/react-query, zustand,
│                            three (3D only), tailwind v4, vite, oxlint, playwright
├─ vite.config.ts            proxy /api → 127.0.0.1:8000 (ws:true)
├─ src/
│  ├─ main.tsx  app.tsx  theme.css        light tokens, no dark mode
│  ├─ lib/
│  │   api.ts               typed fetch wrappers for §3.2 + existing endpoints
│  │   ws.ts                run/alert websocket (reuse existing protocol)
│  │   format.ts            units, tabular numerals, coordinates (DMS + decimal)
│  │   store.ts             zustand: corridor, layers, playback, view mode
│  ├─ map/
│  │   MapCanvas.tsx        MapLibre wrapper, Esri raster, globe toggle
│  │   layers/              hillshade, contours, river path, dam icons,
│  │                        raster-tile layer (depth/velocity/arrival), swipe
│  │   Inspector.tsx        pixel probe → depth/vel/arrival at lon/lat
│  ├─ screens/
│  │   Discover.tsx  Watch.tsx  Build.tsx  Run.tsx
│  │   Results.tsx  Compare.tsx  Player3D.tsx
│  ├─ three/                only imported by Player3D (code-split)
│  │   Scene.tsx  TerrainMesh.tsx  WaterSurface.tsx
│  │   Plume.tsx (GPGPU)    Buildings.tsx (InstancedMesh)
│  └─ components/           Panel, LayerRow, ProvenanceBar, StageChain,
│                            TimeSlider, Legend, SwipeDivider, MetricTable
└─ tests/                    Playwright, rewritten against the new shell
```

**Route map:** `/` Watch · `/discover` · `/corridor/:id` Build · `/run/:id` Run ·
`/results/:id` Results · `/compare/:a/:b` Compare · `/player/:id` 3D.

**Light tokens (start here):**
```css
--bg: #fbfbfd;  --panel: #ffffff;  --line: #e4e7ec;
--text: #1a2029;  --muted: #667085;  --accent: #0b6bcb;
--ok: #12805c;  --warn: #b25e09;  --bad: #b42318;
--mono: ui-monospace, "SF Mono", Menlo, monospace;   /* all measurements */
```
Depth ramp (scientific, fixed): `#eaf3fb → #9ec9ee → #4a9bd8 → #1f6fb2 → #0d4a86 → #5b2a86` (deep = purple, avoids the "neon fake" look).

---

## 5. Non-negotiables (every pixel is evidence)

1. No fabricated numbers. If a value isn't from a run, it isn't shown.
2. Every output carries provenance: engine, DEM tile, imagery date, timestep, benchmark %.
3. Measurements render in monospace with units and real precision (`11.27 m`, `8.0e-06 %`).
4. 2D is the default; 3D only inside the Player.
5. The 57MB frames blob is gone — tiles + `frames.json` only.
6. Deliverable coverage must stay green: generalised framework · SPH+Delft3D ·
   loss & damage · multi-dataset input · GUI + large data · `.shp`/`.kml` ·
   GEE near-real-time · any river of India · **compare** · glacier tracking.
