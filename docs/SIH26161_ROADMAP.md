# NIYANTA — SIH26161 Research & Roadmap (canonical)

> **READ THIS FIRST.** This is the living research record for problem statement
> SIH26161 (NTRO). Nothing here needs to be re-researched. When a decision
> changes, update **§6 Decisions log** and the affected section — do not create
> a parallel document. Root `AGENTS.md` points here.
>
> Last updated: 2026-09-27 · Team 173468 · deadline **30 Sep 2026**

---

## 0. Core philosophy (governing model — everything below derives from this)

NIYANTA is **two systems wired into one product**:

### Part 1 — Watch & Trigger (the always-on system)
- Fixed **target areas** (watch boxes: Rishi Ganga, Kosi, Phuktal, Hidkal — seeded presets) are watched **automatically, daily**.
- Scheduler (07:00 UTC, `modules/gee/scheduler.py`) runs the GEE sweep per box:
  `s2_indices`, `s1_watermask`, `lst_snow`, `seismic_sync`, `flood_extent`, `glacier_ice`.
- Change detection (glacier/ice loss, water-extent growth, rainfall, **natural-dam blockage**
  risk, LST/snow) → `change_detection` rows → risk scoring → **alerts** → trigger.
- "Trigger" = the hand-off into Part 2: a flagged change can precompute a scenario
  (`/api/scenarios/from-event/{change_id}`) which the analyst launches with one click.
- Always-on means **real-time UX**: live feed (WebSocket), sweep-health status,
  jobs progress — the analyst sees *what is happening, where, right now*.

### Part 2 — River Context (the spine; build once, everything hangs off it)
- The analyst **selects a river** → the **river context** is built: corridor + DEM +
  dam registry + population + OSM infrastructure + prepared status.
- **All other pages SUBSCRIBE and PUBLISH to this river context:**
  - *Discover* publishes the selection (river + corridor + buffer width).
  - *Build* publishes scenario config (case, breach, reservoir, engine) bound to the context.
  - *Run / Results / Compare / Player / Evacuation* subscribe to the context and publish
    run outputs back into it (runs, results, exports are attributed to the river).
  - *Watch* publishes events (watch box ↔ river linkage) into the same context.
- One context object (frontend: zustand store + React context, API: `/rivers/{id}`
  + `/corridors/{id}` + `/rivers/{id}/availability`); no page keeps private river state.
- This is the pub/sub law: **no page invents its own river data; it reads the context
  and writes back through endpoints that attribute data to the river.**

Any document that contradicts §0 is drifting — fix the document first.

---

## 1. Problem statement (researched — do not redo)

**SIH26161 · Dam Break Inundation Modelling Using Hydrodynamic Modelling of any River**
- Sponsor: **National Technical Research Organisation (NTRO)** · Theme: Disaster Management ·
  Category: Software · deadline **30 September 2026** · 0/500 submissions at research time.
- Sources: `sih2026.vuce.in/ps/SIH26161` (community archive), sih.gov.in/sih2026PS (official),
  SIH ONE disaster-theme index, master catalogue PDFs.
- **Background:** natural dam/lake formations (Rishi Ganga Feb 2021, Wapriyang Nov 2021,
  Phuktal Mar 2015, Kosi 2008; Kashmir/Assam 2014 floods) → flash floods; dam-release crises;
  HADR needs scenario generation: *if a dam breaks, how much water, which areas inundated?*
- **Deliverables:**
  1. Generalised dam-break / river-blockage modelling framework with loss & damage analysis
     using **SPH and Delft3D** models.
  2. Custom tool to generate flood-inundation simulation scenarios from different input datasets.
  3. **Dashboard GUI** for input/output visualisation, large-data capable; output convertible
     to **.shp / .kml**.
  4. Near-real-time flood analysis framework via **Google Earth Engine** + open data.
  5. Final demo on open-source Indian river + dam data.
- **Judging weightage (2026):** Technical execution/architecture 30% · Ministry feasibility &
  impact 25% · Innovation 20% · Live demo quality 15% · Q&A/team 10%.
  Rounds: ideas → internal → screening (PPT + non-AI demo video + GitHub) → 36h finale;
  judges visit repeatedly — *show delta*, demo-first, no mocked UI, every member speaks.

