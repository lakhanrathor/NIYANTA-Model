import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { api, infraDepthAt } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, clock, num } from '../../lib/format'
import { usePlayer } from './PlayerProvider'

/**
 * Spec §14 live metrics: every cell is the value AT the playhead frame, from
 * the run's own data — series (area, depth, reach, population), gauges
 * (arrival) and the OSM exposure (buildings, roads, bridges). "so far" is the
 * running total up to this frame; it ends equal to the run's impact figures.
 */

function Cell({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'hot' }) {
  return (
    <div className="flex min-w-[118px] flex-1 flex-col justify-center border-r border-[var(--line)] px-3 py-1.5 last:border-r-0">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{label}</span>
      <span className={`font-mono text-[15px] font-semibold leading-tight ${tone === 'hot' ? 'text-[#b42318]' : ''}`}>
        {value}
      </span>
      {sub != null && <span className="truncate text-[10px] text-[var(--muted)]">{sub}</span>}
    </div>
  )
}

export function LiveMetricsBar() {
  const { runId, clamped, series, stations, frameT } = usePlayer()
  // same query key as the Viewport/Layers panel → one shared request
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId!), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })

  const s = series.data
  const i = clamped
  const at = <T,>(arr: T[] | undefined | null): T | null => (arr && i < arr.length ? arr[i] : null)

  const infraNow = useMemo(() => {
    const d = infra.data
    if (!d) return null
    const bThr = d.thresholds.building_m
    const rThr = d.thresholds.road_cut_m
    let bNow = 0
    let bSoFar = 0
    for (const b of d.buildings) {
      if ((infraDepthAt(b, i) ?? 0) > bThr) bNow++
      if (b.f0 != null && b.f0 <= i) bSoFar++
    }
    let rNow = 0
    let rSoFar = 0
    for (const r of d.roads) {
      if ((infraDepthAt(r, i) ?? 0) > rThr) rNow += r.km
      if (r.f0 != null && r.f0 <= i) rSoFar += r.km
    }
    const bridges = d.points.filter((p) => p.k === 'bridge')
    const brNow = bridges.filter((p) => (infraDepthAt(p, i) ?? 0) > bThr).length
    const brSoFar = bridges.filter((p) => p.f0 != null && p.f0 <= i).length
    return { bNow, bSoFar, rNow, rSoFar, brNow, brSoFar, rThr, nBridges: bridges.length }
  }, [infra.data, i])

  // Arrival: the farthest gauge the flood has reached by this frame
  const lastGauge = useMemo(() => {
    if (frameT == null || !stations.data) return null
    const hr = frameT / 3600
    const reached = stations.data
      .filter((g) => g.arrival_hr != null && g.arrival_hr <= hr && g.in_domain !== false)
      .sort((a, b) => b.km - a.km)
    return reached[0] ?? null
  }, [stations.data, frameT])

  const pop = s?.population ?? null
  const popNow = pop ? at(pop.now) : null
  const popSoFar = pop ? at(pop.reached) : null

  return (
    <div className="flex min-h-[54px] shrink-0 overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
      <Cell label="Max depth" value={at(s?.max_depth_m) != null ? `${num(at(s?.max_depth_m), 1)} m` : EM_DASH} sub="deepest water now" />
      <Cell
        label="Flooded area"
        value={at(s?.area_km2.total) != null ? `${num(at(s?.area_km2.total), 2)} km²` : EM_DASH}
        sub={at(s?.reach_km) != null ? `front ${num(at(s?.reach_km), 1)} km from dam` : undefined}
      />
      <Cell
        label="Flood arrival"
        value={lastGauge?.arrival_hr != null ? clock(lastGauge.arrival_hr * 3600) : EM_DASH}
        sub={lastGauge ? `reached ${lastGauge.name ?? `CH${lastGauge.km}`} (${num(lastGauge.km, 0)} km)` : 'no gauge reached yet'}
      />
      <Cell
        label="People in water"
        tone={popNow ? 'hot' : undefined}
        value={popNow != null ? num(popNow, 0) : EM_DASH}
        sub={popSoFar != null ? `${num(popSoFar, 0)} reached so far` : 'no population grid here'}
      />
      <Cell
        label="Buildings flooded"
        tone={infraNow?.bNow ? 'hot' : undefined}
        value={infraNow ? num(infraNow.bNow, 0) : EM_DASH}
        sub={infraNow ? `${num(infraNow.bSoFar, 0)} so far` : undefined}
      />
      <Cell
        label="Roads cut"
        tone={infraNow?.rNow ? 'hot' : undefined}
        value={infraNow ? `${num(infraNow.rNow, 1)} km` : EM_DASH}
        sub={infraNow ? `>${infraNow.rThr} m · ${num(infraNow.rSoFar, 1)} km so far` : undefined}
      />
      <Cell
        label="Bridges hit"
        tone={infraNow?.brNow ? 'hot' : undefined}
        value={infraNow ? num(infraNow.brNow, 0) : EM_DASH}
        sub={infraNow ? `${num(infraNow.brSoFar, 0)} of ${num(infraNow.nBridges, 0)} so far` : undefined}
      />
    </div>
  )
}
