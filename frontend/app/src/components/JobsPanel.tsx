import { useState } from 'react'
import { api } from '../lib/api'
import type { Job } from '../lib/api'
import { EM_DASH, relativeTime } from '../lib/format'
import { useApi } from '../lib/useApi'
import { Icon } from './ui'

const STATUS_TONE: Record<string, string> = {
  queued: 'text-[var(--muted)]',
  running: 'text-[var(--accent)]',
  done: 'text-[var(--ok)]',
  failed: 'text-[var(--bad)]',
  cancelled: 'text-[var(--faint)]',
}

const isLive = (job: Job) => job.status === 'queued' || job.status === 'running'

function title(job: Job): string {
  const params = job.params ?? {}
  if (job.type === 'corridor.dataset') return `Download ${String(params.kind ?? 'dataset')}`
  if (job.type === 'corridor.prepare') return 'Prepare river corridor'
  if (job.type.startsWith('stage.')) return `Run stage · ${job.type.slice(6)}`
  if (job.type === 'dataset.process') return 'Process dataset'
  if (job.type === 'export.package') return 'Package export'
  if (job.type === 'gee.daily') return 'GEE daily sweep'
  if (job.type === 'connector.sync') return 'Connector sync'
  return job.type
}

/**
 * Global job monitor in the top bar — download/prepare/run progress is visible
 * from every screen, not only from the Discover right column that started it.
 */
export function JobsPanel() {
  const [open, setOpen] = useState(false)
  const jobs = useApi(['jobs'], () => api.jobs(), { refetchInterval: 3000 })
  const rows = jobs.data ?? []
  const active = rows.filter(isLive)

  return (
    <div className="relative">
      <button
        title="Jobs"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
          open
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
        }`}
      >
        <Icon name="gear" size={13} />
        {active.length > 0 && (
          <span className="num absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-0.5 text-[8px] font-semibold text-white">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div className="panel absolute right-0 z-50 mt-2 w-[360px] shadow-[var(--shadow)]">
          <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
            <span className="text-[11px] font-semibold">Jobs</span>
            <span className="num text-[10px] text-[var(--muted)]">
              {active.length > 0 ? `${active.length} active` : 'idle'}
            </span>
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {jobs.offline ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">
                Job list unavailable
              </p>
            ) : jobs.pending && rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">No jobs yet</p>
            ) : (
              <ul>
                {rows.map((job) => (
                  <li
                    key={job.id}
                    className="border-b border-[var(--line)] px-3 py-2 last:border-b-0"
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate font-medium">{title(job)}</span>
                      <span className="num shrink-0 text-[10px] text-[var(--faint)]">
                        {job.progress}%
                      </span>
                      <span
                        className={`num w-16 shrink-0 text-right text-[10px] ${STATUS_TONE[job.status] ?? ''}`}
                      >
                        {job.status}
                      </span>
                    </div>

                    {isLive(job) && (
                      <div className="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--line)]">
                        <div
                          className="h-full rounded bg-[var(--accent)] transition-[width] duration-500"
                          style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                        />
                      </div>
                    )}

                    {job.status === 'failed' && job.error && (
                      <p className="mt-1 break-words text-[10px] text-[var(--bad)]">
                        {(job.error.split('\n')[0] || job.error).slice(0, 180)}
                      </p>
                    )}

                    <p className="num mt-0.5 text-[9px] text-[var(--faint)]">
                      {job.type} · {relativeTime(job.updated)} · {job.id.slice(0, 8)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--line)] px-3 py-1.5">
            <span className="num text-[9px] text-[var(--faint)]">
              {rows.length ? `latest ${rows.length} jobs` : EM_DASH} · refreshes every 3s
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