### PPT ↔ codebase mapping (team deck, 3 slides)

| Slide claim | Status |
|---|---|
| 3 input streams (dam/reservoir, natural event, human/wartime) → one engine → outputs | ✅ `scenario/builders` case1/case2 (+case3 planned wiring) |
| Breach models (Froehlich, Von Thun, Xu & Zhang MacDonald & Langenberg) | ✅ `modules/breach` |
| 1D Saint-Venant + SPH + Delft3D, flood-wave propagation H/Q/arrival | ✅ `modules/solvers` (SPH route dispatch — see §13 open item) |
| Outputs: inundation/depth/velocity maps, hydrograph, arrival time, population, infrastructure, SHP/KML | ✅ results/impact/exports |
| GEE daily target-area monitoring (natural-dam formation, glacier change, blockage) | ✅ sweep runs; UI + auto-chain partially wired (§5) |
| Automated report module (PDF/CSV/GIS) | ✅ HTML report + CSV/SHP/KML/zip exports; **not surfaced in UI** |
| NTRO validation / exposure & validation numbers | ⚠️ `/api/validate*` + benchmark exist; not surfaced |
| 1-click data sharing across departments | ⚠️ export package exists; needs share UI |
| **Evacuation corridors** (NTRO framing: arrival times **and evacuation corridors** in real time) | ❌ **missing — biggest gap** |
| Compare = scenario comparison (SPH vs Delft3D per PS text) | ❌ **redefined by us: Compare = TIME comparison (§6)** |

---

## 2. Verified base inventory (2026-09-27, SQLite migration complete)

- **Backend:** SQLite (`backend/data/niyanta.sqlite`, WAL), dialect layer in
  `modules/db/client.py` (`_translate`: `%s→?`, `now()→datetime('now')`, `ILIKE→LIKE`,
  cast-stripping incl. `::text[]`, UDFs `ST_AsGeoJSON/AsText/GeomFromText/GeomFromGeoJSON/
  MakePoint/MakeEnvelope/SetSRID/X/Y/XMin..YMax/left/right/to_timestamp`, `geo_bounds`).
  43-table schema (`schema.sql`), `seed.py` idempotent, `scripts/pg_to_sqlite.py` migrated
  24,732 rows. Demo run `ae999c3f…` VALIDATED, engine sph, 96 frames.
- **Tests:** 49 passed / 1 pre-existing failure (`test_pipeline_sph_engine_validates` —
  `solvers/base.run` routes sph→fast_swe hardcoding `engine:"fast"`; open decision §13).
- **Watch/GEE:** scheduler + 6 daily job kinds, quicklooks, `change_detection`,
  `risk_assessment`, endpoints (boxes/timeline/beforeafter/gee-detections/changes/jobs/
  score/run manual), `from-event`/`from-risk` builders with `auto_execute=False`.
- **Alerts:** rules seeded (`arrival_fast`, risk_class…), ack/dispatch/close, WS
  `/api/ws/alerts` + `/api/ws/runs/{id}` (`frontend/app/src/lib/ws.ts`) — **not yet wired
  into Watch UI**.
- **Run outputs:** frames.json (96 frames + thumbnails), tiles XYZ (+`?frame=`, diff tiles),
  series (area-by-class + reach per frame), stations (arrival_hr, peak), impact
  (population/villages/roads_km/bridges/facilities + hydrograph), arrival rasters
  (`export/gis.py` writes arrival_time), terrain.json, probes.
- **Infra data:** OSM clip ingests `road`, `building`, `bridge`, `hospital`, `school`,
  `power` into `infra_footprint` (GeoJSON via `ST_GeomFromText`).
- **Frontend pages:** `/` Watch (landing), `/discover`, `/build`, `/corridor/:riverId`,
  `/run`, `/results`, `/compare`, `/player`. RiverContextBar + RiverContextTopDropdown exist
  (independent external edits pending — §13).
- **Report:** `GET /api/reports/{run_id}` → HTML report (`modules/export/report.py`).
- **World tier:** `/rivers/search/world` (Nominatim→Overpass, write-back); corridor prep
  uses Copernicus GLO-30 (global). India-centric: CWC/NRLD/WRIS registries, states fields,
  aoi/registry assumptions — see §9.

