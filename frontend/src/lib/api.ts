// Typed client for the NIYANTA FastAPI backend. All paths are relative to
// `/api` — in dev the Vite proxy forwards them to 127.0.0.1:8000.

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

// ---------------------------------------------------------------- shapes

export interface Health {
  status: string
  gee_mode: string
  workers?: number
  gee?: { mode: string; ready: boolean; error: string | null; init_ms?: number }
}

export interface Scenario {
  id: string
  case: string
  name: string | null
  spec: Record<string, unknown>
  status: 'draft' | 'ready' | 'running' | 'complete'
  risk_id?: string | null
  change_id?: string | null
  created: string
  updated: string
}

export interface Run {
  id: string
  scenario_id: string
  engine: string
  state: string
  stage: string | null
  stage_status: string | null
  progress: number
  error: string | null
  metrics: RunMetrics
  result: RunResult | null
  created: string
  updated: string
}

export interface RunMetrics {
  peak_discharge_cms: number
  peak_at_hr: number
  max_depth_m: number
  inundation_km2: number
  volume_hm3: number
  mass_balance_error_pct: number
  duration_hr: number
}

export interface Station {
  km: number
  name?: string | null
  peak_cms: number
  arrival_hr: number | null
  max_stage_m: number
  max_depth_m: number
}

export interface VillageImpact {
  name?: string
  population?: number
  hazard?: string
  depth_m?: number
  [key: string]: unknown
}

export interface RunResult {
  schema_version?: string
  run_id: string
  scenario_id: string
  engine: string
  metrics: RunMetrics
  rasters: Record<string, string>
  stations: Station[]
  impact: {
    population_exposed: number
    villages_affected: number
    infra: { roads_km: number; bridges: number; hospitals: number }
    by_village: VillageImpact[]
  }
  hazard: { layer_id: string | null; classes: string[] }
  exports: Record<string, string | null>
  validation: {
    benchmark: string | null
    error_peak_pct: number | null
    extent_iou: number | null
    grade: string | null
  }
}

export interface LifecycleRow {
  id: number
  run_id: string
  state: string | null
  stage: string | null
  detail: string
  ts: string
}

export interface JobRow {
  id: string
  type: string
  status: string
  progress: number
  error: string | null
}

export interface RunDetail {
  run: Run
  scenario: Scenario
  lifecycle: LifecycleRow[]
  jobs: JobRow[]
  products: { id: string; kind: string; path: string; meta: Record<string, unknown> }[]
}

export interface Alert {
  id: string
  level: string
  title: string
  body: string | null
  run_id: string | null
  state: string
  source: string | null
  created: string
}

export interface WatchBox {
  id: string
  name: string | null
  bbox: unknown
  state?: string
  created?: string
}

export interface WatchJob {
  id: string
  box_id: string
  kind: string
  status: string
  day?: string | null
  error?: string | null
}

export interface Dataset {
  id: string
  name: string
  kind: string
  path?: string | null
  created?: string
}

export interface ExportJob {
  id: string
  run_id: string
  formats: string[]
  status: string
  path?: string | null
  download_url?: string | null
  error?: string | null
  created?: string
}

// ---------------------------------------------------------------- calls

export const api = {
  health: () => request<Health>('/health'),

  // scenarios
  scenarios: (caseId?: string) =>
    request<Scenario[]>(`/scenarios${caseId ? `?case=${encodeURIComponent(caseId)}` : ''}`),
  scenario: (id: string) =>
    request<{ scenario: Scenario; breach_solution: Record<string, unknown> | null; runs: Run[] }>(
      `/scenarios/${id}`,
    ),
  createScenario: (spec: Record<string, unknown>) => post<Scenario>('/scenarios', spec),
  executeScenario: (id: string, engine?: string) =>
    post<Run & { ok?: boolean; detail?: string }>(
      `/scenarios/${id}/execute${engine ? `?engine=${engine}` : ''}`,
    ),

  // runs
  runs: (params?: { state?: string; scenario_id?: string }) => {
    const q = new URLSearchParams()
    if (params?.state) q.set('state', params.state)
    if (params?.scenario_id) q.set('scenario_id', params.scenario_id)
    const qs = q.toString()
    return request<Run[]>(`/runs${qs ? `?${qs}` : ''}`)
  },
  createRun: (scenarioId: string, engine?: string) =>
    post<Run>('/runs', { scenario_id: scenarioId, engine }),
  executeRun: (id: string) => post<{ ok: boolean; detail?: string }>(`/runs/${id}/execute`),
  run: (id: string) => request<RunDetail>(`/runs/${id}`),
  runResult: (id: string) => request<RunResult>(`/runs/${id}/result`),
  runStations: (id: string) => request<Station[]>(`/runs/${id}/stations`),
  runHydrograph: (id: string, station?: string) =>
    request<{ series?: Record<string, { time_hr?: number[]; q_cms?: number[] }>; station?: string }>(
      `/runs/${id}/hydrograph${station ? `?station=${encodeURIComponent(station)}` : ''}`,
    ),
  runRasterUrl: (id: string, kind: 'depth' | 'max_depth' | 'velocity' | 'arrival' | 'extent') =>
    `${BASE}/api/runs/${id}/raster/${kind}`,

  // alerts
  alerts: (state?: string) => request<Alert[]>(`/alerts${state ? `?state=${state}` : ''}`),
  ackAlert: (id: string) => post<Alert>(`/alerts/${id}/ack`),

  // watch / GEE
  watchBoxes: () => request<WatchBox[]>('/watch/boxes'),
  watchTimeline: (boxId: string) =>
    request<Record<string, unknown>>(`/watch/boxes/${boxId}/timeline`),
  watchBeforeAfter: (boxId: string) =>
    request<Record<string, unknown>>(`/watch/boxes/${boxId}/beforeafter`),
  watchRun: () => post<{ job_id: string; status: string; mode: string }>('/watch/run'),
  watchJobs: () => request<WatchJob[]>('/watch/jobs'),
  watchChanges: () => request<Record<string, unknown>[]>('/watch/changes'),
  watchImageUrl: (boxId: string) => `${BASE}/api/watch/boxes/${boxId}/image`,

  // datasets
  datasets: () => request<Dataset[]>('/datasets'),

  // exports
  exports: (runId: string, formats?: string[]) =>
    post<ExportJob>('/exports', { run_id: runId, formats }),
  listExports: () => request<ExportJob[]>('/exports'),
  getExport: (id: string) => request<ExportJob>(`/exports/${id}`),
  exportDownloadUrl: (id: string) => `${BASE}/api/exports/${id}/download`,
  reportUrl: (runId: string) => `${BASE}/api/reports/${runId}`,

  // breach
  breachMethods: () =>
    request<{ methods: { id: string; name?: string; [k: string]: unknown }[] }>('/breach/methods'),
}
