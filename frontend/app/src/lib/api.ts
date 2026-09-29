/** Typed fetch wrappers for every route in docs/API_CONTRACT.md.
 *  All backend routes live under /api (vite proxy). Any 404/500/timeout throws
 *  ApiError; screens render an honest empty state instead of inventing values. */

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  const text = await res.text().catch(() => '')
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  const detail = typeof (body as { detail?: unknown } | null)?.detail === 'string' ? (body as { detail: string }).detail : null
  if (!res.ok) {
    const message = detail ?? text
    throw new ApiError(res.status, `${res.status} ${res.statusText}${message ? ` - ${message.slice(0, 160)}` : ''}`)
  }
  // FastAPI error envelope. It can arrive with a 2xx when a proxy answers for
  // an app that never mounted the route. The envelope is `{detail}` alone —
  // real payloads may carry their own `detail` field (terrain.json does).
  if (detail && Object.keys(body as object).length === 1) throw new ApiError(res.status, detail.slice(0, 160))
  return body as T
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
})

/* ------------------------------------------------------------------ system */

export interface Health {
  status: string
  db: string
  workers: number
  queue_depth: number
  handlers: string[]
  engine_root?: string
  engine_present?: boolean
  gee_mode?: string
}

export interface SystemSource {
  id: string
  label: string
  state: 'online' | 'local'
}

export interface SystemInfo {
  region: string
  epsg: string
  updated_at: string
  sources: SystemSource[]
}

/* ------------------------------------------------------------------- watch */

export interface Overview {
  dams: number
  watch_boxes: number
  alerts: number
  rivers: number
}

export interface AlertRow {
  id: string
  kind?: string | null
  category?: string | null
  title: string
  location?: string | null
  lat?: number | null
  lon?: number | null
  state?: string | null
  river_name?: string | null
  severity?: string | null
  level?: string | null
  box_id?: string | null
  created_at?: string | null
  created?: string | null
}

export interface GeeDetections {
  water_extent: number
  glacier: number
  rainfall: number
  blockage: number
  total: number
}

export interface FeaturedRiver {
  id: string
  name: string
  length_km: number
  major_dam_count: number
  thumbnail?: string | null
  basin?: string | null
  rank?: number
}

export interface LayerDef {
  id: string
  group: 'base' | 'overlay'
  label: string
  source: string
  enabled: boolean
}

export interface WatchBox {
  id: string
  name: string
  preset?: string | null
  kind?: string | null
  state?: string | null
  bbox?: string | null
  bbox_geojson?: GeoJsonPolygon | null
  active?: boolean
  created?: string | null
}

export interface WatchChange {
  id: string
  box_id: string
  glacier_id?: string | null
  kind: string
  flagged: boolean
  delta_pct: number | null
  metrics?: Record<string, unknown> | null
  baseline_id?: string | null
  observation_id?: string | null
  ts?: string | null
}

export interface BeforeAfter {
  box_id: string
  before_km2: number | null
  after_km2: number | null
  delta_pct: number | null
  baseline?: { id: string; sensor?: string | null; metrics?: Record<string, unknown> } | null
  latest?: { id: string; sensor?: string | null; metrics?: Record<string, unknown> } | null
}

/* --------------------------------------------------------------- discover */

export interface GeoJsonLineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export interface RiverSearchItem {
  id: string | null
  name: string
  length_km?: number | null
  basin?: string | null
  states?: string[] | null
  state?: string | null
  major_dam_count?: number | null
  source: string
  kind?: string | null
  prepared_at?: string | null
  path?: GeoJsonLineString | null
  bbox?: number[] | null
  /** World tier only: false means it was fetched from OSM and saved just now. */
  cached?: boolean
}

export interface RiverDetail {
  id: string
  name: string
  length_km?: number | null
  basin?: string | null
  states?: string[] | null
  state?: string | null
  source?: string | null
  kind?: string | null
  source_name?: string | null
  mouth_name?: string | null
  major_dam_count?: number | null
  geometry?: unknown
  path?: GeoJsonLineString | null
  bbox?: number[] | null
}

export interface RiverDam {
  id: string
  name: string
  state?: string | null
  dam_type?: string | null
  height_m?: number | null
  status: 'in_db' | 'missing'
  distance_km?: number | null
  /** False means the curated registry links it but the corridor does not cover it. */
  in_corridor?: boolean
  lat?: number | null
  lon?: number | null
  cwc_id?: string | null
  gap_km?: number | null
}