---

## 3. Doubts, findings & why (research notes)

1. **PostGIS→SQLite hand-off surface** — `modules/discover/__init__.py` was the last
   monster: `river_dams` (ST_Expand/`&&`/ST_DWithin/LATERAL ST_LineLocatePoint over
   geography) rewritten as `_corridor_dam_rows` (bbox prune → pyproj **AEQD** metres →
   shapely planar chainage); `corridor_polygon` → AEQD buffer + `pyproj.Geod` geodesic
   area; `_curated_chainage` → shapely project; `osm_clip._cells` → shapely intersects
   (was silently degrading to full grid); `search` `= ANY(name_alt)` → `json_each` LIKE.
   Translator bug fixed: `::text[]` casts (would have broken `ingest.py rivers`).
   Static prepare-sweep: **all 56 SQL blocks in backend prepare cleanly**.
2. **jsonb `?` operator** collides with placeholder translation — only site was
   `enrich_dam_specs` (now `json_extract`). Sweep rule: never write `?` operators in SQL.
3. **Reports are HTML, not binary PDF** — decision: browser print-to-PDF for now;
   optional server-side PDF later (§13).
4. **Compare wording** — team PPT says "compare the scenario" (PS text), but the product
   need (user, 2026-09-27) is **time comparison** — flood progression at T1 vs T2.
   Locked as decision D3.
5. **Auto-chain stops before execution** (`auto_execute=False`) — deliberate: daily sims
   cost compute; detection→score→alert is automatic, simulation launch is 1-click
   (env flag for full auto). Locked as decision D4.
6. **Evacuation inputs**: roads/buildings/critical assets are already ingested → road-network
   routing chosen over straight-line. Locked as decision D5.
7. **User evidence rule** (standing): no fabricated numbers; missing → `EM_DASH`;
   readouts only from real API data; screenshots supplied by user (no Playwright for us).

---

## 4. Gaps (what is NOT built)

| # | Gap | PS link | Phase |
|---|---|---|---|
| G1 | **Evacuation corridor** module + UI | deliverable i (loss/damage), NTRO "evacuation corridors" | **B (first code)** |
| G2 | Compare = time progression incl. **roads per time** | deliverable ii (scenario gen) | **A (first code)** |
| G3 | Watch live room: WS feed, sweep health, box detail page, trigger UX | deliverable iv | C |
| G4 | River Context pub/sub hardening (single store; all pages wired) | product spine | C |
| G5 | World data wiring end-to-end (non-India river) | "any river" | D |
| G6 | Storytelling surfaces: 3-case gallery, report/validation/share UI | judging + PPT | D |
| G7 | **Cascade runs**: one run breaches one dam. SHIPPED: `POST /runs/{id}/cascade` screens run rasters at registry dams (wet/exposed/overtopped vs recorded crest + arrival); snapshot in mission context (runId-scoped) shared by Results panel, Player pins/list, Discover dam pills, Run handoff; counterparts draft to Build; execution stays manual. OPEN: coupled breaching in one simulation (needs G9) | real-event fidelity | D |
| G8 | **Dam creation endpoint**: SHIPPED as `POST /dams` (name + lon/lat required, honest NULLs; tested) | analyst workflow | C |
| G9 | **Time-varying upstream hydrograph input**: only constant `inflow_cms` exists — blocks cascade coupling (Run 1 outflow → Run 2 boundary) and debris-feed modeling | real-event fidelity | D |
| G10 | **Chamoli storytelling**: Watch before/after box over Rini–Tapovan (Feb-2021 Sentinel-2 pair) + OSM village layer for the corridor (hazard pins empty there) | judging + PPT | D |

---

## 5. Decisions log (locked)

