import { useRiverContext } from './river-context'
import type { BuildSnapshot, RunSnapshot } from './river-context'

/* ---- mission gates ------------------------------------------------------
   Discover → Build → Run → Results → Player / Compare. Every gate reads the
   *persisted* context, never local component state, so a refresh deep in the
   chain keeps the analyst where they were instead of throwing them back. The
   stepper, the step bar and the route guards all read these, so they can
   never disagree. */

const DONE_STATES = ['SUCCEEDED', 'COMPLETED', 'DONE', 'PUBLISHED', 'VALIDATED']

/**
 * Build is complete once the dam carries a reservoir level, a crest and a
 * breach that can actually be cut. The study reach is deliberately not in here:
 * `effectiveReachKm` floors it at 5 km, so an untouched slider is still a real
 * domain rather than an unset one.
 */
const buildReady = (b: BuildSnapshot | null): boolean =>
  Boolean(b && b.damId && b.level_m > 0 && b.crest_m > 0 && b.width_m > 0 && b.depth_m > 0)

/** A run that is still going belongs on the Run screen, not Results. */
const runDone = (r: RunSnapshot | null): boolean => {
  if (!r?.runId) return false
  if (!r.state) return true
  return DONE_STATES.includes(r.state.toUpperCase())
}

export type GateName = 'build' | 'run' | 'results' | 'compare'

export function useGates(): Record<GateName, boolean> {
  const river = useRiverContext((s) => s.river)
  const build = useRiverContext((s) => s.build)
  const run = useRiverContext((s) => s.run)
  const outputs = useRiverContext((s) => s.outputs)
  const haveRiver = Boolean(river?.id && river.damId)
  const haveResults = runDone(run)
  return {
    build: haveRiver,
    run: haveRiver && buildReady(build),
    results: haveResults,
    compare: haveResults && Boolean(outputs?.runId),
  }
}

export interface Step {
  to: string
  label: string
  icon: string
  /** prerequisite; absent = always open */
  gate?: GateName
  /** what this step is for, in one line */
  what: string
  /** what to do here to open the next step */
  todo: string
}

/** The guided workflow, in order. */
export const STEPS: Step[] = [
  {
    to: '/discover',
    label: 'Choose a river',
    icon: 'search',
    what: 'Find the river on the map and pick the dam you want to study.',
    todo: 'select a river and then a dam on the map',
  },
  {
    to: '/build',
    label: 'Build the scenario',
    icon: 'dam',
    gate: 'build',
    what: 'Set the reservoir level and the size of the breach.',
    todo: 'set the reservoir level, crest and breach size',
  },
  {
    to: '/run',
    label: 'Run the simulation',
    icon: 'play',
    gate: 'run',
    what: 'Start the model and follow each stage until it finishes.',
    todo: 'start the run and wait for it to finish',
  },
  {
    to: '/results',
    label: 'See the results',
    icon: 'chart',
    gate: 'results',
    what: 'Flood map, depths, arrival times, villages, roads and evacuation.',
    todo: 'publish the finished run so it can be replayed and compared',
  },
  {
    to: '/player',
    label: 'Replay in 3D',
    icon: 'camera',
    gate: 'compare',
    what: 'Watch the flood move over the real terrain, step by step.',
    todo: '',
  },
  {
    to: '/compare',
    label: 'Compare two moments',
    icon: 'swap',
    gate: 'compare',
    what: 'Put the flood at two times side by side to see how it spreads.',
    todo: '',
  },
]

/** Side tools — useful any time, not part of the step-by-step flow. */
export const TOOLS = [
  { to: '/watch', label: 'Live watch', icon: 'globe', what: 'Daily satellite checks of watched areas and alerts.' },
  { to: '/scenario-lab', label: 'Scenario Lab', icon: 'layers', what: 'Replay scenarios that were already modelled.' },
  { to: '/flood-lab', label: 'Flood Lab', icon: 'river', what: 'Break a dam and watch the water flow live.' },
]

export const unlocked = (s: Step, gates: Record<GateName, boolean>) => !s.gate || gates[s.gate]

/** Which workflow step a path belongs to (corridor screens are Build), -1 = none. */
export function stepIndex(pathname: string): number {
  if (pathname.startsWith('/corridor')) return 1
  return STEPS.findIndex((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))
}