export interface RiverCorridor {
  river_id: string
  buffer_km: number
  area_km2: number
  geometry: GeoJsonPolygon
}

export interface AvailabilityBand {
  pct: number
  present: boolean
}

export interface Availability {
  coverage_pct: number
  /** Width the bands below were measured at, and the width the slider asks for. */
  buffer_km: number
  corridor_buffer_km: number | null
  /** true when the corridor was prepared for a different slider position. */
  stale: boolean
  dem: AvailabilityBand
  sentinel2: AvailabilityBand
  osm: AvailabilityBand
  worldpop: AvailabilityBand
  dam_registry: AvailabilityBand
}

export interface Corridor {
  id: string
  river_id: string
  length_km?: number | null
  coverage_pct?: number | null
  dem_status?: string | null
  status: string
  created_at?: string | null
}

export interface CorridorJob {
  id: string
  status: 'queued' | 'running' | 'paused' | 'failed'
  progress: number
  error?: string | null
  message?: string | null
}

export interface CorridorDataset {
  kind: string
  label: string
  source: string
  coverage_pct: number
  status: 'available' | 'partial' | 'missing' | 'fetching' | 'failed'
  size_bytes: number | null
  job?: CorridorJob | null
}

/** Kinds this staging actually prepares/shows. OSM, SAR and Sentinel-2 come
 *  back for a later glacier-change page (manual upload), not the Discover flow. */
export const STAGING_KINDS = new Set(['dem', 'dams', 'worldpop'])

/** The subset that gates the workflow. DEM terrain + dam registry describe the
 *  corridor itself; WorldPop is optional — impact falls back to GHS-POP/OSM or
 *  manual entry in Build, so a missing population file never blocks a run. */
export const REQUIRED_STAGING_KINDS = new Set(['dem', 'dams'])

export interface Job {
  id: string
  type: string
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  progress: number
  params?: Record<string, unknown> | null
  error?: string | null
  created?: string | null
  updated?: string | null
}

/* ------------------------------------------------------------------- build */

export interface DamRow {
  id: string
  name: string
  state?: string | null
  lat?: number | null
  lon?: number | null
  river_id?: string | null
  river_name?: string | null
  dam_type?: string | null
  height_m?: number | null
  length_m?: number | null
  crest_length_m?: number | null
  heading_deg?: number | null
  crest_m?: number | null
  fsl_m?: number | null
  capacity_mcm?: number | null
  storage_mcm?: number | null
  purpose?: string | null
  status?: string | null
  cwc_id?: string | null
  source?: string | null
  photo?: string | null
  ingest_status?: string | null
}

export interface Bbox {
  crs?: string
  type?: string
  coords: number[]
}

export interface ScenarioBreach {
  mode?: string
  method?: string
  depth_m?: number
  width_m?: number
  chainage_m?: number
  side_slope?: number
  formation_time_hr?: number
  timing?: { start_iso?: string | null; instantaneous?: boolean }
}

export interface ScenarioReservoir {
  area_km2?: number
  inflow_cms?: number
  bed_level_m?: number | null
  storage_mcm?: number
  dam_height_m?: number
  crest_level_m?: number | null
  initial_level_m?: number
}

export interface ScenarioHorizon {
  dt_s?: number
  duration_hr?: number
}

/** Manual impact numbers the Build page records on the scenario. The run
 *  prefers them over the modelled totals when present (see work_impact). */
export interface ScenarioImpact {
  source?: 'worldpop' | 'manual'
  population?: number | null
  houses?: number | null
  assets_million?: number | null
}

export interface ScenarioSpec {
  aoi?: Bbox
  case?: string
  name?: string
  breach?: ScenarioBreach
  dam_id?: string | null
  engine?: string
  horizon?: ScenarioHorizon
  dam_type?: string
  reservoir?: ScenarioReservoir
  erodibility?: string
  impact?: ScenarioImpact
  /** Downstream study reach the user chose on Build, in km. Frozen here at
   *  save time so Run/Results/Compare/Player never re-derive a different
   *  number from mutable context state. */
  reach_km?: number
  [key: string]: unknown
}

/** Wet window of one feature: frames f0..f1 with depth s[i − f0] (m), peak d.
 *  All absent → never reached the threshold (dry for the whole run). */
