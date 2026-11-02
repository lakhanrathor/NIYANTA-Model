import { STEPS, TOOLS } from '../lib/flow'
import type { Step } from '../lib/flow'

/** The v2 wizard reuses the flow's steps, gates and wording, at /v2 paths. */
const PATHS = ['/v2/river', '/v2/scenario', '/v2/run', '/v2/results', '/v2/replay', '/v2/compare']

export const V2_STEPS: Step[] = STEPS.map((s, i) => ({ ...s, to: PATHS[i] }))

/** Tools stay on their current screens until their v2 versions land. */
export const V2_TOOLS = TOOLS

/** Which wizard step a /v2 path belongs to, -1 = none. */
export function v2StepIndex(pathname: string): number {
  return V2_STEPS.findIndex((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))
}
