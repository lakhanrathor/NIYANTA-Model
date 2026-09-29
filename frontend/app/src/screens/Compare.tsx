import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { api, tiles } from '../lib/api'
import type { RampStop } from '../lib/api'
import { useApi } from '../lib/useApi'
import { EM_DASH, num } from '../lib/format'
import { Empty, Panel, Seg } from '../components/ui'
import { MapShell } from '../components/MapShell'
import type { LegendItem, MapFeature } from '../components/MapShell'
import { EChart } from '../components/Charts'
import { useRiverContext } from '../lib/river-context'
import { damRowToRiverPatch } from '../lib/mission'
import { damFit, displayReachKm, sliceDownstreamRiverPath, useBuildConfig } from './build/config'
import { useApp } from '../lib/store'
import { RampLegend } from '../components/RampLegend'
import { ExportPanel } from '../components/ExportPanel'
import { CompareScenarioPanel } from './compare/CompareScenarioPanel'
import { CompareRunsPanel } from './compare/CompareRunsPanel'
import { CompareModePanel } from './compare/CompareModePanel'
import { CompareLayersPanel } from './compare/CompareLayersPanel'
import { fieldMeta } from '../components/flood/rasterFields'
import { CompareTimePanel } from './compare/CompareTimePanel'
import { CompareMapViewport } from './compare/CompareMapViewport'
import { CompareAreasStrip } from './compare/CompareAreasStrip'
import { CompareProbeReadout } from './compare/CompareProbeReadout'
import { CompareMiniMap } from './compare/CompareMiniMap'
import { CompareLayout } from '../layouts'
import { CompareSummaryPanel } from './compare/CompareSummaryPanel'
import { CompareGaugesPanel } from './compare/CompareGaugesPanel'
import { hydroCompareOption, longitudinalOption } from './compare/charts'

const DONE_STATES = ['VALIDATED', 'SUCCEEDED', 'COMPLETED', 'DONE', 'PUBLISHED']

type Box = [number, number, number, number]

