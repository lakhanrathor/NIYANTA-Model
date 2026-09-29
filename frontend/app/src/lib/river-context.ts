import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FeatureCollection } from 'geojson'

/**
 * MISSION CONTEXT — the one shared store every screen publishes to and
 * subscribes from. Screens behave like tabs of one mission: Discover seeds it,
 * Build appends the configuration, Run appends its identity and outputs, and
 * Results / Compare / Player read the same object.
 *
 * Nothing in here is a default value. An empty field is `null` and renders as
 * "—" upstream — never as a placeholder number or a guessed dam.
 */

/** Identity + structure. Published by Discover (search → select → context lives). */
export interface ActiveRiver {
  id: string
  name: string
  lengthKm: number | null
  /** The search that surfaced this river — re-run on refresh to restore results. */
  query: string
  /** Corridor buffer override; null = size it from the river length. */
  bufferKm: number | null
  /** Downstream study reach distance along river in kilometers. */
  reachKm: number | null
  /** Dam chosen for the scenario on this river. */
  damId: string | null
  damName: string | null
  /** Distance along river the dam sits at — published by Discover's dam list,
   *  read by Build's summary. null until a corridor dam row carries it. */
  damAlongKm: number | null
  damLat: number | null
  damLon: number | null
  damHeight: number | null
  damCrest: number | null
  damFsl: number | null
  damType: string | null
  damCrestLength: number | null
  damHeadingDeg: number | null
  damStorageMcm: number | null
  damState: string | null
  since: string
}

/** Build page slice. Mirrored from `useBuildConfig` on every mutation. */
export interface BuildSnapshot {
  damId: string | null
  case: string
  level_m: number
  crest_m: number
  bed_m: number
  height_m: number
  crest_length_m: number
  heading_deg: number
  axis_heading_deg: number
  dam_heading_deg: number
  reach_km: number
  storage_mcm: number
  area_km2: number
  erodibility: string
  damType: string
  method: string
  width_m: number
  depth_m: number
  formation_hr: number
  side_slope: number
  chainage_m: number
  seededMethod: string | null
  inflow_cms: number
  duration_hr: number
  dt_s: number
  engine: string
  hardware: string
  impactSource: string
  impactSeeded: boolean
  population: number | null
  houses: number | null
  assets_million: number | null
}

/** Run identity. Published by the Run tab once `GET /api/runs/{id}` resolves. */
export interface RunSnapshot {
  runId: string | null
  scenarioId: string | null
  scenarioName: string | null
  state: string | null
  engine: string | null
  engineLabel: string | null
  breachMethod: string | null
  simHours: number | null
  finishedAt: string | null
  /** Frozen study reach of THIS run (from its spec). Every screen reads it
   *  here instead of re-deriving a reach from live state — the source of the
   *  "74 km selected / 47 km shown" drift. */
  reachKm: number | null
}

/**
 * Run outputs. Every field is copied verbatim from an API response — a
 * cross-tab cache of evidence, never a computed value. `runId` scopes it so a
 * stale snapshot can never be shown against a different run.
 */
export interface OutputsSnapshot {
  runId: string | null
  metrics: import('./api').ResultMetrics | null
  peakCms: number | null
  releasedHm3: number | null
  stationCount: number
  updatedAt: string | null
}

/**
 * Cascade screening. Same contract as outputs: every dam row is copied
 * verbatim from `POST /runs/{id}/cascade` — evidence, never computed — and
 * `runId` scopes it so a stale screening can never render against another
 * run. `selectedDamId` is the pin/row the analyst picked (pins, lists and
 * the Build handoff all read this one field).
 */
export interface CascadeSnapshot {
  runId: string | null
  sourceName: string | null
  depthThresholdM: number | null
  dams: import('./api').CascadeDam[]
  selectedDamId: string | null
  updatedAt: string | null
}