export interface InfraExposure {
  f0?: number
  f1?: number
  d?: number
  s?: number[]
}
/** OSM infrastructure in the model grid, sampled against every output frame. */
export interface RunInfra {
  frames: number
  times_s: number[]
  thresholds: { building_m: number; road_cut_m: number }
  summary: {
    buildings: number
    buildings_flooded: number
    road_km: number
    road_km_cut: number
    bridges: number
    bridges_flooded: number
  }
  /** x/y = centroid lon/lat, a = footprint side (m). */
  buildings: (InfraExposure & { x: number; y: number; a: number })[]
  /** p = [lon1, lat1, lon2, lat2] of one segment, km = its length. */
  roads: (InfraExposure & { p: [number, number, number, number]; km: number })[]
  points: (InfraExposure & { k: string; n?: string | null; x: number; y: number })[]
}

/** Depth (m) of a feature at frame i, or null when outside its wet window. */
export function infraDepthAt(f: InfraExposure, i: number): number | null {
  if (f.f0 == null || f.f1 == null || !f.s || i < f.f0 || i > f.f1) return null
  return f.s[i - f.f0] ?? null
}

/** Infrastructure state colours — shared by the 3D scene and the 2D map. */
export const INFRA_COLORS = {
  dryBuilding: '#ece7da',
  dryRoad: '#f4e4a6',
  dryPoint: '#e2e8f0',
  was: '#f59e0b', // flooded earlier, water has passed
  wetLo: '#fb923c', // just over the threshold
  wetHi: '#991b1b', // 3 m and deeper
} as const

