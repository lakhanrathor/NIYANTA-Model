import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { ScenarioSpec, StageRow } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useRunId } from '../lib/useRun'
import { clock, EM_DASH, num, pct } from '../lib/format'
import {
  Icon,
  Metric,
  Panel,
  Pill,
} from '../components/ui'
import { MapShell } from '../components/MapShell'
import type { LegendItem, MapFeature } from '../components/MapShell'
import { DamCard } from '../components/dam/DamCard'
import { useRiverContext } from '../lib/river-context'
import { damRowToRiverPatch } from '../lib/mission'
import { damFit, displayReachKm, ringAreaKm2, sliceDownstreamRiverPath, useBuildConfig } from './build/config'
import { IntermediateOutputs3DModal } from '../components/IntermediateOutputs3DModal'
import { DamProfilePanel } from '../components/flood/DamProfilePanel'
import { WorkspaceLayout } from '../layouts'

const STAGES = [
  { key: 'terrain', title: 'Terrain Preparation', sub: 'DEM clipping, river reach, boundary bathymetry' },
  { key: 'mesh', title: 'Mesh Generation', sub: 'Generating 2D/3D computational hydrodynamic grid' },
  { key: 'breach', title: 'Breach Hydrograph', sub: 'Calculating Froehlich discharge outflow curve' },
  { key: 'solver', title: 'Hydrodynamic Solver', sub: 'Solving 2D Shallow Water Equations / SPH particles' },
  { key: 'post', title: 'Post-processing', sub: 'Deriving peak depths, velocities & arrival times' },
  { key: 'impact', title: 'Impact Assessment', sub: 'Overlaying WorldPop population & infrastructure' },
  { key: 'validation', title: 'Validation & Export', sub: 'Finalizing raster maps & GIS bundles' },
]

const DONE_STATES = ['SUCCEEDED', 'COMPLETED', 'DONE', 'PUBLISHED', 'VALIDATED']

function deriveStages(runStage: string | null, runState: string | null, engine: string | null): StageRow[] {
  const idx = runStage ? STAGES.findIndex((s) => s.key === runStage) : -1
  const allDone = runState ? DONE_STATES.includes(runState.toUpperCase()) : false
  return STAGES.map((s, i) => ({
    n: i + 1,
    key: s.key,
    title: s.title,
    status: allDone || (idx >= 0 && i < idx) ? 'done' : idx >= 0 && i === idx ? 'active' : 'pending',
    pct: allDone || (idx >= 0 && i < idx) ? 100 : 0,
    detail: s.sub.replace('{engine}', engine ? engine.toUpperCase() : EM_DASH),
  }))
}

/** Envelope of a saved AOI: a 4-number bbox directly, or the bounds of a saved
 *  river-following ring ([ring]). null when the shape is unreadable. */
function aoiBbox(coords: number[] | undefined | null): [number, number, number, number] | null {
  if (!coords?.length) return null
  if (coords.length === 4 && coords.every((v) => typeof v === 'number')) {
    return coords as [number, number, number, number]
  }
  const ring = (coords as unknown as [number, number][][])[0]
  if (!Array.isArray(ring) || ring.length < 2) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const pt of ring) {
    if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') continue
    if (pt[0] < w) w = pt[0]
    if (pt[0] > e) e = pt[0]
    if (pt[1] < s) s = pt[1]
    if (pt[1] > n) n = pt[1]
  }
  if (!Number.isFinite(w)) return null
  return [w, s, e, n]
}

function aoiCentre(spec?: ScenarioSpec): [number, number] | null {
  const box = aoiBbox(spec?.aoi?.coords)
  if (!box) return null
  return [(box[1] + box[3]) / 2, (box[0] + box[2]) / 2]
}