/**
 * Flood-map intent, keyed by scope (`results`, `cmp-a`, `cmp-b`, …). Screens
 * publish what their panes paint — run, diff partner, raster field, frame,
 * max-union view, flood visibility, probe — and MapShell panes plus the
 * filmstrip read/write the same scope. One shared truth per pane, never
 * per-page props; a run switch replaces the scope so stale state can never
 * bleed across runs. Ephemeral by design: excluded from persistence.
 */
export interface MapProbe {
  lat: number
  lon: number
}

export interface MapIntent {
  runId: string | null
  /** Diff partner for B−A tiles; null = single-run tiles. */
  vs: string | null
  /** Raster kind: depth | arrival | extent | velocity. */
  field: string
  /** Active frame index. Ignored while `showMax` is on. */
  frame: number
  /** Max-extent union grid instead of one moment. */
  showMax: boolean
  floodVisible: boolean
  probe: MapProbe | null
}

export interface RiverIdentity {
  id: string
  name: string
  lengthKm?: number | null
  query?: string
}

/* ------------------------------------------------------------------ map view
 * The map vocabulary — feature, legend row, hover point — lives here so every
 * screen and the shell share one definition (MapShell re-exports these types).
 * Screen-owned overlays (features / fit / legend) are still passed to
 * MapShell as props; mission data (river, dam, build, run) and presentation
 * state (the `view` slice: 2D/3D mode, hidden layers) come from this context.
 */

export interface MapFeature {
  id: string
  label: string
  data: FeatureCollection
  kind: 'line' | 'fill' | 'circle'
  color: string
  width?: number
  dasharray?: number[]
  fillOpacity?: number
  radius?: number
  /** circle only: draw each point's `properties.label` next to the marker. */
  textLabel?: boolean
}

export interface LegendItem {
  /** Stable identity so a row that flips to `pending` does not remount. */
  id?: string
  label: string
  color: string
  dashed?: boolean
  /** Data is still loading — keep the row in place instead of dropping it. */
  pending?: boolean
}

export interface MapHoverPoint {
  lon: number
  lat: number
  title: string
  subtitle?: string
}

/** Key-by-key identity compare — a publish that changes nothing is a no-op,
 *  which is what keeps a screen's own write from re-rendering its own map. */
export function sameShallow(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  const rb = b as Record<string, unknown>
  return ka.every((k) => (a as Record<string, unknown>)[k] === rb[k])
}

export type MapMode = '2d' | '3d'

/**
 * VIEW — how the analyst is looking, not what the data says. The one switch
 * that every map instance shares: toggle 3D on Discover and the Player follows,
 * switch a layer off and it stays off across screens. Mission data (river, dam,
 * build, run) never lives here; this is presentation state only.
 */
export interface ViewSlice {
  mode: MapMode
  /** Feature ids the analyst has switched off. */
  hiddenLayers: string[]
}

export interface RiverContext {
  river: ActiveRiver | null
  build: BuildSnapshot | null
  run: RunSnapshot | null
  outputs: OutputsSnapshot | null
  cascade: CascadeSnapshot | null
  view: ViewSlice
  /** Flood-map intents by scope. See `MapIntent`. */
  mapIntents: Record<string, MapIntent>

  /** Discover: adopt a river. A different id wipes the previous mission. */
  select: (identity: RiverIdentity) => void
  /** Publish the selected dam and every attribute that came with it. */
  selectDam: (dam: Partial<ActiveRiver> & { id: string; name?: string }) => void
  setReachKm: (reachKm: number) => void
  setBufferKm: (bufferKm: number | null) => void
  patch: (patch: Partial<ActiveRiver>) => void
  /** Build tab → context. Shallow-compared, so an identical write is a no-op. */
  publishBuild: (patch: Partial<BuildSnapshot>) => void
  /** Run tab → context. */
  publishRun: (patch: Partial<RunSnapshot>) => void
  /** Results / Player → context. Only ever API-sourced values. */
  publishOutputs: (patch: Partial<OutputsSnapshot>) => void
  /** Cascade screening → context. Only ever API-sourced rows. */
  publishCascade: (patch: Partial<CascadeSnapshot>) => void
  /** Any screen → context: which screened dam the analyst picked. */
  selectCascadeDam: (damId: string | null) => void
  /** Screens → context: one pane's flood-map intent (see `MapIntent`). */
  publishMapIntent: (scope: string, patch: Partial<MapIntent>) => void
  /** Map shell → context: the shared 2D/3D switch. */
  setMode: (mode: MapMode) => void
  /** Map shell → context: show or hide one overlay feature everywhere. */
  toggleLayer: (id: string) => void
  /** Discover starts over: the whole mission goes, not just the river. */
  clear: () => void