/** [w, s, e, n] from a scenario AOI — a flat bbox or a (nested) polygon ring. */
function aoiBox(coords: unknown): Box | null {
  const flat = [coords].flat(4).filter((v): v is number => typeof v === 'number')
  if (flat.length === 4) return [flat[0], flat[1], flat[2], flat[3]]
  if (flat.length < 6 || flat.length % 2) return null
  const xs = flat.filter((_, i) => i % 2 === 0)
  const ys = flat.filter((_, i) => i % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Intersection over union of two boxes (0 = disjoint, 1 = identical). */
function boxIoU(a: Box, b: Box | null): number {
  if (!b) return 0
  const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  if (iw <= 0 || ih <= 0) return 0
  const inter = iw * ih
  const area = (q: Box) => (q[2] - q[0]) * (q[3] - q[1])
  return inter / (area(a) + area(b) - inter)
}

/**
 * Run A vs run B. This screen is an orchestrator: it fetches every dataset,
 * builds the shared map overlays once, and composes the panels in
 * `screens/compare/`. Nothing is fabricated — empty endpoints render EM_DASH.
 */
export function Compare() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState('swipe')
  const [pickedA, setPickedA] = useState<string | null>(searchParams.get('a'))
  const [pickedB, setPickedB] = useState<string | null>(searchParams.get('b'))
  const [split, setSplit] = useState(50)
  const [arrivalFor, setArrivalFor] = useState<'a' | 'b'>('a')

  // River context & build settings — every value below subscribes to the
  // mission store; panes never keep private river state.
  const activeRiver = useRiverContext((s) => s.river)
  const outputs = useRiverContext((s) => s.outputs)
  const build = useBuildConfig()
  const cursor = useApp((s) => s.cursor)

  const runs = useApi(['runs'], () => api.runs())
  const list = runs.data ?? []
  const ready = list.filter((r) => DONE_STATES.includes((r.state ?? '').toUpperCase()))
  const pool = ready.length >= 2 ? ready : list

  const inList = (id: string | null) => !id || list.some((r) => r.id === id)

  // Newest first — defaults compare the latest configurations, not the oldest.
  const ordered = [...pool].sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))

  // The completed run persists in the mission context, so a fresh arrival on
  // this screen (or a reload) opens on the run the analyst actually ran.
  const persisted = outputs?.runId && inList(outputs.runId) ? outputs.runId : null
  const idA =
    (inList(pickedA) ? pickedA : null) ??
    persisted ??
    ordered.find((r) => r.engine === 'sph')?.id ??
    ordered[0]?.id ??
    ''
  // B defaults to a *different configuration of the same engine* — Compare is
  // config-vs-config (D3/D9), never engine-vs-engine by default. A cross-engine
  // pair stays one click away in the dropdown for the model-agreement question.
  // Prefer a run over the same ground: a partner elsewhere shares no raster
  // pixels, so every map, diff and delta would be empty.
  const scenarios = useApi(['scenarios'], () => api.scenarios(), { staleTime: 60_000 })
  const aoiOf = (scenarioId: string | null | undefined) =>
    aoiBox(scenarios.data?.find((s) => s.id === scenarioId)?.spec?.aoi?.coords)
  const rowA = list.find((r) => r.id === idA)
  const aoiA = aoiOf(rowA?.scenario_id)
  const sameGround = aoiA ? ordered.filter((r) => r.id !== idA && boxIoU(aoiA, aoiOf(r.scenario_id)) > 0.5) : []
  const engineA = rowA?.engine ?? null
  const idB =
    (inList(pickedB) ? pickedB : null) ??
    sameGround.find((r) => r.scenario_id !== rowA?.scenario_id)?.id ??
    sameGround[0]?.id ??
    (engineA ? ordered.find((r) => r.id !== idA && r.engine === engineA)?.id : undefined) ??
    ordered.find((r) => r.id !== idA && r.engine === 'delft3d')?.id ??
    ordered.find((r) => r.id !== idA)?.id ??
    ''

  useEffect(() => {
    if (list.length === 0) return
    if (searchParams.get('a') === idA && searchParams.get('b') === idB) return
    const next = new URLSearchParams()
    if (idA) next.set('a', idA)
    if (idB) next.set('b', idB)
    setSearchParams(next, { replace: true })
  }, [list.length, idA, idB, searchParams, setSearchParams])

  const runA = useApi(['run', idA], () => api.run(idA), { enabled: Boolean(idA) })
  const scenId = runA.data?.run.scenario_id ?? null
  const scen = useApi(['scen', scenId], () => api.scenario(scenId!), { enabled: Boolean(scenId) })
  const sumA = useApi(['run-summary', idA], () => api.summary(idA), { enabled: Boolean(idA) })
  const sumB = useApi(['run-summary', idB], () => api.summary(idB), { enabled: Boolean(idB) })
  const spec = scen.data?.scenario.spec ?? runA.data?.run.spec ?? null

  const effectiveDamId = spec?.dam_id ?? activeRiver?.damId ?? build.damId ?? null
  const damDetail = useApi(['dam', effectiveDamId], () => api.dam(effectiveDamId!), {
    enabled: Boolean(effectiveDamId),
  })
  const effectiveRiverId = activeRiver?.id ?? (damDetail.data?.river_id as string | undefined) ?? null

  // Honest when the river length is unknown: no corridor fetch, EM_DASH labels.
  const bufferOverride = activeRiver?.bufferKm ?? null
  const riverDetail = useApi(['river', effectiveRiverId], () => api.river(effectiveRiverId!), {
    enabled: Boolean(effectiveRiverId),
  })
  const riverLength = riverDetail.data?.length_km ?? activeRiver?.lengthKm ?? null
  const autoBuffer = riverLength != null ? Math.max(1, Math.min(50, Math.round(riverLength / 20))) : null
  const bufferKm = bufferOverride ?? autoBuffer

  const corridor = useApi(
    ['river-corridor', effectiveRiverId, bufferKm],
    () => api.riverCorridor(effectiveRiverId!, bufferKm!),
    { enabled: Boolean(effectiveRiverId && bufferKm != null), staleTime: 60_000 },
  )

  // Compare publishes too: the 3D globe and every pane read the dam from the
  // mission context, so the screen puts it there rather than passing it down.
  const selectRiver = useRiverContext((s) => s.select)
  const selectDam = useRiverContext((s) => s.selectDam)
  useEffect(() => {
    if (activeRiver || !riverDetail.data) return
    selectRiver({
      id: riverDetail.data.id,
      name: riverDetail.data.name,
      lengthKm: riverDetail.data.length_km ?? null,
      query: riverDetail.data.name,
    })
  }, [activeRiver, riverDetail.data, selectRiver])
  useEffect(() => {
    if (damDetail.data) selectDam(damRowToRiverPatch(damDetail.data))
    // Re-runs once the river above has been adopted, so opening Compare on a
    // fresh session still ends up with a dam in the context.
  }, [damDetail.data, selectDam, activeRiver?.id])

  const effectiveReachKm = displayReachKm(spec, activeRiver?.reachKm ?? build.reach_km)
  const activeDamObj = damDetail.data ?? (spec?.dam_id ? { id: spec.dam_id, name: runA.data?.run.scenario_name || 'Dam' } : null)

  const reachInfo = useMemo(() => {
    return sliceDownstreamRiverPath(
      activeDamObj,
      riverDetail.data?.path,
      effectiveReachKm,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDamObj, riverDetail.data?.path, effectiveReachKm])

  const cmp = useApi(['cmp', idA, idB, mode], () => api.comparison(idA, idB, mode), {
    enabled: Boolean(idA && idB),
  })
  const diffMeta = useApi(['diff-meta', idA, idB], () => tiles.meta(idA, idB), {
    enabled: Boolean(idA && idB),
  })
  const cmpId = cmp.data?.a ?? idA
  const centre = reachInfo.endCoord ? `${reachInfo.endCoord[1]},${reachInfo.endCoord[0]}` : null
  const lon = useApi(['lon', cmpId, centre], () => api.longitudinal(cmpId, centre!, idB), {
    enabled: Boolean(cmpId && centre),
  })
  const frames = useApi(['frames', idA], () => api.frames(idA), { enabled: Boolean(idA) })
  const rawHours = frames.data?.sim_hours
  const simHours = rawHours != null && rawHours > 0 ? rawHours : null

  const stA = useApi(['stations', idA], () => api.runStations(idA), { enabled: Boolean(idA) })
  const stB = useApi(['stations', idB], () => api.runStations(idB), { enabled: Boolean(idB) })
  const hyA = useApi(['breach-hydro', idA], () => api.breachHydrograph(idA), { enabled: Boolean(idA) })
  const hyB = useApi(['breach-hydro', idB], () => api.breachHydrograph(idB), { enabled: Boolean(idB) })

  // click-to-inspect: the pinned cell lives in both pane scopes — the panes
  // write it on click, the probes and the readout read it. Same context.
  const probe = useRiverContext((s) => s.mapIntents['cmp-a']?.probe ?? null)
  const probeA = useApi(
    ['probe', idA, probe?.lat, probe?.lon],
    () => api.probe(idA, probe!.lon, probe!.lat),
    { enabled: Boolean(idA && probe) },
  )
  const probeB = useApi(
    ['probe', idB, probe?.lat, probe?.lon],
    () => api.probe(idB, probe!.lon, probe!.lat),
    { enabled: Boolean(idB && probe) },
  )

  // Seed each pane's map scope: panes, panels and filmstrip all read it from
  // here. A new pick resets cursor state; analyst prefs (field, flood switch)
  // survive via the store merge.
  useEffect(() => {
    useRiverContext.getState().publishMapIntent('cmp-a', {
      runId: idA || null,
      frame: 0,
      showMax: true,
      probe: null,
    })
  }, [idA])
  useEffect(() => {
    useRiverContext.getState().publishMapIntent('cmp-b', {
      runId: idB || null,
      frame: 0,
      showMax: true,
      probe: null,
    })
  }, [idB])
  // Diff mode paints B−A tiles out of pane B; single mode paints each run.
  useEffect(() => {
    const publish = useRiverContext.getState().publishMapIntent
    if (mode === 'diff') {
      publish('cmp-b', { runId: idA || null, vs: idB || null })
    } else {
      publish('cmp-a', { runId: idA || null, vs: null })
      publish('cmp-b', { runId: idB || null, vs: null })
    }
  }, [mode, idA, idB])

  const runBRow = list.find((r) => r.id === idB)
  const shortA = (runA.data?.run.engine ?? 'A').toUpperCase()
  const shortB = (runBRow?.engine ?? 'B').toUpperCase()
  const labelA = sumA.data?.engine_label || shortA
  const labelB = sumB.data?.engine_label || shortB
  // Configuration identity — what the analyst actually compares (D9). Headers
  // show the compact tag (engine + breach width, the config fingerprint); the
  // full scenario names live in the Runs panel where space allows.
  const tagA = `${shortA}${sumA.data?.breach_width != null ? ` · ${num(sumA.data.breach_width, 0)}m` : ''}`
  const tagB = `${shortB}${sumB.data?.breach_width != null ? ` · ${num(sumB.data.breach_width, 0)}m` : ''}`
  const cfgA = sumA.data?.scenario_name ?? runA.data?.run.scenario_name ?? null
  const cfgB = sumB.data?.scenario_name ?? runBRow?.scenario_name ?? null

  // The raster field lives in the pane scopes (same truth the panes paint);
  // the legend titles below just read it.
  const field = useRiverContext((s) => s.mapIntents['cmp-a']?.field ?? 'depth')
  /** Colour ramps exactly as the servers paint them — legends render these. */
  const ramps = cmp.data?.ramps
  const diffStops: RampStop[] | null =
    (mode === 'diff' ? diffMeta.data?.ramp : null) ?? ramps?.difference ?? cmp.data?.ramp ?? null
  const extentStops: RampStop[] | null =
    diffMeta.data?.extent_ramp ?? ramps?.extent ?? cmp.data?.extent_ramp ?? null
  const fieldStops: RampStop[] | null =
    field === 'extent'
      ? extentStops
      : field === 'depth'
        ? (ramps?.depth ?? null)
        : field === 'arrival'
          ? (ramps?.arrival ?? null)
          : (ramps?.velocity ?? null)

  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []

    if (corridor.data?.geometry) {
      out.push({
        id: 'river-corridor',
        label: `River Corridor (${bufferKm != null ? `${bufferKm} km · ` : ''}${num(corridor.data.area_km2, 0)} km²)`,
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { name: 'River Corridor' }, geometry: corridor.data.geometry }],
        },
        kind: 'fill',
        color: '#4a9bd8',
        fillOpacity: 0.08,
        dasharray: [5, 4],
      })
    }

    if (riverDetail.data?.path) {
      out.push({
        id: 'river-path',
        label: `River Path (${riverDetail.data.name || activeRiver?.name || 'river'})`,
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { name: riverDetail.data.name }, geometry: riverDetail.data.path }],
        },
        kind: 'line',
        color: '#4a9bd8',
        width: 3.5,
      })
    }

    if (reachInfo.coords.length >= 2) {
      out.push({
        id: 'build-downstream-reach',
        label: `Active Flood Path (${reachInfo.actualKm} km reach)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Active Downstream Flood Reach' },
              geometry: { type: 'LineString', coordinates: reachInfo.coords },
            },
          ],
        },
        kind: 'line',
        color: '#00e5ff',
        width: 5,
      })
    }

    if (reachInfo.endCoord) {
      out.push({
        id: 'build-reach-terminus',
        label: `Reach End (${reachInfo.actualKm} km downstream)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                title: `Reach Terminus (${reachInfo.actualKm} km)`,
                subtitle: 'Downstream calculation boundary',
              },
              geometry: { type: 'Point', coordinates: reachInfo.endCoord },
            },
          ],
        },
        kind: 'circle',
        color: '#00e5ff',
        radius: 8,
      })
    }

    const bbox = spec?.aoi?.coords ?? reachInfo.bbox
    if (bbox && bbox.length === 4) {
      const [w, sLat, e, n] = bbox
      out.push({
        id: 'aoi',
        label: `Simulation Domain AOI (${reachInfo.actualKm} km reach)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [w, sLat],
                    [e, sLat],
                    [e, n],
                    [w, n],
                    [w, sLat],
                  ],
                ],
              },
            },
          ],
        },
        kind: 'fill',
        color: '#00e5ff',
        fillOpacity: 0.12,
        dasharray: [4, 3],
      })
    }

    if (damDetail.data && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      out.push({
        id: 'selected-dam',
        label: `Dam · ${damDetail.data.name}`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { id: damDetail.data.id, name: damDetail.data.name },
              geometry: { type: 'Point', coordinates: [damDetail.data.lon, damDetail.data.lat] },
            },
          ],
        },
        kind: 'circle',
        color: '#b42318',
        radius: 9,
      })
    }

    if (probe) {
      out.push({
        id: 'probe',
        label: 'Inspected Point',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { title: 'Inspected Point', lat: probe.lat, lon: probe.lon },
              geometry: { type: 'Point', coordinates: [probe.lon, probe.lat] },
            },
          ],
        },
        kind: 'circle',
        color: '#ef4444',
        radius: 8,
      })
    }

    return out
  }, [corridor.data, riverDetail.data, bufferKm, activeRiver?.name, reachInfo, spec, damDetail.data, probe])

  const legend: LegendItem[] = [
    { id: 'flood-raster', label: 'Flood affected area', color: '#3b82f6' },
    ...(corridor.data?.geometry
      ? [{ id: 'river-corridor', label: `River Corridor (${bufferKm != null ? `${bufferKm} km` : EM_DASH})`, color: '#4a9bd8', dashed: true }]
      : []),
    ...(riverDetail.data?.path
      ? [{ id: 'river-path', label: `River Path (${riverDetail.data.name || 'river'})`, color: '#4a9bd8' }]
      : []),
    { id: 'build-downstream-reach', label: `Active Flood Path (${reachInfo.actualKm} km)`, color: '#00e5ff' },
    { id: 'aoi', label: `Simulation Domain (${reachInfo.tileCountEstimate} tiles)`, color: '#00e5ff', dashed: true },
    ...(damDetail.data ? [{ id: 'selected-dam', label: `Dam · ${damDetail.data.name}`, color: '#b42318' }] : []),
    ...(probe ? [{ id: 'probe', label: 'Inspected Point', color: '#ef4444' }] : []),
  ]

  // Area focus: a gauge chip or a two-click box drops a fit override so the
  // panes fly to the inspected area. It clips the *view* only — every number
  // still comes from the endpoints (no polygon aggregates exist on the fly).
  const [areaFit, setAreaFit] = useState<number[] | null>(null)
  const [areaIdx, setAreaIdx] = useState<number | null>(null)
  const [boxMode, setBoxMode] = useState(false)
  const [corners, setCorners] = useState<{ lat: number; lon: number }[]>([])

  const pickArea = (idx: number, lat: number, lon: number) => {
    setAreaIdx(idx)
    useRiverContext.getState().publishMapIntent('cmp-a', { probe: { lat, lon } })
    useRiverContext.getState().publishMapIntent('cmp-b', { probe: { lat, lon } })
    const d = 0.035
    setAreaFit([lon - d, lat - d, lon + d, lat + d])
  }
  const clearArea = () => {
    setAreaIdx(null)
    setAreaFit(null)
  }
  const handleMapClick = (lat: number, lon: number) => {
    if (boxMode) {
      const next = [...corners, { lat, lon }]
      if (next.length >= 2) {
        const [a, b] = next
        setAreaIdx(null)
        setAreaFit([
          Math.min(a.lon, b.lon),
          Math.min(a.lat, b.lat),
          Math.max(a.lon, b.lon),
          Math.max(a.lat, b.lat),
        ])
        setCorners([])
        setBoxMode(false)
      } else {
        setCorners(next)
      }
      return
    }
    const publish = useRiverContext.getState().publishMapIntent
    publish('cmp-a', { probe: { lat, lon } })
    publish('cmp-b', { probe: { lat, lon } })
  }

  const baseFit = useMemo(() => {
    if (spec?.aoi?.coords && spec.aoi.coords.length === 4) return spec.aoi.coords
    if (reachInfo.bbox && reachInfo.bbox.length === 4) return reachInfo.bbox
    if (damDetail.data && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      return damFit(damDetail.data)
    }
    if (riverDetail.data?.bbox && riverDetail.data.bbox.length === 4) return riverDetail.data.bbox
    return null
  }, [spec?.aoi?.coords, reachInfo.bbox, damDetail.data, riverDetail.data?.bbox])

  // An area pick overrides the default fit until cleared.
  const mapFit = areaFit ?? baseFit

  // Panes paint from their map scopes — run/field/frame/max-view come from the
  // shared context the panels and filmstrip read and write. Only overlay
  // geometry and the click handler arrive as props.
  const renderPane = (which: 'a' | 'b') => (
    <div className="absolute inset-0">
      <MapShell
        scope={which === 'a' ? 'cmp-a' : 'cmp-b'}
        features={features}
        fit={mapFit}
        legend={legend}
        showSearch={false}
        primary={which === 'a'}
        shared={false}
        onMapClick={handleMapClick}
      />
    </div>
  )

  const swap = () => {
    setPickedA(idB)
    setPickedB(idA)
  }

  const place = scen.data?.scenario.name ?? runA.data?.run.scenario_name ?? activeRiver?.name ?? null
  const nearFields: { label: string; windowM: number | null }[] = [
    ...(sumA.data?.near_field_only
      ? [{ label: `${labelA} (A)`, windowM: sumA.data.window_m ?? null }]
      : []),
    ...(sumB.data?.near_field_only
      ? [{ label: `${labelB} (B)`, windowM: sumB.data.window_m ?? null }]
      : []),
  ]

  const longitudinalOpt = longitudinalOption(lon.data, shortA, shortB)
  const hydroOpt = hydroCompareOption(hyA.data, hyB.data, shortA, shortB)

  // Gate: Compare needs a completed run; persisted state survives reloads.
  if (!outputs?.runId) {
    return <Navigate to="/results" replace />
  }
  if (runs.pending) {
    return <div className="p-8 text-center text-[12px] text-[var(--faint)]">Loading scenario comparisons…</div>
  }
  if (!list.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-[12px] leading-relaxed text-[var(--faint)]">
        No completed runs available for comparison yet. Run a scenario from the Build tab first.
      </div>
    )
  }

  return (
    <CompareLayout
      layoutId="compare"
      leftTitle="Runs"
      rightTitle="Summary"
      left={
        <>
          <CompareScenarioPanel
            place={place}
            riverName={riverDetail.data?.name ?? activeRiver?.name ?? null}
            reachKm={reachInfo.actualKm}
            breachMethod={spec?.breach?.method ?? sumA.data?.breach_method ?? null}
            simHours={simHours}
          />

          <CompareRunsPanel
            list={list}
            idA={idA}
            idB={idB}
            onPickA={setPickedA}
            onPickB={setPickedB}
            onSwap={swap}
            engineA={labelA}
            engineB={labelB}
            stateA={runA.data?.run.state ?? null}
            stateB={runBRow?.state ?? null}
            nearFields={nearFields}
            configA={cfgA}
            configB={cfgB}
          />

          <CompareModePanel mode={mode} onChange={setMode} />

          <CompareLayersPanel scopes={['cmp-a', 'cmp-b']} />

          <CompareTimePanel
            scopes={['cmp-a', 'cmp-b']}
            thumbs={frames.data?.frames ?? []}
            simHours={simHours}
          />
        </>
      }
      center={
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <CompareAreasStrip
            stationsA={stA.data}
            stationsB={stB.data}
            shortA={shortA}
            shortB={shortB}
            boxMode={boxMode}
            hasCorner={corners.length > 0}
            activeIdx={areaIdx}
            onPick={pickArea}
            onToggleBox={() => {
              setCorners([])
              setBoxMode((b) => !b)
            }}
            onClear={clearArea}
          />

          <div className="h-[62vh] min-h-[420px] shrink-0">
          <CompareMapViewport
            mode={mode}
            split={split}
            onSplit={setSplit}
            labelA={tagA}
            labelB={tagB}
            renderA={() => renderPane('a')}
            renderB={() => renderPane('b')}
          >
            <CompareProbeReadout
              scope="cmp-a"
              thumbs={frames.data?.frames ?? []}
              cursor={cursor}
              shortA={shortA}
              shortB={shortB}
              a={{ pending: probeA.pending, depth: probeA.data?.depth_m ?? null }}
              b={{ pending: probeB.pending, depth: probeB.data?.depth_m ?? null }}
            />
            <div className="absolute bottom-3 left-3 z-40">
              {mode === 'diff' ? (
                <RampLegend
                  title={`B − A · ${fieldMeta(field).label}`}
                  note={`${fieldMeta(field).unit} · GET /api/comparisons`}
                  stops={diffStops}
                  width={210}
                />
              ) : (
                <RampLegend
                  title={fieldMeta(field).label}
                  note={`${fieldMeta(field).unit} · GET /api/comparisons`}
                  stops={fieldStops}
                  width={210}
                />
              )}
            </div>
          </CompareMapViewport>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            <Panel title="Inundation Extent Comparison" className="h-[236px]">
              <CompareMiniMap
                features={features}
                fit={mapFit}
                raster={{ run: idA, vs: idB, kind: 'extent' }}
              />
              <div className="px-3 py-1.5">
                <RampLegend
                  title="Extent classes"
                  note="A-only · B-only · overlap · GET /api/tiles/diff/…/meta.json"
                  stops={extentStops}
                />
              </div>
            </Panel>

            <Panel title="Water Depth Along River (Longitudinal Profile)">
              {longitudinalOpt ? (
                <div className="p-2">
                  <EChart option={longitudinalOpt} height={186} />
                </div>
              ) : (
                <Empty>No longitudinal profile data returned</Empty>
              )}
            </Panel>

            <Panel
              title={`Arrival Time Comparison — ${arrivalFor === 'a' ? `${shortA} (A)` : `${shortB} (B)`}`}
              className="h-[236px]"
              actions={
                <Seg
                  size="sm"
                  options={[
                    { value: 'a', label: `${shortA} A` },
                    { value: 'b', label: `${shortB} B` },
                  ]}
                  value={arrivalFor}
                  onChange={(v) => setArrivalFor(v as 'a' | 'b')}
                />
              }
            >
              <CompareMiniMap
                features={features}
                fit={mapFit}
                raster={{ run: arrivalFor === 'a' ? idA : idB, kind: 'arrival' }}
              />
              <div className="px-3 py-1.5">
                <RampLegend
                  title="Arrival time (h)"
                  note="GET /api/comparisons"
                  stops={ramps?.arrival ?? null}
                />
              </div>
            </Panel>
          </div>

          <Panel title={`Breach Hydrographs — ${labelA} (A) vs ${labelB} (B)`} className="shrink-0">
            {hydroOpt ? (
              <div className="p-2">
                <p className="mb-0.5 px-1 text-[10px] text-[var(--muted)]">
                  Discharge leaving the breach over time, both runs on one axis
                  {hyA.data?.peak_cms != null && hyB.data?.peak_cms != null
                    ? ` — peaks ${num(hyA.data.peak_cms, 0)} vs ${num(hyB.data.peak_cms, 0)} m³/s`
                    : ''}
                </p>
                <EChart option={hydroOpt} height={190} />
              </div>
            ) : (
              <Empty>
                {hyA.pending || hyB.pending
                  ? 'Loading breach hydrographs…'
                  : 'No breach hydrograph products for these runs.'}
              </Empty>
            )}
          </Panel>
        </div>
      }
      right={
        <>
          <CompareSummaryPanel shortA={shortA} shortB={shortB} metrics={cmp.data?.metrics} />

          <CompareGaugesPanel
            shortA={shortA}
            shortB={shortB}
            stationsA={stA.data}
            stationsB={stB.data}
            pending={stA.pending}
          />

          <Panel title="Export & Report">
            {/* keyed by run: a new pick remounts with fresh job state */}
            <ExportPanel key={idA || 'none'} runId={idA || null} label={`${tagA} (A)`} accent="#0b6bcb" />
            <div className="border-t border-[var(--line)]" />
            <ExportPanel key={idB || 'none'} runId={idB || null} label={`${tagB} (B)`} accent="#b42318" />
          </Panel>
        </>
      }
    />
  )
}
