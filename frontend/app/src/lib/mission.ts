import { api } from './api'
import type { Scenario, ScenarioSpec } from './api'
import { useRiverContext, type BuildSnapshot, type OutputsSnapshot, type RunSnapshot } from './river-context'
import { useBuildConfig } from '../screens/build/config'

/**
 * MISSION WIRING
 *
 * `useRiverContext` is the hub. This module keeps its two moving parts honest:
 *
 *  - Build → context: every mutation of the Build draft is mirrored in, so any
 *    other tab reads the configuration without a round trip.
 *  - context → Build: when another tab (Discover, Run) changes the reach or the
 *    dam, the draft follows.
 *
 * and it rehydrates the mission after a refresh with a single small database
 * call, so a reload lands on the same river, dam, configuration and run.
 */

const BUILD_FIELDS: (keyof BuildSnapshot)[] = [
  'damId', 'case', 'level_m', 'crest_m', 'bed_m', 'height_m', 'crest_length_m',
  'heading_deg', 'axis_heading_deg', 'dam_heading_deg', 'reach_km', 'storage_mcm',
  'area_km2', 'erodibility', 'damType', 'method', 'width_m', 'depth_m',
  'formation_hr', 'side_slope', 'chainage_m', 'seededMethod', 'inflow_cms',
  'duration_hr', 'dt_s', 'engine', 'hardware', 'impactSource', 'impactSeeded',
  'population', 'houses', 'assets_million',
]

function buildSnapshot(s: ReturnType<typeof useBuildConfig.getState>): BuildSnapshot {
  const out = {} as BuildSnapshot
  for (const k of BUILD_FIELDS) (out as unknown as Record<string, unknown>)[k] = s[k]
  return out
}

/** Strip the action functions so `loadSpec` can push a restored spec into the draft. */
export function applySpecToDraft(spec: ScenarioSpec, damId: string | null): void {
  useBuildConfig.getState().loadSpec(spec, damId)
}

function runSnapshot(run: {
  id: string
  scenario_id?: string
  engine?: string
  state?: string | null
  finished_at?: string | null
  spec?: ScenarioSpec | null
}, scenario: Scenario | null): Partial<RunSnapshot> {
  const horizon = scenario?.spec?.horizon ?? run.spec?.horizon ?? null
  return {
    runId: run.id,
    scenarioId: scenario?.id ?? run.scenario_id ?? null,
    scenarioName: scenario?.name ?? null,
    state: run.state ?? null,
    engine: run.engine ?? null,
    engineLabel: run.engine ?? null,
    breachMethod: scenario?.spec?.breach?.method ?? run.spec?.breach?.method ?? null,
    simHours: horizon?.duration_hr ?? null,
    finishedAt: run.finished_at ?? null,
  }
}

let wired = false

/** Call once at boot. Idempotent — safe from HMR and StrictMode double-invoke. */
export function wireMission(): void {
  if (wired) return
  wired = true

  // --- Build draft → context, on every mutation.
  useBuildConfig.subscribe((state) => {
    useRiverContext.getState().publishBuild(buildSnapshot(state))
  })

  // --- context → Build draft, and context lifecycle side-effects.
  useRiverContext.subscribe((prev, next) => {
    const river = next.river
    const prevRiver = prev.river

    // Discover cleared the mission: the draft belongs to the old river too.
    if (!river && prevRiver) {
      useBuildConfig.getState().reset()
      return
    }
    if (!river) return

    const draft = useBuildConfig.getState()
    if (river.reachKm != null && river.reachKm !== prevRiver?.reachKm && draft.reach_km !== river.reachKm) {
      draft.patch({ reach_km: river.reachKm })
    }
    if (river.damId && river.damId !== prevRiver?.damId && draft.damId !== river.damId) {
      draft.patch({ damId: river.damId })
    }
  })

  // Seed the context from storage once React has mounted.
  void hydrateMission()
}

/**
 * Restore the mission after a refresh with ONE small database call:
 *   runId known      → GET /api/runs/{id}   (run + scenario spec in one payload)
 *   else damId known → GET /api/scenarios?dam_id=…  (saved configurations)
 *   else             → no call: Discover seeds the mission on first search.
 */
export async function hydrateMission(): Promise<void> {
  const ctx = useRiverContext.getState()
  const river = ctx.river
  if (!river) return

  try {
    if (ctx.run?.runId) {
      const detail = await api.run(ctx.run.runId)
      const scenario = detail.scenario ?? null
      const spec = scenario?.spec ?? detail.run.spec ?? null
      const damId = spec?.dam_id ?? river.damId ?? null

      ctx.publishRun(runSnapshot(detail.run, scenario))
      if (spec && damId) {
        applySpecToDraft(spec, damId)
        // Refresh any dam attribute the store is missing — only when missing.
        if (!river.damLat || !river.damName) {
          const dam = await api.dam(damId)
          useRiverContext.getState().selectDam(damRowToRiverPatch(dam))
        }
      }
      return
    }

    if (river.damId) {
      const saved = await api.scenarios(undefined, river.damId)
      const latest = saved[0]
      if (!latest) return
      const spec = latest.spec ?? null
      const scenarioId = latest.id ?? null
      ctx.publishRun({ scenarioId, runId: null, scenarioName: latest.name ?? null })
      if (spec) applySpecToDraft(spec, river.damId)
    }
  } catch {
    // Offline or endpoint missing — the mission stays exactly as persisted.
    // Every field already has its honest null; nothing to invent here.
  }
}

/** Dam record → the patch `selectDam` understands. All values come from /api/dams/{id}. */
export function damRowToRiverPatch(dam: {
  id: string
  name?: string | null
  lat?: number | null
  lon?: number | null
  height_m?: number | null
  crest_m?: number | null
  fsl_m?: number | null
  dam_type?: string | null
  crest_length_m?: number | null
  length_m?: number | null
  heading_deg?: number | null
  storage_mcm?: number | null
  capacity_mcm?: number | null
  state?: string | null
}) {
  return {
    id: dam.id,
    name: dam.name ?? undefined,
    damName: dam.name ?? undefined,
    damLat: dam.lat ?? undefined,
    damLon: dam.lon ?? undefined,
    damHeight: dam.height_m ?? undefined,
    damCrest: dam.crest_m ?? undefined,
    damFsl: dam.fsl_m ?? undefined,
    damType: dam.dam_type ?? undefined,
    damCrestLength: dam.crest_length_m ?? dam.length_m ?? undefined,
    damHeadingDeg: dam.heading_deg ?? undefined,
    damStorageMcm: dam.storage_mcm ?? dam.capacity_mcm ?? undefined,
    damState: dam.state ?? undefined,
  }
}

/** Outputs published by whichever tab fetched them — API values only. */
export function publishOutputsFromApi(runId: string, patch: Partial<OutputsSnapshot>): void {
  useRiverContext.getState().publishOutputs({ runId, updatedAt: new Date().toISOString(), ...patch })
}
