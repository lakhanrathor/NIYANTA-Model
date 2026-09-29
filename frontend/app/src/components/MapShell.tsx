/**
 * MAP SHELL — the one shared map for every screen. READ THIS BEFORE EDITING.
 *
 * Architecture (locked): the shell is PAGE-UNAGNOSTIC. It renders whatever the
 * mission context holds and knows nothing about routes. Data flows ONE way:
 *
 *   screens ──publish──▶ river-context ──subscribe──▶ MapShell ──draw──▶ canvas
 *
 * ── WHAT THE SHELL READS FROM CONTEXT (never from props) ────────────────────
 * - `view.mode` / `setMode` ......... the single 2D/3D switch for the whole app
 * - `view.hiddenLayers` / `toggleLayer`  one hidden-layer set every map agrees on
 * - mission river/dam/run ........... dam marker, fit targets, provenance notes
 * - `useDomainRingFeature()` ........ the GLOBAL amber study-domain ring, computed
 *   from context alone (river, dam, draft reach, corridor width). It is appended
 *   to the render list and the legend here, so NO page passes it, lists it, or
 *   toggles it. If a `features` entry ever carries id `build-domain`, the global
 *   ring steps aside (skip-if-present) — duplicate ids break the layer menu.
 *
 * ── WHAT STAYS A PROP (per-instance viewport needs only) ────────────────────
 * `features, legend, fit, raster, overlay, notice, showSearch, hover,
 *  onMapClick, onFeatureHover, className, primary, shared`.
 * A prop is layout/viewport scoping for THIS slot — never mission data. If you
 * need something from the mission (dam, river, run, reach), read the context.
 *
 * ── RULES FOR EVERYONE (both agents) ────────────────────────────────────────
 * 1. Screens NEVER pass mission objects as props and NEVER call map methods
 *    directly. Publish into `river-context` (or its action hooks); the shell
 *    subscribes. Component-to-component map calls are forbidden.
 * 2. New GLOBAL layers (visible on all maps) follow the domain-ring pattern: a
 *    context-only hook returning `MapFeature | null`, mounted HERE — not in a
 *    screen. Page-specific layers stay in that screen's `features` prop.
 * 3. Reserved feature ids (skip-if-present in the shell): `build-domain`,
 *    `ruler-measure-line`, `ruler-pt-*`. Do not reuse them for page layers.
 * 4. The 3D counterpart is `CesiumGlobe` (same `features`, same ids). Its own
 *    header documents the entity contract — polygon draping, marker ranges,
 *    boot/ready protocol. Keep the two renderers in agreement.
 * 5. Shared engine access goes through `lib/mapEngine` (`acquireSharedMap`) —
 *    never `new Map()` in a screen.
 */
import { CesiumGlobe } from './CesiumGlobe'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GeoJSONSource, Map, Popup, ScaleControl } from 'maplibre-gl'
import type { ExpressionSpecification, MapMouseEvent, RasterTileSource, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ApiError, api, tiles } from '../lib/api'
import type { RiverSearchItem } from '../lib/api'
import { useApi } from '../lib/useApi'
import { acquireSharedMap } from '../lib/mapEngine'
import { useDomainRingFeature } from '../screens/build/config'
import { useApp } from '../lib/store'
import { useRiverContext } from '../lib/river-context'
import { FRAME_FIELDS, type CompareField } from './flood/rasterFields'
import type { LegendItem, MapFeature, MapHoverPoint } from '../lib/river-context'
import { DEPTH_STOPS, EM_DASH, rampColor } from '../lib/format'
import { Icon, IconButton, Seg } from './ui'

// The map vocabulary lives in the mission context (that is where a screen
// publishes it and where the shell subscribes); re-exported here so screens
// keep a single import site.
export type { LegendItem, MapFeature, MapHoverPoint } from '../lib/river-context'

const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const BASE_STYLE: StyleSpecification = {
  version: 8,
  name: 'niyanta-base',
  sources: {
    esri: {
      type: 'raster',
      tiles: [ESRI_TILES],
      tileSize: 256,
      attribution: 'Esri',
      maxzoom: 17,
    },
  },
  layers: [{ id: 'esri-base', type: 'raster', source: 'esri' }],
}

/** Per-feature `_color` property wins over the layer colour — lets one layer
 *  carry state (e.g. flooded vs dry roads) without a layer per state. */
function featureColor(f: MapFeature): ExpressionSpecification {
  return ['coalesce', ['get', '_color'], f.color]
}

