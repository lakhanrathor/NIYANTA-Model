# NIYANTA UI Specification

Authoritative visual + interaction contract for the frontend. Screens are described
exactly as designed; every value shown must come from a real API response — **no
fabricated numbers**. Empty data renders an honest empty state.

> Governing model: **Watch & Trigger** (Part 1) + **River Context pub/sub** (Part 2) —
> `AGENTS.md` §2. Canonical research/decisions: [`SIH26161_ROADMAP.md`](SIH26161_ROADMAP.md).
> Compare page = **time comparison** (decision D3).

---

## Global chrome (every screen)

**Top bar** — logo `≋ NIYANTA` / `Dam Break Inundation Platform` · nav: **Watch · Discover · Build · Run · Results · Compare · Player** (active = blue underline + blue icon) · global search `Search rivers, dams, places...` · help `?` · avatar `AK`.

**Bottom status bar** — `Data Sources` label, then a two-line chip per source: name over
`● {Online|Local}`, dot green for both (`Esri World Imagery` · `Sentinel-2 (GEE)` ·
`DEM (Copernicus 30m)` · `HydroRIVERS` · `GeoDAR/GRanD/CWC` · `OSM / WorldPop`); amber
dot = Offline, hollow dot = Unknown. Amber `Source offline — GET /api/system` only when
the endpoint itself fails.
Right side: `Map: {region} (EPSG:4326)` · `Cursor: {lat}° N, {lon}° E` · `Zoom: {z}` · `● Last Updated: {ts}`.

**Map shell (shared)** — 2D/3D segmented toggle top-left · floating search box · right rail buttons (zoom in, zoom out, locate, layers) · legend card bottom-left · minimap bottom-right with label + expand icon · scale bar bottom-centre.

**Theme** — light. `--bg #fbfbfd`, panel `#fff`, line `#e4e7ec`, text `#1a2029`, muted `#667085`, accent `#0b6bcb`, ok `#12805c`, warn `#b25e09`, bad `#b42318`. Monospace numerals with units.

---

## 1 · Watch (`/`)

**Left column**
- **Pan India Overview** card — subtitle `Dams • Rivers • Watch Boxes • Recent Changes`; 4 stat cells: `Dams (India)` · `Watch Boxes` · `Active Alerts` (red when >0) · `Rivers Indexed` (em-dash when no index).
- **Layers** card, `Manage` link, tabs `Base Layers` / `Overlays`; checkbox rows with swatch thumbnails: `Esri World Imagery`, `Sentinel-2 (Local)`, `Rivers (HydroRIVERS)`, `Dams (GeoDAR/GRanD/CWC)`, `State Boundary`, `Watch Boxes`.
- **Recent Alerts** card, `View All`; rows = coloured dot + **bold title** + location line + relative time (`2h ago`). Categories → dot colour: glacier_change red, reservoir_anomaly amber, blockage amber, high_rainfall blue, glacier_lake blue.

**Right column**
- **Glacier & Change Detection (Case 2)** — chevron to detail; tabs `Recent Changes` / `Glacier Trend` / `Before / After`. Card = image with drawn polygon outline, headline (`Expansion detected`), badge `+18.4%` (green), name + state line, provenance line `Sentinel-2 · 12 Aug 2024 vs 12 Aug 2023`, carousel dots.
- **Key Statistics (Live)** — left cells `Total Dams (DB)` / `Watch Boxes` / `Active Alerts` / `Rivers Indexed`; right sub-list `Recent GEE Detections (7d)` → `Water Extent Changes` · `Glacier Changes` · `High Rainfall Events` · `Potential Blockages`.
- **Featured Rivers**, `View All` — rows: thumbnail, **name**, `{length} km · {n} major dams`, chevron.

**Map** — India extent; markers: dams (red circle), rivers (blue line), watch boxes (magenta dashed rectangle), alert points.

---

## 2 · Discover (`/discover`)

**Left column**
- **Discover Rivers** header + `Search any river, explore its path, dams and prepare data for simulation.`
- Tabs: `Search` · `By State` · `By Basin` · `Upload`.
- Search input + blue search button.
- **Search Results** with `{n} results` count. Row = river icon, **name**, `{length} km · {basin} Basin · {n} major dams`, chevron. Selected row = blue border + light blue fill. `Show more results` link.
- **Quick Filters**, `Clear All`: `Basin` select · `State` select · `River Length` slider `{0} – {3,000} km` · toggles `Show Dams` / `Show Watch Boxes` / `Show State Boundary`.