  /**
   * The route currently on screen ('/discover', '/build', …). Set by the app
   * shell from the router on every navigation; persisted nowhere — the URL is
   * the authority after a refresh. Global chrome (map shell, layer visibility)
   * reads this to decide what to show.
   */
  page: string
  setPage: (page: string) => void

  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

/** The store predates the mission slices — drop the old key so a stale
 *  auto-selected default can never resurrect itself. */
try {
  localStorage.removeItem('niyanta.active-river')
} catch {
  /* storage unavailable — nothing to migrate */
}

const freshStamp = () => new Date().toISOString()
const emptyMission = () => ({ build: null, run: null, outputs: null, cascade: null })

/** `undefined` means "keep what the river already has"; `null` clears it. */
function pick<T>(current: T, ...candidates: (T | undefined)[]): T {
  for (const c of candidates) if (c !== undefined) return c
  return current
}

function blankRiver(identity: Required<RiverIdentity>): ActiveRiver {
  return {
    id: identity.id,
    name: identity.name,
    lengthKm: identity.lengthKm ?? null,
    query: identity.query,
    bufferKm: null,
    reachKm: null,
    damId: null,
    damName: null,
    damAlongKm: null,
    damLat: null,
    damLon: null,
    damHeight: null,
    damCrest: null,
    damFsl: null,
    damType: null,
    damCrestLength: null,
    damHeadingDeg: null,
    damStorageMcm: null,
    damState: null,
    since: freshStamp(),
  }
}

export const useRiverContext = create<RiverContext>()(
  persist(
    (set) => ({
      river: null,
      build: null,
      run: null,
      outputs: null,
      cascade: null,
      mapIntents: {},
      view: { mode: '2d', hiddenLayers: [] },
      page: '/',
      collapsed: false,

      select: (identity) =>
        set((s) => {
          const sameRiver = s.river?.id === identity.id
          const query = identity.query ?? s.river?.query ?? identity.name
          const lengthKm = identity.lengthKm ?? s.river?.lengthKm ?? null

          if (sameRiver && s.river) {
            const next = { ...s.river, name: identity.name, query, lengthKm }
            return sameShallow(next, s.river) ? s : { river: next }
          }
          // A new river is a new mission: the dam, build draft, run and outputs
          // all belong to the river we are leaving.
          return {
            river: blankRiver({ ...identity, query, lengthKm }),
            ...emptyMission(),
          }
        }),

      selectDam: (dam) =>
        set((s) => {
          const base = s.river
          if (!base) return s

          const next: ActiveRiver = {
            ...base,
            damId: dam.id,
            damName: pick(base.damName, dam.damName, dam.name),
            damAlongKm: pick(base.damAlongKm, dam.damAlongKm),
            damLat: pick(base.damLat, dam.damLat),
            damLon: pick(base.damLon, dam.damLon),
            damHeight: pick(base.damHeight, dam.damHeight),
            damCrest: pick(base.damCrest, dam.damCrest),
            damFsl: pick(base.damFsl, dam.damFsl),
            damType: pick(base.damType, dam.damType),
            damCrestLength: pick(base.damCrestLength, dam.damCrestLength),
            damHeadingDeg: pick(base.damHeadingDeg, dam.damHeadingDeg),
            damStorageMcm: pick(base.damStorageMcm, dam.damStorageMcm),
            damState: pick(base.damState, dam.damState),
          }
          if (sameShallow(next, base)) return s
          // Only a *different* dam invalidates the scenario. Adopting the first
          // dam on a river that had none changes nothing that was already there,
          // so a screen can publish the dam it is looking at without wiping the
          // mission a run just produced.
          const mission = base.damId && base.damId !== dam.id ? emptyMission() : {}
          return { river: next, ...mission }
        }),

      setReachKm: (reachKm) => set((s) => (s.river ? { river: { ...s.river, reachKm } } : s)),

      setBufferKm: (bufferKm) => set((s) => (s.river ? { river: { ...s.river, bufferKm } } : s)),

      patch: (patch) => set((s) => (s.river ? { river: { ...s.river, ...patch } } : s)),

      publishBuild: (patch) =>
        set((s) => {
          const next = { ...(s.build ?? {}), ...patch } as BuildSnapshot
          return sameShallow(next, s.build) ? s : { build: next }
        }),

      publishRun: (patch) =>
        set((s) => {
          const next = { ...(s.run ?? {}), ...patch } as RunSnapshot
          return sameShallow(next, s.run) ? s : { run: next }
        }),

      publishOutputs: (patch) =>
        set((s) => {
          // A snapshot from an earlier run must never survive a run switch.
          if (patch.runId && s.outputs?.runId && patch.runId !== s.outputs.runId) {
            return { outputs: { ...patch } as OutputsSnapshot }
          }
          const next = { ...(s.outputs ?? {}), ...patch } as OutputsSnapshot
          return sameShallow(next, s.outputs) ? s : { outputs: next }
        }),

      publishCascade: (patch) =>
        set((s) => {
          // Same run-scoping as outputs: a new runId replaces the screening
          // wholesale instead of merging dams across runs.
          if (patch.runId && s.cascade?.runId && patch.runId !== s.cascade.runId) {
            return { cascade: { ...patch } as CascadeSnapshot }
          }
          const next = { ...(s.cascade ?? {}), ...patch } as CascadeSnapshot
          return sameShallow(next, s.cascade) ? s : { cascade: next }
        }),

      selectCascadeDam: (damId) =>
        set((s) => {
          if (!s.cascade || s.cascade.selectedDamId === damId) return s
          return { cascade: { ...s.cascade, selectedDamId: damId } }
        }),

      publishMapIntent: (scope, patch) =>
        set((s) => {
          const prev = s.mapIntents[scope]
          const base: MapIntent =
            prev ?? {
              runId: null,
              vs: null,
              field: 'depth',
              frame: 0,
              showMax: true,
              floodVisible: true,
              probe: null,
            }
          // A new run on the scope resets view state but keeps analyst prefs
          // (field, flood visibility) — identical writes stay no-ops.
          const next: MapIntent =
            patch.runId && prev?.runId && patch.runId !== prev.runId
              ? { ...base, field: prev.field, floodVisible: prev.floodVisible, ...patch }
              : { ...base, ...patch }
          if (prev && sameShallow(next, prev)) return s
          return { mapIntents: { ...s.mapIntents, [scope]: next } }
        }),

      setMode: (mode) => set((s) => (s.view.mode === mode ? s : { view: { ...s.view, mode } })),

      toggleLayer: (id) =>
        set((s) => {
          const hidden = s.view.hiddenLayers.includes(id)
            ? s.view.hiddenLayers.filter((x) => x !== id)
            : [...s.view.hiddenLayers, id]
          return { view: { ...s.view, hiddenLayers: hidden } }
        }),

      clear: () => set({ river: null, ...emptyMission() }),
      setPage: (page) => set((s) => (s.page === page ? s : { page })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    {
      name: 'niyanta.mission',
      version: 1,
      partialize: (s) => ({
        river: s.river,
        build: s.build,
        run: s.run,
        outputs: s.outputs,
        cascade: s.cascade,
        view: s.view,
        collapsed: s.collapsed,
      }),
    },
  ),
)