function addFeatureLayers(map: Map, f: MapFeature) {
  const existing = map.getSource(f.id) as GeoJSONSource | undefined
  if (existing) {
    // Same layer, new geometry — the corridor refetches on every slider move
    // and the source must follow it, otherwise the map keeps the old polygon.
    existing.setData(f.data)
    return
  }
  map.addSource(f.id, { type: 'geojson', data: f.data })
  if (f.kind === 'line') {
    map.addLayer({
      id: f.id,
      type: 'line',
      source: f.id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': featureColor(f),
        'line-width': f.width ?? 2,
        ...(f.dasharray ? { 'line-dasharray': f.dasharray } : {}),
      },
    })
    return
  }
  if (f.kind === 'fill') {
    map.addLayer({
      id: `${f.id}-fill`,
      type: 'fill',
      source: f.id,
      paint: { 'fill-color': f.color, 'fill-opacity': f.fillOpacity ?? 0.25 },
    })
    map.addLayer({
      id: `${f.id}-line`,
      type: 'line',
      source: f.id,
      paint: { 'line-color': featureColor(f), 'line-width': 1.4, 'line-dasharray': f.dasharray ?? [2, 2] },
    })
    return
  }
  map.addLayer({
    id: f.id,
    type: 'circle',
    source: f.id,
    paint: {
      'circle-color': featureColor(f),
      'circle-radius': f.radius ?? 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.4,
    },
  })
  if (f.textLabel) {
    map.addLayer({
      id: `${f.id}-text`,
      type: 'symbol',
      source: f.id,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    })
  }
}

