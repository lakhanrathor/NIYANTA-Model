import { useCallback, useMemo } from 'react'
import { useRiverContext } from './river-context'
import type { MapIntent } from './river-context'

/**
 * Shared map-scope access: read the first scope, publish to all. Compare's
 * synced panes pass two scopes (`cmp-a`, `cmp-b`); single-map screens pass
 * one. `publishAll` is referentially stable, so effects can depend on it.
 */
export function useMapScopes(scope: string | string[]) {
  const keys = useMemo(() => (Array.isArray(scope) ? scope : [scope]), [scope])
  const intent = useRiverContext((s) => (keys.length ? s.mapIntents[keys[0]] : undefined))
  const publishMapIntent = useRiverContext((s) => s.publishMapIntent)
  const publishAll = useCallback(
    (patch: Partial<MapIntent>) => {
      keys.forEach((k) => publishMapIntent(k, patch))
    },
    [keys, publishMapIntent],
  )
  return { keys, intent, publishAll }
}
