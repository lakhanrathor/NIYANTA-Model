import type { ResultMetrics, RunSeries } from '../../lib/api'
import { kpiRows } from './kpi'

/** One measured headline number. Never a demo value: absent data renders —. */
function Cell({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: 'ok' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]' : tone === 'bad' ? 'text-[var(--bad)]' : ''
  return (
    <div className="flex flex-col gap-0.5 bg-white px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.05em] text-[var(--muted)]">{label}</span>
      <span className="num text-[16px] font-semibold leading-tight">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-[var(--faint)]">{unit}</span>}
      </span>
      <span className={`num text-[9.5px] ${toneClass || 'text-[var(--faint)]'}`}>{sub ?? ' '}</span>
    </div>
  )
}

/**
 * Headline flood-impact numbers for a completed run — peak breach discharge,
 * volume released, footprint, depth, mass balance — read straight from
 * `GET /runs/{id}/result` and `/series`.
 */
export function KpiStrip({
  metrics,
  series,
}: {
  metrics?: ResultMetrics | null
  series?: RunSeries | null
}) {
  const rows = kpiRows(metrics, series)
  return (
    <div className="grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3 xl:grid-cols-6">
      {rows.map((r) => (
        <Cell key={r.label} {...r} />
      ))}
    </div>
  )
}
