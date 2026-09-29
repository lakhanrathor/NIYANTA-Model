import { EM_DASH } from '../../lib/format'
import { Panel, Prov } from '../../components/ui'
import { BreachHydrographChart, hydroHeadline } from '../../components/flood/BreachHydrographChart'
import { usePlayer } from './PlayerProvider'

/** Right rail — breach outflow Q(t); method labelled verbatim from the run. */
export function HydrographPanel() {
  const { runId, hydro, summary, spec } = usePlayer()
  const method = summary.data?.breach_method ?? spec?.breach?.method ?? null
  return (
    <Panel
      title="Breach hydrograph"
      actions={<span className="num text-[10px] text-[var(--muted)]">{hydroHeadline(hydro.data)}</span>}
    >
      <div className="px-1 pt-1">
        <BreachHydrographChart hydro={hydro.data} height={170} />
      </div>
      <Prov>
        Method: {method ?? EM_DASH} ·{' '}
        <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/hydrograph</span>
      </Prov>
    </Panel>
  )
}