export function Run() {
  const runId = useRunId()
  const navigate = useNavigate()
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeModal, setActiveModal] = useState<'dem' | 'mesh' | 'breach' | 'water' | null>(null)

  // 1. River Context & Build Settings
  const activeRiver = useRiverContext((s) => s.river)
  const build = useBuildConfig()

  const runDetail = useApi(['run', runId], () => api.run(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const run = runDetail.data?.run
  const scenarioId = run?.scenario_id ?? null
  const scenario = useApi(['scenario', scenarioId], () => api.scenario(scenarioId!), {
    enabled: Boolean(scenarioId),
  })
  const stages = useApi(['run-stages', runId], () => api.runStages(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const metrics = useApi(['run-metrics', runId], () => api.runMetrics(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const outputs = useApi(['run-outputs', runId], () => api.runOutputs(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const params = useApi(['run-params', runId], () => api.runParams(runId!), { enabled: Boolean(runId) })
  const logs = useApi(['run-log', runId], () => api.runLog(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const summary = useApi(['run-summary', runId], () => api.summary(runId!), { enabled: Boolean(runId) })
  const resultDoc = useApi(['result', runId], () => api.result(runId!), { enabled: Boolean(runId) })
  const boxes = useApi(['boxes'], api.watchBoxes)

  const selectDam = useRiverContext((s) => s.selectDam)
  const publishRun = useRiverContext((s) => s.publishRun)
  const publishOutputs = useRiverContext((s) => s.publishOutputs)
  const loadSpec = useBuildConfig((s) => s.loadSpec)

  const spec = run?.spec ?? scenario.data?.scenario?.spec ?? null
  const effectiveDamId = spec?.dam_id ?? activeRiver?.damId ?? build.damId ?? null
  const damDetail = useApi(['dam', effectiveDamId], () => api.dam(effectiveDamId!), { enabled: Boolean(effectiveDamId) })

  const effectiveRiverId = activeRiver?.id ?? (damDetail.data?.river_id as string | undefined) ?? null

  // Auto-sync loaded run scenario and dam into the mission context
  useEffect(() => {
    if (damDetail.data) selectDam(damRowToRiverPatch(damDetail.data))
    if (spec && effectiveDamId) loadSpec(spec, effectiveDamId)
  }, [damDetail.data, spec, effectiveDamId, selectDam, loadSpec])

  // One agreed engine and one agreed reach: every panel on this page — and the
  // published snapshot — reads these instead of re-deriving them.
  const engine = run?.engine ?? spec?.engine ?? build.engine ?? null
  const effectiveReachKm = displayReachKm(spec, activeRiver?.reachKm ?? build.reach_km)

  // Run publishes its own identity: Discover/Build/Results/Player all learn which run is live
  // from the context instead of each re-deriving it.
  useEffect(() => {
    if (!run) return
    publishRun({
      runId: run.id,
      scenarioId: run.scenario_id ?? null,
      scenarioName: run.scenario_name ?? scenario.data?.scenario?.name ?? null,
      state: run.state ?? null,
      engine: run.engine ?? null,
      engineLabel: summary.data?.engine_label ?? run.engine ?? null,
      breachMethod: summary.data?.breach_method ?? spec?.breach?.method ?? null,
      simHours: spec?.horizon?.duration_hr ?? summary.data?.sim_hours ?? null,
      finishedAt: run.finished_at ?? null,
      reachKm: effectiveReachKm > 0 ? effectiveReachKm : null,
    })
  }, [run, scenario.data, summary.data, spec, effectiveReachKm, publishRun])

  // ...and the outputs it already computed, so downstream tabs inherit them.
  useEffect(() => {
    if (!runId || !resultDoc.data) return
    publishOutputs({
      runId,
      metrics: resultDoc.data.metrics ?? null,
      peakCms: resultDoc.data.metrics?.peak_discharge_cms ?? null,
      ...(resultDoc.data.stations ? { stationCount: resultDoc.data.stations.length } : {}),
      updatedAt: new Date().toISOString(),
    })
  }, [runId, resultDoc.data, publishOutputs])

  // 2. Fetch River, Corridor and Dam Data for map continuity
  const bufferOverride = activeRiver?.bufferKm ?? null
  const riverDetail = useApi(['river', effectiveRiverId], () => api.river(effectiveRiverId!), { enabled: Boolean(effectiveRiverId) })
  const riverLength = riverDetail.data?.length_km ?? activeRiver?.lengthKm ?? null
  const autoBuffer = riverLength ? Math.max(1, Math.min(50, Math.round(riverLength / 20))) : 10
  const bufferKm = bufferOverride ?? autoBuffer

  const corridor = useApi(
    ['river-corridor', effectiveRiverId, bufferKm],
    () => api.riverCorridor(effectiveRiverId!, bufferKm),
    { enabled: Boolean(effectiveRiverId), staleTime: 60_000 },
  )

  const rows = stages.data ?? deriveStages(run?.stage ?? null, run?.state ?? null, engine)
  const doneCount = rows.filter((r) => r.status === 'done').length
  const pctValue = run?.pct ?? run?.progress ?? 0
  const widthValue = summary.data?.breach_width ?? spec?.breach?.width_m ?? build.width_m
  const depthValue = summary.data?.breach_depth ?? spec?.breach?.depth_m ?? build.depth_m
  const levelValue = summary.data?.reservoir_level ?? spec?.reservoir?.initial_level_m ?? build.level_m
  const simHours = summary.data?.sim_hours ?? spec?.horizon?.duration_hr ?? build.duration_hr
  const place = [summary.data?.state, damDetail.data?.state, 'India'].filter(Boolean).join(', ') || null

  const peakCms = resultDoc.data?.metrics?.peak_discharge_cms ?? null
  const hMax = resultDoc.data?.metrics?.max_depth_m ?? null
  const inundArea = resultDoc.data?.metrics?.inundation_km2 ?? null
  const cellCount = metrics.data?.mesh_cells ?? null
  const elevRange = outputs.data?.find((o) => o.key === 'dem')?.elevation ?? null
  const storageMcm = params.data?.storage_mcm ?? null

  const isCompleted = run?.state ? DONE_STATES.includes(run.state.toUpperCase()) : false

  // 3. Unified Downstream Reach Calculation (effectiveReachKm is defined once above,
  // alongside the engine, so panels and the published snapshot cannot disagree).
  // Memoized (not rebuilt per render): every downstream memo — features, legend,
  // fit — keys off this, so an unstable object here would rebuild the map
  // overlays on every cursor move.
  const activeDamObj = useMemo(
    () =>
      damDetail.data ??
      (activeRiver?.damId
        ? {
            id: activeRiver.damId,
            name: activeRiver.damName || '',
            lat: activeRiver.damLat,
            lon: activeRiver.damLon,
          }
        : null),
    [damDetail.data, activeRiver?.damId, activeRiver?.damName, activeRiver?.damLat, activeRiver?.damLon],
  )

  const reachInfo = useMemo(() => {
    // The corridor half-width rides along so the result carries the
    // river-following domain ring — the envelope rectangle is only a fallback.
    return sliceDownstreamRiverPath(
      activeDamObj,
      riverDetail.data?.path,
      effectiveReachKm,
      bufferKm,
    )
  }, [activeDamObj, riverDetail.data?.path, effectiveReachKm, bufferKm])

  // 4. Complete Unified Vector Layers (Corridor, Full Path, Active Reach, Terminus, Domain AOI, Dam)
  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []

    // A. River Corridor
    if (corridor.data?.geometry) {
      out.push({
        id: 'river-corridor',
        label: `River Corridor (${bufferKm} km · ${num(corridor.data.area_km2, 0)} km²)`,
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

    // B. Full River Path
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

    // C. (retired) The flood-path centreline duplicated the river path inside
    // the study area, so it is not drawn — the domain ring, the reach
    // terminus and the legend carry the reach extent instead.

    // D. Reach Terminus Marker
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
                title: `Reach End (${reachInfo.actualKm} km)`,
                subtitle: 'Downstream simulation boundary',
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

    // E. Simulation Domain — the river-following ring, never the envelope box.
    // Preference order: the polygon ring this scenario actually saved; else the
    // live ring rebuilt from this run's frozen reach; the envelope rectangle
    // only when no centreline exists (then the square genuinely is the domain).
    const savedCoords = spec?.aoi?.coords
    const savedRing =
      spec?.aoi?.type === 'polygon' &&
      Array.isArray(savedCoords) &&
      Array.isArray((savedCoords as unknown as unknown[])[0]) &&
      (((savedCoords as unknown as [number, number][][])[0]?.length ?? 0) >= 4)
        ? ((savedCoords as unknown as [number, number][][])[0])
        : null
    const liveRing = !savedRing && reachInfo.ring && reachInfo.ring.length >= 4 ? reachInfo.ring : null
    const domainRing = savedRing ?? liveRing
    if (domainRing) {
      // Tile math mirrors the builder: ring area / 35 km² per DEM tile.
      const drawnTiles = Math.max(1, Math.ceil(ringAreaKm2(domainRing) / 35))
      out.push({
        id: 'build-domain',
        label: `Simulation Domain AOI (${drawnTiles} tiles · ${reachInfo.actualKm} km reach · follows river)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Simulation Domain Reach' },
              geometry: {
                type: 'Polygon',
                coordinates: [domainRing],
              },
            },
          ],
        },
        kind: 'fill',
        color: '#00e5ff',
        fillOpacity: 0.12,
        dasharray: [4, 3],
      })
    } else {
      const bbox = spec?.aoi?.coords ?? reachInfo.bbox
      if (bbox && bbox.length === 4) {
        const [w, sLat, e, n] = bbox as [number, number, number, number]
        out.push({
          id: 'build-domain',
          label: `Simulation Domain AOI (${reachInfo.tileCountEstimate} tiles · ${reachInfo.actualKm} km reach)`,
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: 'Simulation Domain Reach' },
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
    }

    // F. Upstream Reservoir Footprint
    const resArea = build.area_km2 > 0 ? build.area_km2 : Math.max(0.5, build.storage_mcm * 0.15)
    if (damDetail.data && resArea > 0 && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      out.push({
        id: 'build-reservoir',
        label: `Reservoir footprint (≈ ${resArea.toFixed(1)} km²)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: `${damDetail.data.name} Reservoir`, area_km2: resArea },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  Array.from({ length: 65 }, (_, i) => {
                    const a = (i / 64) * Math.PI * 2
                    const rKm = Math.sqrt(resArea / Math.PI)
                    const dLat = rKm / 111.32
                    const dLon = rKm / (111.32 * Math.max(Math.cos(((damDetail.data!.lat! * Math.PI) / 180)), 0.05))
                    return [damDetail.data!.lon! + dLon * Math.cos(a), damDetail.data!.lat! + dLat * Math.sin(a)]
                  }),
                ],
              },
            },
          ],
        },
        kind: 'fill',
        color: '#2e90fa',
        fillOpacity: 0.16,
        dasharray: [4, 3],
      })
    }

    // G. Selected Dam Location Marker
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

    // H. Watch Boxes
    if (boxes.data?.length) {
      out.push({
        id: 'watch-boxes',
        label: 'Watch Boxes',
        data: {
          type: 'FeatureCollection',
          features: boxes.data
            .filter((b) => b.bbox_geojson)
            .map((b) => ({ type: 'Feature', properties: { name: b.name }, geometry: b.bbox_geojson! })),
        },
        kind: 'fill',
        color: '#d81b9b',
        fillOpacity: 0.08,
        dasharray: [3, 2],
      })
    }

    return out
  }, [riverDetail.data, corridor.data, bufferKm, spec, damDetail.data, boxes.data, activeRiver?.name, reachInfo, build])

  const legend: LegendItem[] = [
    ...(corridor.data?.geometry
      ? [{ id: 'river-corridor', label: `River Corridor (${bufferKm} km)`, color: '#4a9bd8', dashed: true }]
      : []),
    ...(riverDetail.data?.path
      ? [{ id: 'river-path', label: `River Path (${riverDetail.data.name || 'river'})`, color: '#4a9bd8' }]
      : []),
    { id: 'build-domain', label: `Simulation Domain AOI (${reachInfo.tileCountEstimate} tiles${reachInfo.ring ? ' · follows river' : ''})`, color: '#00e5ff', dashed: true },
    ...(damDetail.data ? [{ id: 'selected-dam', label: `Dam · ${damDetail.data.name}`, color: '#b42318' }] : []),
    ...(boxes.data?.length ? [{ id: 'watch-boxes', label: 'Watch Boxes', color: '#d81b9b', dashed: true }] : []),
  ]

  const centre = aoiCentre(spec ?? undefined)
  const stateLabel = run?.state ?? 'QUEUED'
  const stateTone =
    stateLabel === 'RUNNING' || stateLabel === 'ACTIVE'
      ? 'ok'
      : stateLabel === 'FAILED'
        ? 'bad'
        : stateLabel === 'DRAFT'
          ? 'muted'
          : 'accent'

  const mapFit = useMemo(() => {
    // The live reach envelope first: it spans dam → terminus along the river,
    // which is the analyst's research area. The saved AOI (stale rectangles
    // from older scenarios) only positions the camera when no reach exists.
    if (reachInfo.bbox && reachInfo.bbox.length === 4) return reachInfo.bbox
    const savedBox = aoiBbox(spec?.aoi?.coords)
    if (savedBox) return savedBox
    if (damDetail.data && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      return damFit(damDetail.data)
    }
    if (riverDetail.data?.bbox && riverDetail.data.bbox.length === 4) return riverDetail.data.bbox
    return null
  }, [reachInfo.bbox, spec?.aoi?.coords, damDetail.data, riverDetail.data?.bbox])

  if (!runId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-[12px] text-[var(--faint)]">
        No active simulation run — please launch a scenario from the Build tab.
      </div>
    )
  }

  return (
    <>
    <WorkspaceLayout
      layoutId="run"
      leftTitle="Scenario"
      rightTitle="Stage Outputs"
      dockTitle="Console"
      left={
        <>
          <Panel
            title="Current Scenario"
            actions={<Link to="/build" className="text-[11px] text-[var(--accent)] hover:underline">← Back to Build</Link>}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-[var(--line)] bg-[var(--bg)]">
                <span className="flex h-full items-center justify-center text-[var(--faint)]">
                  <Icon name="image" size={16} />
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  {summary.data?.scenario_name ?? scenario.data?.scenario.name ?? `${activeRiver?.name || 'River'} · Case ${build.case}`}
                </p>
                {place ? <p className="text-[11px] text-[var(--muted)]">{place}</p> : null}
                <p className="num text-[10px] text-[var(--faint)]">
                  {centre ? `${centre[0].toFixed(4)}° N, ${centre[1].toFixed(4)}° E` : EM_DASH}
                </p>
              </div>
            </div>
            <DamCard variant="inline" />
            <DamCard variant="metrics" />
            <Metric
              label="Reservoir Level"
              value={levelValue === undefined || levelValue === null ? EM_DASH : num(levelValue, 1)}
              unit="m"
            />
            <Metric
              label="Breach Width"
              value={widthValue === undefined || widthValue === null ? EM_DASH : num(widthValue, 1)}
              unit="m"
            />
            <Metric
              label="Breach Depth"
              value={depthValue === undefined || depthValue === null ? EM_DASH : num(depthValue, 1)}
              unit="m"
            />
            <Metric
              label="Study Reach"
              value={reachInfo.actualKm > 0 ? num(reachInfo.actualKm, 1) : EM_DASH}
              unit="km"
            />
            <Metric
              label="Simulation Length"
              value={simHours === undefined || simHours === null ? EM_DASH : num(simHours, 1)}
              unit="h"
            />
            <Metric
              label="Model Engine"
              value={
                <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                  {engine ? engine.toUpperCase() : EM_DASH}
                </span>
              }
            />
          </Panel>

          <Panel title="Simulation Pipeline">
            <ol className="relative py-1">
              <span className="absolute bottom-4 left-[26px] top-4 w-px bg-[var(--line)]" />
              {rows.map((s) => (
                <li key={s.key} className="relative flex items-start gap-2.5 px-3 py-2">
                  <span
                    className={`z-10 num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      s.status === 'done'
                        ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                        : s.status === 'active'
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white animate-pulse'
                          : 'border-[var(--line-strong)] bg-white text-[var(--faint)]'
                    }`}
                  >
                    {s.status === 'done' ? <Icon name="check" size={10} /> : s.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[12px] ${
                        s.status === 'active'
                          ? 'font-semibold text-[var(--accent)]'
                          : s.status === 'pending'
                            ? 'text-[var(--muted)]'
                            : 'font-medium'
                      }`}
                    >
                      {s.title}
                    </span>
                    <span className="block text-[10px] text-[var(--faint)]">{s.detail}</span>
                  </span>
                  {s.status === 'active' && (
                    <span className="num shrink-0 text-[10px] font-semibold text-[var(--accent)]">{pct(s.pct || pctValue, 0)}</span>
                  )}
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Simulation Status">
            <div className="flex items-center gap-2 px-3 py-2">
              <Pill tone={stateTone}>{stateLabel}</Pill>
              <span className="num ml-auto text-[11px] text-[var(--muted)]">
                {`${doneCount}/${rows.length}`}
              </span>
            </div>
            <Metric label="Elapsed" value={clock(run?.elapsed_seconds)} />
            <Metric label="ETA" value={isCompleted ? '00:00:00' : clock(run?.eta_seconds)} />
            <div className="px-3 py-2">
              <div className="mb-1 flex items-baseline justify-between text-[11px]">
                <span className="text-[var(--muted)]">Progress</span>
                <span className="num font-semibold text-[var(--accent)]">{pct(pctValue, 0)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, pctValue))}%` }}
                />
              </div>
            </div>
          </Panel>

          <Panel title="Live Solver Telemetry & Benchmarks">
            <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Mesh Cells</p>
                <p className="num text-[13px] font-semibold">
                  {metrics.data?.mesh_cells != null ? num(metrics.data.mesh_cells, 0) : EM_DASH}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Domain Area</p>
                <p className="num text-[13px] font-semibold">
                  {metrics.data?.domain_km2 != null ? `${num(metrics.data.domain_km2, 1)} km²` : EM_DASH}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Time Step (Δt)</p>
                <p className="num text-[13px] font-semibold">
                  {metrics.data?.dt_s != null
                    ? `${num(metrics.data.dt_s, 2)} s`
                    : params.data?.dt_s != null
                      ? `${num(params.data.dt_s, 2)} s (configured)`
                      : EM_DASH}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Solver Time</p>
                <p className="num text-[13px] font-semibold">
                  {metrics.data?.sim_time_s != null ? clock(metrics.data.sim_time_s) : EM_DASH}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Iterations</p>
                <p className="num text-[13px] font-semibold">
                  {metrics.data?.iterations != null ? num(metrics.data.iterations, 0) : EM_DASH}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Compute Hardware</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      metrics.data?.hardware ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--line)]'
                    }`}
                  />
                  <p className="text-[12px] font-semibold text-[var(--foreground)]">
                    {metrics.data?.hardware ??
                      (spec?.hardware === 'cpu' || build.hardware === 'cpu' ? 'CPU (configured)' : EM_DASH)}
                  </p>
                </div>
                <p className="text-[9px] text-[var(--muted)] font-medium mt-0.5">
                  {summary.data?.engine_label ?? (engine ? `${engine.toUpperCase()} engine` : EM_DASH)}
                </p>
              </div>
            </div>
            {isCompleted && (
              <div className="border-t border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-[10px] text-[var(--muted)]">
                <div className="flex items-center justify-between">
                  <span>Peak Discharge Q_max:</span>
                  <span className="font-mono font-semibold text-[var(--accent)]">
                    {peakCms != null ? `${num(peakCms, 0)} m³/s` : EM_DASH}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span>Inundated area:</span>
                  <span className="font-mono font-semibold text-[var(--ok)]">
                    {inundArea != null ? `${num(inundArea, 1)} km²` : EM_DASH}
                  </span>
                </div>
              </div>
            )}
          </Panel>
        </>
      }
      center={
        <MapShell
          features={features}
          fit={mapFit}
          legend={legend}
          showSearch={false}
        />
      }

      dockHeader={
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Icon name="file" size={13} />
            <span>Console / Logs</span>
            <span className={`h-2 w-2 rounded-full ${logs.data?.length ? 'bg-[var(--ok)] animate-pulse' : 'bg-slate-300'}`} />
            {logs.data?.length ? (
              <span className="font-mono text-[10px] text-[var(--muted)] font-normal truncate max-w-md hidden md:inline">
                · Latest: {logs.data[logs.data.length - 1].message}
              </span>
            ) : null}
          </div>
          <span className="ml-auto text-[10px] font-mono text-[var(--faint)]">
            ID: {runId ? runId.slice(0, 8) : '—'}
          </span>
        </>
      }
      dock={
        <div>
          <div className="flex items-center justify-between border-t border-[var(--line)] bg-slate-900 px-3 py-1 text-[10px] text-slate-400">
            <span>Stream Terminal</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Auto-scroll
            </label>
          </div>
          <div className="h-44 overflow-y-auto bg-[#0d1117] p-2.5 font-mono text-[10px] leading-relaxed text-[#c9d1d9]">
            {logs.data?.length ? (
              logs.data.map((l, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  <span className="text-[#8b949e]">[{l.ts ? new Date(l.ts).toLocaleTimeString() : '00:00:01'}]</span>{' '}
                  <span
                    className={
                      l.level === 'error'
                        ? 'text-[#f85149]'
                        : l.level === 'warn'
                          ? 'text-[#d29922]'
                          : 'text-[#58a6ff]'
                    }
                  >
                    {l.level.toUpperCase()}
                  </span>{' '}
                  {l.message}
                </p>
              ))
            ) : (
              <div className="text-[#8b949e]">
                <p>No log lines published for this run yet — lines stream in while the solver runs.</p>
              </div>
            )}
          </div>
        </div>
      }
      right={
        <>
          <Panel title="Stage Parameters & Intermediate Outputs">
            <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Target Resolution (Cell Size)</p>
                <p className="num text-[13px] font-semibold text-[var(--foreground)]">
                  {params.data?.target_resolution_m != null
                    ? `${num(params.data.target_resolution_m, 1)} m`
                    : EM_DASH}
                </p>
                <p className="text-[9px] text-[var(--faint)] mt-0.5">
                  {params.data?.method ?? 'Mesh strategy unknown'}
                </p>
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] font-medium text-[var(--muted)]">Computational Domain Area</p>
                <p className="num text-[13px] font-semibold text-[var(--foreground)]">
                  {params.data?.domain_km != null
                    ? `${num(params.data.domain_km, 1)} km²`
                    : metrics.data?.domain_km2 != null
                      ? `${num(metrics.data.domain_km2, 1)} km²`
                      : EM_DASH}
                </p>
                <p className="text-[9px] text-[var(--faint)] mt-0.5">
                  {params.data?.expected_cells != null
                    ? `${num(params.data.expected_cells, 0)} cells planned · ${reachInfo.actualKm} km reach`
                    : `${reachInfo.actualKm} km study reach (${reachInfo.coords.length} vertices)`}
                </p>
              </div>
            </div>

            {/* longitudinal section through the dam — crest, reservoir, breach notch */}
            <div className="border-t border-[var(--line)]">
              <DamProfilePanel dam={damDetail.data ?? null} spec={spec} peakCms={peakCms} />
            </div>

            {/* 4 Interactive 3D Output Cards */}
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] p-2">
              {[
                {
                  key: 'dem' as const,
                  title: 'Copernicus DEM-30m',
                  sub: 'Elevation surface & dam profile',
                  badge: 'DEM GLO-30',
                  tag: elevRange ? `${num(elevRange[0], 0)}–${num(elevRange[1], 0)} m` : EM_DASH,
                  status: 'ready',
                  gradient: 'from-[#0f172a] via-[#1e3a8a] to-[#0284c7]',
                  icon: 'layers',
                },
                {
                  key: 'mesh' as const,
                  title: 'Hydrodynamic Mesh',
                  sub:
                    cellCount != null
                      ? `${num(cellCount, 0)} cells · ${params.data?.method ?? 'adaptive grid'}`
                      : 'Mesh not built yet',
                  badge: params.data?.dt_s != null ? `Δt ${num(params.data.dt_s, 1)} s` : 'adaptive',
                  tag:
                    params.data?.target_resolution_m != null
                      ? `${num(params.data.target_resolution_m, 0)} m res`
                      : EM_DASH,
                  status: doneCount >= 2 ? 'ready' : 'active',
                  gradient: 'from-[#0f172a] via-[#042f2e] to-[#0d9488]',
                  icon: 'grid',
                },
                {
                  key: 'breach' as const,
                  title: 'Breach Hydrograph',
                  sub:
                    peakCms != null
                      ? `Peak Q ${num(peakCms, 0)} m³/s`
                      : 'Breach discharge not exported yet',
                  badge:
                    summary.data?.breach_method ?? spec?.breach?.method ?? 'breach formation',
                  tag: storageMcm != null ? `Vw = ${num(storageMcm, 1)} MCM` : EM_DASH,
                  status: doneCount >= 3 ? 'ready' : 'active',
                  gradient: 'from-[#0f172a] via-[#311042] to-[#7c3aed]',
                  icon: 'chart',
                },
                {
                  key: 'water' as const,
                  title: 'Inundation Field',
                  sub: 'Depth & velocity fields',
                  badge: hMax != null ? `h_max ${num(hMax, 1)} m` : 'pending',
                  tag: inundArea != null ? `${num(inundArea, 1)} km²` : EM_DASH,
                  status: isCompleted || doneCount >= 4 ? 'ready' : doneCount >= 3 ? 'active' : 'pending',
                  gradient: 'from-[#0f172a] via-[#082f49] to-[#0284c7]',
                  icon: 'water',
                },
              ].map((item) => {
                const serverOut = outputs.data?.find((o) => o.key === item.key)
                const effectiveStatus = serverOut?.status ?? item.status
                return (
                  <div
                    key={item.key}
                    onClick={() => setActiveModal(item.key)}
                    className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-2 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:bg-white hover:shadow-lg hover:shadow-sky-500/10"
                    title={`Click to launch 3D ${item.title} Inspector`}
                  >
                    {/* Mini 3D Preview Thumbnail — real server render when it exists */}
                    <div className={`relative mb-2 h-16 w-full overflow-hidden rounded-lg bg-gradient-to-tr ${item.gradient} p-1.5 text-white shadow-inner flex flex-col justify-between`}>
                      {serverOut?.thumb ? (
                        <>
                          <img
                            src={serverOut.thumb}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/45" />
                        </>
                      ) : null}
                      <div className="relative z-10 flex items-center justify-between">
                        <span className="rounded bg-black/50 px-1 py-0.5 text-[8px] font-mono font-semibold tracking-wide text-cyan-300 backdrop-blur-sm">
                          {item.badge}
                        </span>
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-white shadow-sm transition-transform duration-300 group-hover:scale-110">
                          <Icon name={item.icon} size={10} />
                        </span>
                      </div>
                      
                      <div className="relative z-10 flex items-center justify-between">
                        <span className="font-mono text-[8px] text-slate-300">{item.tag}</span>
                        <span className="flex items-center gap-1 rounded bg-sky-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm transition-all duration-200 group-hover:bg-[#00e5ff] group-hover:text-black">
                          3D Inspect
                        </span>
                      </div>
                    </div>

                    {/* Card Meta */}
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-[10.5px] font-bold text-[var(--foreground)] group-hover:text-[var(--accent)]">
                          {item.title}
                        </p>
                        <Pill tone={effectiveStatus === 'ready' ? 'ok' : effectiveStatus === 'active' ? 'accent' : 'muted'}>
                          {effectiveStatus}
                        </Pill>
                      </div>
                      <p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{item.sub}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* Action Callouts on completion */}
          {isCompleted && (
            <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
              <p className="text-[12px] font-semibold text-[var(--accent)]">Simulation Completed Successfully</p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Hydrodynamic results, flood arrival curves and damage models are ready.
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                <button
                  onClick={() => navigate(`/player/${runId}`)}
                  className="flex h-8 items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 text-[11px] font-semibold text-white shadow-sm hover:opacity-90"
                >
                  <Icon name="camera" size={13} />
                  Launch 3D Simulation Player
                </button>
                <button
                  onClick={() => navigate(`/results/${runId}`)}
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-[var(--line-strong)] bg-white px-3 text-[11px] font-medium text-[var(--foreground)] hover:border-[var(--accent)]"
                >
                  <Icon name="chart" size={13} />
                  View 2D Inundation Results
                </button>
                <button
                  onClick={() => navigate(`/results/${runId}`)}
                  title="Screen this flood against downstream dams on the Results page"
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-[var(--line-strong)] bg-white px-3 text-[11px] font-medium text-[var(--foreground)] hover:border-[var(--accent)]"
                >
                  <Icon name="layers" size={13} />
                  Screen Downstream Cascade
                </button>
              </div>
            </div>
          )}
        </>
      }
    />
      {/* -------------------------------------------------- 3D Intermediate Outputs Inspection Modal */}
      {/* The modal reads river/run/outputs from the mission context itself and
          fetches what it needs through the shared query cache — Run never hands
          it data component-to-component. */}
      {activeModal && (
        <IntermediateOutputs3DModal
          activeTab={activeModal}
          onClose={() => setActiveModal(null)}
          onSelectTab={(tab) => setActiveModal(tab)}
        />
      )}
    </>
  )
}