function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16))
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16))
  return `#${pa.map((v, k) => Math.round(v + (pb[k] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** Hex colour of a feature at frame i (null = the run's peak / max view):
 *  over `thr` → orange→dark red by depth, past its wet window → amber, else `dry`. */
export function infraColorHex(f: InfraExposure, i: number | null, thr: number, dry: string): string {
  const d = i == null ? (f.d ?? null) : infraDepthAt(f, i)
  if (d != null && d > thr) return mixHex(INFRA_COLORS.wetLo, INFRA_COLORS.wetHi, Math.min(1, d / 3))
  if (i != null && f.f0 != null && i >= f.f0) return INFRA_COLORS.was
  return dry
}

/** One SPH output frame: `data` is flat [col, row, z m, speed m/s, …] on the solve grid. */
export interface RunParticles {
  frame: number
  frames: number
  t_s: number
  count: number
  l0_m: number
  cell_m: number
  data: number[]
}

/** Run DEM for the 3D player: rows[0] = north, bounds = (w, s, e, n).
 *  `detail=full` serves the solve-grid resolution, `std` the ≤200/axis cut. */
export interface Terrain3D {
  bounds: number[]
  cell_m: number
  step: number
  detail?: string
  min: number
  max: number
  rows: number[][]
}

export interface Scenario {
  id: string
  case?: string | null
  case_name?: string | null
  name?: string | null
  status?: string | null
  spec?: ScenarioSpec
  created?: string | null
}

export interface BreachProfile {
  shape: string
  points: { x: number; y: number }[]
  width: number
  depth: number
  level: number
}

export interface BreachFixture {
  method: string
  fixture: string
  result: {
    method: string
    avg_width_m: number
    bottom_width_m: number
    side_slope: number
    depth_m: number
    t_form_hr: number
    volume_eroded_m3?: number | null
    top_width_m?: number | null
    notes?: string
  }
}

/* --------------------------------------------------------------------- run */

export interface Run {
  id: string
  scenario_id: string
  engine: string
  status?: string | null
  state?: string | null
  stage?: string | null
  stage_status?: string | null
  stage_label?: string | null
  pct?: number | null
  progress?: number | null
  eta_seconds?: number | null
  elapsed_seconds?: number | null
  started_at?: string | null
  finished_at?: string | null
  created?: string | null
  updated?: string | null
  error?: string | null
  spec?: ScenarioSpec | null
  scenario_name?: string | null
  scenario_case?: string | null
}

export interface RunDetail {
  run: Run
  /** `GET /api/runs/{id}` returns the scenario row alongside the run, so one
   *  call carries both the run state and its persisted spec. */
  scenario?: Scenario | null
  lifecycle?: unknown
  jobs?: unknown[]
  products?: unknown[]
}

export interface StageRow {
  n: number
  key: string
  title: string
  status: 'done' | 'active' | 'pending'
  pct: number
  detail?: string | null
}

export interface RunMetrics {
  mesh_cells?: number | null
  domain_km2?: number | null
  dt_s?: number | null
  sim_time_s?: number | null
  iterations?: number | null
  hardware?: string | null
}

export interface RunOutput {
  key: 'dem' | 'mesh' | 'breach' | 'water'
  status: string
  thumb?: string | null
  elevation?: [number, number] | null
}

export interface LogLine {
  ts: string
  level: string
  message: string
}

export interface RunParams {
  target_resolution_m?: number | null
  domain_km?: number | null
  expected_cells?: number | null
  method?: string | null
  dt_s?: number | null
  duration_hr?: number | null
  engine_label?: string | null
  particles?: number | null
  storage_mcm?: number | null
}

/* ----------------------------------------------------- results / compare */

export interface Frame {
  i: number
  t: number
  t_label: string
  thumbnail?: string | null
}

export interface RampStop {
  v: number
  label: string
  color: string
}

export interface FramesDoc {
  frames: Frame[]
  kind: string
  kind_label: string
  ramp: RampStop[]
  sim_hours: number
}

export interface HydroPoint {
  t: number
  sph: number | null
  delft3d: number | null
  fast: number | null
}

export interface Impact {
  inundated_km2?: number | null
  population?: number | null
  villages?: number | null
  roads_km?: number | null
  bridges?: number | null
  facilities?: number | null
  buildings?: number | null
  peak_depth_m?: number | null
  population_method?: string | null
  population_source?: string | null
  hydrograph?: HydroPoint[]
  hydrograph_labels?: string[] | null
}

/** One dam screened by POST /runs/{id}/cascade (event-in → dams-out). */
export interface CascadeDam {
  dam_id: string
  name?: string | null
  state?: string | null
  lon: number
  lat: number
  distance_km?: number | null
  max_depth_m?: number | null
  max_vel_ms?: number | null
  arrival_hr?: number | null
  bed_m?: number | null
  crest_m?: number | null
  /** true = water over recorded crest; false = wet but held; null = unknown geometry. */
  overtopped?: boolean | null
  status: 'overtopped' | 'exposed' | 'exposed-unknown-geometry' | 'dry' | 'outside-domain'
  scenario_id?: string | null
}

export interface CascadeResult {
  run_id: string
  source_dam?: { dam_id: string; name?: string | null; lon: number; lat: number } | null
  depth_threshold_m: number
  dams: CascadeDam[]
  scenarios_created: { dam_id: string; scenario_id: string }[]
}

/** One affected village from GET /runs/{id}/hazard-villages (stage.impact). */
export interface HazardVillageFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    name?: string | null
    hazard?: string | null
    depth_m?: number | null
    arrival_hr?: number | null
    population?: number | null
  }
}

export interface HazardVillages {
  type: 'FeatureCollection'
  features: HazardVillageFeature[]
}

export interface Probe {
  lat: number
  lon: number
  depth_m?: number | null
  arrival_s?: number | null
  velocity_mps?: number | null
  inundated?: boolean | null
  elevation_m?: number | null
  /** Metres to the nearest wet cell (0 = this cell); null when none nearby. */
  nearest_water_m?: number | null
}

/** One gauge (CH0 = breach, CH5 = 5 km downstream, …). */
export interface RunStation {
  km: number
  name?: string | null
  lon?: number | null
  lat?: number | null
  /** false → station lies beyond the modelled centreline; values are clamped. */
  in_domain?: boolean
  peak_cms?: number
  arrival_hr?: number | null
  max_stage_m?: number
  max_depth_m?: number
}

/** GET /runs/{id}/series — area by hazard class + flood-front reach per frame. */
export interface RunSeries {
  times_s: number[]
  area_km2: { total: number[]; low: number[]; moderate: number[]; high: number[] }
  reach_km: number[]
  threshold_m: number
  bands_m: [number, number]
}

export interface ResultMetrics {
  peak_discharge_cms?: number
  peak_at_hr?: number
  max_depth_m?: number
  inundation_km2?: number
  volume_hm3?: number
  mass_balance_error_pct?: number
  duration_hr?: number
  near_field_only?: boolean
  window_m?: number
}

/** GET /runs/{id}/result — canonical RunResult written by the pipeline. */
export interface RunResultDoc {
  schema_version?: string
  run_id?: string
  scenario_id?: string
  engine?: string
  metrics?: ResultMetrics
  rasters?: Record<string, string>
  stations?: RunStation[]
  series?: RunSeries
}

/** GET /runs/{id}/hydrograph — breach outflow series (stage.breach product). */
export interface BreachHydrograph {
  time_s: number[]
  q_cms: number[]
  level_m?: number[]
  peak_cms?: number
  peak_at_hr?: number
  released_hm3?: number
  duration_hr?: number
}

export interface RunSummary {
  id: string
  scenario_name?: string | null
  state?: string | null
  engine?: string | null
  engine_label?: string | null
  near_field_only?: boolean | null
  window_m?: number | null
  breach_width?: number | null
  breach_depth?: number | null
  breach_method?: string | null
  reservoir_level?: number | null
  sim_hours?: number | null
  run_id?: string | null
  status?: string | null
  photo?: string | null
  created?: string | null
  finished_at?: string | null
}

export interface ComparisonMetric {
  key: string
  label: string
  a: number | null
  b: number | null
  delta: number | null
  pct: number | null
  dir: string | null
}

/** Colour ramp as the server paints it — legends render these, never local constants. */
export interface RampSet {
  depth?: RampStop[]
  arrival?: RampStop[]
  velocity?: RampStop[]
  extent?: RampStop[]
  difference?: RampStop[]
}

export interface Comparison {
  a: string
  b: string
  mode: string
  metrics: ComparisonMetric[]
  /** B − A ramp (also mirrored inside `ramps.difference`). */
  ramp?: RampStop[]
  extent_ramp?: RampStop[]
  ramps?: RampSet
}

export interface Longitudinal {
  series: { key: string; points: { d: number; depth: number }[] }[]
}

export interface ExportDoc {
  url: string
  filename: string
}

/** POST /exports row, then GET /exports/{id} while the job packages. */
export interface ExportJob {
  id: string | number
  run_id?: string | null
  formats?: string[] | string | null
  status?: string | null
  progress?: number | null
  path?: string | null
  files?: string[] | null
  error?: string | null
  /** Present once `status === 'done'`. */
  download_url?: string | null
}

/* ------------------------------------------------------------------ tiles */

export interface TileMeta {
  minzoom: number
  maxzoom: number
  bounds: [number, number, number, number]
  kind: string
  ramp: RampStop[]
  /** Every paintable kind, so overlays invert without copying server constants. */
  ramps?: Record<string, RampStop[]>
  /** Diff pairs only: A-only / B-only / overlap classes. */
  extent_ramp?: RampStop[]
  tilejson: string
}

export const tiles = {
  meta: (run: string, vs?: string) =>
    request<TileMeta>(vs ? `/tiles/diff/${run}/${vs}/meta.json` : `/tiles/${run}/meta.json`),
  /** frame = one output instant (depth/extent tiles); ignored for diff pairs. */
  url: (run: string, kind: string, vs?: string, frame?: number | null) =>
    vs
      ? `/api/tiles/diff/${run}/${vs}/${kind}/{z}/{x}/{y}.png`
      : `/api/tiles/${run}/${kind}/{z}/{x}/{y}.png${frame != null ? `?frame=${frame}` : ''}`,
}

/* ----------------------------------------------------------------- routes */

export const api = {
  health: () => request<Health>('/health'),
  system: () => request<SystemInfo>('/system'),

  // watch
  overview: () => request<Overview>('/watch/overview'),
  alerts: (limit = 20) => request<AlertRow[]>(`/alerts?limit=${limit}`),
  geeDetections: (days = 7) => request<GeeDetections>(`/watch/gee-detections?days=${days}`),
  featuredRivers: (limit = 6) => request<FeaturedRiver[]>(`/stats/featured-rivers?limit=${limit}`),
  layers: () => request<LayerDef[]>('/layers'),
  watchBoxes: () => request<WatchBox[]>('/watch/boxes'),
  watchChanges: () => request<WatchChange[]>('/watch/changes'),
  beforeAfter: (boxId: string) => request<BeforeAfter>(`/watch/boxes/${boxId}/beforeafter`),

  // discover
  searchRivers: (q: string, limit = 12) =>
    request<RiverSearchItem[]>(`/rivers/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** Explicit online tier — catalogue first, then OSM, then saved back. */
  searchWorldRivers: (q: string, limit = 12) =>
    request<RiverSearchItem[]>(`/rivers/search/world?q=${encodeURIComponent(q)}&limit=${limit}`),
  rivers: (limit = 100) => request<RiverSearchItem[]>(`/rivers?limit=${limit}`),
  riverFeatured: (limit = 6) => request<RiverSearchItem[]>(`/rivers/featured?limit=${limit}`),
  river: (id: string) => request<RiverDetail>(`/rivers/${id}`),
  riverDams: (id: string, bufferKm?: number) =>
    request<RiverDam[]>(
      `/rivers/${id}/dams${bufferKm ? `?buffer_km=${bufferKm}` : ''}`,
    ),
  riverCorridor: (id: string, bufferKm: number) =>
    request<RiverCorridor>(`/rivers/${id}/corridor?buffer_km=${bufferKm}`),
  riverAvailability: (id: string, bufferKm: number) =>
    request<Availability>(`/rivers/${id}/availability?buffer_km=${bufferKm}`),
  createRiver: (body: { name: string; geometry: unknown; length_km?: number; basin?: string; states?: string[] }) =>
    request<RiverSearchItem>('/rivers', post(body)),
  prepareRiver: (id: string, bufferKm?: number) =>
    request<{ job_id: string }>(
      `/rivers/${id}/prepare${bufferKm ? `?buffer_km=${bufferKm}` : ''}`,
      { method: 'POST' },
    ),
  corridors: () => request<Corridor[]>('/corridors'),
  corridorDatasets: (id: string) => request<CorridorDataset[]>(`/corridors/${id}/datasets`),
  downloadCorridorDataset: (corridorId: string, kind: string) =>
    request<{ job_id: string | null; cached?: boolean }>(
      `/corridors/${corridorId}/datasets/${kind}/download`,
      { method: 'POST' },
    ),

  // build
  dams: (limit = 200) => request<DamRow[]>(`/dams?limit=${limit}`),
  dam: (id: string) => request<DamRow>(`/dams/${id}`),
  damImage: (id: string) => request<{ url: string | null }>(`/dams/${id}/image`),
  /** All scenarios, or one case's / one dam's saved configurations (dam_id). */
  scenarios: (caseName?: string, damId?: string) => {
    const q = new URLSearchParams()
    if (caseName) q.set('case', caseName)
    if (damId) q.set('dam_id', damId)
    const qs = q.toString()
    return request<Scenario[]>(`/scenarios${qs ? `?${qs}` : ''}`)
  },
  scenario: (id: string) => request<{ scenario: Scenario }>(`/scenarios/${id}`),
  breachProfile: (damId: string, width: number, depth: number) =>
    request<BreachProfile>(
      `/breach/profile?dam_id=${encodeURIComponent(damId)}&width=${width}&depth=${depth}`,
    ),
  breachMethods: () => request<{ methods: string[]; modes: string[] }>('/breach/methods'),
  breachFixture: (method: string) => request<BreachFixture>(`/breach/methods/${method}/fixture`),
  /** The method's breach for this dam's own height/storage/levels (capped at the crest). */
  breachEstimate: (
    method: string,
    q: { height_m: number; storage_mcm: number; level_m: number; bed_m: number; crest_length_m: number; dam_type: string; mode: string },
  ) =>
    request<BreachFixture>(
      `/breach/methods/${method}/estimate?${new URLSearchParams(
        Object.entries(q).map(([k, v]) => [k, String(v)]),
      ).toString()}`,
    ),
  /** Raw ScenarioSpec — the server validates it (case, aoi, breach, engine). */
  createScenario: (spec: ScenarioSpec) => request<Scenario>('/scenarios', post(spec)),
  /** Creates the run and starts stage 1. `ok:false` carries preflight errors. */
  executeScenario: (scenarioId: string, engine?: string) =>
    request<{ run: Run; ok?: boolean; errors?: string[]; job_id?: string }>(
      `/scenarios/${scenarioId}/execute${engine ? `?engine=${engine}` : ''}`,
      { method: 'POST' },
    ),

  // run
  runs: () => request<Run[]>('/runs'),
  run: (id: string) => request<RunDetail>(`/runs/${id}`),
  createRun: (scenarioId: string, engine?: string) =>
    request<Run>('/runs', post({ scenario_id: scenarioId, engine })),
  runStages: (id: string) => request<StageRow[]>(`/runs/${id}/stages`),
  runMetrics: (id: string) => request<RunMetrics>(`/runs/${id}/metrics`),
  runOutputs: (id: string) => request<RunOutput[]>(`/runs/${id}/outputs`),
  runLog: (id: string, tail = 200) => request<LogLine[]>(`/runs/${id}/log?tail=${tail}`),
  runParams: (id: string) => request<RunParams>(`/runs/${id}/params`),
  /** DEM elevation grid for the 3D player (relief heightfield + dam siting).
   *  `detail='full'` serves the solve-grid resolution instead of the ≤200/axis cut. */
  runTerrain: (id: string, detail?: 'std' | 'full') =>
    request<Terrain3D>(`/runs/${id}/terrain.json${detail === 'full' ? '?detail=full' : ''}`),
  /** OSM roads/buildings/bridges with per-frame flood exposure (cached per run). */
  runInfrastructure: (id: string) => request<RunInfra>(`/runs/${id}/infrastructure`),
  /** SPH particles at one output frame (404 for non-SPH engines). */
  runParticles: (id: string, frame: number) => request<RunParticles>(`/runs/${id}/particles?frame=${frame}`),
  /** Affected villages with modelled depth/arrival (stage.impact product). */
  hazardVillages: (id: string) => request<HazardVillages>(`/runs/${id}/hazard-villages`),

  // results / compare / player
  frames: (id: string) => request<FramesDoc>(`/runs/${id}/frames.json`),
  impact: (id: string) => request<Impact>(`/runs/${id}/impact`),
  /** Canonical run result: metrics, rasters, stations, series. 409 until complete. */
  result: (id: string) => request<RunResultDoc>(`/runs/${id}/result`),
  runStations: (id: string) => request<RunStation[]>(`/runs/${id}/stations`),
  /** Area-by-class + reach over time (built once, cached on the run). */
  runSeries: (id: string) => request<RunSeries>(`/runs/${id}/series`),
  /** Breach outflow Q(t): time_s, q_cms, level_m, peak_*, released_hm3. */
  breachHydrograph: (id: string) => request<BreachHydrograph>(`/runs/${id}/hydrograph`),
  probe: (id: string, lon: number, lat: number) =>
    request<Probe>(`/runs/${id}/probes?lon=${lon}&lat=${lat}`),
  exportRun: (id: string, fmt: 'geotiff' | 'shp' | 'kml') =>
    request<ExportDoc>(`/runs/${id}/export?fmt=${fmt}`),
  summary: (id: string) => request<RunSummary>(`/runs/${id}/summary`),
  /** `mode` is the on-screen comparison layout (swipe / side / diff) — echoed back. */
  comparison: (a: string, b: string, mode = 'swipe') =>
    request<Comparison>(`/comparisons?run_a=${a}&run_b=${b}&mode=${encodeURIComponent(mode)}`),
  /** Queued GIS package: poll `getExport` until `status` is done, then download. */
  createExport: (runId: string, formats: string[]) =>
    request<ExportJob>('/exports', post({ run_id: runId, formats })),
  getExport: (id: string) => request<ExportJob>(`/exports/${id}`),
  listExports: (limit = 20) => request<ExportJob[]>(`/exports?limit=${limit}`),
  /** Print-ready HTML report (browser prints it to PDF). */
  reportUrl: (runId: string) => `/api/reports/${runId}`,
  longitudinal: (id: string, lonlat: string, runB?: string) =>
    request<Longitudinal>(
      `/comparisons/${id}/longitudinal?lonlat=${lonlat}${runB ? `&run_b=${runB}` : ''}`,
    ),
  probes: (runId: string) => request<Probe[]>(`/probes/${runId}`),
  /** Downstream-dam screening: which registry dams this run's flood wets,
   *  who overtops (recorded crest only), and optional counterpart drafts. */
  cascade: (runId: string, body?: { depth_threshold_m?: number; reach_km?: number; max_dams?: number; create_scenarios?: boolean }) =>
    request<CascadeResult>(`/runs/${runId}/cascade`, post(body ?? {})),

  // system
  settings: () => request<Record<string, unknown>>('/settings'),
  jobs: (limit = 30) => request<Job[]>(`/jobs?limit=${limit}`),
  pauseJob: (id: string) => request<{ ok: boolean }>(`/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id: string) => request<{ ok: boolean }>(`/jobs/${id}/resume`, { method: 'POST' }),
  cancelJob: (id: string) => request<{ ok: boolean }>(`/jobs/${id}/cancel`, { method: 'POST' }),
}
