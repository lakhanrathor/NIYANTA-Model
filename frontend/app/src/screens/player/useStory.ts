import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { usePlayer } from './PlayerProvider'
import { storyEvents, type StoryEvent } from './story'

/** The run's story for the current player (shared by caption + timeline ticks). */
export function useStory(): StoryEvent[] {
  const { runId, damName, summary, hydro, stations, series } = usePlayer()
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId!), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })
  return useMemo(
    () =>
      storyEvents({
        damName,
        summary: summary.data,
        hydro: hydro.data,
        stations: stations.data,
        infra: infra.data,
        series: series.data,
      }),
    [damName, summary.data, hydro.data, stations.data, infra.data, series.data],
  )
}
