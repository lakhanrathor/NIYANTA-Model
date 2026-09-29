# NIYANTA API Contract

Base: `/api`. All responses JSON. The frontend must treat **any** 404/500/timeout as
"no data" and render an honest empty state — never a fabricated number.

## System / status bar

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{status, db, workers, handlers[]}` |
| GET | `/system` | `{region, epsg, updated_at, sources:[{id,label,state}]}` — `state` is `online`\|`local` |

`sources` ids: `esri`, `sentinel2`, `dem`, `hydrorivers`, `dams`, `osm`.

## Watch

| Method | Path | Returns |
|---|---|---|
| GET | `/watch/overview` | `{dams, watch_boxes, alerts, rivers}` (int) |
| GET | `/alerts?limit=20` | `[{id, kind, category, title, location, lat, lon, state, river_name, severity, box_id, created_at}]` |
| GET | `/watch/gee-detections?days=7` | `{water_extent, glacier, rainfall, blockage, total}` |
| GET | `/stats/featured-rivers?limit=6` | `[{id, name, length_km, major_dam_count, thumbnail, basin, rank}]` |
| GET | `/layers` | `[{id, group:'base'\|'overlay', label, source, enabled}]` |

## Discover

| Method | Path | Returns |
|---|---|---|
| GET | `/rivers/search?q=&limit=12` | `[{id?, name, length_km, basin, states[], major_dam_count, source, geometry(WGS84), bbox[], kind:'db'\|'nominatim'\|'overpass'\|'name'}]` — **HTTP 200 always** |
| GET | `/rivers?limit=100` | same shape |
| GET | `/rivers/featured?limit=6` | same shape (ranked) |
| GET | `/rivers/{id}` | `{id, name, length_km, basin, states[], source_name, mouth_name, major_dam_count, geometry, bbox, coverage_pct, dam_total}` |
| GET | `/rivers/{id}/dams` | `[{id, name, state, dam_type, height_m, status:'in_db'\|'missing', distance_km, lat, lon, cwc_id}]` |
| GET | `/rivers/{id}/availability` | `{coverage_pct, dem, sentinel2, osm, worldpop, dam_registry}` each `{pct, present}` |
| POST | `/rivers` | `{name, geometry, length_km?, basin?, states?}` → river row |
| POST | `/rivers/{id}/prepare` | `{job_id}` (corridor.prepare) |
| GET | `/corridors` | `[{id, river_id, length_km, coverage_pct, dem_status, status, created_at}]` |
| GET | `/corridors/{id}/datasets` | `[{kind, label, source, coverage_pct, status:'available'\|'partial'\|'missing'\|'fetching'\|'failed', size_bytes, job:{id, status:'queued'\|'running'\|'failed', progress, error, message}\|null}]` |
| POST | `/corridors/{id}/datasets/{kind}/download` | `{job_id}` (`corridor.dataset`); `kind` ∈ dem, dams, osm, imagery_s2, sar_s1, worldpop |

## Build

| Method | Path | Returns |
|---|---|---|
| GET | `/dams?limit=200` | dam rows |
| GET | `/dams/{id}` | `{id, name, state, lat, lon, river_name, dam_type, height_m, length_m, capacity_mcm, status, cwc_id, source, photo, ingest_status}` |
| GET | `/dams/{id}/image` | `{url}` (Wikipedia/Dam-ID photo proxy) or `{url:null}` |
| GET | `/scenarios?case=` | scenario rows |
| POST | `/scenarios` | `{case_name, target_kind, target_id, breach, spec}` → `{id}` |
| GET | `/breach/profile?dam_id=&width=&depth=` | `{shape, points:[{x,y}], width, depth, level}` for cross-section diagram |

## Run

| Method | Path | Returns |
|---|---|---|
| POST | `/runs` | `{scenario_id, engine}` → `{id, job_id}` |
| GET | `/runs` | run rows |
| GET | `/runs/{id}` | `{id, scenario_id, engine, status, stage, pct, stage_label, eta_seconds, elapsed_seconds, started_at, finished_at, spec, error}` |
| GET | `/runs/{id}/stages` | `[{n, key, title, status:'done'\|'active'\|'pending', pct, detail}]` (7 stages) |
| GET | `/runs/{id}/metrics` | `{mesh_cells, domain_km2, dt_s, sim_time_s, iterations, hardware}` |
| GET | `/runs/{id}/outputs` | `[{key:'dem'\|'mesh'\|'breach'\|'water', status, thumb, elevation:[min,max]}]` |
| GET | `/runs/{id}/log?tail=200` | `[{ts, level, message}]` |
| GET | `/runs/{id}/params` | `{target_resolution_m, domain_km, expected_cells, method}` |

Stages, in order: `terrain`, `mesh`, `breach`, `solver`, `post`, `impact`, `validation`.

## Results / Compare / Player

| Method | Path | Returns |
|---|---|---|
| GET | `/runs/{id}/frames.json` | `{frames:[{i, t, t_label, thumbnail}], kind, kind_label, ramp:[{v,label,color}], sim_hours}` |
| GET | `/runs/{id}/impact` | `{inundated_km2, population, villages, roads_km, bridges, facilities, hydrograph:[{t, sph, delft3d}], hydrograph_labels}` |
| GET | `/runs/{id}/probes?lon=&lat=` | `{lat, lon, depth_m, arrival_s, velocity_mps, inundated, elevation_m}` |
| GET | `/runs/{id}/export?fmt=geotiff\|shp\|kml` | `{url, filename}` |
| GET | `/runs/{id}/summary` | `{id, scenario_name, state, engine, breach_width, breach_depth, reservoir_level, sim_hours, run_id, status, photo}` |
| GET | `/comparisons?run_a=&run_b=` | `{a, b, mode, metrics:[{key, label, a, b, delta, pct, dir}]}` |
| GET | `/comparisons/{id}/longitudinal?lonlat=` | `{series:[{key, points:[{d, depth}]}]}` |
| GET | `/runs/{id}/stations` | `[{km, name, lon, lat, in_domain, peak_cms, arrival_hr, max_stage_m, max_depth_m}]` |
| GET | `/runs/{id}/series` | `{times_s, area_km2:{total,low,moderate,high}, reach_km, threshold_m, bands_m}` |
| GET | `/runs/{id}/hydrograph` | `{time_s, q_cms, level_m, peak_cms, peak_at_hr, released_hm3, duration_hr}` |
| GET | `/probes/{run_id}` | recent probes for Player depth chart: `[{t, depth_m, lat, lon}]` |

`metrics` keys (Comparison Summary order): `inundated_km2`, `peak_depth_m`, `arrival_s`,
`population`, `villages`, `roads_km`, `facilities`.

**Compare page = TIME comparison (decision D3):** maps are the same run rendered with
`?frame=N` tiles; the delta panel is built from `series` + the planned rows below
(planned = not yet implemented; must 404 honestly until built):

| Method | Path | Returns |
|---|---|---|
| GET | `/runs/{id}/series/roads` *(planned)* | per-frame `{times_s, roads_km, roads_cut:[{road_id, name, length_km}], people_in_water}` |
| GET | `/runs/{id}/evacuation` *(planned)* | `{corridors:[{geom, margin_h, class, people}], assembly:[{geom, people}], origins:[{...}], stats}` (409 until run complete) |

## Tiles

| Method | Path | Returns |
|---|---|---|
| GET | `/tiles/{run}/{kind}/{z}/{x}/{y}.png` | 256×256 PNG, `k` in `depth`\|`arrival`\|`velocity`\|`extent`\|`satellite`. 404 on out-of-range. `Cache-Control: public, max-age=300` |
| GET | `/tiles/{run}/meta.json` | `{minzoom, maxzoom, bounds:[w,s,e,n], kind, ramp:[{v,label,color}], tilejson:'2.2.0'}` |

## System

| Method | Path | Returns |
|---|---|---|
| GET | `/settings` | `{k:v}` |
| PUT | `/settings/{k}` | body `{value}` → `{ok:true}` |
| GET | `/jobs` | job rows `{id, type, status, progress, params, error, run_id, attempts, created, updated}` |
| POST | `/jobs/{id}/cancel` | `{ok:true}` |

## WebSocket

`/ws?topic=run:{id}` → `{type:'run', id, status, stage, pct, ...}`.
