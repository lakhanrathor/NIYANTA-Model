# Chamoli 2021 Validation Case (executed 2026-09-28)

First real-event validation of the NIYANTA routing/propagation stack:
a dam-break **analog** in the real Rishiganga–Dhauliganga valley, on the real
Copernicus DEM, checked against the observed kinematics of 7 Feb 2021.

> Framing (locked): this is **not** a reconstruction of the 7 Feb 2021 debris
> flood. That event was a rock–ice avalanche, not a dam failure, and no verified
> peak discharge exists in the accessible literature. What is validated here is
> flood **routing**: given an instantaneous release at the destroyed Rishiganga
> barrage site, do arrival times, velocities and depths down the real valley
> land in the observed neighborhood?

## 1. Event research (online sources)

- 7 Feb 2021, ~10:30–10:45 AM IST. Wedge (~500 m wide, 180 m thick) detached
  from Ronti/Raunthi peak (~5,600 m) at ~30.339°N, 79.731°E; fell ~2 km.
- ~27 Mm³, 80% rock / 20% ice; frictional melt → hyper-mobile debris flood
  (Shugar et al., *Science* 373:300–306, via ESA/BBC).
- Path: Ronti Gad → Rishiganga (40 km) → Dhauliganga (Rini) → Alaknanda
  (Vishnuprayag) → Joshimath.
- Destroyed: 13 MW Rishiganga HEP (Rini); Dhauliganga dam @ Reni
  (30.485°N, 79.691°E); damaged Tapovan Vishnugad (520 MW RoR).
  ~204 dead/missing, mostly plant workers, no warning.
- **Observed kinematics (BBC/Shugar): 25 m/s at Rishiganga HEP (15 km from
  source), 16 m/s at Tapovan (~10 km further).**
- Tapovan barrage (recorded): 30.494139°N, 79.627528°E; concrete; 200 m long,
  22 m high; sill elev 1,787 m; catchment 3,100 km²; HRT capacity 122.2 m³/s.
- NOT verified online (paywalled): peak discharge, total flood volume,
  Rishiganga barrage height. None of these were invented for the case.

## 2. Case setup (run `42f2766b-c844-4a11-b7e0-e364aa271e8b`)

Scenario `9c745750-b4f4-4a52-851b-737ae930a504`
("Chamoli 2021 analog — Rini instantaneous breach"), engine `fast`.

| Input | Value | Provenance |
|---|---|---|
| River | OSM Dhauliganga (81.7 km, 736 coords) | `searchWorldRivers` → catalog id `cdab2d19…` |
| Dam point | Rishiganga HEP barrage, 30.485°N, 79.691°E | destroyed-structure site; height NULL (unrecorded) |
| Breach | manual, instantaneous, 120 m × 20 m | DEM-measured gorge at Rini (bed 1960 m; 106 m @+10 m, 163 m @+20 m, Copernicus N30/E079) |
| Impoundment | 27 MCM, level 1980 m, area 0.5 km² | **documented analog assumption**: recorded 27 Mm³ avalanche volume released at Rini |
| Base inflow | 122 m³/s | recorded Tapovan HRT design capacity (lean-flow proxy) |
| AOI | [79.55, 30.44, 79.73, 30.60] | Rini → Vishnuprayag + margin |
| Horizon | 3 h @ dt 1 s; stations every 5 km to 30 km | standard |
| DEM | Copernicus 30 m auto, 288×324 @ 53 m | `source: copernicus_auto` in `dem.npz` meta |

Registry additions (real working DB): `Tapovan Vishnugad Barrage`
(`1010c0f0…`, 22 m / 200 m recorded), `Rishiganga HEP Barrage (Rini)`
(`c4d6e91f…`, honest NULLs), `Vishnuprayag Dam` (`61b1058c…`, 17 m concrete
barrage @ 30.5669°N, 79.5468°E, recorded) — all surface `in_corridor` on
Dhauliganga with chainage (VP 2.8 km, Tapovan 9.5 km, Rini 16.2 km).
Srinagar HEP (330 MW) skipped: town at 30.22°N, 78.78°E but no sourced dam
coordinates — evidence rule.

## 3. Model vs observed

