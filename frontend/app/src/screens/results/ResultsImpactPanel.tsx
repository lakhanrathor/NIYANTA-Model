import type { Impact, ResultMetrics } from '../../lib/api'
import { EM_DASH, km2, num, people } from '../../lib/format'
import { Icon, Panel } from '../../components/ui'

const STAT_CARDS = [
  { key: 'inundated_km2', label: 'Inundated Area', icon: 'globe', unit: 'km²' },
  { key: 'population', label: 'Affected Population', icon: 'pin', unit: '' },
  { key: 'villages', label: 'Affected Settlements', icon: 'grid', unit: '' },
  { key: 'roads_km', label: 'Impacted Roads', icon: 'ruler', unit: 'km' },
  { key: 'bridges', label: 'Bridges at Risk', icon: 'dam', unit: '' },
  { key: 'facilities', label: 'Critical Facilities', icon: 'file', unit: '' },
] as const

/**
 * Domain impact & vulnerabilities matrix: canonical `/result` metrics first,
 * `/impact` exposure totals beside them. Missing endpoints render EM_DASH —
 * never zeros that would read as "no damage".
 */
export function ResultsImpactPanel({
  metrics,
  impact,
}: {
  metrics: ResultMetrics | null | undefined
  impact: Impact | null | undefined
}) {
  return (
    <Panel title="Domain Impact & Vulnerabilities">
      <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
        {STAT_CARDS.map((card) => {
          const raw =
            card.key === 'inundated_km2'
              ? metrics?.inundation_km2 ?? impact?.inundated_km2 ?? null
              : impact?.[card.key] ?? null
          const display =
            raw === undefined || raw === null
              ? EM_DASH
              : card.key === 'population'
                ? people(raw)
                : card.key === 'inundated_km2'
                  ? km2(raw)
                  : `${num(raw, card.key === 'roads_km' ? 1 : 0)}${card.unit ? ` ${card.unit}` : ''}`
          return (
            <div key={card.key} className="flex items-start gap-2 bg-white px-3 py-2.5">
              <span className="mt-0.5 text-[var(--accent)]">
                <Icon name={card.icon} size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] leading-tight text-[var(--muted)] font-medium">{card.label}</span>
                <span className="num block text-[13px] font-bold text-slate-900">{display}</span>
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
