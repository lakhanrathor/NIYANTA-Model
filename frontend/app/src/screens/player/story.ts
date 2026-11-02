import type { BreachHydrograph, RunInfra, RunSeries, RunStation, RunSummary } from '../../lib/api'
import { num } from '../../lib/format'

/** One moment in the run worth narrating. `t` = seconds after breach start. */
export interface StoryEvent {
  t: number
  kind: 'breach' | 'peak' | 'building' | 'road' | 'bridge' | 'gauge' | 'extent' | 'recede'
  title: string
  detail?: string
}

/**
 * The run's own timeline, built only from its outputs (hydrograph, gauges,
 * OSM exposure, area series) — nothing is narrated that the data doesn't show.
 */
export function storyEvents(input: {
  damName: string | null
  summary?: RunSummary
  hydro?: BreachHydrograph
  stations?: RunStation[]
  infra?: RunInfra
  series?: RunSeries
}): StoryEvent[] {
  const { damName, summary, hydro, stations, infra, series } = input
  const ev: StoryEvent[] = []
  const size =
    summary?.breach_width != null && summary?.breach_depth != null
      ? `${num(summary.breach_width, 0)} m wide × ${num(summary.breach_depth, 0)} m deep breach`
      : undefined
  ev.push({ t: 0, kind: 'breach', title: `Dam breach begins${damName ? ` at ${damName}` : ''}`, detail: size })
  if (hydro?.peak_cms != null && hydro.peak_at_hr != null) {
    ev.push({
      t: hydro.peak_at_hr * 3600,
      kind: 'peak',
      title: `Peak outflow ${num(hydro.peak_cms, 0)} m³/s leaves the breach`,
      detail: hydro.released_hm3 != null ? `${num(hydro.released_hm3, 1)} million m³ released in total` : undefined,
    })
  }
  if (infra) {
    const ts = infra.times_s
    const first = <T extends { f0?: number }>(xs: T[]) =>
      xs.reduce<T | null>((b, x) => (x.f0 != null && (b == null || x.f0 < (b.f0 ?? Infinity)) ? x : b), null)
    const b0 = first(infra.buildings)
    if (b0?.f0 != null && ts[b0.f0] != null) {
      ev.push({
        t: ts[b0.f0],
        kind: 'building',
        title: 'Water reaches the first buildings',
        detail: `${num(infra.summary.buildings_flooded, 0)} of ${num(infra.summary.buildings, 0)} mapped buildings are reached during the run`,
      })
    }
    const r0 = first(infra.roads)
    if (r0?.f0 != null && ts[r0.f0] != null) {
      ev.push({
        t: ts[r0.f0],
        kind: 'road',
        title: `First road cut (water over ${infra.thresholds.road_cut_m} m)`,
        detail: `${num(infra.summary.road_km_cut, 1)} km of road is cut during the run`,
      })
    }
    const bridges = infra.points
      .filter((p) => p.k === 'bridge' && p.f0 != null && ts[p.f0] != null)
      .sort((a, b) => (a.f0 ?? 0) - (b.f0 ?? 0))
    bridges.forEach((p, k) =>
      ev.push({
        t: ts[p.f0!],
        kind: 'bridge',
        title: `${p.n ? `Bridge ${p.n}` : `Bridge ${k + 1} of ${bridges.length}`} goes under water`,
      }),
    )
  }
  for (const s of stations ?? []) {
    // the 0 km gauge is the dam site itself — the breach event covers it
    if (s.arrival_hr == null || s.in_domain === false || s.km <= 0.05) continue
    ev.push({
      t: s.arrival_hr * 3600,
      kind: 'gauge',
      title: `Flood front reaches ${s.name ?? `chainage ${num(s.km, 0)} km`}`,
      detail: `${num(s.km, 1)} km downstream${s.max_depth_m != null ? ` · up to ${num(s.max_depth_m, 1)} m deep there` : ''}`,
    })
  }
  const area = series?.area_km2?.total
  if (series && area?.length) {
    let k = 0
    for (let i = 1; i < area.length; i++) if (area[i] > area[k]) k = i
    if (area[k] > 0) {
      ev.push({ t: series.times_s[k], kind: 'extent', title: `Largest flooded area: ${num(area[k], 2)} km²` })
      const r = area.findIndex((a, i) => i > k && a < area[k] * 0.9)
      if (r > 0) ev.push({ t: series.times_s[r], kind: 'recede', title: 'Water starts to recede' })
    }
  }
  return ev.filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t)
}

/** Breach outflow (m³/s) at time t, linearly interpolated; null outside. */
export function outflowAt(hydro: BreachHydrograph | undefined, t: number): number | null {
  const ts = hydro?.time_s
  const qs = hydro?.q_cms
  if (!ts?.length || !qs?.length || t < ts[0] || t > ts[ts.length - 1]) return null
  let i = 1
  while (i < ts.length && ts[i] < t) i++
  if (i >= ts.length) return qs[qs.length - 1]
  const k = (t - ts[i - 1]) / Math.max(1e-9, ts[i] - ts[i - 1])
  return qs[i - 1] + (qs[i] - qs[i - 1]) * k
}