**Right column**
- **River Information**, `View on Map` — river icon + **large name**; grid: `Total Length` · `Basin` · `Major Dams` / `States` · `Source` · `Mouth`.
- **Dams Along This River ({n})**, `View All` — table `# | Dam Name | State | Status | Distance from Source`; Status = green `In DB` / amber `Missing`.
- **Data Availability (Along Corridor)** — donut showing `Coverage %` labelled `Coverage (DEM + Imagery)`; legend rows with dots: `DEM (30m)` · `Sentinel-2 Imagery` · `OSM Infrastructure` · `WorldPop (Population)` · `Dam Registry`, each `{pct}%`.
- **Next Steps** — 4 numbered chips: `Prepare River Corridor` · `Fetch Missing Data` · `Review & Select Dams` · `Create Scenario`. Buttons: primary `Prepare Corridor for {river}` + secondary `View Data Gaps`.

**Map** — river path (blue), corridor polygon (translucent blue), major dam (red dot), other dam (amber dot), watch box (magenta), state boundary. Legend matches.

---

## 3 · Build (`/build`)

**Left column**
- **Build Scenario** + `Configure inputs, select dam, set breach parameters and prepare data for simulation.`
- Numbered stepper, active = blue: `1 Area & Data` (`DEM, Imagery, River, Dams`) · `2 Dam & Reservoir` (`Select dam and configure`) · `3 Breach Parameters` (`Define breach scenario`) · `4 Infrastructure & Population` (`OSM, WorldPop, Key assets`) · `5 Review & Prepare` (`Check data and start pipeline`).
- **Data Layers**, `Manage` — checkboxes: `Esri World Imagery` · `Sentinel-2 (Local)` · `DEM (Copernicus 30m)` · `River Path (HydroRIVERS)` · `Dams (GeoDAR/GRanD/CWC)` · `Reservoir (Selected)` · `OSM Infrastructure` · `WorldPop (Population)` · `State Boundary` · `District Boundary`.

**Map** — search `Tehri Dam, Bhagirathi (Ganga)` · buttons `2D/3D` `Fit to Area` `Measure`. Legend: `River Path (HydroRIVERS)` · `Selected Dam` · `Reservoir Extent` · `River Corridor (20 km)` · `Dams (Along River)` · `Watch Boxes` · `State Boundary`.

**Right column**
- **Selected Dam**, `View on Map` — photo, **name**, `{state}, India`, `{lat}° N, {lon}° E`; rows `River` · `State` · `Dam Type` · `Height` · `Length` · `Reservoir Capacity` · `Status` (green dot `In DB (CWC)`) · `Source`.
- **Reservoir & Breach Parameters**, `Edit` — inputs `Reservoir Level {n} m (amsl)` · `Breach Width {n} m` · `Breach Depth {n} m` · `Breach Formation Time {n} hours` · `Breach Shape` select (`Trapezoidal`/`Rectangular`/`Parabolic`); plus a breach cross-section diagram with `Breach Width ↔` / `Breach Depth ↓` callouts.
- **Input Data Status (Along {n} km Corridor)**, `Fetch Missing` — table `Dataset | Source | Coverage | Status | Size`; status = green `Available` / amber `Partial` / red `Missing (n)`.
- **Missing Items** red badge `{n}` + `{n} dams, {n} DEM tiles` + button `Download Missing Data`.

---

## 4 · Run (`/run/:id`)

**Left column**
- **Current Scenario** + `← Back to Build` — photo, **name**, `{state}, India`, coords; rows `Dam Type` · `Reservoir Level` · `Breach Width` · `Breach Depth` · `Simulation Length` · `Model Engine` (+ engine swap icon).
- **Simulation Pipeline** — 7 rows with connecting rail: `Terrain Preparation` (`DEM, river, domain, roughness`) · `Mesh Generation` (`Creating computational mesh...`) · `Breach Modelling` (`Generating breach hydrograph`) · `Hydrodynamic Solver` (`Running {engine} simulation`) · `Post-processing` (`Computing flood metrics`) · `Impact Analysis` (`Population, infrastructure, loss`) · `Validation & Export` (`Preparing outputs`). Status: green ✓ done · blue numbered active · grey pending.

**Map** — legend: `Reservoir Extent` · `River Path (HydroRIVERS)` · `Selected Dam` · `Simulation Domain` · `Downstream Corridor (20 km)` · `Watch Boxes` · `State Boundary`.

**Below map**
- **Stage Details** — stage title, description paragraph, rows `Target Resolution` · `Domain Size` · `Expected Cells` · `Method`.
- **Intermediate Outputs** — 4 tiles, each image + name + status chip: green ✓ `Loaded`/`Generated`, blue spinner `Generating…`/`Processing…`.

