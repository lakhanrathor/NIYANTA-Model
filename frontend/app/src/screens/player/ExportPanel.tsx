import { useState } from 'react'
import { api } from '../../lib/api'
import { num } from '../../lib/format'
import { Icon, Panel, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'
import type { ExportFormat } from './types'

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

function triggerDownload(url: string, filename: string | null) {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Right rail — GIS downloads. Direct file when the run already packaged one,
 * otherwise queue `POST /exports` and poll until `download_url` appears.
 */
export function ExportPanel() {
  const { runId } = usePlayer()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const doExport = async (fmt: ExportFormat) => {
    if (!runId || busy) return
    setBusy(fmt)
    setNote(null)
    try {
      const doc = (await api.exportRun(runId, fmt)) as unknown as {
        url: string | null
        filename: string | null
        status?: string
      }
      if (doc?.url) {
        triggerDownload(doc.url, doc.filename)
        setNote(`${fmt.toUpperCase()} ready · ${doc.filename ?? 'download started'}`)
      } else {
        setNote(`${fmt.toUpperCase()} not packaged yet — queuing an export job…`)
        const job = await api.createExport(runId, [fmt])
        const jobId = String(job.id)
        for (let n = 0; n < 40; n++) {
          await sleep(3000)
          const st = await api.getExport(jobId)
          if (st.download_url) {
            triggerDownload(st.download_url, null)
            setNote(`${fmt.toUpperCase()} packaged · download started`)
            break
          }
          const failed = (st.status ?? '').toLowerCase()
          if (failed === 'failed' || failed === 'error') {
            setNote(`Export job ${st.status}${st.error ? ` — ${st.error}` : ''}`)
            break
          }
          setNote(
            `Packaging ${fmt.toUpperCase()}… ${st.progress != null ? `${num(st.progress, 0)}%` : `(${st.status ?? 'queued'})`}`,
          )
          if (n === 39) setNote(`Export job still ${st.status ?? 'queued'} — check Jobs for the download.`)
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Export & download">
      <div className="flex flex-wrap gap-1.5 p-2.5">
        {(['geotiff', 'shp', 'kml'] as ExportFormat[]).map((fmt) => (
          <button
            key={fmt}
            onClick={() => void doExport(fmt)}
            disabled={!runId || busy != null}
            className="flex items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11px] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            <Icon name="download" size={12} />
            {busy === fmt ? 'Working…' : fmt.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => runId && window.open(api.reportUrl(runId), '_blank', 'noopener')}
          disabled={!runId}
          className="flex items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11px] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          <Icon name="file" size={12} />
          Report
        </button>
      </div>
      {note && <p className="px-3 pb-2 text-[11px] text-[var(--muted)]">{note}</p>}
      <Prov>
        Direct rasters via <span className="num">/runs/{runId ? runId.slice(0, 8) : '…'}/export?fmt=</span> · packages
        via <span className="num">POST /exports</span>
      </Prov>
    </Panel>
  )
}
