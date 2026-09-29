import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { api, tiles } from '../../lib/api'
import type {
  BreachHydrograph,
  Frame,
  FramesDoc,
  HazardVillages,
  Impact,
  RampStop,
  RunDetail,
  RunResultDoc,
  RunSeries,
  RunStation,
  RunSummary,
  ScenarioSpec,
  Terrain3D,
} from '../../lib/api'
import type { ApiResult } from '../../lib/useApi'
import { useApi } from '../../lib/useApi'
import { useRunId } from '../../lib/useRun'
import { EM_DASH, clock } from '../../lib/format'
import { useRiverContext } from '../../lib/river-context'
import type { OutputsSnapshot } from '../../lib/river-context'
import { damRowToRiverPatch } from '../../lib/mission'
import { displayReachKm, sliceDownstreamRiverPath } from '../build/config'
import type { PlayerScene, SceneDam, SceneVillage, WaterColorMode } from '../PlayerScene'
import type { CamPreset, PickPoint, TimeFormat, WaterState } from './types'

/**
 * PLAYER STORE — shared data + scene state for the Player page only.
 *
 * The provider fetches everything more than one panel needs (run, spec,
 * frames, terrain, dam, …) and derives the domain once (bbox, dam pin,
 * playhead). Panels fetch their own single-purpose endpoints on top
 * (params, probe, …) so editing one panel never touches the others.
 * react-query dedupes identical keys, so shared reads cost one request.
 */

interface PlayerValue {
  runId: string | null
  spec: ScenarioSpec | null
  reachKm: number | null
  damName: string | null
  riverName: string | null
  bbox: [number, number, number, number] | null
  bboxKey: string
  damView: SceneDam | null
  damKey: string

  run: ApiResult<RunDetail>
  summary: ApiResult<RunSummary>
  framesDoc: ApiResult<FramesDoc>
  terrainDoc: ApiResult<Terrain3D>
  hydro: ApiResult<BreachHydrograph>
  stations: ApiResult<RunStation[]>
  series: ApiResult<RunSeries>
  impact: ApiResult<Impact>
  resultDoc: ApiResult<RunResultDoc>
  villagesDoc: ApiResult<HazardVillages>
  /** Paintable ramps by kind (depth primary from frames.json, rest from tiles/meta.json). */
  ramps: { depth: RampStop[] | null; arrival: RampStop[] | null; velocity: RampStop[] | null }
  /** Affected villages mapped for the 3D pins + list panel. */
  villages: SceneVillage[]
  selectedVillage: SceneVillage | null
  setSelectedVillage: (v: SceneVillage | null) => void
  colorMode: WaterColorMode
  setColorMode: (m: WaterColorMode) => void
  overlayStates: Partial<Record<'arrival' | 'velocity', string>>
  setOverlayState: (kind: 'arrival' | 'velocity', status: string) => void

  frameList: Frame[]
  frameCount: number
  frame: number
  clamped: number
  frameT: number | null
  simHours: number | null
  formattedTime: string
  setFrame: (f: number | ((f: number) => number)) => void
  playing: boolean
  setPlaying: (p: boolean | ((p: boolean) => boolean)) => void
  speed: string
  setSpeed: (s: string) => void
  timeFormat: TimeFormat
  setTimeFormat: (t: TimeFormat) => void

  mountRef: RefObject<HTMLDivElement | null>
  sceneRef: RefObject<PlayerScene | null>
  terrainExag: number
  setTerrainExag: (v: number) => void
  waterExag: number
  setWaterExag: (v: number) => void
  waterOpacity: number
  setWaterOpacity: (v: number) => void
  /** Layer visibility lives in the mission context (`view.hiddenLayers`) —
   *  shared with every screen, persisted, never a per-page copy. */
  hiddenLayers: string[]
  toggleLayer: (id: string) => void
  cameraPreset: CamPreset
  applyCamera: (view: CamPreset) => void
  water: WaterState | null
  setWater: (w: WaterState | null) => void
  pick: PickPoint | null
  setPick: (p: PickPoint | null) => void
}

const PlayerContext = createContext<PlayerValue | null>(null)