| ID | Decision | Why |
|---|---|---|
| D1 | Two-part core philosophy: **Watch & Trigger** + **River Context pub/sub** | user, 2026-09-27 — governing model for all docs/UI |
| D2 | Canonical research doc = **this file**; root `AGENTS.md` points here | never re-research |
| D3 | **Compare = TIME comparison** (T1 vs T2 flood progression, roads included), NOT engine A-vs-B | user; PPT "compare the scenario" reinterpreted as time |
| D4 | Auto-track always (GEE sweep → change → risk → alert); simulation trigger = **1-click proposal**, `NIYANTA_AUTO_MODEL=1` opts into full auto | compute cost + judge-visible control |
| D5 | Evacuation routing over **OSM road network** (already ingested), not straight-line | analyst credibility |
| D6 | Verification = pytest + endpoint battery + `tsc`/`oxlint`; **user screenshots**, no Playwright specs | user directive |
| D7 | Evacuation constants (walk 4.5 km/h, depth cutoff 0.30 m, leave-now margin 1 h) are config with visible assumptions | evidence rule |
| D8 | DB = single SQLite file, geometry = GeoJSON text, dialect via `_translate` + UDFs | completed migration |
| D9 | Compare ships as **config-vs-config** A/B (same-engine default, newest first); cross-engine pairs stay selectable, engine labels out of headers/framing | user 2026-09-28 — honors D3 intent with the endpoints that exist; full §6 Time Machine needs per-frame roads + frame-aware diff (backend backlog) |
| D10 | Real-event validation is framed as a **dam-break analog in the real valley**, never as a reconstruction of the natural event; every input carries recorded / measured / documented-assumption provenance (§13) | evidence rule + Chamoli case, user 2026-09-28 |
| D11 | `engine=sph` runs the real WCSPH solver (`solvers/sph.py`) over the **whole model grid** (not the 1.5 km near-field window), particle spacing ≥ ½ DEM cell and grown to fit the released volume; per-frame particle snapshots → `particles.npz` → `GET /runs/{id}/particles?frame=N` → the 3D Player draws water as particles. `fast` stays the 2D grid SWE solver; engine labels say which is which ("2D SWE (fast)" / "SPH particles"). Delft3D stays the D-Flow FM path and needs the Deltares kernel installed (`engine_present` in `/health` = kernel resolvable) | user 2026-09-29: "2D = Delft3D, 3D = SPH particles"; resolves §12 SPH dispatch question |

---

## 6. Compare redesign — "Time Machine" (spec)

**Question the page answers:** *at T1 nothing/this much waterlogging; at T2 this much —
what changed in the area between those times, including roads.*

- **Two time cursors** T1/T2 on the run timeline (transport: prev/next preset, scrubber,
  playback 0.5–4×). Defaults: T1 = first frame, T2 = peak.
- **Centre:** two synced maps (`/api/tiles/{run}/{kind}/{z}/{x}/{y}.png?frame=N`) —
  Swipe | Side-by-side | Diff modes kept as *presentation* modes.
- **Delta panel (the point of the page):**
  - area km² by hazard class at T1 vs T2 + newly-inundated km²
  - **roads: km inundated at T1 vs T2; newly-cut road segments list** (OSM `infra_footprint`
    × per-frame depth ≥ 0.30 m) — per-frame road inundation computed once, cached like `series`
  - people/villages newly affected between T1 and T2 (frame-resolved population proxy)
  - arrival-front position/extent outline at each time; per-gauge stage at T1 vs T2
- **Removed:** engine labels (SPH vs Delft3D), B−A engine diff framing.
  Longitudinal profile & arrival-isochrone panels stay (they are time-bearing).
- **New endpoint:** extend `GET /runs/{id}/series` (or sibling
  `GET /runs/{id}/series/roads`) with per-frame `{area, roads_km, roads_cut_ids, wet_gauges}`.
- **Export:** delta table CSV; SHP/KML of newly-cut roads (extend `export/gis.py`).

### Shipped increment (2026-09-28, frontend-only — no new endpoints)

Why this shape, and how it helps the analyst:

- **Same-engine A/B defaults (newest first).** The analyst's daily question is
  *"what if the breach is bigger?"* — two configurations of one engine, headers
  tagged `ENGINE · breach-width` (e.g. `SPH · 223m`), full scenario names in the
  Runs panel. Cross-engine pairs stay one click away for the model-agreement
  question judges ask — available, never the default framing.
