import type { ComparisonMetric } from '../../lib/api'
import { clock, EM_DASH, km2, num, people } from '../../lib/format'
import { EmptyRow, Panel, Table } from '../../components/ui'

const ROWS: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: 'inundated_km2', label: 'Inundated Area', fmt: km2 },
  { key: 'peak_depth_m', label: 'Peak Depth', fmt: (v) => `${num(v, 2)} m` },
  { key: 'arrival_s', label: 'First arrival (downstream gauge)', fmt: (v) => clock(v) },
  { key: 'population', label: 'Affected Population', fmt: people },
  { key: 'villages', label: 'Affected Villages', fmt: (v) => num(v, 0) },
  { key: 'roads_km', label: 'Affected Roads', fmt: (v) => `${num(v, 1)} km` },
  { key: 'facilities', label: 'Critical Facilities', fmt: (v) => num(v, 0) },
]

/**
 * Metric-by-metric A/B table from `GET /api/comparisons`. Arrival carries an
 * honest label — the backend value is the first downstream gauge arrival, not
 * a dam-site time.
 */
export function CompareSummaryPanel({
  shortA,
  shortB,
  metrics,
}: {
  shortA: string
  shortB: string
  metrics: ComparisonMetric[] | undefined
}) {
  const byKey = new Map<string, ComparisonMetric>()
  for (const m of metrics ?? []) byKey.set(m.key, m)

  return (
    <Panel title="Comparison Summary">
      <Table head={['Metric', `${shortA} (A)`, `${shortB} (B)`, 'Difference (B − A)']}>
        {ROWS.map((row) => {
          const m = byKey.get(row.key)
          const deltaTone =
            m && typeof m.pct === 'number'
              ? m.pct > 0
                ? 'text-[var(--bad)]'
                : m.pct < 0
                  ? 'text-[var(--ok)]'
                  : 'text-[var(--muted)]'
              : 'text-[var(--faint)]'
          return (
            <tr key={row.key} className="border-b border-[var(--line)] last:border-b-0">
              <td className="px-2 py-1.5 text-[10px] text-[var(--muted)]">{row.label}</td>
              <td className="num px-2 py-1.5 text-right text-[11px]">
                {m && typeof m.a === 'number' ? row.fmt(m.a) : EM_DASH}
              </td>
              <td className="num px-2 py-1.5 text-right text-[11px]">
                {m && typeof m.b === 'number' ? row.fmt(m.b) : EM_DASH}
              </td>
              <td className={`num px-2 py-1.5 text-right text-[11px] ${deltaTone}`}>
                {m && typeof m.pct === 'number'
                  ? `${m.pct > 0 ? '↑' : m.pct < 0 ? '↓' : ''} ${num(Math.abs(m.pct), 1)}%`
                  : EM_DASH}
              </td>
            </tr>
          )
        })}
        {!metrics?.length && (
          <EmptyRow colSpan={4}>
            No comparison metrics available — both runs must be completed.
          </EmptyRow>
        )}
      </Table>
    </Panel>
  )
}
