-- ============================================================
-- NIYANTA authoritative DDL  (idempotent; runs on every boot)
-- SQLite (WAL, single file) — no extensions, no server.
-- Geometry columns are GeoJSON text; jsonb columns decode to
-- Python objects on read (see modules/db/client.py converters).
-- NO foreign keys by convention — integrity is enforced at the
-- application boundary so tables can be rebuilt, restored from
-- backup, or shipped as fixtures independently.
-- snake_case column names (no explicit column-name strings needed).
-- ============================================================

-- ============================================================
-- catalog: dataset · product · scenario · report
-- ============================================================
CREATE TABLE IF NOT EXISTS dataset (
  id           uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  kind         text NOT NULL,          -- dem|imagery_pre|imagery_post|sar|vector|dam|weather|population|gee_export|other
  name         text,
  path         text,                   -- relative to storage root
  crs          text,
  bbox         geojson,                -- Polygon (GeoJSON text)
  status       text NOT NULL DEFAULT 'uploaded',   -- uploaded|processing|ready|failed
  meta         jsonb NOT NULL DEFAULT '{}',
  river_id     uuid,
  dam_id       uuid,
  corridor_id  uuid,
  source_url   text,
  bytes        bigint,
  checksum     text,
  coverage_pct double precision,
  fetch_status text NOT NULL DEFAULT 'ready',      -- queued|downloading|ready|failed
  deleted_at   timestamptz,
  created      timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_dataset_kind ON dataset(kind) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS product (
  id             uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  kind           text NOT NULL,        -- depth|velocity|arrival|extent|hydrograph|frame|difference_raster|longitudinal_profile|...
  label          text,
  run_id         uuid,
  dataset_id     uuid,
  scenario_id    uuid,
  path           text,
  thumb          text,
  frame_t_s      double precision,
  status         text NOT NULL DEFAULT 'ready',    -- queued|generating|generated|processing|ready|failed
  meta           jsonb NOT NULL DEFAULT '{}',
  schema_version text NOT NULL DEFAULT '1.0',
  created        timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_product_kind_run ON product(kind, run_id);
CREATE INDEX IF NOT EXISTS ix_product_dataset ON product(dataset_id);

CREATE TABLE IF NOT EXISTS scenario (
  id          uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "case"      text NOT NULL,                    -- '1'|'2'|'3'
  case_name   text,                             -- reservoir_break|glacier_change|river_blockage
  name        text,
  spec        jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'draft',     -- draft|ready|running|complete
  target_kind text,                             -- dam|waterbody|river|watch_box
  target_id   uuid,
  river_id    uuid,
  dam_id      uuid,
  waterbody_id uuid,
  build_step  int NOT NULL DEFAULT 1,            -- Build stepper position 1..5
  risk_id     uuid,
  change_id   uuid,
  created     timestamptz NOT NULL DEFAULT (datetime('now')),
  updated     timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_scenario_case ON scenario("case");
CREATE INDEX IF NOT EXISTS ix_scenario_target ON scenario(target_kind, target_id);

CREATE TABLE IF NOT EXISTS report (
  id      uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_id  uuid,
  kind    text NOT NULL DEFAULT 'hadr',
  path    text,
  meta    jsonb NOT NULL DEFAULT '{}',
  created timestamptz NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- jobs: durable queue with atomic claim + lease
-- ============================================================
CREATE TABLE IF NOT EXISTS job (
  id           uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  type         text NOT NULL,
  status       text NOT NULL DEFAULT 'queued',   -- queued|running|done|failed|cancelled
  priority     int NOT NULL DEFAULT 0,
  progress     int NOT NULL DEFAULT 0,
  params       jsonb NOT NULL DEFAULT '{}',
  result       jsonb,
  log          text NOT NULL DEFAULT '',
  run_id       uuid,
  error        text,
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  claimed_by   text,                             -- worker identity holding the lease
  lease_until  timestamptz,                      -- claim expires without heartbeat -> reclaim
  heartbeat_at timestamptz,
  created      timestamptz NOT NULL DEFAULT (datetime('now')),
  updated      timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_job_status ON job(status, created);
CREATE INDEX IF NOT EXISTS ix_job_run ON job(run_id);
CREATE INDEX IF NOT EXISTS ix_job_claim ON job(priority DESC, created)
  WHERE status = 'queued';

-- ============================================================
-- run: execution + 7-stage pipeline + live metrics + frames + impact
-- ============================================================
CREATE TABLE IF NOT EXISTS run (
  id           uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  scenario_id  uuid NOT NULL,
  engine       text NOT NULL DEFAULT 'fast',     -- fast|delft3d|sph|hecras
  state        text NOT NULL DEFAULT 'DRAFT',    -- DRAFT|DATA_READY|QUEUED|RUNNING|POST_PROCESSING|VALIDATED|PUBLISHED|FAILED|CANCELLED
  stage        text,
  stage_status text,
  progress     int NOT NULL DEFAULT 0,
  error        text,
  metrics      jsonb NOT NULL DEFAULT '{}',
  result       jsonb,
  params       jsonb NOT NULL DEFAULT '{}',      -- {time_step_s, particles, resolution_m, domain_km, engine_label}
  started_at   timestamptz,
  finished_at  timestamptz,
  eta_seconds  int,
  created      timestamptz NOT NULL DEFAULT (datetime('now')),
  updated      timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_run_state ON run(state, created DESC);
CREATE INDEX IF NOT EXISTS ix_run_scenario ON run(scenario_id);

CREATE TABLE IF NOT EXISTS run_lifecycle (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id uuid NOT NULL,
  state  text,
  stage  text,
  ts     timestamptz NOT NULL DEFAULT (datetime('now')),
  detail text
);
CREATE INDEX IF NOT EXISTS ix_run_lifecycle_run ON run_lifecycle(run_id, ts);

CREATE TABLE IF NOT EXISTS run_stage (
  id       uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_id   uuid NOT NULL,
  idx      int NOT NULL,                        -- 1..7
  key      text NOT NULL,                       -- terrain|mesh|breach|solve|post|impact|validate
  title    text NOT NULL,
  subtitle text,
  status   text NOT NULL DEFAULT 'queued',      -- queued|running|done|failed|skipped
  progress int NOT NULL DEFAULT 0,
  detail   jsonb NOT NULL DEFAULT '{}',         -- target_resolution, domain, expected_cells, method
  started  timestamptz,
  finished timestamptz,
  UNIQUE (run_id, idx)
);

CREATE TABLE IF NOT EXISTS run_metric (
  run_id     uuid NOT NULL,
  key        text NOT NULL,                     -- mesh_cells|sim_time_s|iterations|eta_s|elapsed_s
  value      double precision,
  unit       text,
  text_value text,
  ts         timestamptz NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, key)
);

CREATE TABLE IF NOT EXISTS run_frame (
  id          uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_id      uuid NOT NULL,
  idx         int NOT NULL,
  t_s         double precision NOT NULL,
  label       text NOT NULL,                    -- "6h 00m"
  thumb_path  text,
  raster_path text,
  min_val     double precision,
  max_val     double precision,
  stats       jsonb NOT NULL DEFAULT '{}',      -- per-frame area/population/peak_depth
  UNIQUE (run_id, idx)
);

CREATE TABLE IF NOT EXISTS run_impact (
  run_id              uuid PRIMARY KEY,
  inundated_area_km2  double precision,
  peak_depth_m        double precision,
  affected_population bigint,
  affected_villages   int,
  affected_buildings  int,
  affected_roads_km   double precision,
  bridges             int,
  critical_facilities int,
  meta                jsonb NOT NULL DEFAULT '{}',
  updated             timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_comparison (
  id       uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_a    uuid NOT NULL,
  run_b    uuid NOT NULL,
  status   text NOT NULL DEFAULT 'queued',
  metrics  jsonb NOT NULL DEFAULT '[]',          -- [{key,label,unit,a,b,delta,delta_pct}]
  products jsonb NOT NULL DEFAULT '{}',          -- difference_raster|longitudinal_profile|extent_overlap
  error    text,
  created  timestamptz NOT NULL DEFAULT (datetime('now')),
  updated  timestamptz NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_a, run_b)
);

CREATE TABLE IF NOT EXISTS run_probe (
  id        uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_id    uuid NOT NULL,
  point_key text NOT NULL,                      -- "30.10320,78.29760" (5dp — avoids float UNIQUE)
  lon       double precision NOT NULL,
  lat       double precision NOT NULL,
  label     text,
  series    jsonb NOT NULL DEFAULT '[]',        -- [{t_s, depth_m, velocity_mps, arrival_s}]
  created   timestamptz NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_id, point_key)
);

-- ============================================================
-- shared processing log (all proc_* modules + Run console)
-- ============================================================
CREATE TABLE IF NOT EXISTS proc_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id uuid,
  run_id     uuid,
  stage      text,
  level      text NOT NULL DEFAULT 'info',       -- info|warn|error
  status     text,                               -- start|done|failed
  msg        text,
  ts         timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_proc_log_dataset ON proc_log(dataset_id, ts);
CREATE INDEX IF NOT EXISTS ix_proc_log_run ON proc_log(run_id, ts);

-- ============================================================
-- connector (bottom status bar: Online / Local)
-- ============================================================
CREATE TABLE IF NOT EXISTS connector_snapshot (
  id        uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name      text NOT NULL UNIQUE,                -- wris|osm|worldpop|weather|dem|esri|gee|hydro_rivers|dam_registry
  label     text,                                -- display label for the status bar
  icon      text,
  mode      text NOT NULL DEFAULT 'local',       -- online|local|offline
  status    text NOT NULL DEFAULT 'idle',        -- idle|syncing|ok|failed
  counts    jsonb NOT NULL DEFAULT '{}',
  last_sync timestamptz,
  error     text
);

-- ============================================================
-- mesh / breach
-- ============================================================
CREATE TABLE IF NOT EXISTS mesh_meta (
  run_id          uuid PRIMARY KEY,
  centerline_path text,
  sections_count  int NOT NULL DEFAULT 0,
  cells_count     int NOT NULL DEFAULT 0,
  dam_structure   jsonb NOT NULL DEFAULT '{}',
  meta            jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS breach_solution (
  scenario_id       uuid PRIMARY KEY,
  method            text,
  mode              text,
  shape             text NOT NULL DEFAULT 'trapezoidal',  -- trapezoidal|rectangular|parabolic
  width_m           double precision,
  depth_m           double precision,
  side_slope        double precision,
  t_form_hr         double precision,
  reservoir_level_m double precision,
  sim_hours         double precision,
  hydrograph_path   text,
  sensitivity       jsonb,
  created           timestamptz NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- risk / trigger
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_assessment (
  id         uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "case"     text,                               -- '1' reservoir | '2' event
  target_id  uuid,
  target_ref text,
  score      double precision NOT NULL,
  class      text NOT NULL,                      -- LOW|MODERATE|HIGH|CRITICAL
  factors    jsonb NOT NULL DEFAULT '{}',
  ts         timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_risk_target ON risk_assessment(target_id, ts DESC);

CREATE TABLE IF NOT EXISTS trigger_event (
  id      uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  kind    text NOT NULL,                         -- reservoir|change|manual
  box_id  uuid,
  risk_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  ts      timestamptz NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- gee / watch (Case 1 monitoring + Case 2 glacier change)
-- ============================================================
CREATE TABLE IF NOT EXISTS watch_box (
  id      uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name    text NOT NULL,
  preset  text,                                  -- rishiganga|kosi|phuktal|hidkal|auto|custom
  kind    text,                                  -- river|glacier|reservoir|flood
  state   text,
  bbox    geojson NOT NULL,                      -- Polygon (GeoJSON text)
  meta    jsonb NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT 1,
  created timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS glacier (
  id        uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name      text NOT NULL,
  state     text,
  district  text,
  area_km2  double precision,
  centroid  geojson,                             -- Point (GeoJSON text)
  bbox      geojson,                             -- Polygon (GeoJSON text)
  thumb     text,
  source    text NOT NULL DEFAULT 'rgi',
  meta      jsonb NOT NULL DEFAULT '{}',
  created   timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gee_job (
  id       uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  box_id   uuid,
  kind     text NOT NULL,                         -- s2_indices|s1_watermask|lst_snow|flood_extent|glacier_ice
  status   text NOT NULL DEFAULT 'queued',        -- queued|running|done|failed
  params   jsonb NOT NULL DEFAULT '{}',
  result   jsonb,
  error    text,
  started  timestamptz,
  finished timestamptz,
  created  timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observation (
  id        uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  box_id    uuid,
  glacier_id uuid,
  sensor    text NOT NULL,                        -- sentinel2|sentinel1|lst|era5
  kind      text NOT NULL,                        -- imagery|water_mask|indices|lst
  path      text,
  acquired  date,
  meta      jsonb NOT NULL DEFAULT '{}',
  created   timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_obs_box ON observation(box_id, acquired DESC);
CREATE INDEX IF NOT EXISTS ix_obs_glacier ON observation(glacier_id, acquired DESC);

CREATE TABLE IF NOT EXISTS baseline (
  id      uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  box_id  uuid NOT NULL,
  sensor  text NOT NULL,
  path    text,
  metrics jsonb NOT NULL DEFAULT '{}',
  updated timestamptz NOT NULL DEFAULT (datetime('now')),
  UNIQUE (box_id, sensor)
);

CREATE TABLE IF NOT EXISTS change_detection (
  id             uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  box_id         uuid,
  glacier_id     uuid,
  kind           text NOT NULL,                   -- lake_area|water_mask|snow|lst|glacier|flood|glacier_extent|blockage|high_rainfall|reservoir_anomaly
  flagged        boolean NOT NULL DEFAULT 0,
  delta_pct      double precision,                -- "+18.4%" promoted for fast queries
  metrics        jsonb NOT NULL DEFAULT '{}',     -- {area_km2, delta_pct, iou, ...}
  baseline_id    uuid,
  observation_id uuid,
  ts             timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_change_box ON change_detection(box_id, ts DESC);
CREATE INDEX IF NOT EXISTS ix_change_glacier ON change_detection(glacier_id, ts DESC);
CREATE INDEX IF NOT EXISTS ix_change_ts_kind ON change_detection(kind, ts DESC);

-- ============================================================
-- alert (Watch feed + GEE detection counters)
-- ============================================================
CREATE TABLE IF NOT EXISTS alert (
  id         uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  level      text NOT NULL DEFAULT 'INFO',        -- INFO|WARNING|CRITICAL
  category   text,                                -- glacier_change|reservoir_anomaly|blockage|high_rainfall|glacier_lake|flood
  title      text NOT NULL,
  body       text DEFAULT '',
  location   text,                                -- "Chamoli, Uttarakhand"
  run_id     uuid,
  box_id     uuid,
  dam_id     uuid,
  river_id   uuid,
  glacier_id uuid,
  state      text NOT NULL DEFAULT 'NEW',         -- NEW|ACK|DISPATCH|CLOSED
  source     text NOT NULL DEFAULT 'system',
  payload    jsonb NOT NULL DEFAULT '{}',
  created    timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_alert_category ON alert(category, created DESC);
CREATE INDEX IF NOT EXISTS ix_alert_active ON alert(created DESC) WHERE state <> 'CLOSED';

CREATE TABLE IF NOT EXISTS alert_action (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id uuid NOT NULL,
  action   text NOT NULL,                         -- ack|dispatch|close|note
  actor    text DEFAULT 'operator',
  note     text,
  ts       timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_rule (
  id        uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name      text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}',          -- {metric, op, threshold}
  active    boolean NOT NULL DEFAULT 1,
  created   timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriber (
  id      uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name    text,
  channel text NOT NULL DEFAULT 'ws',             -- ws|sms|email
  target  text,
  active  boolean NOT NULL DEFAULT 1
);

-- ============================================================
-- export / validate
-- ============================================================
CREATE TABLE IF NOT EXISTS export_job (
  id       uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  run_id   uuid NOT NULL,
  formats  jsonb NOT NULL DEFAULT '[]',           -- ["geotiff","shp","kml"]
  status   text NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0,
  path     text,
  files    jsonb NOT NULL DEFAULT '[]',
  error    text,
  created  timestamptz NOT NULL DEFAULT (datetime('now')),
  updated  timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_score (
  run_id            uuid PRIMARY KEY,
  benchmark         text,
  error_peak_pct    double precision,
  error_arrival_pct double precision,
  extent_error_pct  double precision,
  extent_iou        double precision,
  grade             text,
  detail            jsonb NOT NULL DEFAULT '{}',
  created           timestamptz NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- geographic registry: dam · reservoir_level · vector · population
-- ============================================================
CREATE TABLE IF NOT EXISTS dam (
  id               uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name             text NOT NULL,
  river            text,
  river_id         uuid,
  state            text,
  country          text DEFAULT 'IN',
  location         geojson,                       -- Point (GeoJSON text)
  dam_type         text,                          -- rockfill|concrete|earth|arch|gravity
  photo            text,
  crest_m          double precision,
  height_m         double precision,
  fsl_m            double precision,
  storage_mcm      double precision,
  crest_length_m   double precision,
  river_km         double precision,              -- distance from river source
  purpose          text,
  registry_source  text,                          -- cwc|goodd|grand|geodar|demo
  ingest_status    text NOT NULL DEFAULT 'complete', -- listed|located|dem_ready|complete
  dem_status       text NOT NULL DEFAULT 'none',  -- none|partial|cached
  imagery_status   text NOT NULL DEFAULT 'none',
  dataset_id       uuid,
  meta             jsonb NOT NULL DEFAULT '{}',
  created          timestamptz NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservoir_level (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dam_id      uuid NOT NULL,
  ts          timestamptz NOT NULL,
  level_m     double precision,
  storage_mcm double precision,
  inflow_cms  double precision,
  outflow_cms double precision
);
CREATE INDEX IF NOT EXISTS ix_reslevel_dam ON reservoir_level(dam_id, ts DESC);

CREATE TABLE IF NOT EXISTS vector_feature (
  id         uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  dataset_id uuid,
  layer      text NOT NULL,                       -- village|road|bridge|hospital|school|critical|power|state_boundary|district_boundary
  name       text,
  geom       geojson,                             -- any GeoJSON geometry (text)
  props      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_vfeature_layer ON vector_feature(layer);

CREATE TABLE IF NOT EXISTS village_population (
  village_id uuid PRIMARY KEY,
  count      int NOT NULL DEFAULT 0,
  source     text,
  updated    timestamptz NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- discover: river · corridor · infra · river_dam_ref · corridor_dataset
-- ============================================================
CREATE TABLE IF NOT EXISTS river (
  id               uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name             text NOT NULL,
  name_alt         jsonb DEFAULT '[]',
  kind             text,                          -- river|stream|tributary
  basin            text,                          -- Ganga|Brahmaputra|Indus|Narmada|Godavari
  states           jsonb DEFAULT '[]',
  country          text DEFAULT 'IN',
  state            text,
  source_name      text,                          -- "Gangotri Glacier (Uttarakhand)"
  mouth_name       text,                          -- "Ganga Sagar (West Bengal)"
  osm_id           bigint,
  hydro_rivers_id  text,
  path             geojson,                       -- LineString (GeoJSON text)
  bbox             geojson,                       -- Polygon (GeoJSON text)
  length_km        double precision,
  drainage_km2     double precision,
  major_dam_count  int NOT NULL DEFAULT 0,
  featured         boolean NOT NULL DEFAULT 0,
  rank             int,
  thumb            text,
  source           text NOT NULL DEFAULT 'osm',   -- osm|hydro_rivers|dem|manual
  prepared_at      timestamptz,
  created          timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_river_basin ON river(basin);
CREATE INDEX IF NOT EXISTS ix_river_length ON river(length_km DESC);
CREATE INDEX IF NOT EXISTS ix_river_featured ON river(rank) WHERE featured;

CREATE TABLE IF NOT EXISTS river_dam_ref (
  id              uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  river_id        uuid NOT NULL,
  dam_id          uuid,                           -- NULL => listed but not ingested ("Missing")
  name            text NOT NULL,
  state           text,
  distance_km     double precision,               -- "Distance from Source"
  registry_source text,                           -- cwc|grand|geodar
  status          text NOT NULL DEFAULT 'missing', -- in_db|missing
  UNIQUE (river_id, name)
);
CREATE INDEX IF NOT EXISTS ix_dam_ref_river ON river_dam_ref(river_id, status);

CREATE TABLE IF NOT EXISTS corridor (
  id             uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  river_id       uuid NOT NULL,
  buffer_m       int NOT NULL DEFAULT 20000,
  dam_total      int NOT NULL DEFAULT 0,
  dam_cached     int NOT NULL DEFAULT 0,
  dam_missing    int NOT NULL DEFAULT 0,
  bytes          bigint NOT NULL DEFAULT 0,
  coverage_pct   double precision NOT NULL DEFAULT 0,
  imagery_status text NOT NULL DEFAULT 'idle',    -- idle|fetching|ready|failed
  osm_status     text NOT NULL DEFAULT 'idle',
  pop_status     text NOT NULL DEFAULT 'idle',
  dem_status     text NOT NULL DEFAULT 'idle',
  status         text NOT NULL DEFAULT 'draft',   -- draft|preparing|ready|failed
  updated        timestamptz NOT NULL DEFAULT (datetime('now')),
  created        timestamptz NOT NULL DEFAULT (datetime('now')),
  UNIQUE (river_id)
);

CREATE TABLE IF NOT EXISTS corridor_dataset (
  id           uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  corridor_id  uuid NOT NULL,
  kind         text NOT NULL,                     -- dem|imagery_s2|sar_s1|dams|osm|worldpop
  label        text NOT NULL,                     -- "DEM (30m)"
  source       text,                              -- "Copernicus"
  coverage_pct double precision NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'idle',      -- available|partial|missing|fetching|failed
  bytes        bigint NOT NULL DEFAULT 0,
  dataset_id   uuid,
  updated      timestamptz NOT NULL DEFAULT (datetime('now')),
  UNIQUE (corridor_id, kind)
);

CREATE TABLE IF NOT EXISTS infra_footprint (
  id          uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  river_id    uuid,
  kind        text NOT NULL,                      -- building|bridge|road|hospital|school|power
  name        text,
  geom        geojson,                            -- any GeoJSON geometry (text)
  attrs       jsonb NOT NULL DEFAULT '{}',
  model_count int NOT NULL DEFAULT 1,             -- 3D slider multiplier target
  source      text NOT NULL DEFAULT 'osm',        -- osm|worldpop|manual
  created     timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_infra_river ON infra_footprint(river_id, kind);
-- Spatial index (R*Tree on the footprint bbox, keyed by rowid): "features in
-- this run's grid" is an index probe, not a parse of every row — a basin clip
-- holds millions of buildings. Triggers keep it in step; seed backfills.
CREATE VIRTUAL TABLE IF NOT EXISTS infra_rtree USING rtree(id, minx, maxx, miny, maxy);
CREATE TRIGGER IF NOT EXISTS infra_rtree_ai AFTER INSERT ON infra_footprint BEGIN
  INSERT OR REPLACE INTO infra_rtree VALUES (new.rowid, ST_XMin(new.geom), ST_XMax(new.geom),
                                             ST_YMin(new.geom), ST_YMax(new.geom));
END;
CREATE TRIGGER IF NOT EXISTS infra_rtree_ad AFTER DELETE ON infra_footprint BEGIN
  DELETE FROM infra_rtree WHERE id = old.rowid;
END;

-- ============================================================
-- waterbodies: any lake / pond / reservoir / glacier lake
-- ============================================================
CREATE TABLE IF NOT EXISTS waterbody (
  id              uuid PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || printf('%x', 8 + (abs(random()) % 4)) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name            text NOT NULL,
  kind            text NOT NULL,                  -- lake|pond|reservoir|glacier_lake|wetland
  state           text,
  country         text DEFAULT 'IN',
  area_km2        double precision,
  perimeter_km    double precision,
  storage_mcm     double precision,
  outlet_river_id uuid,
  centroid        geojson,                        -- Point (GeoJSON text)
  geom            geojson,                        -- Polygon (GeoJSON text)
  bbox            geojson,                        -- Polygon (GeoJSON text)
  source          text NOT NULL DEFAULT 'osm',
  meta            jsonb NOT NULL DEFAULT '{}',
  created         timestamptz NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_wb_kind ON waterbody(kind);

-- ============================================================
-- UI preferences + system state (layer toggles, last-updated)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_setting (
  key     text PRIMARY KEY,
  value   jsonb NOT NULL DEFAULT '{}',
  updated timestamptz NOT NULL DEFAULT (datetime('now'))
);
