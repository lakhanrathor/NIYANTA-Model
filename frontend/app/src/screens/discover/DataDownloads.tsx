import { useEffect, useMemo, useState } from 'react'
import { Empty, Panel, Prov } from '../../components/ui'
import { PrepareStages } from './PrepareStages'
import { STAGING_KINDS, api } from '../../lib/api'
import type { CorridorDataset } from '../../lib/api'
import { EM_DASH, bytes, pct } from '../../lib/format'
import { useApi } from '../../lib/useApi'

const STATUS_TONE: Record<string, string> = {
  available: 'text-[var(--ok)]',
  partial: 'text-[var(--warn)]',
  missing: 'text-[var(--faint)]',
  fetching: 'text-[var(--accent)]',
  failed: 'text-[var(--bad)]',
}

const isLive = (status?: string | null) => status === 'queued' || status === 'running'

export function DataDownloads({ riverId }: { riverId: string | null }) {
  const corridors = useApi(['corridors'], api.corridors)
  const corridorId = corridors.data?.find((c) => c.river_id === riverId)?.id ?? null
  // A running prepare owns the downloads: dataset rows (and their buttons)
  // only exist once it writes them from disk evidence, so surface its
  // progress here instead of a dead-end "no corridor" message.
  const jobs = useApi(['jobs'], () => api.jobs(), {
    enabled: Boolean(riverId),
    refetchInterval: 2000,
  })
  const prepareJob = (jobs.data ?? []).find(
    (j) => j.type === 'corridor.prepare' && `${j.params?.river_id ?? ''}` === riverId,
  )
  const preparing =
    prepareJob != null && (isLive(prepareJob.status) || prepareJob.status === 'paused')
  const preparePaused = prepareJob?.status === 'paused'
  const [polling, setPolling] = useState(false)
  const [queued, setQueued] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const sets = useApi(
    ['corridor-datasets', corridorId],
    () => api.corridorDatasets(corridorId!),
    { enabled: Boolean(corridorId), refetchInterval: polling ? 1500 : false },
  )

  // OSM / SAR / Sentinel-2 rows exist for a later page — this staging only
  // prepares and offers DEM, dam registry and population.
  const rows = useMemo(
    () => (sets.data ?? []).filter((r) => STAGING_KINDS.has(r.kind)),
    [sets.data],
  )

  // Poll only while a download is actually in flight (paused included, so a
  // resume or an external cancel shows up); stop the moment none are.
  useEffect(() => {
    const live = rows.some((r) => isLive(r.job?.status) || r.job?.status === 'paused')
    setPolling(live)
    if (rows.some((r) => isLive(r.job?.status))) setQueued(null)
  }, [rows])

  const download = async (kind: string) => {
    if (!corridorId || queued) return
    setQueued(kind)
    setNotice(null)
    try {
      const res = await api.downloadCorridorDataset(corridorId, kind)
      // Already on disk: nothing to poll for, and leaving `queued` set would
      // disable every button in the panel.
      if (res.cached) {
        setQueued(null)
        setNotice('Already on disk')
        return
      }
      setPolling(true)
    } catch (err) {
      setQueued(null)
      setNotice(err instanceof Error ? err.message : 'Download failed to queue')
    }
  }

  // Pause keeps the `.part` file; resume re-queues the same job, so the byte
  // range already fetched is never downloaded twice.
  const setJobState = async (
    kind: string,
    job: NonNullable<CorridorDataset['job']>,
    action: 'pause' | 'resume',
  ) => {
    setQueued(kind)
    setNotice(null)
    try {
      await (action === 'pause' ? api.pauseJob(job.id) : api.resumeJob(job.id))
      setPolling(true)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `${action} failed`)
    } finally {
      setQueued(null)
    }
  }

  const totalBytes = rows.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0)

  return (
    <Panel title="Data Downloads">
      {!riverId ? (
        <Empty>Select a river first</Empty>
      ) : corridors.pending || (sets.pending && rows.length === 0) ? (
        <Empty>Loading…</Empty>
      ) : preparing ? (
        <>
          <Empty>
            {preparePaused
              ? 'Prepare paused — resume it in Next Steps; the DEM lands here when it finishes'
              : `Prepare running at ${prepareJob?.progress ?? 0}% — the DEM is being fetched by it right now, download rows appear when it finishes`}
          </Empty>
          <PrepareStages progress={prepareJob?.progress ?? 0} />
        </>
      ) : corridors.offline || sets.offline ? (
        <Empty>Corridor catalogue unavailable</Empty>
      ) : rows.length === 0 ? (
        <Empty>No corridor prepared for this river yet</Empty>
      ) : (
        <>
          <div className="px-3 pb-2">
            {rows.map((d) => {
              const job = d.job
              const live = isLive(job?.status)
              const paused = job?.status === 'paused'
              const busy = live || paused
              const failed = job?.status === 'failed' || d.status === 'failed'
              const waiting = queued === d.kind && !job
              const idle = !busy && d.status !== 'available' && d.status !== 'fetching'
              return (
                <div
                  key={d.kind}
                  className="border-b border-[var(--line)] py-1.5 last:border-b-0"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {d.label || d.kind}
                    </span>
                    <span className="num text-[var(--muted)]">{pct(d.coverage_pct, 0)}</span>
                    <span
                      className={`num w-16 shrink-0 text-right text-[10px] ${
                        paused ? 'text-[var(--warn)]' : (STATUS_TONE[d.status] ?? '')
                      }`}
                    >
                      {paused ? 'paused' : d.status}
                    </span>
                  </div>
                  <div className="num flex items-center justify-between gap-2 text-[10px] text-[var(--faint)]">
                    <span className="min-w-0 truncate">{d.source || EM_DASH}</span>
                    <span className="shrink-0">{d.size_bytes ? bytes(d.size_bytes) : EM_DASH}</span>
                  </div>

                  {busy && (
                    <div className="mt-1.5">
                      <div className="h-1 w-full overflow-hidden rounded bg-[var(--line)]">
                        <div
                          className={`h-full rounded transition-[width] duration-500 ${
                            paused ? 'bg-[var(--warn)]' : 'bg-[var(--accent)]'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, job?.progress ?? 0))}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p className="num min-w-0 flex-1 truncate text-[10px] text-[var(--muted)]">
                          {job?.status === 'queued'
                            ? 'Queued'
                            : paused
                              ? `Paused at ${job?.progress ?? 0}%`
                              : `${job?.progress ?? 0}%`}
                          {job?.message ? ` · ${job.message}` : ''}
                        </p>
                        <button
                          onClick={() => job && void setJobState(d.kind, job, paused ? 'resume' : 'pause')}
                          disabled={Boolean(queued)}
                          className="shrink-0 rounded border border-[var(--line-strong)] px-1.5 py-px text-[10px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                        >
                          {queued === d.kind ? '…' : paused ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </div>
                  )}

                  {failed && (
                    <p className="mt-1 break-words text-[10px] text-[var(--bad)]">
                      {job?.error || 'Download failed'}
                    </p>
                  )}

                  {idle && (
                    <button
                      onClick={() => void download(d.kind)}
                      disabled={Boolean(queued)}
                      className="mt-1.5 h-6 w-full rounded border border-[var(--accent)] text-[10px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-40"
                    >
                      {waiting ? 'Queuing…' : failed ? 'Retry download' : 'Download'}
                    </button>
                  )}
                </div>
              )
            })}
            {notice && (
              <p className="mt-1.5 text-[10px] text-[var(--bad)]">{notice}</p>
            )}
          </div>
          <Prov>{`Corridor has ${rows.length} datasets · ${bytes(totalBytes)} on disk`}</Prov>
        </>
      )}
    </Panel>
  )
}
