import { useEffect, useState } from 'react'
import { api, type Job } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useWatchContext } from '../../lib/watch-context'
import { EM_DASH, relativeTime } from '../../lib/format'
import { Empty, Panel, Pill } from '../../components/ui'
import { watchApi } from './watchApi'

const isLive = (s?: string | null) => s === 'queued' || s === 'running'

/** The daily sweep, visible: last run, live progress, one button to run now.
 *  Publishes sweep state into the watch context for any subscriber. */
export function SweepControl() {
  const setSweep = useWatchContext((s) => s.setSweep)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [poll, setPoll] = useState(false)
  // One query; the interval adapts — poll while a sweep is in flight, stop the
  // moment it lands.
  const jobs = useApi(['jobs'], () => api.jobs(30), {
    refetchInterval: poll ? 2000 : false,
  })
  const sweeps = (jobs.data ?? []).filter((j: Job) => j.type === 'gee.daily')
  const current = sweeps[0] ?? null
  const live = isLive(current?.status)

  useEffect(() => {
    setPoll(live)
  }, [live])

  useEffect(() => {
    setSweep({
      running: live,
      lastRun: current?.updated ?? current?.created ?? null,
      nextRun: null,
      jobId: current?.id ?? null,
    })
  }, [live, current?.id, current?.updated, current?.created, setSweep])

  const runNow = async () => {
    setStarting(true)
    setError(null)
    try {
      await watchApi.triggerSweep()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sweep failed to queue')
    } finally {
      setStarting(false)
    }
  }

  const pct = current && Number.isFinite(current.progress) ? Math.round(current.progress) : null

  return (
    <Panel
      title="Daily Sweep"
      actions={
        <Pill tone={live ? 'accent' : current?.status === 'failed' ? 'bad' : current ? 'ok' : 'muted'}>
          {live ? (current?.status ?? 'running') : (current?.status ?? 'never run')}
        </Pill>
      }
    >
      {jobs.offline && !current ? (
        <Empty>Source offline — GET /api/jobs</Empty>
      ) : (
        <div className="px-3 py-2">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-[var(--muted)]">Last sweep</span>
            <span className="num font-semibold">
              {current?.updated || current?.created ? relativeTime((current.updated ?? current.created) as string) : EM_DASH}
            </span>
          </div>
          {live && pct !== null && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <p className="num mt-1 text-right text-[10px] text-[var(--muted)]">{pct}%</p>
            </div>
          )}
          {current?.error && (
            <p className="mt-1.5 break-words text-[10px] text-[var(--bad)]">{current.error}</p>
          )}
          {error && <p className="mt-1.5 break-words text-[10px] text-[var(--bad)]">{error}</p>}
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={starting || live}
            className="mt-2 h-7 w-full rounded-lg bg-[var(--accent)] text-[11px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {starting ? 'Queueing…' : live ? 'Sweep running…' : 'Run sweep now'}
          </button>
          <p className="num mt-1.5 text-[10px] leading-snug text-[var(--faint)]">
            s2_indices · s1_watermask · lst_snow · flood_extent · glacier_ice
          </p>
        </div>
      )}
    </Panel>
  )
}
