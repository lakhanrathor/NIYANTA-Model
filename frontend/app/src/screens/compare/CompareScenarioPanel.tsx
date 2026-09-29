import { clock, EM_DASH } from '../../lib/format'
import { Metric, Panel } from '../../components/ui'
import { DamCard } from '../../components/dam/DamCard'

/**
 * Whose floods are being compared: the dam header reads the mission context
 * through the shared card; river, breach method and horizon are this run's
 * own facts and stay props.
 */
export function CompareScenarioPanel({
  place,
  riverName,
  reachKm,
  breachMethod,
  simHours,
}: {
  place: string | null
  riverName: string | null
  reachKm: number
  breachMethod: string | null
  simHours: number | null
}) {
  return (
    <Panel title="Scenario Details">
      <DamCard variant="inline" />
      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="truncate text-[13px] font-semibold">{place ?? EM_DASH}</p>
        <p className="num truncate text-[10px] text-[var(--faint)]">{reachKm} km reach</p>
      </div>
      <Metric label="River" value={riverName ?? EM_DASH} />
      <Metric label="Breach method" value={breachMethod ?? EM_DASH} />
      <Metric label="Horizon" value={simHours != null ? clock(simHours * 3600) : EM_DASH} />
    </Panel>
  )
}
