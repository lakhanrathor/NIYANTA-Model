import type { RunStation } from '../../lib/api'
import type { LegendItem, MapFeature } from '../MapShell'

/** Gauge marker styling: white dot, dark ring — reads over depth tiles. */
export const GAUGE_COLOR = '#ffffff'
export const BREACH_COLOR = '#facc15'

const has = (s: RunStation): s is RunStation & { lon: number; lat: number } =>
  typeof s.lon === 'number' && typeof s.lat === 'number'

/**
 * Map layers for the gauges: in-domain stations as one circle feature (with
 * CH labels) and the breach as a second, heavier circle. Stations outside the
 * modelled centreline are dropped — their coordinates are a clamped cell and
 * would stack on top of each other.
 */
export function gaugeFeatures(
  stations: RunStation[] | undefined,
  breach?: { lon?: number | null; lat?: number | null } | null,
): MapFeature[] {
  const out: MapFeature[] = []
  const seen = new Set<string>()
  const pts = (stations ?? []).filter((s): s is RunStation & { lon: number; lat: number } => {
    if (!has(s) || s.in_domain === false) return false
    const key = `${s.lon.toFixed(5)},${s.lat.toFixed(5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (pts.length) {
    out.push({
      id: 'flood-gauges',
      label: `Gauges (${pts.map((s) => s.name ?? `CH${s.km}`).join(' · ')})`,
      kind: 'circle',
      color: GAUGE_COLOR,
      radius: 5,
      textLabel: true,
      data: {
        type: 'FeatureCollection',
        features: pts.map((s) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
          properties: { label: s.name ?? `CH${s.km}` },
        })),
      },
    })
  }
  if (typeof breach?.lon === 'number' && typeof breach.lat === 'number') {
    out.push({
      id: 'flood-breach',
      label: 'Breach',
      kind: 'circle',
      color: BREACH_COLOR,
      radius: 7,
      textLabel: true,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [breach.lon, breach.lat] },
            properties: { label: 'Breach ★' },
          },
        ],
      },
    })
  }
  return out
}

/** Legend rows matching the gauge/breach markers. */
export function gaugeLegend(
  stations: RunStation[] | undefined,
  breach?: { lon?: number | null; lat?: number | null } | null,
): LegendItem[] {
  const rows: LegendItem[] = []
  const n = (stations ?? []).filter((s) => s.in_domain !== false && has(s)).length
  if (n) rows.push({ id: 'lg-gauges', label: `Gauges CH0 · ${n > 1 ? 'downstream' : 'only breach'}`, color: GAUGE_COLOR })
  if (typeof breach?.lon === 'number' && typeof breach.lat === 'number') {
    rows.push({ id: 'lg-breach', label: 'Breach', color: BREACH_COLOR })
  }
  return rows
}