- **Areas strip.** One chip per in-domain gauge (`CH0 · 0 km · arrival`) flies
  both panes there and pins the probe; two-click box select zooms both panes to
  any rectangle. Both clip the *view* only — every number still comes from
  `/probes`, `/stations`, tiles. Polygon aggregates (population/area inside a
  drawn box) are **not** claimed: no on-the-fly zonal-stats endpoint exists,
  and faking them from pixels would break the evidence rule. That endpoint is
  the one named backend backlog item.
- **Shared `FrameStrip`** (`components/`, Results + Compare): thumbnail +
  `T+time` + progress bar per frame, click-to-jump, playback continues. Results
  keeps per-card captions; Compare uses the slim variant. One code path.
- **Results dedupe:** gauges live only in the always-visible right panel (the
  analytics-tab duplicate is gone); exports go through the shared job-flow
  panel (`POST /exports` → poll → download).

Remaining for the full §6 spec: per-frame `{area, roads_km, roads_cut_ids,
wet_gauges}` series endpoint, T1/T2 delta readouts, frame-aware diff tiles,
server-side zonal stats. None are faked in the UI meanwhile.

### Map state lives in the context (2026-09-28, no new endpoints)

Why: panes, panels and the filmstrip kept disagreeing through per-page props,
so all shared mutable map state moved into `mapIntents` (`river-context.ts`),
keyed by scope (`results`, `cmp-a`, `cmp-b`): run, diff partner, raster field,
frame, max-view, flood visibility, probe. MapShell panes read their scope
instead of a `raster` prop; the filmstrip reads/writes the same scopes; the
flood-area switch is one shared value surfaced in the map rail, the legend
row, and the overlay panels. Overlay *geometry* (features/fit) stays props
until the scope API lands — it is derived from context + API data, never
private state. Max-extent union is the default view (matches the output
previews); scrubbing dives into moments. Ephemeral by design: excluded from
persistence, run switches reset cursor state but keep analyst prefs.
Flood-layer acquire retries network failures with backoff (meta and layer-add
share one path — no silent console-only deaths); a "Flood hidden" chip makes
a switched-off layer one tap away instead of a mystery.

## 7. Evacuation corridor (spec)

- Inputs: run arrival frames + max-depth raster, `infra_footprint` road graph,
  buildings/origins, hospitals/schools (critical targets), DEM (terrain.json).
- Algorithm: build road graph (nodes = intersections/endpoints); Dijkstra to nearest
  **safe assembly point** (depth < 0.30 m and arrival not yet passed); per origin:
  `margin_h = T_arrival(origin) − dist / 4.5 km/h` → classify
  `OK / LEAVE NOW (margin < 1 h) / IMPOSSIBLE (no path or margin < 0)`.
- Outputs: corridors (polyline + margin class), assembly points (people assigned),
  origins table, stats (people OK / leave-now / impossible), timeline-synced cut-offs.
- Endpoint: `GET /runs/{id}/evacuation` (computed once, cached; honest 409 pre-run).
- UI: Results → **Evacuation panel** (map overlay + analyst table + timeline sync +
  CSV/KML/SHP). Alert rule `evac_margin_hr < 1` → CRITICAL.
- Reuses per-frame road primitives built for §6.

## 8. Watch & Trigger live room (spec)

- Wire `lib/ws.ts` alerts + run sockets into Watch: live feed strip, severity badges,
  click → map pan; `refetchInterval` 30–60 s on overview/changes/jobs/detections.
- Sweep-health pill: last `gee_job` > 26 h or `failed` → amber/red (honest status).
- New route `/watch/:boxId`: 30-day timeline, observation quicklooks, jobs log,
  before/after, risk card, alerts, **“Model this”** → from-event → execute → live run.
- Daily chain stays automatic through alert (D4); scenario proposal visible in feed.

## 9. World data wiring (spec)

- Audit + remove India-only guards: scenario `aoi` validation bounds, required states,
  registry-only dams → OSM/GeoDAR global fallback, WorldPop/GHS fallback, global
  roughness/land-cover fallbacks.
- End-to-end proof: one non-India river (Dnieper for the Kakhovka/wartime case) —
  world search → corridor prepare → OSM dams → build → run → impact → exports.