**Right column**
- **Simulation Progress** — status pill (`Running` green), `Elapsed: hh:mm:ss`, `ETA: hh:mm:ss`, `{stage}/7`; progress bar; active-stage card with gear icon, `{n}%`, sub-message.
- **Live Metrics**, `View Logs` — grid `Mesh Cells` · `Domain Area` · `Time Step (Δt)` / `Current Sim Time` · `Iterations` · `CPU / GPU`.
- **Stage Outputs (Live Preview)** — tabs `DEM & Terrain` · `Mesh` · `Breach Hydrograph` · `Water Surface`; rendered raster + colour bar with `Elevation (m)` and numeric stops.
- **Console / Logs**, `Auto-scroll` toggle — monospace timestamped lines `[hh:mm:ss] message`.

---

## 5 · Results (`/results/:id`)

**Left column**
- **Scenario Details** — photo, **name**, `{state}, India`, green badge `Simulation Completed`; rows `Model Engine` · `Breach Width` · `Breach Depth` · `Reservoir Level` · `Simulation Time` · `Run ID`.
- **Result Layers**, tabs `Inundation` / `Hazard` / `Infrastructure` — checkbox rows: `Water Depth (max)` ✓ · `Arrival Time (Isochrones)` ✓ · `Inundation Extent` ✓ · `Velocity (vector)` ☐ · `Water Surface (time)` ☐ · `Inundation Front (animated)` ✓ · `Affected Area (polygon)` ☐.
- **Time Control** — transport buttons, `{hh:mm:ss} / {hh:mm:ss}`, scrubber, `Playback Speed` segmented `0.5x 1x 2x 4x 8x`.

**Map** — layer selector `Water Depth (m)` + stepped colour ramp with stops `0 0.5 1 2 5 10 20+`; `Layers` · `Measure` · fullscreen buttons.

**Below map** — **Simulation Timeline (Water Depth)** filmstrip: thumbnails labelled `0h 00m`, `1h 00m`, `3h 00m`, `6h 00m`, `12h 00m`, `18h 00m`, `24h 00m`; selected = blue border; left/right chevrons.

**Right column**
- **Point Inspector**, `✕` — coords line; rows `Water Depth` · `Arrival Time` · `Max Velocity` · `Inundation Status` (red pill `Inundated`) · `Elevation (DEM)`.
- **Key Statistics (Current View)** — icon cards: `Inundated Area` · `Affected Population` · `Affected Villages` · `Major Roads (km)` · `Bridges` · `Critical Facilities`.
- **Breach Hydrograph** — line chart, series `Outflow Q (this run)` solid blue, `Current Time` dashed red vertical cursor; axes `Discharge (m³/s)` × `Time (hours)`. (No engine overlay — engine framing lives only in the run-vs-run API, decision D3.)
- **Export Results** — rows `Download GeoTIFF` (`Depth, Velocity, Arrival Time`) · `Export SHP` (`Inundation Extent, Affected Areas`) · `Export KML` (`Google Earth (Time Enabled)`), each with icon + chevron.

---

## 6 · Compare (`/compare`) — TIME comparison

> Redesigned 2026-09-27 (decision D3, roadmap §6). This page compares **two times of the
> same run** — flood progression, waterlogging growth, roads cut — not two engines.

**Top toolbar (the time controls)**
- **Cursors** — `T1` and `T2`, each: ◀ step · `{hh:mm:ss}` · ▶ step, on the shared run
  timeline scrubber (T1 = blue handle, T2 = red handle). Presets: `first frame`,
  `+1 h`, `peak`, `last frame`.
- **Playback** — `▶ Play T1→T2`, speeds `0.5× 1× 2× 4×`; loops between the cursors.
- **Presentation mode** — tiles `Swipe` · `Side by Side` · `Diff (T2 − T1)`.
- **Layers** — Water Depth ✓ · Inundation Extent ✓ · **Roads (red = cut)** ✓ ·
  Arrival front ✓ · Population ✓ · Critical assets ✓.

**Centre** — one or two synced maps, both rendered from
`/api/tiles/{run}/{kind}/{z}/{x}/{y}.png?frame=` (T1 handle frame N, T2 handle frame M).
Shared depth legend `0 0.5 1 5 10 20+`; roads legend `passable / cut (≥0.30 m)`.

**Δ panel (below map — the point of the page)**