function haversineDistanceKm(coord1: [number, number], coord2: [number, number]): number {
  const [lon1, lat1] = coord1
  const [lon2, lat2] = coord2
  const R = 6371.0 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function bboxOf(r: RiverSearchItem): [[number, number], [number, number]] | null {
  const coords = r.path?.coordinates
  if (coords?.length) {
    let w = coords[0][0]
    let e = coords[0][0]
    let s = coords[0][1]
    let n = coords[0][1]
    for (const c of coords) {
      if (c[0] < w) w = c[0]
      if (c[0] > e) e = c[0]
      if (c[1] < s) s = c[1]
      if (c[1] > n) n = c[1]
    }
    return [
      [w, s],
      [e, n],
    ]
  }
  if (r.bbox && r.bbox.length === 4) {
    const [a, b, c, d] = r.bbox
    return [
      [a, b],
      [c, d],
    ]
  }
  return null
}

function MapSearch({ onPick, placeholder }: { onPick: (r: RiverSearchItem) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useApi(['map-search', q], () => api.searchRivers(q, 6), {
    enabled: q.trim().length >= 2,
  })

  return (
    <div className="relative w-[230px]">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--faint)]">
        <Icon name="search" size={13} />
      </span>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder={placeholder ?? 'Search rivers, dams, places...'}
        className="h-7 w-full rounded border border-[var(--line-strong)] bg-white/95 pl-7 pr-2 text-[12px] shadow-[var(--shadow)] outline-none focus:border-[var(--accent)]"
      />
      {open && q.trim().length >= 2 && (
        <div className="panel absolute z-40 mt-1 max-h-64 w-full overflow-auto py-1 shadow-[var(--shadow)]">
          {results.pending && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--faint)]">Searching…</div>
          )}
          {results.offline && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--warn)]">Source offline</div>
          )}
          {results.data?.length === 0 && !results.pending && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--faint)]">No matches</div>
          )}
          {results.data?.map((r, i) => (
            <button
              key={`${r.name}-${i}`}
              onMouseDown={() => {
                setOpen(false)
                setQ(r.name)
                onPick(r)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--accent-soft)]"
            >
              <span className="text-[var(--accent)]">
                <Icon name="river" size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{r.name}</span>
              <span className="num shrink-0 text-[10px] text-[var(--faint)]">
                {r.length_km ? `${r.length_km.toFixed(0)} km` : r.source}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface MapShellProps {
  /** Overlay layers this screen wants drawn — compare panes each carry their own. */
  features?: MapFeature[]
  fit?: number[] | null
  legend?: LegendItem[]
  raster?: { run: string; kind: string; vs?: string; frame?: number | null } | null
  extraTools?: ReactNode
  overlay?: ReactNode
  notice?: ReactNode
  showSearch?: boolean
  searchPlaceholder?: string
  onMapClick?: (lat: number, lon: number) => void
  /** Point hovered in a side list — gets a ring + tooltip on the map. */
  hover?: MapHoverPoint | null
  /** A point feature hovered on the map reports its `properties.id` back. */
  onFeatureHover?: (id: string | null) => void
  className?: string
  /** Only the primary map feeds the global status bar (zoom + cursor). */
  primary?: boolean
  /**
   * Single-map screens share one MapLibre instance across page switches, so
   * the base map, cached tiles and camera survive navigation instead of the
   * whole map reloading. Compare panes and the minimap pass false —
   * concurrent maps each need their own instance.
   */
  shared?: boolean
  /**
   * Context scope this pane paints from (`results`, `cmp-a`, …). When set,
   * run/field/frame/max-view/flood-visibility come from `mapIntents[scope]`
   * instead of the `raster` prop, so panes, panels and the filmstrip read one
   * shared truth. Panes without a scope keep the legacy `raster` behaviour.
   */
  scope?: string
}

/** Shared map shell: satellite base, floating search, 2D/3D toggle, right rail,
 *  legend, scale bar — plus honest notes when flood tiles are absent.
 *
 *  Mission data (the dam, the river, the run) is read from the mission context,
 *  never handed down as a prop; the 2D/3D switch and the hidden-layer set are
 *  published back to the same context so every map on screen agrees. */
export function MapShell({
  features = [],
  fit = null,
  legend,
  raster = null,
  extraTools,
  overlay,
  notice,
  showSearch = true,
  searchPlaceholder,
  onMapClick,
  hover = null,
  onFeatureHover,
  className = '',
  primary = true,
  shared = true,
  scope,
}: MapShellProps) {
  const holder = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  // Shared view state: one 2D/3D switch and one hidden-layer set for the app.
  const mode = useRiverContext((s) => s.view.mode)
  const hidden = useRiverContext((s) => s.view.hiddenLayers)
  const setMode = useRiverContext((s) => s.setMode)
  const toggleLayer = useRiverContext((s) => s.toggleLayer)
  // Scoped panes paint from the shared map intent, not the raster prop —
  // same context the panels and the filmstrip read and write.
  const scopedIntent = useRiverContext((s) => (scope ? s.mapIntents[scope] : undefined))
  const publishMapIntent = useRiverContext((s) => s.publishMapIntent)
  const scoped = scope ? scopedIntent : undefined
  const [layersOpen, setLayersOpen] = useState(false)
  const [rasterNote, setRasterNote] = useState<string | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const measuringRef = useRef(measuring)
  measuringRef.current = measuring

  const totalDistanceKm = useMemo(() => {
    if (measurePoints.length < 2) return 0
    let d = 0
    for (let i = 0; i < measurePoints.length - 1; i++) {
      d += haversineDistanceKm(measurePoints[i], measurePoints[i + 1])
    }
    return d
  }, [measurePoints])

  // The amber study domain is global: computed from the mission context alone
  // (river, dam, draft reach, corridor width) and drawn by every map instance —
  // pages never pass it and stay unaware of it.
  const domainRing = useDomainRingFeature()

  const allFeatures = useMemo<MapFeature[]>(() => {
    const extra =
      domainRing && !features.some((f) => f.id === 'build-domain') ? [domainRing] : []
    if (!measuring || measurePoints.length === 0) return [...features, ...extra]
    const rulerLayers: MapFeature[] = []
    if (measurePoints.length >= 2) {
      rulerLayers.push({
        id: 'ruler-measure-line',
        label: 'Measured Distance Line',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Distance Path' },
              geometry: { type: 'LineString', coordinates: measurePoints },
            },
          ],
        },
        kind: 'line',
        color: '#f59e0b',
        width: 3.5,
        dasharray: [3, 2],
      })
    }
    measurePoints.forEach((pt, i) => {
      rulerLayers.push({
        id: `ruler-pt-${i}`,
        label: `Measure Node ${i + 1}`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: `Node ${i + 1}` },
              geometry: { type: 'Point', coordinates: pt },
            },
          ],
        },
        kind: 'circle',
        color: '#f59e0b',
        radius: 6,
      })
    })
    return [...features, ...rulerLayers, ...extra]
  }, [features, measuring, measurePoints, domainRing])

  // The global ring carries its own legend entry — derived from the feature so
  // pages neither list it twice nor forget it.
  const legendRows = useMemo<LegendItem[]>(() => {
    const base = legend ?? []
    if (!domainRing || base.some((l) => l.id === 'build-domain')) return base
    return [
      ...base,
      { id: 'build-domain', label: domainRing.label, color: '#e8930c', dashed: true },
    ]
  }, [legend, domainRing])

  const cursor = useApp((s) => s.cursor)
  const zoom = useApp((s) => s.zoom)
  const setCursor = useApp((s) => s.setCursor)
  const setZoom = useApp((s) => s.setZoom)
  const [tileFails, setTileFails] = useState<{ n: number; src: string | null }>({ n: 0, src: null })
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick
  const featureHoverRef = useRef(onFeatureHover)
  useEffect(() => {
    featureHoverRef.current = onFeatureHover
  })
  const popup = useRef<Popup | null>(null)
  const popupFrom = useRef<'map' | 'list' | null>(null)
  const lastFeatureId = useRef<string | null>(null)

  const showPopup = (lngLat: [number, number], title: string, lines: string[]) => {
    const map = mapRef.current
    if (!map) return
    const el = document.createElement('div')
    const h = document.createElement('div')
    h.className = 'text-[12px] font-semibold'
    h.textContent = title
    el.appendChild(h)
    for (const line of lines) {
      const p = document.createElement('div')
      p.className = 'num text-[11px] text-[var(--muted)]'
      p.textContent = line
      el.appendChild(p)
    }
    if (!popup.current) popup.current = new Popup({ closeButton: false, offset: 10 })
    popup.current.setDOMContent(el).setLngLat(lngLat).addTo(map)
  }

  const clearPopup = (from: 'map' | 'list') => {
    if (popupFrom.current !== from) return
    popup.current?.remove()
    popupFrom.current = null
  }
  const primaryRef = useRef(primary)
  useEffect(() => {
    primaryRef.current = primary
  }, [primary])

  /* ---- base map -------------------------------------------------------
     A shared instance survives page switches (adopt, never destroy); a
     private one behaves exactly as before. Handlers are named so unmount
     detaches them — a shared map must never accumulate a previous screen's
     listeners. */
  useEffect(() => {
    if (!holder.current) return
    let map: Map
    let fresh: boolean
    if (shared) {
      const acquired = acquireSharedMap(holder.current, BASE_STYLE)
      map = acquired.map
      fresh = acquired.fresh
    } else {
      map = new Map({
        container: holder.current,
        style: BASE_STYLE,
        center: [80.5, 22.5],
        zoom: 4.2,
        attributionControl: false,
        maxPitch: 70,
      })
      fresh = true
    }
    mapRef.current = map
    if (fresh) {
      const scale = new ScaleControl({ maxWidth: 96, unit: 'metric' })
      map.addControl(scale, 'bottom-left')
    }
    const onMove = (e: MapMouseEvent) => {
      if (primaryRef.current) setCursor({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      // Hover a point feature (dam) → name + details popup, and hand its id to
      // the page so the side list can highlight the same row.
      const hit = map
        .queryRenderedFeatures(e.point)
        .find(
          (f) =>
            f.layer.type === 'circle' &&
            !f.layer.id.startsWith('minimap-') &&
            typeof f.properties?.id === 'string',
        )
      const id = typeof hit?.properties?.id === 'string' ? hit.properties.id : null
      if (id !== lastFeatureId.current) {
        lastFeatureId.current = id
        featureHoverRef.current?.(id)
        map.getCanvas().style.cursor = id ? 'pointer' : ''
        if (id && hit) {
          const p = hit.properties
          const lines: (string | null)[] = [
            p.status === 'in_db'
              ? `In DB${typeof p.state === 'string' && p.state ? ` · ${p.state}` : ''}`
              : p.status === 'missing'
                ? 'Missing from DB'
                : null,
            typeof p.distance_km === 'number' ? `${p.distance_km} km along river` : null,
            p.in_corridor === false ? 'outside corridor' : null,
          ]
          popupFrom.current = 'map'
          showPopup(
            [e.lngLat.lng, e.lngLat.lat],
            String(p.name ?? 'Dam'),
            lines.filter((x): x is string => x !== null),
          )
        } else {
          clearPopup('map')
        }
      }
    }
    const onOut = () => {
      if (primaryRef.current) setCursor(null)
      if (lastFeatureId.current !== null) {
        lastFeatureId.current = null
        featureHoverRef.current?.(null)
        map.getCanvas().style.cursor = ''
        clearPopup('map')
      }
    }
    const report = () => {
      if (primaryRef.current) setZoom(map.getZoom())
    }
    const onClick = (e: MapMouseEvent) => {
      if (measuringRef.current) {
        setMeasurePoints((pts) => [...pts, [e.lngLat.lng, e.lngLat.lat]])
        return
      }
      clickRef.current?.(e.lngLat.lat, e.lngLat.lng)
    }
    const onErr = (e: unknown) =>
      setTileFails((s) => ({
        n: s.n + 1,
        src: s.src ?? ((e as { sourceId?: string }).sourceId ?? null),
      }))
    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    map.on('click', onClick)
    map.on('error', onErr)
    report()
    return () => {
      map.off('mousemove', onMove)
      map.off('mouseout', onOut)
      map.off('click', onClick)
      map.off('error', onErr)
      if (primaryRef.current) {
        setCursor(null)
        setZoom(null)
      }
      if (!shared) map.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [shared, setCursor, setZoom])

  // Cursor style update when measuring
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = measuring ? 'crosshair' : ''
  }, [measuring])

  /* ---- overlay features ---------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const keep = new Set(allFeatures.map((f: MapFeature) => f.id))
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.id.startsWith('esri-base') || layer.id.startsWith('minimap-')) continue
        if (layer.id === 'flood-raster' || layer.id === 'hover-point') continue
        const sourceId = map.getLayer(layer.id)?.source
        if (sourceId && !keep.has(sourceId)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id)
          if (map.getSource(sourceId)) map.removeSource(sourceId)
        }
      }
      for (const f of allFeatures) addFeatureLayers(map, f)
      for (const f of allFeatures) {
        const vis = hidden.includes(f.id) ? 'none' : 'visible'
        const ids = [f.id, `${f.id}-fill`, `${f.id}-line`, `${f.id}-text`]
        for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [allFeatures, hidden])

  /* ---- hover driven from a side list (e.g. the dam table) -------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!hover) {
      clearPopup('list')
      if (map.getLayer('hover-point')) map.setLayoutProperty('hover-point', 'visibility', 'none')
      return
    }
    const apply = () => {
      if (!map.getSource('hover-point')) {
        map.addSource('hover-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: 'hover-point',
          type: 'circle',
          source: 'hover-point',
          paint: {
            'circle-color': '#0b6bcb',
            'circle-opacity': 0.25,
            'circle-radius': 13,
            'circle-stroke-color': '#0b6bcb',
            'circle-stroke-width': 2.5,
          },
        })
      }
      const src = map.getSource('hover-point') as GeoJSONSource
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [hover.lon, hover.lat] },
          },
        ],
      })
      if (map.getLayer('hover-point')) map.setLayoutProperty('hover-point', 'visibility', 'visible')
      popupFrom.current = 'list'
      showPopup(
        [hover.lon, hover.lat],
        hover.title,
        hover.subtitle ? [hover.subtitle] : [],
      )
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [hover])

  /* ---- fit bounds ----------------------------------------------------- */
  const fitRef = useRef(fit)
  useEffect(() => {
    fitRef.current = fit
  }, [fit])
  const applyFit = (map: Map) => {
    const f = fitRef.current
    if (!f || f.length !== 4 || f.some((v) => Number.isNaN(v))) return
    map.fitBounds(
      [
        [f[0], f[1]],
        [f[2], f[3]],
      ],
      { padding: 48, duration: 600, maxZoom: 11 },
    )
  }

  // Value-key, not array identity: screens rebuild the same bounds array on
  // every render (list hover, cursor moves), and a re-fit on each one reads
  // as the whole map "refreshing" — river path, dams and all.
  const fitKey =
    fit && fit.length === 4 && fit.every((v) => typeof v === 'number' && !Number.isNaN(v))
      ? fit.join(',')
      : null

  useEffect(() => {
    if (!fitKey) return
    // poll instead of trusting a single style 'load' event: remounts can make
    // the event fire before this effect attaches, leaving the view unfitted
    let done = false
    const handle = setInterval(() => {
      const map = mapRef.current
      if (!map || !map.isStyleLoaded() || done) return
      done = true
      applyFit(map)
      clearInterval(handle)
    }, 150)
    return () => clearInterval(handle)
    // `applyFit` reads the live ref on purpose; only the bounds values refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  /* ---- flood raster tiles (preflight, honest on 404) ------------------- */
  // Scoped panes derive the descriptor from the shared intent: max-union grid
  // while showMax is on, per-frame tiles only where they exist (FRAME_FIELDS).
  const rasterRun = scoped ? scoped.runId : raster?.run
  const rasterKind = scoped ? scoped.field : raster?.kind
  const rasterVs = scoped ? (scoped.vs ?? undefined) : raster?.vs
  const rasterFrame =
    scoped && (scoped.showMax || !FRAME_FIELDS.has(scoped.field as CompareField))
      ? null
      : (scoped ? scoped.frame : (raster?.frame ?? null))
  // One shared flood switch: scoped panes read it from the intent, legacy
  // panes from the global hidden-layer set. Either way the map, the legend
  // row and the panels' checkboxes read the same context value.
  const floodOn = scoped ? scoped.floodVisible : !hidden.includes('flood-raster')
  const setFlood = (v: boolean) => {
    if (scope) {
      publishMapIntent(scope, { floodVisible: v })
      return
    }
    if (v !== floodOn) toggleLayer('flood-raster')
  }

  // UI-only: the layers panel merges the legend rows (swatch + label) with
  // the feature toggles, so one scrollable list explains AND switches every
  // layer. No separate legend card.
  const featureIds = new Set(features.map((f) => f.id))
  const panelRows: {
    key: string
    label: string
    flood: boolean
    color: string
    dashed: boolean
    pending: boolean
    off: boolean
    toggle: (() => void) | null
  }[] = []
  for (const [i, l] of legendRows.entries()) {
    const isFlood = l.id === 'flood-raster'
    // The flood row exists only while a raster is active (as before).
    if (isFlood && !(rasterRun && rasterKind)) continue
    const off = isFlood && scoped ? !scoped.floodVisible : l.id != null && hidden.includes(l.id)
    const hasLayer = isFlood || (l.id != null && featureIds.has(l.id))
    panelRows.push({
      key: l.id ?? `${l.label}-${i}`,
      label: l.label,
      flood: isFlood,
      color: l.color,
      dashed: l.dashed ?? false,
      pending: l.pending ?? false,
      off,
      toggle:
        !hasLayer || l.pending
          ? null
          : isFlood
            ? () => setFlood(off)
            : () => toggleLayer(l.id as string),
    })
  }
  for (const f of features) {
    if (legendRows.some((l) => l.id === f.id)) continue
    panelRows.push({
      key: f.id,
      label: f.label,
      flood: false,
      color: '#94a3b5',
      dashed: false,
      pending: false,
      off: hidden.includes(f.id),
      toggle: () => toggleLayer(f.id),
    })
  }
  const panelToggleables = panelRows.filter((r) => r.toggle)
  const panelOnCount = panelToggleables.filter((r) => !r.off).length
  // The source is built once per run/kind/vs; the frame rides in via a ref so
  // a timeline scrub never tears the layer down (effect below swaps tiles only).
  const frameRef = useRef<number | null>(rasterFrame)
  frameRef.current = rasterFrame
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const id = 'flood-raster'
    const clear = () => {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
    if (!rasterRun || !rasterKind) {
      clear()
      setRasterNote(null)
      return
    }
    if (!floodOn) {
      clear()
      setRasterNote(null)
      return
    }
    let cancelled = false
    let onLoad: (() => void) | null = null
    let timer: number | null = null
    clear()
    setRasterNote(null)
    // Transient failures (backend restart, proxy hiccup) must self-heal, not
    // latch the layer off: retry network errors with backoff, note honestly
    // only when the tiles are deterministically absent (HTTP status) or the
    // retries run out. A failed add goes through the same path — never a
    // silent console-only death while the strip keeps showing water.
    const fail = (n: number, err: unknown) => {
      if (cancelled) return
      const status = err instanceof ApiError ? err.status : 'network'
      if (status === 'network' && n < 3) {
        setRasterNote('Flood tiles failed to load — retrying…')
        timer = window.setTimeout(() => attempt(n + 1), 2000)
        return
      }
      clear()
      setRasterNote(
        `Flood tiles unavailable — GET /api/tiles/{run}/meta.json returned ${status}`,
      )
    }
    const attempt = (n: number) => {
      if (cancelled || !mapRef.current) return
      tiles
        .meta(rasterRun, rasterVs)
        .then((meta) => {
          if (cancelled || !mapRef.current) return
          const m = mapRef.current
          const add = () => {
            if (cancelled || !mapRef.current) return
            try {
              if (m.getLayer(id)) m.removeLayer(id)
              if (m.getSource(id)) m.removeSource(id)
              m.addSource(id, {
                type: 'raster',
                tiles: [tiles.url(rasterRun, rasterKind, rasterVs, frameRef.current)],
                tileSize: 256,
                minzoom: meta.minzoom ?? 0,
                maxzoom: meta.maxzoom ?? 18,
                bounds: meta.bounds,
              })
              m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.72 } })
              setRasterNote(null)
            } catch (err) {
              console.warn('[raster] overlay not added', err)
              fail(n, err)
            }
          }
          if (m.isStyleLoaded()) add()
          else {
            onLoad = add
            m.once('load', onLoad)
          }
        })
        .catch((err: unknown) => fail(n, err))
    }
    attempt(0)
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      if (onLoad) mapRef.current?.off('load', onLoad)
    }
  }, [rasterRun, rasterKind, rasterVs, floodOn])

  /* ---- timeline scrub: swap the source's tile URL in place -------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !rasterRun || !rasterKind) return
    const src = map.getSource('flood-raster') as RasterTileSource | undefined
    if (!src || typeof src.setTiles !== 'function') return
    try {
      src.setTiles([tiles.url(rasterRun, rasterKind, rasterVs, rasterFrame)])
    } catch (err) {
      console.warn('[raster] frame tiles not swapped', err)
    }
  }, [rasterFrame, rasterRun, rasterKind, rasterVs])

  const toggle3d = (v: string) => {
    const next = v === '3d' ? '3d' : '2d'
    if (next === mode) return
    setMode(next)
  }

  // The camera follow belongs to the shared switch, so a 3D choice made on one
  // screen carries over instead of resetting when the component remounts.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: mode === '3d' ? 58 : 0, bearing: mode === '3d' ? -12 : 0, duration: 600 })
  }, [mode])

  const pick = (r: RiverSearchItem) => {
    const b = bboxOf(r)
    if (!b || !mapRef.current) return
    mapRef.current.fitBounds(b, { padding: 56, duration: 700, maxZoom: 10 })
  }

  return (
    <div className={`map-shell relative h-full w-full overflow-hidden bg-[var(--bg)] ${className}`}>
      {/* Fast & crisp MapLibre 2D canvas */}
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />

      {/* Cesium 3D Globe loaded on-demand when 3D is toggled */}
      {mode === '3d' && (
        <div className="absolute inset-0 z-10">
          <CesiumGlobe features={allFeatures} fit={fit} />
        </div>
      )}

      {/* Interactive Ruler / Distance Measurement Banner */}
      {measuring && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-1.5 shadow-md backdrop-blur-sm text-[11px] text-amber-950 font-medium">
          <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
            <Icon name="ruler" size={14} />
            <span>Ruler Mode</span>
          </span>
          <span className="text-amber-300">|</span>
          {measurePoints.length === 0 ? (
            <span className="text-amber-800">Click anywhere on map to begin measuring distance</span>
          ) : (
            <div className="flex items-center gap-2 font-mono">
              <span>
                Total Distance:{' '}
                <strong className="text-amber-900 font-bold">
                  {totalDistanceKm >= 1 ? `${totalDistanceKm.toFixed(2)} km` : `${(totalDistanceKm * 1000).toFixed(0)} m`}
                </strong>{' '}
                ({measurePoints.length} points)
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 ml-1">
            {measurePoints.length > 0 && (
              <button
                onClick={() => setMeasurePoints([])}
                className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-300 transition-colors"
                title="Reset points"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => {
                setMeasuring(false)
                setMeasurePoints([])
              }}
              className="rounded bg-amber-900 px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-800 transition-colors"
              title="Exit ruler mode"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* top-left: 2D/3D + tools */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        <Seg
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
          value={mode}
          onChange={toggle3d}
        />
        {extraTools}
      </div>

      {/* floating search */}
      {showSearch && (
        <div className="absolute left-3 top-12 z-20">
          <MapSearch onPick={pick} placeholder={searchPlaceholder} />
        </div>
      )}

      {/* right rail — buttons stay right-aligned; the layers card floats
          below them instead of stretching this container leftward. */}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1.5">
        <IconButton name="plus" title="Zoom in" onClick={() => mapRef.current?.zoomIn()} />
        <IconButton name="minus" title="Zoom out" onClick={() => mapRef.current?.zoomOut()} />
        <IconButton
          name="locate"
          title="Locate"
          onClick={() =>
            mapRef.current?.easeTo({ center: [80.5, 22.5], zoom: 5, duration: 700 })
          }
        />
        <IconButton
          name="ruler"
          title="Measure Distance (Ruler Tool)"
          active={measuring}
          onClick={() => {
            setMeasuring((m) => !m)
            if (measuring) setMeasurePoints([])
          }}
        />
        <IconButton
          name="layers"
          title="Layers"
          active={layersOpen}
          onClick={() => setLayersOpen((v) => !v)}
        />
        {layersOpen && (
          <div className="panel absolute right-0 top-full z-20 mt-1.5 max-h-[46vh] w-[232px] overflow-y-auto py-1 shadow-[var(--shadow)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                Layers
              </span>
              <span className="num text-[10px] text-[var(--faint)]">
                {panelOnCount}/{panelToggleables.length} on
              </span>
            </div>
            {panelRows.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-[var(--faint)]">No overlay layers</div>
            )}
            <ul className="max-h-[46vh] overflow-y-auto py-1">
              {panelRows.map((r) => (
                <li
                  key={r.key}
                  className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${
                    r.off ? 'opacity-50' : ''
                  }`}
                >
                  {r.flood ? (
                    <span
                      className="h-3 w-4 shrink-0 rounded-[2px] border border-[var(--line)]"
                      style={{ background: 'linear-gradient(135deg,#7dd3fc,#0c4a6e)' }}
                    />
                  ) : (
                    <span
                      className="h-[3px] w-4 shrink-0"
                      style={{
                        background: r.dashed
                          ? `repeating-linear-gradient(90deg, ${r.color} 0 5px, transparent 5px 9px)`
                          : r.color,
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[var(--foreground)]" title={r.label}>
                    {r.label}
                    {r.pending && <span className="num text-[var(--faint)]"> …</span>}
                    {r.off && r.toggle && <span className="text-[var(--faint)]"> · hidden</span>}
                  </span>
                  {r.toggle ? (
                    <LayerSwitch on={!r.off} label={r.label} onToggle={r.toggle} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* notice about missing overlays */}
      {(notice || rasterNote || tileFails.n > 0) && (
        <div className="absolute right-11 top-3 z-20 max-w-[320px] rounded border border-[#f0d2a8] bg-[#fdf6ec] px-2 py-1 text-[10px] leading-snug text-[var(--warn)] shadow-[var(--shadow)]">
          {rasterNote ?? notice}
          {tileFails.n > 0 && !rasterNote && (
            <span className="block text-[var(--faint)]">
              {tileFails.n} base-map tile request(s) failed —{' '}
              {tileFails.src === 'esri'
                ? 'Esri World Imagery'
                : (tileFails.src ?? 'basemap source')}
            </span>
          )}
        </div>
      )}

      {/* The layers panel above merged the legend rows (swatch + label) with
          the switches — no separate legend card anymore. The depth ramp
          (Results / Compare) stays: it explains raster values, not layers. */}

      {/* depth ramp (Results / Compare) */}
      {overlay}

      {/* scale bar bottom-centre is maplibre's ScaleControl, re-centred by CSS */}
      <div className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2" />

      {/* Live Map Telemetry Bar — coordinates and zoom only; depth/DEM come from the raster probe */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-2 rounded border border-[var(--line)] bg-white/95 px-2.5 py-1 text-[10px] font-mono text-[var(--foreground)] shadow-[var(--shadow)] backdrop-blur-sm">
        {cursor ? (
          <>
            <span className="text-[var(--muted)]">Coord:</span>
            <span className="font-semibold">{cursor.lat.toFixed(4)}°N, {cursor.lon.toFixed(4)}°E</span>
            <span className="text-[var(--line)]">|</span>
            <span className="text-[var(--muted)]">Zoom:</span>
            <span className="font-semibold">{zoom != null ? zoom.toFixed(1) : EM_DASH}</span>
            <span className="text-[var(--line)]">|</span>
            <span className="text-[var(--muted)]">click to inspect depth</span>
          </>
        ) : (
          <span className="text-[var(--muted)]">Hover the map for coordinates · click to inspect a cell</span>
        )}
      </div>

      {/* Flood-state chip: the raster layer going missing must never be
          silent. Either the scope hasn't published yet (transient on mount)
          or the analyst switched the flood off without noticing — both read
          the same shared switch the panels use, so one tap restores it. */}
      {scope && !scopedIntent ? (
        <div className="absolute bottom-2 right-2 z-20 rounded border border-[var(--line)] bg-white/95 px-2 py-1 text-[10px] text-[var(--muted)] shadow-[var(--shadow)] backdrop-blur-sm">
          Preparing map…
        </div>
      ) : Boolean(rasterRun && rasterKind) && !floodOn ? (
        <button
          onClick={() => setFlood(true)}
          title="Show the flood raster layer"
          className="absolute bottom-2 right-2 z-20 rounded border border-[var(--warn)] bg-[#fdf6ec] px-2 py-1 text-[10px] font-semibold text-[var(--warn)] shadow-[var(--shadow)] hover:underline"
        >
          Flood hidden — tap to show
        </button>
      ) : null}
    </div>
  )
}

/** One layer switch in the merged layers panel. */
function LayerSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={on ? `Hide ${label}` : `Show ${label}`}
      onClick={onToggle}
      className={`relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${
        on ? 'bg-[var(--accent)]' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${
          on ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

/** Stepped depth ramp used by Results / Compare / Player overlays. */
export function DepthRamp({ stops = DEPTH_STOPS }: { stops?: readonly string[] }) {
  return (
    <div className="flex h-2.5 w-[200px] overflow-hidden rounded-[2px] border border-[var(--line)]">
      {stops.map((s, i) => (
        <span key={s} style={{ background: rampColor(i / (stops.length - 1)) }} className="flex-1" />
      ))}
    </div>
  )
}
