import type { ResultMetrics, RunSeries } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { Metric, Panel, Pill } from '../../components/ui'
import { DamCard } from '../../components/dam/DamCard'
import { kpiRows } from '../../components/flood/kpi'

/**
 * Scenario tab: the run's headline outcome numbers first (peak discharge,
 * released volume, footprint, depth, reach, mass balance — the old top strip,
 * now living here so the map gets the vertical room), then the compact dam &
 * breach configuration they were produced with. Every value is a primitive
 * computed by the orchestrator — unknown renders EM_DASH.
 *
 * The dam header reads the mission context itself; only run facts
 * (completion, case, breach, engine, metrics) arrive as props.
 */
export function ResultsScenarioPanel({
  completed,
  stateLabel,
  caseLabel,
  damType,
  reachKm,
  breachWidth,
  breachDepth,
  reservoirLevel,
  simHours,
  engine,
  engineLabel,
  metrics,
  series,
}: {
  completed: boolean
  stateLabel: string | null
  caseLabel: string
  damType: string | null
  reachKm: number
  breachWidth: number | null
  breachDepth: number | null
  reservoirLevel: number | null
  simHours: number | null
  engine: string | null
  engineLabel: string | null
  metrics: ResultMetrics | null | undefined
  series: RunSeries | null | undefined
}) {
  return (
    <Panel title="Scenario Details">
      <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
        {kpiRows(metrics, series).map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 bg-white px-2.5 py-2">
            <span className="text-[9px] uppercase tracking-[0.05em] text-[var(--muted)]">
              {r.label}
            </span>
            <span className="num text-[14px] font-semibold leading-tight">
              {r.value}
              {r.unit && <span className="ml-1 text-[9px] font-normal text-[var(--faint)]">{r.unit}</span>}
            </span>
            <span
              className={`num text-[9px] ${
                r.tone === 'ok'
                  ? 'text-[var(--ok)]'
                  : r.tone === 'warn'
                    ? 'text-[var(--warn)]'
                    : 'text-[var(--faint)]'
              }`}
            >
              {r.sub ?? ' '}
            </span>
          </div>
        ))}
      </div>

      <DamCard variant="inline" />
      <div className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-2">
        <Pill tone={completed ? 'ok' : 'accent'}>
          {completed ? 'Simulation Succeeded' : (stateLabel ?? EM_DASH)}
        </Pill>
        <span className="font-mono text-[10px] text-slate-500">{caseLabel}</span>
      </div>

      <Metric label="Dam type" value={damType ?? EM_DASH} />
      <Metric label="Study reach" value={`${reachKm} km`} />
      <Metric
        label="Breach width"
        value={breachWidth != null ? num(breachWidth, 1) : EM_DASH}
        unit="m"
      />
      <Metric
        label="Breach depth"
        value={breachDepth != null ? num(breachDepth, 1) : EM_DASH}
        unit="m"
      />
      <Metric
        label="Reservoir level"
        value={reservoirLevel != null ? num(reservoirLevel, 1) : EM_DASH}
        unit="m"
      />
      <Metric
        label="Sim duration"
        value={simHours != null ? num(simHours, 1) : EM_DASH}
        unit="h"
      />
      <Metric label="Engine" value={engineLabel ?? (engine ? engine.toUpperCase() : EM_DASH)} />
    </Panel>
  )
}
