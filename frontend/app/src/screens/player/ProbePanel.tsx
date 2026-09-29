import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, clock, m, num } from '../../lib/format'
import { Empty, Metric, Panel, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Right rail — depth/arrival/velocity at the point clicked in the viewport. */
export function ProbePanel() {
  const { runId, pick } = usePlayer()
  const probe = useApi(['probe', runId, pick?.lon, pick?.lat], () => api.probe(runId!, pick!.lon, pick!.lat), {
    enabled: Boolean(runId && pick),
  })

  return (
    <Panel title="Depth at selected location">
      {!pick ? (
        <Empty>Click anywhere in the 3D scene to probe depth, arrival, velocity and bed elevation.</Empty>
      ) : (
        <>
          <Metric label="Point" value={`${pick.lat.toFixed(4)}°, ${pick.lon.toFixed(4)}°`} />
          <Metric
            label="Depth"
            value={probe.data?.depth_m != null ? m(probe.data.depth_m, 2) : probe.offline ? 'Source offline' : EM_DASH}
          />
          <Metric
            label="Arrival"
            value={
              probe.data?.arrival_s != null
                ? clock(probe.data.arrival_s)
                : probe.data && probe.data.inundated === false
                  ? 'never reached'
                  : probe.offline
                    ? 'Source offline'
                    : EM_DASH
            }
          />
          <Metric
            label="Velocity"
            value={
              probe.data?.velocity_mps != null
                ? `${num(probe.data.velocity_mps, 2)} m/s`
                : probe.offline
                  ? 'Source offline'
                  : EM_DASH
            }
          />
          <Metric
            label="Bed elevation"
            value={
              probe.data?.elevation_m != null ? m(probe.data.elevation_m, 1) : probe.offline ? 'Source offline' : EM_DASH
            }
          />
          <Prov>
            <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/probes?lon&lat</span>
          </Prov>
        </>
      )}
    </Panel>
  )
}
