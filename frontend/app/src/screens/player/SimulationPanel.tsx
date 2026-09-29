import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, clock, km, km2, num, stamp } from '../../lib/format'
import { Metric, Panel, Pill, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Right rail — run identity + solver configuration + breach geometry. All rows API-sourced. */
export function SimulationPanel() {
  const { runId, summary, simHours, frameT, reachKm } = usePlayer()
  const params = useApi(['run-params', runId], () => api.runParams(runId!), { enabled: Boolean(runId) })
  const metrics = useApi(['run-metrics', runId], () => api.runMetrics(runId!), { enabled: Boolean(runId) })

  const engineLabel = summary.data?.engine_label ?? null
  const stateLabel = summary.data?.status ?? null
  const dtS = metrics.data?.dt_s ?? params.data?.dt_s ?? null
  const domainKm2 = params.data?.domain_km ?? metrics.data?.domain_km2 ?? null
  const nearField = summary.data?.near_field_only ?? false

  return (
    <Panel
      title="Simulation"
      actions={
        nearField ? (
          <Pill tone="warn">
            Near-field only{summary.data?.window_m != null ? ` · ${num(summary.data.window_m, 0)} m` : ''}
          </Pill>
        ) : undefined
      }
    >
      <Metric label="Engine" value={engineLabel ?? EM_DASH} />
      <Metric label="State" value={stateLabel ?? EM_DASH} />
      <Metric label="Sim hours" value={simHours != null ? `${num(simHours, 2)} hr` : EM_DASH} />
      <Metric label="Current time" value={frameT != null ? clock(frameT) : EM_DASH} />
      <Metric label="Finished" value={summary.data?.finished_at ? stamp(summary.data.finished_at) : EM_DASH} />
      <Metric label="Time step" value={dtS != null ? `${num(dtS, 2)} s` : EM_DASH} />
      <Metric label="Domain" value={domainKm2 != null ? km2(domainKm2, 1) : EM_DASH} />
      <Metric
        label="Resolution"
        value={params.data?.target_resolution_m != null ? `${num(params.data.target_resolution_m, 1)} m` : EM_DASH}
      />
      <Metric label="Study reach" value={reachKm != null ? km(reachKm, 0) : EM_DASH} />
      <Metric
        label="Breach width"
        value={summary.data?.breach_width != null ? `${num(summary.data.breach_width, 1)} m` : EM_DASH}
      />
      <Metric
        label="Breach depth"
        value={summary.data?.breach_depth != null ? `${num(summary.data.breach_depth, 1)} m` : EM_DASH}
      />
      <Metric
        label="Reservoir level"
        value={summary.data?.reservoir_level != null ? `${num(summary.data.reservoir_level, 1)} m` : EM_DASH}
      />
      <Prov offline={summary.offline || params.offline || metrics.offline}>
        <span className="num">/summary · /params · /metrics · /frames.json</span>
        {(summary.offline || params.offline || metrics.offline) && ' — a source is offline'}
      </Prov>
    </Panel>
  )
}
