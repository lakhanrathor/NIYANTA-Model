import type { BreachHydrograph, RunSeries } from '../../lib/api'

/**
 * Pure client-side CSV builders for the analytics tab exports. No fetching,
 * no context — the panel hands over data it already has.
 */

/** Download a CSV blob — used by the hydrograph/series export buttons. */
export function downloadCsv(rows: string[], filename: string) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Real breach hydrograph → time_s,time_hr,q_cms,released_hm3. */
export function exportHydroCsv(h: BreachHydrograph | null | undefined, runId: string | null) {
  if (!h?.time_s?.length || !h.q_cms?.length) return
  const times = h.time_s
  const qs = h.q_cms
  const dt = times.length > 1 ? times[1] - times[0] : 1
  const out = ['time_s,time_hr,q_cms,released_hm3']
  let vol = 0
  let prev = 0
  times.forEach((t, i) => {
    const q = qs[i]
    vol += ((q + prev) / 2) * dt / 1e6
    prev = q
    out.push(`${t},${(t / 3600).toFixed(4)},${q},${vol.toFixed(4)}`)
  })
  downloadCsv(out, `breach_hydrograph_${runId || 'run'}.csv`)
}

/** Area-by-class + reach series → one row per output frame. */
export function exportSeriesCsv(s: RunSeries | null | undefined, runId: string | null) {
  if (!s?.times_s?.length) return
  const out = ['time_s,time_hr,area_total_km2,area_low_km2,area_moderate_km2,area_high_km2,reach_km']
  s.times_s.forEach((t, i) => {
    out.push(
      [
        t,
        (t / 3600).toFixed(4),
        s.area_km2?.total?.[i] ?? '',
        s.area_km2?.low?.[i] ?? '',
        s.area_km2?.moderate?.[i] ?? '',
        s.area_km2?.high?.[i] ?? '',
        s.reach_km?.[i] ?? '',
      ].join(','),
    )
  })
  downloadCsv(out, `flood_series_${runId || 'run'}.csv`)
}