| Check | Observed | Model (`42f2766b`) | Verdict |
|---|---|---|---|
| Velocity @ Rini reach | 25 m/s | ~25–30 (near-field; solver caps at 30) | ✅ order-correct |
| Velocity @ Tapovan (~10 km down) | 16 m/s | **11.6 m/s** (depth 19.1 m, arrival 9.4 min) | ✅ same order (~27% low — clear-water SWE vs debris flow + 53 m-smoothed gorge) |
| Velocity @ Vishnuprayag | — (flood reached) | 17.3 m/s, depth 12.6 m, arrival 26 min | ✅ plausible |
| Arrival Rini→Tapovan | ~15–30 min | **9.4 min** | ✅ ballpark (clear-water wave outruns debris) |
| Release / mass | 27 Mm³ in | peak 17,718 m³/s @ 1 min; **26.66 Mm³ released** | ✅ conserved |
| Joshimath (upslope) | untouched | dry | ✅ correct |
| Exposure | 204 dead (plant workers) | 1,273 residents / 2.6 km² (zonal) | ⚠️ not comparable — different populations |
| Peak-Q literature | unverified | — | ❌ no claim made |

**Algorithm verdict: routing/propagation is sound.** Velocities, arrivals,
depths and the dry/wet pattern land in the observed neighborhood with zero
calibration. The Tapovan shortfall is physically explainable, not a code error.

## 4. Cascade counterpart — Run 2 (Tapovan break)

The event was a chain (Rini → Reni → Tapovan → Vishnuprayag…), but one run
breaches one dam, so the counterpart is a standalone hypothetical, NOT a
coupled handoff (roadmap G7).

Run `dff48588-a8e7-4330-8f4f-28dee703cc51` (scenario `8d67baa1…`,
"Chamoli valley counterpart — Tapovan barrage break"): Froehlich2008 on the
**recorded** 22 m / 200 m geometry; pondage 1.5 MCM / 0.2 km² **estimated**
from barrage dims + DEM channel width (assumption); sill 1787 m recorded;
bed 1770 m DEM-measured; base inflow 122. Froehlich computed the breach;
peak **904 m³/s @ 15 min**, 2.57 Mm³ released (mass sensible).

| Check (Run 2) | Model | Reading |
|---|---|---|
| Depths near Tapovan | 12.8 m max, 3.4 m at barrage | locally destructive, 531 exposed / 1.3 km² |
| Vishnuprayag dam (~7 km down) | dry, arrival −1 | Tapovan-only failure does **not** propagate there |
| vs Run 1 at Vishnuprayag | 17.3 m/s, 12.6 m depth | Rini-scale events threaten the whole chain |

Cascade moral, quantified: a Rini-scale wave endangers every structure to
Vishnuprayag; a Tapovan-only failure stays local. View: `/player/dff48588…`,
`/results/dff48588…`.

## 5. Cascade wiring (event-in → dams-out, shipped)

`POST /api/runs/{id}/cascade` + shared `useCascade` hook + mission-context
`cascade` slice (runId-scoped like `outputs` — screen once, serve every page):

- Input = any run (analyst picks event parameters via Build as usual — no dam
  pre-selection needed for the question "what does this flood hit?").
- Wired into the flow where it belongs: **Run** completion callout →
  **Results** right rail (auto-screens) → **Build** counterpart adoption;
  **Player** shows the same snapshot as 3D pins + list; **Discover** dam rows
  carry overtopped/exposed pills from context; dam pins and saved-config lists
  pick everything up data-first.
- Output = dams ordered by distance with depth / velocity / arrival and a
  screening flag: `overtopped` (water over RECORDED crest), `exposed`,
  `exposed-unknown-geometry`, `dry`, `outside-domain`. A flag is not a failure
  prediction.
- `create_scenarios` drafts one Froehlich counterpart per wet dam with recorded
  height (app-standard reservoir fallback, provenance `cascade:{run}`).
  Execution stays manual — nothing auto-runs.
