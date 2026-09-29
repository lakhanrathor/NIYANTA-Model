import { useState } from 'react'
import type { BreachHydrograph, RunSeries } from '../../lib/api'
import { Icon } from '../../components/ui'
import { AreaReachChart, seriesHeadline } from '../../components/flood/AreaReachChart'
import { BreachHydrographChart, hydroHeadline } from '../../components/flood/BreachHydrographChart'
import { exportHydroCsv, exportSeriesCsv } from './csv'

/**
 * Analytics tabs: inundation progression and breach hydrograph. Owns only its
 * tab state — data arrives as props, CSV exports are the pure builders in
 * `csv.ts`. Gauges live in the always-visible right-column panel, not here.
 */
export function ResultsAnalyticsPanel({
  series,
  hydro,
  hydroPending,
  runId,
}: {
  series: RunSeries | null | undefined
  hydro: BreachHydrograph | null | undefined
  hydroPending: boolean
  runId: string | null
}) {
  const [tab, setTab] = useState<'progression' | 'hydrograph'>('progression')

  const btn = (value: typeof tab, label: string) => (
    <button
      key={value}
      onClick={() => setTab(value)}
      className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${
        tab === value
          ? 'bg-white text-[var(--accent)] shadow-xs border border-[var(--line)]'
          : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="shrink-0 rounded-xl border border-[var(--line)] bg-white shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-slate-50/70 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {btn('progression', 'Inundation Progression (Area & Reach)')}
          {btn('hydrograph', 'Breach Hydrograph & Outflow')}
        </div>

        {/* CSV Export for Active Analytics Tab */}
        {tab === 'progression' && (
          <button
            disabled={!series?.times_s?.length}
            onClick={() => exportSeriesCsv(series, runId)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-40"
          >
            <Icon name="download" size={12} />
            Export Progression CSV
          </button>
        )}
        {tab === 'hydrograph' && (
          <button
            disabled={!hydro?.time_s?.length}
            onClick={() => exportHydroCsv(hydro, runId)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-40"
          >
            <Icon name="download" size={12} />
            Export Hydrograph CSV
          </button>
        )}
      </div>

      <div className="p-3">
        {tab === 'progression' && (
          <div>
            <p className="mb-1 text-[11px] text-[var(--muted)] font-medium">
              {series ? seriesHeadline(series) : 'Building flood progression series…'}
            </p>
            <AreaReachChart series={series} height={200} />
          </div>
        )}

        {tab === 'hydrograph' && (
          <div>
            <p className="mb-1 text-[11px] text-[var(--muted)] font-medium">
              {hydroPending ? 'Loading hydrograph…' : hydroHeadline(hydro)}
            </p>
            <BreachHydrographChart hydro={hydro} height={200} />
          </div>
        )}
      </div>
    </div>
  )
}