| Metric | @ T1 | @ T2 | Δ |
|---|---|---|---|
| Water area (km²) | `{n.n}` | `{n.n}` | `+{n.n}` |
| — low / moderate / high (km²) | … | … | … |
| **Roads cut (km)** | `{n.n}` | `{n.n}` | `+{n.n}` |
| **Newly-cut road segments** | — | `{count}` | names, clickable → pans map |
| People affected | `{n}` | `{n}` | `+{n}` (source footnote) |
| Villages affected | `{n}` | `{n}` | `+{n}` |
| Gauge stage (CH0 / CH5 …) | `{m} m` | `{m} m` | `+{m}` |

**Side panels**
1. **Road cut list** — `Road name | length km | cut at | status`, rows clickable;
   export CSV / SHP / KML.
2. **Longitudinal profile** — `Depth (m) × Distance from dam (km)`, **T1 solid vs T2
   dashed** (time series, not engines).
3. **Arrival front** — isochrone map with cursor readout (`T_arrival` at T2 cursor).

**Empty / honest states** — pre-run: `EM_DASH` + "run a simulation first"; single-frame
runs: cursor T2 disabled with explanation; road data missing: `EM_DASH`, never a guess.

---

## 7 · Player (`/player/:id`)

**Left column**
- **Simulation Player** + `Visualize the flood propagation in 2D or 3D with real terrain, imagery and infrastructure.` — photo, **name**, `{state}, India`; rows `Run ID` · `Model Engine` · `Simulation Time` · `Current Time`.
- **View Mode** — 2 tiles `2D Map View` / `3D Player`.
- **Layers (3D)** — `Terrain (DEM - 30m)` ✓ · `Satellite Imagery (Sentinel-2)` ✓ · `Water Surface (Simulation)` ✓ · `Inundation Extent` ✓ · `3D Buildings (OSM / WorldPop)` ✓ · `Roads & Infrastructure` ✓ · `Bridges` ✓ · `Particles (GPU)` ☐ · `Labels (Villages / Places)` ☐.
- **Scene Controls** — sliders `Building Height Scale` (`1.0x`), `Water Transparency` (`0.7`).

**Centre — 3D scene**
- Real terrain mesh with **satellite imagery draped** as the surface texture, water depth rendered as a translucent blue overlay above it, instanced buildings, road lines, bridge markers, place labels.
- Top toolbar: `2D/3D` toggle · `Water Depth (m)` select + colour ramp `0 0.5 1 2 5 10 20+` · `Show Labels` switch · `Camera View` select.
- Left vertical tool rail: cursor · globe · pin · ruler · camera. Compass `N` top-right.
- **Playback chrome** (bottom overlay): `⏮` `⏸` `⏭` · `{hh:mm:ss} / {hh:mm:ss}` · scrubber · speed `0.5x 1x 2x 4x 8x` · fullscreen.
- **Simulation Frames (Water Depth)** filmstrip beneath, same labels as Results.

**Right column**
- **Simulation Information** — `Run ID` · `Model Engine` · `Simulation Time` · `Current Time` · `Time Step` · `Particles (GPU)` · `Domain Size` · `Resolution`.
- **Live Statistics (Current Frame)** — icon cards `Inundated Area` · `Peak Depth (max)` · `Affected Population` · `Affected Buildings` · `Affected Roads` · `Critical Facilities`.
- **Depth at Selected Location** — coords line; line chart `Depth (m)` × `Time (hours)` with callout `Depth: {n} m / Time: {hh:mm}`.
- **Export & Download** — same three rows as Results.

---

## Deliverable coverage (must all be reachable)

| # | Deliverable | Where |
|---|---|---|
| i | Generalized dam-break framework | Build + Run |
| ii | Dam break / river blockage / surge scenarios | Build step 3 (case selector) |
| iii | Dashboard with large data + `.shp`/`.kml` | Results → Export Results |
| iv | GEE near-real-time flood analysis | Watch → Recent Alerts + Glacier panel |
| v | Any river + open dam data of India | Discover |
| vi | Loss & damage analysis | Run stage 6 `Impact Analysis` |
| vii | SPH + Delft3D comparison | run-vs-run API `/api/compare/{a}/{b}` (page framing = time, D3) |
| viii | Customized tool from input datasets | Build step 1 `Area & Data` |
| ix | Case 2 — glacier tracking & change detection | Watch → Glacier panel |
| x | Compare scenarios | Compare — time progression T1→T2 incl. roads (D3) |

## Non-negotiables

1. Every displayed value traces to an API response — show an empty/offline state otherwise.
2. Every number carries a unit and a source/provenance label.
3. 2D is the default everywhere; 3D only inside Player.
4. Monospace numerals.
5. No emoji anywhere in the UI.