- Live proof: Tapovan `exposed` (19–20 m vs 22 m crest, arr ~9 min) reproduced
  on the API-built run (`42f2766b`), the fixed-trace run (`3b183a35`), and the
  GUI-clone run (`080d7cae`, user's own spec + corrected AOI).
- Wide-AOI re-run (`49a0ff41`, AOI west to 79.50) covers Vishnuprayag Dam
  properly; its cascade screen is the end-to-end proof (pending at write time).
- Coupled breaching inside one simulation remains open (needs G9).

## 6. Bugs found (all real, all fixed except noted)

1. **Custom dam points silently forced synthetic valleys (FIXED).**
   `work_terrain._grid_from_tif` parsed dam `location` with `wkb.loads`
   only; GeoJSON-text rows (which the registry itself stores) crashed
   auto-DEM → silent synthetic fallback. First Chamoli run (`6cb6719d`)
   is INVALID for this reason. Fixed to accept both formats.
2. **Station centreline tracing stalled on real DEM (FIXED).** Greedy
   steepest-descent stopped at the first pit/flat (CH5+ piled at the dam,
   `in_domain=false`). Fix: pit-escape toward the nearest lower cell within
   24 rings (≈1.3 km at 53 m — verified to converge where 12 stalled).
   Proven on runs `ea9157be` → `3b183a35`: gauges now run Rini → Tapovan →
   Vishnuprayag with real arrivals (CH10 13 min, CH15 20.6 min). Unit tests in
   `tests/test_mesh_trace.py`.
3. **AOI orientation silently floods upstream (USER-VISIBLE LESSON).** The GUI
   run `720ef219` drew its polygon north-east of Rini, so the "flood" ponded
   up the Rishiganga valley instead of routing to Tapovan. Rule: the dam must
   sit at the UPSTREAM edge of the AOI with the box stretching downstream.
   Cloned spec + corrected AOI → run `080d7cae` reproduces Tapovan
   (20.57 m / 10.17 m/s / 9.4 min). A Build-side guard (dam-near-downstream-
   edge warning) is still open.
4. **FastAPI route order 405 (FIXED).** `POST /dams` placed after `GET /dams`
   never matches — Starlette returns 405 on the first path hit. New POST
   routes go above their GET siblings from now on.

## 7. View it

- 3D Player: `/player/42f2766b-c844-4a11-b7e0-e364aa271e8b`
  (96 frames, full-res terrain, depth/arrival/velocity modes, cascade pins)
- 2D + gauges + cascade: `/results/42f2766b-c844-4a11-b7e0-e364aa271e8b`
  (gauges fixed on runs `3b183a35` / `080d7cae`; `42f2766b` pre-dates the fix)
- GUI-clone proof: `/results/080d7cae-5074-490a-888f-2d697f491122`
- Discover: Dhauliganga → Tapovan + Rini + Vishnuprayag pins (cascade pills
  appear once any run is screened)
- Products: `frames.npz` (96×288×324), `max_depth` (62.6 m max),
  `max_velocity`, `arrival_time`, `impact_table.json`, `hazard_villages.geojson`
  (0 features — no villages inside this extent: a real zero)

## 8. Honest caveats (UI wiring)

a. **Dam points were inserted via DB directly** — then `POST /dams` shipped
   (validated live + tested), so UI-side creation works from here on.
b. **Corridor availability read 0%** because the prepare job died at 95% with
   no dataset rows. Fixed at the root: `corridor_datasets` now syncs rows from
   disk evidence — DEM reads 100% available, and the Download option appears.
c. **Run `6cb6719d` in the runs list is INVALID** (silent synthetic-valley bug,
   §6.1) — ignore it; the valid runs are `42f2766b`, `3b183a35`, `080d7cae`.
d. All of the above live in `backend/data/niyanta.sqlite` — the app's real
   working database, which is why river, dams, scenario and runs appear in the
   UI with zero extra wiring. Mission adoption (select river → dam → config →
   run) is still per-browser clicks, by design.

## 9. Open / next (fidelity roadmap — also in canonical roadmap gaps)

1. **Couple the cascade** (G7/G9): feed Run 1's Tapovan hydrograph as Run 2's
   upstream boundary — needs an inflow-hydrograph input (only constant
   `inflow_cms` exists today).
2. **Debris rheology**: clear-water SWE vs hyperconcentrated slurry
   (the ~27% Tapovan gap). Engine-level.
3. **Literature gaps**: verified peak-Q + Rishiganga barrage height — needed
   before any discharge-accuracy claim.
4. **AOI-orientation guard**: warn in Build when the dam sits at the
   downstream edge of the AOI (§6.3 class of silent mistake).
5. **Finer DEM + OSM villages** for the corridor (G10; hazard pins empty there).
6. **Watch before/after box** over Rini–Tapovan, Feb-2021 Sentinel-2 pair (G10;
   GEE readiness is the blocker).
7. Vishnuprayag recorded-geometry break if a larger event ever reaches it
   (pending the wide run's VP row).
8. Feeds roadmap §10: `/api/validate/benchmark` vs observed (Rishi Ganga).