export function usePlayer(): PlayerValue {
  const v = useContext(PlayerContext)
  if (!v) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return v
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const runId = useRunId()

  const river = useRiverContext((s) => s.river)
  const buildSnap = useRiverContext((s) => s.build)
  const publishRun = useRiverContext((s) => s.publishRun)
  const publishOutputs = useRiverContext((s) => s.publishOutputs)
  const selectDam = useRiverContext((s) => s.selectDam)
  const hiddenLayers = useRiverContext((s) => s.view.hiddenLayers)
  const toggleLayer = useRiverContext((s) => s.toggleLayer)

  /* ---------------------------------------------------------- queries */
  const run = useApi(['run', runId], () => api.run(runId!), { enabled: Boolean(runId) })
  const runRow = run.data?.run ?? null
  const scenId = runRow?.scenario_id ?? null
  const scen = useApi(['scen', scenId], () => api.scenario(scenId!), { enabled: Boolean(scenId) })
  const spec = scen.data?.scenario?.spec ?? runRow?.spec ?? null

  const summary = useApi(['run-summary', runId], () => api.summary(runId!), { enabled: Boolean(runId) })
  const framesDoc = useApi(['frames', runId], () => api.frames(runId!), { enabled: Boolean(runId) })
  // Full solve-grid relief — the ≤200/axis cut blurs the valley the flood runs in.
  const terrainDoc = useApi(['terrain3d-full', runId], () => api.runTerrain(runId!, 'full'), {
    enabled: Boolean(runId),
  })
  const hydro = useApi(['breach-hydro', runId], () => api.breachHydrograph(runId!), { enabled: Boolean(runId) })
  const stations = useApi(['stations', runId], () => api.runStations(runId!), { enabled: Boolean(runId) })
  const series = useApi(['series', runId], () => api.runSeries(runId!), { enabled: Boolean(runId) })
  const impact = useApi(['impact', runId], () => api.impact(runId!), { enabled: Boolean(runId) })
  const resultDoc = useApi(['result', runId], () => api.result(runId!), { enabled: Boolean(runId) })
  const villagesDoc = useApi(['hazard-villages', runId], () => api.hazardVillages(runId!), {
    enabled: Boolean(runId),
  })

  const effectiveDamId = spec?.dam_id ?? river?.damId ?? buildSnap?.damId ?? null
  const damDetail = useApi(['dam', effectiveDamId], () => api.dam(effectiveDamId!), {
    enabled: Boolean(effectiveDamId),
    staleTime: 60_000,
  })
  const effectiveRiverId = river?.id ?? damDetail.data?.river_id ?? null
  const riverDetail = useApi(['river', effectiveRiverId], () => api.river(effectiveRiverId!), {
    enabled: Boolean(effectiveRiverId),
    staleTime: 60_000,
  })

  /* ----------------------------------------------------------- domain */
  const reachKm = spec?.reach_km ?? river?.reachKm ?? buildSnap?.reach_km ?? null
  const damName = damDetail.data?.name ?? river?.damName ?? null
  const riverName = river?.name ?? damDetail.data?.river_name ?? null

  const damView: SceneDam | null = useMemo(() => {
    const lon = damDetail.data?.lon ?? river?.damLon ?? null
    const lat = damDetail.data?.lat ?? river?.damLat ?? null
    if (typeof lon !== 'number' || typeof lat !== 'number') return null
    return {
      name: damDetail.data?.name ?? river?.damName ?? 'Dam',
      lon,
      lat,
      height_m: damDetail.data?.height_m ?? river?.damHeight ?? null,
      crest_length_m: damDetail.data?.crest_length_m ?? river?.damCrestLength ?? null,
      heading_deg: damDetail.data?.heading_deg ?? river?.damHeadingDeg ?? null,
    }
  }, [damDetail.data, river])
  const damKey = damView
    ? [damView.lon, damView.lat, damView.height_m, damView.crest_length_m, damView.heading_deg].join(',')
    : ''

  const reachInfo = useMemo(
    () =>
      sliceDownstreamRiverPath(
        damView ? { lon: damView.lon, lat: damView.lat } : null,
        riverDetail.data?.path,
        // An unknown reach renders the documented 5 km minimum domain — never
        // an invented typical length. `displayReachKm` prefers the spec, then
        // the AOI diagonal, then live state, floored at the minimum.
        displayReachKm(spec, river?.reachKm ?? buildSnap?.reach_km ?? 0),
      ),
    [damView, riverDetail.data?.path, spec, river?.reachKm, buildSnap?.reach_km],
  )

  const bbox = useMemo<[number, number, number, number] | null>(() => {
    if (terrainDoc.data?.bounds?.length === 4)
      return [terrainDoc.data.bounds[0], terrainDoc.data.bounds[1], terrainDoc.data.bounds[2], terrainDoc.data.bounds[3]]
    if (spec?.aoi?.coords?.length === 4)
      return [spec.aoi.coords[0], spec.aoi.coords[1], spec.aoi.coords[2], spec.aoi.coords[3]]
    if (reachInfo.bbox?.length === 4)
      return [reachInfo.bbox[0], reachInfo.bbox[1], reachInfo.bbox[2], reachInfo.bbox[3]]
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainDoc.data, spec?.aoi?.coords, reachInfo.bbox])
  const bboxKey = bbox ? bbox.join(',') : ''

  /* --------------------------------------------------------- timeline */
  const frameList = framesDoc.data?.frames ?? []
  const frameCount = frameList.length
  const simHours =
    framesDoc.data?.sim_hours && framesDoc.data.sim_hours > 0
      ? framesDoc.data.sim_hours
      : (summary.data?.sim_hours ?? spec?.horizon?.duration_hr ?? null)

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('hhmm')
  const [pick, setPick] = useState<PickPoint | null>(null)

  useEffect(() => {
    setFrame(0)
    setPlaying(false)
    setPick(null)
  }, [runId])

  useEffect(() => {
    if (!playing || frameCount < 2) return
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % frameCount)
    }, 1200 / Number(speed))
    return () => window.clearInterval(id)
  }, [playing, speed, frameCount])

  const clamped = frameCount ? Math.min(frame, frameCount - 1) : 0
  const frameT = frameCount ? (frameList[clamped]?.t ?? null) : null
  const formattedTime =
    frameT == null
      ? EM_DASH
      : timeFormat === 'minutes'
        ? `${Math.round(frameT / 60)} min`
        : timeFormat === 'hours'
          ? `${(frameT / 3600).toFixed(2)} hr`
          : clock(frameT)

  /* ------------------------------------------------------ scene state */
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<PlayerScene | null>(null)
  const [terrainExag, setTerrainExag] = useState(1)
  // True scale by default — gorge floods run tens of metres deep, and 10×
  // turned them into walls. Shallow floods can raise it from Scene controls.
  const [waterExag, setWaterExag] = useState(1)
  const [waterOpacity, setWaterOpacity] = useState(0.85)
  const [cameraPreset, setCameraPreset] = useState<CamPreset>('dam')
  const [water, setWater] = useState<WaterState | null>(null)
  const [colorMode, setColorMode] = useState<WaterColorMode>('depth')
  const [overlayStates, setOverlayStates] = useState<Partial<Record<'arrival' | 'velocity', string>>>({})
  const [selectedVillage, setSelectedVillage] = useState<SceneVillage | null>(null)

  useEffect(() => {
    setColorMode('depth')
    setSelectedVillage(null)
    setOverlayStates({})
  }, [runId])

  // Stable identity: the Viewport's scene-creation effect depends on it, and a
  // fresh function per render would dispose and rebuild the 3D scene each time.
  const setOverlayState = useCallback(
    (kind: 'arrival' | 'velocity', status: string) =>
      setOverlayStates((s) => (s[kind] === status ? s : { ...s, [kind]: status })),
    [],
  )

  const applyCamera = (view: CamPreset) => {
    setCameraPreset(view)
    sceneRef.current?.preset(view)
  }

  /* --------------------------------------- depth-ramp + overlay ramps */
  const framesRamp = framesDoc.data?.ramp?.length ? framesDoc.data.ramp : null
  const tileMeta = useApi(['tile-meta', runId], () => tiles.meta(runId!), {
    enabled: Boolean(runId),
  })
  const ramps = {
    depth: framesRamp ?? (tileMeta.data?.ramps?.depth?.length ? tileMeta.data.ramps.depth : null),
    arrival: tileMeta.data?.ramps?.arrival?.length ? tileMeta.data.ramps.arrival : null,
    velocity: tileMeta.data?.ramps?.velocity?.length ? tileMeta.data.ramps.velocity : null,
  }

  const villages: SceneVillage[] = useMemo(() => {
    const feats = villagesDoc.data?.features ?? []
    const out: SceneVillage[] = []
    for (const f of feats) {
      const coords = f.geometry?.coordinates
      if (f.geometry?.type !== 'Point' || !coords || coords.length < 2) continue
      const [lon, lat] = coords
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      out.push({
        name: f.properties?.name ?? 'Village',
        lon,
        lat,
        hazard: (f.properties?.hazard ?? '').toUpperCase(),
        depth_m: f.properties?.depth_m ?? null,
        arrival_hr: f.properties?.arrival_hr ?? null,
        population: f.properties?.population ?? null,
      })
    }
    return out.sort((a, b) => (b.depth_m ?? -1) - (a.depth_m ?? -1))
  }, [villagesDoc.data])

  /* -------------------------------------------------- context publish */
  useEffect(() => {
    if (damDetail.data) selectDam(damRowToRiverPatch(damDetail.data))
  }, [damDetail.data, selectDam])

  useEffect(() => {
    if (!runRow) return
    publishRun({
      runId: runRow.id,
      scenarioId: runRow.scenario_id ?? null,
      scenarioName: runRow.scenario_name ?? scen.data?.scenario?.name ?? null,
      state: runRow.state ?? null,
      engine: runRow.engine ?? null,
      engineLabel: summary.data?.engine_label ?? null,
      breachMethod: summary.data?.breach_method ?? spec?.breach?.method ?? null,
      simHours: spec?.horizon?.duration_hr ?? summary.data?.sim_hours ?? null,
      finishedAt: runRow.finished_at ?? null,
      reachKm: spec?.reach_km ?? null,
    })
  }, [runRow, scen.data, summary.data, spec, publishRun])

  useEffect(() => {
    if (!runId) return
    const patch: Partial<OutputsSnapshot> = { runId }
    let dirty = false
    if (stations.data) {
      patch.stationCount = stations.data.length
      dirty = true
    }
    if (hydro.data?.peak_cms != null) {
      patch.peakCms = hydro.data.peak_cms
      dirty = true
    }
    if (hydro.data?.released_hm3 != null) {
      patch.releasedHm3 = hydro.data.released_hm3
      dirty = true
    }
    if (resultDoc.data?.metrics) {
      patch.metrics = resultDoc.data.metrics
      dirty = true
    }
    if (!dirty) return
    patch.updatedAt = new Date().toISOString()
    publishOutputs(patch)
  }, [runId, stations.data, hydro.data, resultDoc.data, publishOutputs])

  const value: PlayerValue = {
    runId,
    spec,
    reachKm,
    damName,
    riverName,
    bbox,
    bboxKey,
    damView,
    damKey,
    run,
    summary,
    framesDoc,
    terrainDoc,
    hydro,
    stations,
    series,
    impact,
    resultDoc,
    villagesDoc,
    ramps,
    villages,
    selectedVillage,
    setSelectedVillage,
    colorMode,
    setColorMode,
    overlayStates,
    setOverlayState,
    frameList,
    frameCount,
    frame,
    clamped,
    frameT,
    simHours,
    formattedTime,
    setFrame,
    playing,
    setPlaying,
    speed,
    setSpeed,
    timeFormat,
    setTimeFormat,
    mountRef,
    sceneRef,
    terrainExag,
    setTerrainExag,
    waterExag,
    setWaterExag,
    waterOpacity,
    setWaterOpacity,
    hiddenLayers,
    toggleLayer,
    cameraPreset,
    applyCamera,
    water,
    setWater,
    pick,
    setPick,
  }

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}
