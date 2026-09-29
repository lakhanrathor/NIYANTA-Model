import { Panel, Prov } from '../../components/ui'
import { StationsPanel } from '../../components/flood/StationsPanel'
import { usePlayer } from './PlayerProvider'

/** Right rail — downstream gauge arrivals from /stations. */
export function GaugesPanel() {
  const { runId, stations } = usePlayer()
  return (
    <Panel title="Gauges">
      <StationsPanel stations={stations.data} />
      <Prov>
        <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/stations</span>
      </Prov>
    </Panel>
  )
}
