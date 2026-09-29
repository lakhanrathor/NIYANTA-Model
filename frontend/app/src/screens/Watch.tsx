import { useMemo } from 'react'
import type { FeatureCollection } from 'geojson'
import { api } from '../lib/api'
import type { GeoJsonPolygon, WatchBox } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useWatchContext } from '../lib/watch-context'
import { EM_DASH, num } from '../lib/format'
import { Panel, Prov, StatCell } from '../components/ui'
import { MapShell } from '../components/MapShell'
import type { LegendItem, MapFeature } from '../components/MapShell'
import { WorkspaceLayout } from '../layouts'
import { AlertFeed } from './watch/AlertFeed'
import { BoxDetail } from './watch/BoxDetail'
import { BoxList } from './watch/BoxList'
import { SweepControl } from './watch/SweepControl'

function boxFeatures(boxes: WatchBox[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: boxes
      .filter((b): b is WatchBox & { bbox_geojson: GeoJsonPolygon } => Boolean(b.bbox_geojson))
      .map((b) => ({
        type: 'Feature',
        properties: { id: b.id, name: b.name },
        geometry: b.bbox_geojson,
      })),
  }
}

function ringBox(box: WatchBox | null | undefined): number[] | null {
  const ring = box?.bbox_geojson?.coordinates?.[0]
  if (!ring) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [x, y] of ring) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/**
 * WATCH — Track B shell. Fetches the shared lists once (one cache entry each —
 * every panel below reads the same keys), draws boxes + alert points, and
 * lays out the track components. All state lives in the watch context; this
 * file holds no selection, no toggles, no draft.
 */
export function Watch() {
  const selectedBoxId = useWatchContext((s) => s.selectedBoxId)

  const overview = useApi(['watch', 'overview'], api.overview)
  const boxes = useApi(['boxes'], api.watchBoxes)
  const alerts = useApi(['alerts'], () => api.alerts(50))
  const gee = useApi(['gee'], () => api.geeDetections(7))
  const dams = useApi(['dams'], () => api.dams(200))
  const rivers = useApi(['rivers'], () => api.rivers(100))

  const ov = overview.data
  const boxCount = ov?.watch_boxes ?? (boxes.data ? boxes.data.length : null)
  const alertCount =
    ov?.alerts ?? (alerts.data ? alerts.data.filter((a) => (a.state ?? 'NEW') === 'NEW').length : null)
  const damCount = ov?.dams ?? (dams.data ? dams.data.length || null : null)
  const riverCount = ov?.rivers ?? (rivers.data ? rivers.data.length || null : null)

  const showBoxes = true
  const showAlerts = true

  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []
    if (showBoxes && boxes.data?.length) {
      out.push({
        id: 'watch-boxes',
        label: 'Watch Boxes',
        data: boxFeatures(boxes.data),
        kind: 'fill',
        color: '#d81b9b',
        fillOpacity: 0.12,
        dasharray: [3, 2],
      })
    }
    const points = (alerts.data ?? []).filter(
      (a) => typeof a.lon === 'number' && typeof a.lat === 'number',
    )
    if (showAlerts && points.length) {
      out.push({
        id: 'watch-alerts',
        label: `Alerts (${points.length})`,
        data: {
          type: 'FeatureCollection',
          features: points.map((a) => ({
            type: 'Feature',
            properties: { id: a.id, name: a.title },
            geometry: { type: 'Point', coordinates: [a.lon as number, a.lat as number] },
          })),
        },
        kind: 'circle',
        color: '#b42318',
        radius: 7,
      })
    }
    return out
  }, [boxes.data, alerts.data, showBoxes, showAlerts])

  const selectedBox = boxes.data?.find((b) => b.id === selectedBoxId) ?? null
  const fit = useMemo(() => {
    const one = ringBox(selectedBox)
    if (one) return one
    if (!boxes.data) return null
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity
    for (const b of boxes.data) {
      const ring = b.bbox_geojson?.coordinates?.[0]
      if (!ring) continue
      for (const [x, y] of ring) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
    }
    return Number.isFinite(w) ? [w, s, e, n] : null
  }, [boxes.data, selectedBox])

  const legend: LegendItem[] = [
    { id: 'watch-boxes', label: 'Watch Boxes', color: '#d81b9b', dashed: true },
    { id: 'watch-alerts', label: 'Alerts', color: '#b42318' },
  ]

  const notices: string[] = []
  if (dams.offline) notices.push('Dams — GET /api/dams 404')
  if (alerts.data && alerts.data.length > 0 && alerts.data.every((a) => a.lat == null || a.lon == null))
    notices.push('Alert points have no coordinates')

  return (
    <WorkspaceLayout
      layoutId="watch"
      leftTitle="Monitor"
      rightTitle="Alerts"
      centerClassName="relative min-h-0 overflow-hidden rounded border border-[var(--line)] bg-white"
      left={
        <>
          <Panel title="Pan India Overview">
          <p className="border-b border-[var(--line)] px-3 py-1 text-[10px] text-[var(--faint)]">
            Dams • Rivers • Watch Boxes • Recent Changes
          </p>
          <div className="grid grid-cols-2">
            <StatCell label="Dams (India)" value={damCount === null ? EM_DASH : num(damCount)} offline={dams.offline && !ov} />
            <StatCell label="Watch Boxes" value={boxCount === null ? EM_DASH : num(boxCount)} />
            <StatCell
              label="Active Alerts"
              value={alertCount === null ? EM_DASH : num(alertCount)}
              tone={alertCount ? 'bad' : undefined}
            />
            <StatCell label="Rivers Indexed" value={riverCount === null ? EM_DASH : num(riverCount)} />
          </div>
          <Prov offline={overview.offline}>
            {overview.offline
              ? 'GET /api/watch/overview — Source offline · counts derived from /api/watch/boxes, /api/alerts, /api/rivers'
              : 'GET /api/watch/overview'}
          </Prov>
        </Panel>

        <SweepControl />

        <BoxList />

        <Panel title="GEE Detections (7d)">
          <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
            {(
              [
                ['Water Extent', gee.data?.water_extent],
                ['Glacier', gee.data?.glacier],
                ['High Rainfall', gee.data?.rainfall],
                ['Blockages', gee.data?.blockage],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="bg-white px-3 py-1.5">
                <p className="text-[10px] text-[var(--muted)]">{label}</p>
                <p className="num text-[14px] font-semibold">
                  {value === undefined ? EM_DASH : num(value)}
                </p>
              </div>
            ))}
          </div>
          <Prov offline={gee.offline}>
            {gee.offline ? 'GET /api/watch/gee-detections — Source offline' : 'GET /api/watch/gee-detections?days=7'}
          </Prov>
        </Panel>
        </>
      }
      center={
        <MapShell
          features={features}
          fit={fit}
          legend={legend}
          notice={notices.length ? notices.join(' · ') : undefined}
          onMapClick={() => undefined}
        />
      }
      right={
        <>
          <AlertFeed />
        <BoxDetail />
        </>
      }
    />
  )
}
