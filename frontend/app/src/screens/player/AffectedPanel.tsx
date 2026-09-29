import { EM_DASH, km, num, people } from '../../lib/format'
import { Empty, Metric, Panel, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Right rail — modelled exposure totals from /impact. */
export function AffectedPanel() {
  const { runId, impact } = usePlayer()
  const d = impact.data
  // A zero is data (real zeros render as numbers); only a wholly absent
  // document collapses — five dash-rows plus an endpoint string help nobody.
  const hasAny =
    d != null &&
    (d.population ?? d.buildings ?? d.villages ?? d.roads_km ?? d.facilities) != null
  return (
    <Panel title="Affected">
      {hasAny ? (
        <>
          <Metric label="Population" value={d!.population != null ? people(d!.population) : EM_DASH} />
          <Metric label="Buildings" value={d!.buildings != null ? num(d!.buildings, 0) : EM_DASH} />
          <Metric label="Villages" value={d!.villages != null ? num(d!.villages, 0) : EM_DASH} />
          <Metric label="Roads" value={d!.roads_km != null ? km(d!.roads_km, 1) : EM_DASH} />
          <Metric label="Facilities" value={d!.facilities != null ? num(d!.facilities, 0) : EM_DASH} />
        </>
      ) : impact.pending ? (
        <Empty>Loading impact…</Empty>
      ) : (
        <Empty>Impact not computed for this run.</Empty>
      )}
      <Prov>
        <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/impact</span>
        {d?.population_method ? ` · ${d.population_method}` : ''}
      </Prov>
    </Panel>
  )
}