- Discover keeps the explicit "search the whole world" tier (writes results back —
  context published by Discover per §0).

## 10. Storytelling surfaces (spec)

- **Scenario Gallery** (Build landing): ① Dam criticality (Machhu-style overtopping preset)
  ② Natural event (from watch change — Rishi Ganga box) ③ Human/wartime (sudden breach,
  world-tier dam) → each prefills context+scenario → run → Results.
- Results: **report button** (HTML report, print-to-PDF) + export package = "1-click sharing".
- Compare/validation: surface `/api/validate/benchmark` vs observed (Rishi Ganga) with
  sourced accuracy numbers (Evidence rule).
- Exposure KPIs (people/roads/critical assets) carry source footnotes.

## 11. Execution order

1. ✅ This doc + `AGENTS.md` + fix drifting docs (Compare sections).
2. **A — Compare time machine incl. per-frame roads** (first code).
3. **B — Evacuation corridor** (reuses A's road primitives).
4. **C — Watch live room + River Context pub/sub hardening.**
5. **D — World wiring + storytelling surfaces.**

Each step: pytest (baseline 49/1 pre-existing), endpoint battery (43 probes),
`tsc`/`npx oxlint`, then user screenshots (D6).

## 12. Open questions

- ~~SPH engine dispatch failure~~ — RESOLVED 2026-09-29 (D11). Also fixed in `sph.py`:
  terrain contact now removes velocity along the true surface normal (particles used
  to climb valley walls for free — 2% of SPH-wet cells overlapped the SWE footprint,
  now 96%), spawn direction follows the breach's steepest descent, gauge Q is a
  volume flux (Σ|v|·V_p/2R). Chamoli 3 h: ~8 min CPU, mass error 0.07%.
- **Delft3D kernel not on the Windows dev box** (2026-09-29): `delft3d_fm_suite/` holds
  only GUI DLLs + a 1.8 MB `.msi` stub; no `run_dimr.bat`/`dflowfm`. Preflight blocks
  `engine=delft3d` with a clear error until the Deltares FM Suite kernel is installed.
- Server-side PDF export now or print-to-PDF only?
- Which world river for the wartime demo (Dnieper vs Kakhovka-specific AOI)?
- Frontend external-session TS errors (`RiverContextTopDropdown.tsx`, `Run.tsx`) — fix on
  our side?
- Station centreline tracing on steep real DEM — FIXED (pit-escape to 24 rings;
  gauges verified Rini → Tapovan → Vishnuprayag on runs `3b183a35`/`080d7cae`).
- Chamoli peak-Q still unverified (Shugar et al. paywalled) — no discharge-accuracy
  claim until sourced.
- `POST /dams` shipped; corridor-dataset rows sync from disk (DEM Download appears).
- Debris-flow rheology: solvers are clear-water SWE; hyperconcentrated-slurry
  physics is engine-level work (explains Chamoli's ~27% Tapovan gap).

## 13. Chamoli 2021 validation case (executed 2026-09-28)

Full case file: [`docs/CHAMOLI2021_CASE.md`](CHAMOLI2021_CASE.md).

- Rini instantaneous-breach analog (27 Mm³ recorded avalanche volume as
  impoundment, DEM-measured gorge breach, recorded Tapovan/HRT anchors),
  engine `fast`, run `42f2766b` — VALIDATED on Copernicus auto-DEM.
- vs observed: 25 m/s @ Rini ✅, 11.6 vs 16 m/s @ Tapovan ✅ (same order),
  9.4 min arrival ✅, mass conserved ✅, Joshimath dry ✅.
- Verdict: routing/propagation sound with zero calibration; feeds §10
  `/api/validate/benchmark` plans.
- Cascade counterpart Run 2 (`dff48588`, Tapovan recorded-geometry break):
  904 m³/s peak, stays local, Vishnuprayag dry — Rini-scale waves threaten the
  whole chain, Tapovan-only failures don't. Registry now holds all three
  cascade pins (Rini, Tapovan 22 m/200 m, Vishnuprayag 17 m).
- Bugs: custom-dam GeoJSON location silently forced synthetic valleys (fixed in
  `work_terrain`); station tracing on real DEM open (above).
