import { useParams } from 'react-router-dom'
import { api } from './api'
import { useApi } from './useApi'
import { useRiverContext } from './river-context'

/**
 * Screens are routed as `/run/:runId` etc. Resolution order: the route param,
 * then the run the mission context already holds, then a run that actually has
 * results from `GET /api/runs` — never a hard-coded id, and never a
 * queued/draft run with no products to show.
 */
export function useRunId(): string | null {
  const params = useParams()
  const routeId = params.runId ?? null
  const ctxRunId = useRiverContext((s) => s.run?.runId ?? null)
  const runs = useApi(['runs'], api.runs, { enabled: !routeId && !ctxRunId })
  const done = ['VALIDATED', 'PUBLISHED']
  const fallback = runs.data?.find((r) => done.includes((r.state ?? '').toUpperCase()))
  return routeId ?? ctxRunId ?? fallback?.id ?? runs.data?.[0]?.id ?? null
}
