import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

export interface ApiResult<T> {
  data: T | undefined
  /** true when the endpoint 404'd / 500'd / timed out — render "Source offline". */
  offline: boolean
  pending: boolean
}

interface Options {
  enabled?: boolean
  refetchInterval?: number | false
  /** How long a result counts as fresh. A scope that only changes when the user
   *  changes it (the river, the buffer) passes Infinity: leaving and coming back
   *  then costs no network at all. Defaults to 15 s. */
  staleTime?: number
  /** Keep the previous key's data on screen while the new one loads, so moving
   *  the buffer slider never blanks the map. */
  keepPrevious?: boolean
}

/**
 * One query shape for the whole app: missing endpoints must degrade to an honest
 * empty state, never to a fabricated value.
 */
export function useApi<T>(
  key: readonly unknown[],
  fn: () => Promise<T>,
  options?: Options,
): ApiResult<T> {
  const query: UseQueryResult<T> = useQuery({
    queryKey: key,
    queryFn: fn,
    enabled: options?.enabled ?? true,
    retry: false,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 15_000,
    placeholderData: options?.keepPrevious ? keepPreviousData : undefined,
  })
  return { data: query.data, offline: query.isError, pending: query.isPending }
}
