import type { ResultMetrics, RunSeries } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'

export type KpiTone = 'ok' | 'warn' | 'bad'

export interface KpiRow {
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: KpiTone
}

/**
 * Headline flood-impact numbers for a completed run — peak breach discharge,
 * volume released, footprint, depth, reach, mass balance — read straight from
 * `GET /runs/{id}/result` and `/series`. One measured number per row, never a
 * demo value: absent data renders EM_DASH. Shared by the full-width strip and
 * the compact Scenario-tab grid.
 */
export function kpiRows(
  metrics: ResultMetrics | null | undefined,
  series: RunSeries | null | undefined,
): KpiRow[] {
  const peak = metrics?.peak_discharge_cms
  const peakHr = metrics?.peak_at_hr
  const reach = series?.reach_km?.length ? Math.max(...series.reach_km) : null
  const massErr = metrics?.mass_balance_error_pct
  return [
    {
      label: 'Peak breach discharge',
      value: peak != null ? num(peak, 0) : EM_DASH,
      unit: 'm³/s',
      sub: peakHr != null ? `at ${num(peakHr * 60, 0)} min after breach` : undefined,
    },
    {
      label: 'Water released',
      value: metrics?.volume_hm3 != null ? num(metrics.volume_hm3, 2) : EM_DASH,
      unit: 'hm³',
      sub: metrics?.duration_hr != null ? `by t = ${num(metrics.duration_hr, 1)} h` : undefined,
    },
    {
      label: 'Area inundated',
      value: metrics?.inundation_km2 != null ? num(metrics.inundation_km2, 2) : EM_DASH,
      unit: 'km²',
      sub: series ? `≥ ${num(series.threshold_m * 100, 0)} cm deep` : undefined,
    },
    {
      label: 'Max flood depth',
      value: metrics?.max_depth_m != null ? num(metrics.max_depth_m, 2) : EM_DASH,
      unit: 'm',
      sub: 'somewhere in domain',
    },
    {
      label: 'Farthest reach',
      value: reach != null ? num(reach, 2) : EM_DASH,
      unit: 'km',
      sub: 'from the breach',
    },
    {
      label: 'Mass balance error',
      value:
        massErr != null ? num(Math.abs(massErr), massErr !== 0 && Math.abs(massErr) < 0.01 ? 4 : 3) : EM_DASH,
      unit: '%',
      sub: 'in = out + stored',
      tone: (massErr != null && Math.abs(massErr) < 1 ? 'ok' : massErr != null ? 'warn' : undefined) as
        | KpiTone
        | undefined,
    },
  ]
}
