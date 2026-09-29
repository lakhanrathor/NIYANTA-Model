import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { EM_DASH } from '../lib/format'
import { Icon } from './ui'

/** `POST /api/exports` accepts any of these; the packager writes each one. */
const EXPORT_FORMATS = [
  { fmt: 'shp', label: 'SHP' },
  { fmt: 'kml', label: 'KML' },
  { fmt: 'geojson', label: 'GeoJSON' },
  { fmt: 'geotiff', label: 'GeoTIFF' },
  { fmt: 'csv', label: 'CSV' },
  { fmt: 'report', label: 'Report' },
]

type Job = {
  id: string
  fmt: string
  status: string
  error: string | null
  url: string | null
  files: string[] | null
}

const STATUS_TEXT: Record<string, string> = {
  queued: 'Queued',
  running: 'Packaging',
  done: 'Ready',
  failed: 'Failed',
}

/**
 * One run's GIS/report export surface: `POST /exports` starts a job, the panel
 * polls `GET /exports/{id}` until it settles, then offers the download. The
 * live HTML report comes from `GET /api/reports/{run}`. Used by Compare for
 * runs A and B; Results can adopt the same panel.
 */
export function ExportPanel({
  runId,
  label,
  accent,
}: {
  runId: string | null
  label: string
  accent: string
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const jobRef = useRef<Job | null>(null)

  useEffect(() => {
    jobRef.current = job
  }, [job])

  const busy = Boolean(job && job.status !== 'done' && job.status !== 'failed')

  useEffect(() => {
    if (!busy) return
    const tick = window.setInterval(() => {
      const cur = jobRef.current
      if (!cur) return
      api
        .getExport(cur.id)
        .then((row) => {
          setJob((prev) => {
            if (!prev || prev.id !== cur.id) return prev
            const status = (row.status ?? prev.status).toLowerCase()
            const url =
              status === 'done'
                ? row.download_url ?? (row.path ? `/api/exports/${cur.id}/download` : prev.url)
                : prev.url
            return {
              ...prev,
              status,
              url,
              error: row.error ?? prev.error,
              files: Array.isArray(row.files) ? row.files : prev.files,
            }
          })
        })
        .catch(() => {
          /* the next tick retries; the last honest status stays on screen */
        })
    }, 1500)
    return () => window.clearInterval(tick)
  }, [busy])

  const start = async (fmt: string) => {
    if (!runId) return
    setNote(null)
    try {
      const row = await api.createExport(runId, [fmt])
      setJob({
        id: String(row.id),
        fmt,
        status: (row.status ?? 'queued').toLowerCase(),
        error: row.error ?? null,
        url: row.download_url ?? null,
        files: Array.isArray(row.files) ? row.files : null,
      })
    } catch (err) {
      setNote(
        err instanceof ApiError ? `Export rejected — ${err.message}` : 'Export service offline',
      )
    }
  }

  const openReport = () => {
    if (runId) window.open(api.reportUrl(runId), '_blank', 'noopener')
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          {label}
        </span>
        <span className="num ml-auto truncate text-[10px] text-[var(--faint)]" title={runId ?? ''}>
          {runId ? runId.slice(0, 8) : EM_DASH}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.fmt}
            disabled={!runId || busy}
            onClick={() => start(f.fmt)}
            title={runId ? 'POST /api/exports' : 'Pick a run first'}
            className="rounded border border-[var(--line-strong)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--muted)] enabled:hover:border-[var(--accent)] enabled:hover:text-[var(--accent)] disabled:opacity-40"
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={openReport}
          disabled={!runId}
          title={runId ? `GET ${api.reportUrl(runId)}` : 'Pick a run first'}
          className="flex items-center rounded border border-[var(--line-strong)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--muted)] enabled:hover:border-[var(--accent)] enabled:hover:text-[var(--accent)] disabled:opacity-40"
        >
          <Icon name="file" size={11} className="mr-1" />
          Open report
        </button>
      </div>
      {job && (
        <div className="mt-1.5 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-[10px] leading-snug">
          <div className="flex items-center gap-1.5">
            <span className={job.status === 'failed' ? 'text-[var(--bad)]' : 'text-[var(--text)]'}>
              {STATUS_TEXT[job.status] ?? job.status} · {job.fmt}
            </span>
            <span className="num ml-auto text-[var(--faint)]">job {job.id}</span>
          </div>
          {job.status === 'done' && job.url && (
            <a
              href={job.url}
              download
              className="mt-1 inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
            >
              <Icon name="download" size={11} />
              Download package
            </a>
          )}
          {job.status === 'done' && !job.url && (
            <p className="mt-1 text-[var(--faint)]">
              Packaged — the file list below comes from the job record.
            </p>
          )}
          {job.files && job.files.length > 0 && (
            <ul className="num mt-1 space-y-0.5 text-[var(--faint)]">
              {job.files.map((f) => (
                <li key={f} className="truncate" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
          {job.status === 'failed' && (
            <p className="mt-1 break-words text-[var(--bad)]">
              {job.error ?? 'The packager failed — no files written.'}
            </p>
          )}
        </div>
      )}
      {note && (
        <p className="mt-1.5 break-words text-[10px] leading-snug text-[var(--bad)]">{note}</p>
      )}
    </div>
  )
}
