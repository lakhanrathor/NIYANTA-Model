import type { Probe } from '../../lib/api'
import { clock, EM_DASH, num } from '../../lib/format'
import { Empty, Metric, Panel, Pill } from '../../components/ui'
import { useRiverContext } from '../../lib/river-context'
import { useApp } from '../../lib/store'

/**
 * Point inspector: the pinned cell (from the map scope) with depth / arrival /
 * velocity / inundation / bed elevation from the raster-probe endpoint, or the
 * live cursor with an invitation to click. Pin state lives in the context —
 * the map pane writes it, this panel reads it. Probe *values* arrive as data
 * props from the orchestrator's query.
 */
export function ResultsProbePanel({
  scope,
  pending,
  data,
}: {
  scope: string
  pending: boolean
  data: Probe | null | undefined
}) {
  const probePoint = useRiverContext((s) => s.mapIntents[scope]?.probe ?? null)
  const publishMapIntent = useRiverContext((s) => s.publishMapIntent)
  const cursor = useApp((s) => s.cursor)

  return (
    <Panel
      title="Point Inspector"
      actions={
        probePoint ? (
          <button
            onClick={() => publishMapIntent(scope, { probe: null })}
            className="text-[11px] font-semibold text-rose-600 hover:underline"
            title="Clear pinned location"
          >
            Clear pin
          </button>
        ) : undefined
      }
    >
      {probePoint ? (
        <>
          <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--accent-soft)] px-3 py-1.5 text-[11px]">
            <span className="font-bold text-[var(--accent)]">Pinned Coordinate</span>
            <span className="num font-mono text-[11px] font-semibold">
              {probePoint.lat.toFixed(4)}° N, {probePoint.lon.toFixed(4)}° E
            </span>
          </div>
          <Metric
            label="Water Depth (h)"
            value={pending ? '…' : data?.depth_m != null ? num(data.depth_m, 2) : EM_DASH}
            unit="m"
          />
          <Metric
            label="Flood Arrival Time"
            value={
              data?.arrival_s != null ? (
                clock(data.arrival_s)
              ) : pending ? (
                '…'
              ) : (
                <span className="text-[var(--faint)]">not reached</span>
              )
            }
          />
          <Metric
            label="Peak Flow Velocity"
            value={data?.velocity_mps != null ? num(data.velocity_mps, 2) : EM_DASH}
            unit="m/s"
          />
          <Metric
            label="Inundation Zone"
            value={
              data?.inundated == null ? (
                EM_DASH
              ) : data.inundated ? (
                <Pill tone="bad">Hazard Zone</Pill>
              ) : data.nearest_water_m != null ? (
                <Pill tone="warn">
                  Near water · ~
                  {data.nearest_water_m < 1000
                    ? `${Math.round(data.nearest_water_m)} m`
                    : `${(data.nearest_water_m / 1000).toFixed(1)} km`}
                </Pill>
              ) : (
                <Pill tone="ok">Dry / Safe</Pill>
              )
            }
          />
          <Metric
            label="Bed Elevation (DEM)"
            value={data?.elevation_m != null ? num(data.elevation_m, 1) : EM_DASH}
            unit="m"
          />
        </>
      ) : cursor ? (
        <>
          <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[11px]">
            <span className="font-semibold text-[var(--muted)]">Hovered Location</span>
            <span className="num font-mono text-[10px]">
              {cursor.lat.toFixed(4)}° N, {cursor.lon.toFixed(4)}° E
            </span>
          </div>
          <Empty>
            Click the map to pin this coordinate — depth, arrival time, velocity and DEM bed elevation are sampled live from solver rasters.
          </Empty>
        </>
      ) : (
        <Empty>Hover anywhere over the map or click a location to inspect depth, velocity, and elevation.</Empty>
      )}
    </Panel>
  )
}
