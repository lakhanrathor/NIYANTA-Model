import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LegendItem, MapFeature } from '../../components/MapShell'
import type { BreachFixture, DamRow, ScenarioSpec } from '../../lib/api'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useRiverContext } from '../../lib/river-context'

export type FailureCase = '1' | '2' | '3'
export type DamType = 'corewall' | 'concrete_faced' | 'homogeneous'
export type Erodibility = 'high' | 'medium' | 'low'
export type Engine = 'fast' | 'sph' | 'delft3d'
export type HardwareDevice = 'gpu' | 'cpu'
export type ImpactSource = 'worldpop' | 'manual'

/** The three cases converge on one ScenarioSpec — only breach mode and timing
 *  change, which is why the case cards show the mode they imply. */
export const CASE_META: Record<
  FailureCase,
  { title: string; blurb: string; mode: string; hydro: string }
> = {
  '1': {
    title: 'Structural weakness',
    blurb: 'Seepage / piping through an ageing structure. Onset is emergent — the solver resolves when the breach opens, then grows it over the formation time.',
    mode: 'piping',
    hydro: 'steady inflow — the reservoir only has to be high enough for piping to run',
  },
  '2': {
    title: 'Extreme event',
    blurb: 'Cloudburst or flood wave lifts the reservoir over the crest. The breach starts when the level crosses crest level.',
    mode: 'overtopping',
    hydro: 'event inflow — this number decides when the level reaches the crest',
  },
  '3': {
    title: 'Attack / sabotage',
    blurb: 'A notch cut at the dam at T+0. Timing is immediate; geometry comes from the breach inputs below.',
    mode: 'attack',
    hydro: 'only the starting level matters — the breach is immediate',
  },
}

export const ENGINES = ['fast', 'sph', 'delft3d'] as const
export const METHODS = ['froehlich2008', 'froehlich1995', 'macdonald', 'vonthun', 'xuzhang', 'manual'] as const

interface BuildConfig {
  damId: string | null
  case: FailureCase
  /** reservoir */
  level_m: number
  crest_m: number
  bed_m: number
  height_m: number
  crest_length_m: number
  heading_deg: number
  axis_heading_deg: number
  dam_heading_deg: number
  reach_km: number
  storage_mcm: number
  area_km2: number
  erodibility: Erodibility
  damType: DamType
  /** breach */
  method: string
  width_m: number
  depth_m: number
  formation_hr: number
  side_slope: number
  chainage_m: number
  seededMethod: string | null
  /** hydrology + solver */
  inflow_cms: number
  duration_hr: number
  dt_s: number
  engine: Engine
  hardware: HardwareDevice
  /** impact */
  impactSource: ImpactSource
  /** True once the auto-decision (WorldPop on disk → worldpop, else manual)
   *  has run — after that the user's own choice is never overwritten. */
  impactSeeded: boolean
  /** The current source came from seeding, not the user — so it may still
   *  follow the data (manual → worldpop once the file lands). */
  impactAuto: boolean
  population: number | null
  houses: number | null
  assets_million: number | null
}

export interface BuildState extends BuildConfig {
  patch: (patch: Partial<BuildConfig>) => void
  /** Defaults from the dam record. Guarded so tab switches never wipe edits. */
  seedDam: (dam: DamRow) => void
  /** Method fixture values (HEC-RAS worked example) — applied once per method. */
  seedBreach: (fixture: BreachFixture) => void
  /** Impact source picks itself from disk evidence, once: WorldPop on disk →
   *  worldpop, otherwise manual entry (GHS-POP/OSM still back the run itself). */
  seedImpact: (worldpopReady: boolean) => void
  /** Explicit user pick — marks the decision as owned so seeding never wins. */
  setImpactSource: (source: ImpactSource) => void
  /** Inverse of toSpec: apply a saved configuration back onto the draft. */
  loadSpec: (spec: ScenarioSpec, damId: string | null) => void
  /** Discover cleared the mission — the draft belonged to the old river. */
  reset: () => void
}

/** Structural zeros: "not set yet", distinct from a measured value. */
const INITIAL: BuildConfig = {
  damId: null,
  case: '2',
  level_m: 0,
  crest_m: 0,
  bed_m: 0,
  height_m: 0,
  crest_length_m: 0,
  heading_deg: 0,
  axis_heading_deg: 0,
  dam_heading_deg: 0,
  reach_km: 0,
  storage_mcm: 0,
  area_km2: 0,
  erodibility: 'medium',
  damType: 'homogeneous',
  method: 'froehlich2008',
  width_m: 0,
  depth_m: 0,
  formation_hr: 0,
  side_slope: 0.7,
  chainage_m: 0,
  seededMethod: null,
  inflow_cms: 0,
  duration_hr: 6,
  dt_s: 1,
  engine: 'fast',
  hardware: 'gpu',
  // Manual is the safe default: it never claims a population grid the corridor
  // doesn't have. seedImpact flips it to worldpop the moment the file is seen.
  impactSource: 'manual',
  impactSeeded: false,
  impactAuto: false,
  population: null,
  houses: null,
  assets_million: null,
}

/** One draft at a time: the Build page configures the dam picked in Discover. */
export const useBuildConfig = create<BuildState>()(
  persist(
    (set) => ({
      ...INITIAL,
      // Every mutation is mirrored into the mission context, so Build is the
      // publisher and every other tab is a subscriber of the same object.
      patch: (patch) => set(patch),
      reset: () => set({ ...INITIAL, impactSeeded: false, seededMethod: null }),
      seedDam: (dam) => {
        // Sync to mission context store
        useRiverContext.getState().selectDam({
          id: dam.id,
          name: dam.name,
          damName: dam.name,
          damLat: dam.lat,
          damLon: dam.lon,
          damHeight: dam.height_m,
          damCrest: dam.crest_m,
          damFsl: dam.fsl_m,
          damType: dam.dam_type,
          damCrestLength: dam.crest_length_m ?? dam.length_m,
          damHeadingDeg: dam.heading_deg,
          damStorageMcm: dam.storage_mcm ?? dam.capacity_mcm,
          damState: dam.state,
        })

        set((s) => {
          if (s.damId === dam.id && s.crest_m > 0 && s.height_m > 0) return s
          const height = dam.height_m ?? 0
          const crest = dam.crest_m ?? (dam.fsl_m ? dam.fsl_m + 1.5 : 0)
          const fsl = dam.fsl_m ?? (crest > 0 ? crest - 1.5 : 0)
          const bed = crest > 0 && height > 0 ? Math.max(0, crest - height) : 0
          const length = dam.crest_length_m ?? dam.length_m ?? 0
          // Orientation comes from the registry when it carries one; otherwise 0
          // means "unknown" and the 3D view derives the axis from the river path.
          const heading = dam.heading_deg ?? 0
          const storage = dam.storage_mcm ?? dam.capacity_mcm ?? 0
          const area = storage > 0 && height > 0
            ? Math.max(0.5, Math.round((storage / Math.max(height * 0.35, 2.0)) * 10) / 10)
            : 0
          const damType: DamType =
            dam.dam_type === 'concrete' || dam.dam_type === 'corewall' || dam.dam_type === 'concrete_faced'
              ? (dam.dam_type as DamType)
              : 'homogeneous'

          // Breach estimates are derived from the dam's own height and storage —
          // stated arithmetic, not a copied constant. Zero storage means we have
          // nothing to derive from, so the field stays unset for the user.
          const hw = Math.max(height * 0.75, 0)
          const Vw = Math.max(storage * 1e6, 0)
          const froehlich = hw > 0 && Vw > 0
            ? Math.max(15, Math.round(0.27 * 1.3 * Math.pow(Vw, 0.32) * Math.pow(hw, 0.19)))
            : 0
          // a breach can't be wider than the dam (backend rejects it with 422)
          const breachWidth = length > 0 ? Math.min(froehlich, length) : froehlich
          const breachDepth = hw > 0 ? Math.round(hw * 10) / 10 : 0
          const formationHr = hw > 0 && Vw > 0
            ? Math.max(0.5, Math.min(8.0, Math.round((0.015 * Math.pow(Vw, 0.53) / Math.pow(hw, 0.9)) * 10) / 10))
            : 0
          const inflow = storage > 0 ? Math.max(150, Math.round(storage * 25)) : 0

          return {
            damId: dam.id,
            crest_m: Math.round(crest * 10) / 10,
            level_m: Math.round(fsl * 10) / 10,
            bed_m: Math.round(bed * 10) / 10,
            height_m: Math.round(height * 10) / 10,
            crest_length_m: Math.round(length * 10) / 10,
            heading_deg: heading,
            axis_heading_deg: heading,
            dam_heading_deg: heading,
            storage_mcm: Math.round(storage * 10) / 10,
            area_km2: area,
            damType,
            width_m: breachWidth,
            depth_m: breachDepth,
            formation_hr: formationHr,
            inflow_cms: inflow,
            duration_hr: s.duration_hr > 0 ? s.duration_hr : 24,
            dt_s: s.dt_s > 0 ? s.dt_s : 1,
            // Impact baselines are left unset — the corridor's own WorldPop /
            // GHS-POP grid fills them at run time (see work_impact).
            population: s.population,
            houses: s.houses,
            assets_million: s.assets_million,
          }
        })
      },
      seedBreach: (f) =>
        set((s) => {
          if (s.seededMethod === f.method) return s
          return {
            method: f.method,
            width_m: Math.round(f.result.avg_width_m * 10) / 10,
            depth_m: Math.round(f.result.depth_m * 10) / 10,
            formation_hr: Math.round(f.result.t_form_hr * 10) / 10,
            side_slope: Math.round(f.result.side_slope * 10) / 10,
            seededMethod: f.method,
          }
        }),
      seedImpact: (worldpopReady) =>
        set((s) => {
          // `undefined` = a draft persisted before this flag existed: auto.
          if (s.impactSeeded && s.impactAuto === false) return s
          const impactSource = worldpopReady ? 'worldpop' : 'manual'
          if (s.impactSeeded && s.impactSource === impactSource) return s
          return { impactSource, impactSeeded: true, impactAuto: true }
        }),
      setImpactSource: (source) => set({ impactSource: source, impactSeeded: true, impactAuto: false }),
      loadSpec: (spec, damId) =>
        set(() => {
          const b = spec.breach ?? {}
          const r = spec.reservoir ?? {}
          const h = spec.horizon ?? {}
          const im = spec.impact ?? {}
          const c: FailureCase =
            spec.case === '1' || spec.case === '3' ? spec.case : '2'
          const method = b.method ?? 'froehlich2008'
          return {
            damId: damId ?? spec.dam_id ?? null,
            case: c,
            damType: (spec.dam_type as DamType) ?? 'homogeneous',
            erodibility: (spec.erodibility as Erodibility) ?? 'medium',
            engine: (spec.engine as Engine) ?? 'fast',
            hardware: (spec.hardware as HardwareDevice) ?? 'gpu',
            method,
            width_m: b.width_m ?? 0,
            depth_m: b.depth_m ?? 0,
            chainage_m: b.chainage_m ?? 0,
            side_slope: b.side_slope ?? 0.7,
            formation_hr: b.formation_time_hr ?? 0,
            level_m: r.initial_level_m ?? 0,
            crest_m: r.crest_level_m ?? 0,
            bed_m: r.bed_level_m ?? 0,
            height_m: r.dam_height_m ?? 0,
            storage_mcm: r.storage_mcm ?? 0,
            area_km2: r.area_km2 ?? 0,
            inflow_cms: r.inflow_cms ?? 0,
            duration_hr: h.duration_hr ?? 6,
            dt_s: h.dt_s ?? 30,
            impactSource: im.source === 'manual' ? 'manual' : 'worldpop',
            impactSeeded: true,
            impactAuto: false,
            population: im.population ?? null,
            houses: im.houses ?? null,
            assets_million: im.assets_million ?? null,
            // Frozen extent travels with the configuration; a spec saved before
            // the field existed leaves the draft's current reach untouched.
            ...(typeof spec.reach_km === 'number' && spec.reach_km > 0
              ? { reach_km: spec.reach_km }
              : {}),
            // the loaded geometry is authoritative — block fixture auto-seed
            // and dam defaults from overwriting what the user just loaded
            seededMethod: method,
          }
        }),
    }),
    { name: 'niyanta.build-config' },
  ),
)

export const caseMode = (c: FailureCase) => CASE_META[c].mode

/** Calculate haversine distance in kilometers between two lon/lat points */
export function geoDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371.0
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

export interface DownstreamReachResult {
  coords: [number, number][]
  actualKm: number
  totalDownstreamKm: number
  /** null when the dam record carries no coordinates — no domain to draw. */
  bbox: [number, number, number, number] | null // [minLon, minLat, maxLon, maxLat]
  /**
   * River-following domain ring (closed): the sliced path buffered by the
   * corridor half-width on both sides. The simulation domain, the DEM clip and
   * the saved scenario AOI are this polygon — never the envelope rectangle.
   * null when no buffer was given or the path can't carry one.
   */
  ring: [number, number][] | null
  /** Honest domain area: ring area when a ring exists, envelope area otherwise. */
  domainAreaKm2: number
  tileCountEstimate: number
  estSolveTimeMin: number
  endCoord: [number, number] | null
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

/**
 * Buffer a centreline into a closed ring that follows its curves: for every
 * vertex, offset ±halfWidthKm along the local perpendicular (degrees scaled by
 * cos(lat)), left rail forward + right rail reversed. Degenerate segments are
 * skipped; fewer than 4 distinct ring points → [] (caller falls back to bbox).
 */
export function bufferPathRing(
  coords: [number, number][],
  halfWidthKm: number,
): [number, number][] {
  if (!coords || coords.length < 2 || !(halfWidthKm > 0)) return []
  const left: [number, number][] = []
  const right: [number, number][] = []
  const n = coords.length
  for (let i = 0; i < n; i++) {
    const [lon, lat] = coords[i]
    const [pLon, pLat] = coords[Math.max(0, i - 1)]
    const [qLon, qLat] = coords[Math.min(n - 1, i + 1)]
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05)
    // Direction in km-space so the normal is metric, not degree-skewed.
    const dxKm = (qLon - pLon) * 111.32 * cosLat
    const dyKm = (qLat - pLat) * 110.54
    const len = Math.hypot(dxKm, dyKm)
    if (len <= 1e-9) continue
    const nx = -dyKm / len
    const ny = dxKm / len
    const offLon = halfWidthKm / (111.32 * cosLat)
    const offLat = halfWidthKm / 110.54
    left.push([round5(lon + nx * offLon), round5(lat + ny * offLat)])
    right.push([round5(lon - nx * offLon), round5(lat - ny * offLat)])
  }
  const ring = [...left, ...right.reverse()]
  // Drop consecutive duplicates; need a real polygon.
  const clean = ring.filter(
    (pt, i) => i === 0 || pt[0] !== ring[i - 1][0] || pt[1] !== ring[i - 1][1],
  )
  if (clean.length < 4) return []
  clean.push([...clean[0]] as [number, number])
  return clean
}

/** Shoelace area of a lon/lat ring in km² (lon scaled by mean cos(lat)). */
export function ringAreaKm2(ring: [number, number][]): number {
  if (!ring || ring.length < 4) return 0
  const meanLat = ring.reduce((a, p) => a + p[1], 0) / ring.length
  const kx = 111.32 * Math.max(Math.cos((meanLat * Math.PI) / 180), 0.05)
  const ky = 110.54
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky)
  }
  return Math.abs(sum) / 2
}

/** Nothing to trace: no dam coordinates, or no river geometry to trace along. */
export function emptyReach(): DownstreamReachResult {
  return {
    coords: [],
    actualKm: 0,
    totalDownstreamKm: 0,
    bbox: null,
    ring: null,
    domainAreaKm2: 0,
    tileCountEstimate: 0,
    estSolveTimeMin: 0,
    endCoord: null,
  }
}

/**
 * Extracts the exact downstream river path starting from the dam location,
 * slicing along the river line geometry up to targetReachKm (or the entire river length).
 * Computes exact bounding box for DEM tiles, tile count, and estimated solve time.
 *
 * Requires real coordinates: with no dam position and no path there is no reach,
 * and the function returns `emptyReach()` rather than a box around a guessed point.
 */
export function sliceDownstreamRiverPath(
  dam: { lon?: number | null; lat?: number | null } | null,
  path: { coordinates: [number, number][] } | null | undefined,
  targetReachKm: number = 35,
  /**
   * Corridor half-width in km. When given, the result also carries `ring` — the
   * sliced path buffered by this width on both sides — and the tile estimate is
   * computed from the ring area, not the envelope rectangle.
   */
  halfWidthKm?: number | null,
): DownstreamReachResult {
  const lon = dam?.lon
  const lat = dam?.lat
  if (typeof lon !== 'number' || typeof lat !== 'number') return emptyReach()

  const reach = Math.max(5, targetReachKm)

  if (!path?.coordinates || path.coordinates.length < 2) {
    // No river geometry to trace along. The domain is then a plain AOI square
    // that genuinely spans `reach` km across, there is no polyline to draw, and
    // the full-river length is unknown — all three are reported as such instead
    // of of a synthetic 75 %-of-reach box that still claimed the full reach.
    const half = reach / 2
    const dLat = half / 111.32
    const dLon = half / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05))
    const bbox: [number, number, number, number] = [
      Math.round((lon - dLon) * 1000) / 1000,
      Math.round((lat - dLat) * 1000) / 1000,
      Math.round((lon + dLon) * 1000) / 1000,
      Math.round((lat + dLat) * 1000) / 1000,
    ]
    const tiles = Math.max(2, Math.ceil((reach * reach) / 35))
    return {
      coords: [],
      actualKm: reach,
      totalDownstreamKm: 0,
      bbox,
      // No centreline to follow — the square is the only honest domain here.
      ring: null,
      domainAreaKm2: reach * reach,
      tileCountEstimate: tiles,
      estSolveTimeMin: Math.max(1, Math.round((reach * 0.07 + 1.0) * 10) / 10),
      endCoord: null,
    }
  }

  const rawCoords = path.coordinates
  let bestIdx = 0
  let minDist = Infinity
  for (let i = 0; i < rawCoords.length; i++) {
    const [cLon, cLat] = rawCoords[i]
    const d = geoDistanceKm(lon, lat, cLon, cLat)
    if (d < minDist) {
      minDist = d
      bestIdx = i
    }
  }

  const distForward = rawCoords.slice(bestIdx).reduce((acc, pt, i, arr) => {
    if (i === 0) return 0
    return acc + geoDistanceKm(arr[i - 1][0], arr[i - 1][1], pt[0], pt[1])
  }, 0)

  const distBackward = rawCoords.slice(0, bestIdx + 1).reduce((acc, pt, i, arr) => {
    if (i === 0) return 0
    return acc + geoDistanceKm(arr[i - 1][0], arr[i - 1][1], pt[0], pt[1])
  }, 0)

  const isForward = distForward >= distBackward || distForward >= reach * 0.4
  const downstreamSlice = isForward
    ? rawCoords.slice(bestIdx)
    : rawCoords.slice(0, bestIdx + 1).reverse()

  const totalDownstreamKm = Math.max(
    5,
    downstreamSlice.reduce((acc, pt, i, arr) => {
      if (i === 0) return 0
      return acc + geoDistanceKm(arr[i - 1][0], arr[i - 1][1], pt[0], pt[1])
    }, 0),
  )

  const sliced: [number, number][] = [[lon, lat]]
  let accumulatedKm = 0
  let lastPt: [number, number] = [lon, lat]

  for (const pt of downstreamSlice) {
    const segDist = geoDistanceKm(lastPt[0], lastPt[1], pt[0], pt[1])
    if (accumulatedKm + segDist <= reach || sliced.length <= 2) {
      sliced.push(pt)
      accumulatedKm += segDist
      lastPt = pt
    } else {
      const remaining = reach - accumulatedKm
      if (segDist > 0 && remaining > 0) {
        const ratio = remaining / segDist
        const interpLon = lastPt[0] + (pt[0] - lastPt[0]) * ratio
        const interpLat = lastPt[1] + (pt[1] - lastPt[1]) * ratio
        sliced.push([interpLon, interpLat])
        accumulatedKm += remaining
      }
      break
    }
  }

  const actualKm = Math.min(reach, Math.round(accumulatedKm * 10) / 10 || reach)
  const endCoord = sliced[sliced.length - 1] ?? null

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  for (const [pLon, pLat] of sliced) {
    if (pLon < minLon) minLon = pLon
    if (pLon > maxLon) maxLon = pLon
    if (pLat < minLat) minLat = pLat
    if (pLat > maxLat) maxLat = pLat
  }

  const padLon = 0.04
  const padLat = 0.035
  const bbox: [number, number, number, number] = [
    Math.round((minLon - padLon) * 1000) / 1000,
    Math.round((minLat - padLat) * 1000) / 1000,
    Math.round((maxLon + padLon) * 1000) / 1000,
    Math.round((maxLat + padLat) * 1000) / 1000,
  ]

  const widthKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)
  const heightKm = (bbox[3] - bbox[1]) * 111.32
  const envelopeAreaKm2 = Math.max(10, widthKm * heightKm)
  // The domain follows the river: buffered ring area, not the envelope the
  // meanders happen to span. The envelope stays only as a camera/fallback box.
  const ring = halfWidthKm != null && halfWidthKm > 0 ? bufferPathRing(sliced, halfWidthKm) : null
  const ringArea = ring && ring.length >= 4 ? ringAreaKm2(ring) : 0
  const domainAreaKm2 = ringArea > 0 ? ringArea : envelopeAreaKm2
  const tileCountEstimate = Math.max(1, Math.ceil(domainAreaKm2 / 35))
  const estSolveTimeMin = Math.max(1.0, Math.round((actualKm * 0.07 + 1.0) * 10) / 10)

  return {
    coords: sliced,
    actualKm,
    totalDownstreamKm: Math.round(totalDownstreamKm * 10) / 10,
    bbox,
    ring,
    domainAreaKm2: Math.round(domainAreaKm2 * 10) / 10,
    tileCountEstimate,
    estSolveTimeMin,
    endCoord,
  }
}

/**
 * The reach slider's own floor. Reach is a user choice and starts unset (0);
 * every consumer shows and draws the same effective value, so there is no
 * hidden constant behind the UI.
 */
export const MIN_REACH_KM = 5
export const effectiveReachKm = (reach_km: number) => Math.max(MIN_REACH_KM, reach_km)

/** Length in km of a domain's diagonal — the direction-independent measure
 *  of how big a domain the scenario was actually saved with. Accepts the
 *  legacy 4-number box or a polygon ring ([ring]). */
function aoiDiagonalKm(coords: number[] | number[][][] | undefined | null): number | null {
  if (!coords) return null
  let w: number
  let s: number
  let e: number
  let n: number
  if (Array.isArray(coords[0])) {
    const ring = (coords as number[][][])[0] ?? []
    const xs = ring.map((p) => p[0]).filter(Number.isFinite)
    const ys = ring.map((p) => p[1]).filter(Number.isFinite)
    if (xs.length === 0 || ys.length === 0) return null
    w = Math.min(...xs)
    e = Math.max(...xs)
    s = Math.min(...ys)
    n = Math.max(...ys)
  } else {
    if (coords.length !== 4) return null
    ;[w, s, e, n] = coords as number[]
  }
  if (![w, s, e, n].every((v) => Number.isFinite(v))) return null
  const midLat = (s + n) / 2
  const widthKm = (e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  const heightKm = (n - s) * 111.32
  const diag = Math.hypot(widthKm, heightKm)
  return diag > 0 ? diag : null
}

/**
 * The reach a saved run actually used.
 *
 *  1. `spec.reach_km` — frozen in by `toSpec` at save time (current schema).
 *  2. otherwise the diagonal of `spec.aoi`, the box the domain really was
 *     clipped to — this keeps pre-existing runs reporting the same extent as
 *     the polygon drawn on their map, instead of whatever the context happens
 *     to hold now.
 *  3. otherwise `null` and the caller falls back to live state.
 */
export function specReachKm(spec: ScenarioSpec | null | undefined): number | null {
  const direct = spec?.reach_km
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct
  return aoiDiagonalKm(spec?.aoi?.coords)
}

/** Reach to display for a screen that may or may not have a saved scenario. */
export function displayReachKm(
  spec: ScenarioSpec | null | undefined,
  fallback: number,
): number {
  return effectiveReachKm(specReachKm(spec) ?? fallback)
}

/** The whole point of the screen: one spec for all three cases. */
export function toSpec(
  s: BuildConfig,
  dam: DamRow | null,
  name: string,
  riverPath?: { coordinates: [number, number][] } | null,
  /**
   * Corridor half-width in km. The saved AOI is the reach buffered by this
   * width — a polygon that follows the river — so the DEM clip, the mesh and
   * the tile estimate cover the corridor, never the envelope rectangle.
   */
  bufferKm?: number | null,
): ScenarioSpec {
  const reachInfo = sliceDownstreamRiverPath(dam, riverPath, effectiveReachKm(s.reach_km), bufferKm)

  return {
    case: s.case,
    name,
    // The reach is part of the scenario, not a UI preference: without it every
    // downstream screen re-derives its own number from mutable context state.
    reach_km: effectiveReachKm(s.reach_km),
    // No domain AOI exists until the dam record carries coordinates.
    // The wire shape is a GeoJSON-style polygon (coords = [ring]); the shared
    // `Bbox` type still says number[] — every reader guards on length === 4, so
    // a ring (length 1) safely falls back instead of misreading points as a box.
    ...(reachInfo.ring && reachInfo.ring.length >= 4
      ? {
          aoi: {
            type: 'polygon' as const,
            crs: 'EPSG:4326',
            coords: [reachInfo.ring] as unknown as number[],
          },
        }
      : reachInfo.bbox
        ? {
            aoi: {
              type: 'bbox' as const,
              crs: 'EPSG:4326',
              coords: reachInfo.bbox,
            },
          }
        : {}),
    dam_type: s.damType,
    erodibility: s.erodibility,
    dam_id: dam?.id ?? null,
    engine: s.engine,
    hardware: s.hardware ?? 'gpu',
    breach: {
      mode: caseMode(s.case),
      method: s.method,
      width_m: s.width_m,
      depth_m: s.depth_m,
      chainage_m: s.chainage_m,
      side_slope: s.side_slope,
      formation_time_hr: s.formation_hr,
      timing: { instantaneous: s.case === '3' },
    },
    reservoir: {
      initial_level_m: s.level_m,
      crest_level_m: s.crest_m,
      bed_level_m: s.bed_m,
      dam_height_m: s.height_m,
      storage_mcm: s.storage_mcm,
      area_km2: s.area_km2,
      inflow_cms: s.inflow_cms,
    },
    horizon: { duration_hr: s.duration_hr, dt_s: s.dt_s },
    impact: {
      source: s.impactSource,
      population: s.population,
      houses: s.houses,
      assets_million: s.assets_million,
    },
  }
}

/** Estimated time from "simulation start" to the breach — every branch states
 *  the arithmetic it used, so nothing here is a guessed constant. */
export function timeToFailure(s: BuildConfig): { value: string; unit?: string; basis: string } {
  if (s.case === '3')
    return { value: 'T+0', basis: 'attack · breach.timing.instantaneous = true' }
  if (s.case === '1')
    return {
      value: s.formation_hr > 0 ? `≈ ${s.formation_hr}` : '—',
      unit: s.formation_hr > 0 ? 'hr' : undefined,
      basis: `emergent — onset is solved, then formation ≈ ${s.formation_hr || '—'} hr by ${s.method}`,
    }
  const head = s.crest_m - s.level_m
  if (s.inflow_cms <= 0)
    return { value: '—', basis: 'set an inflow — overtopping needs water coming in' }
  if (s.area_km2 > 0) {
    if (head <= 0) return { value: 'now', basis: 'level is already at crest — overtopping starts immediately' }
    const hours = (head * s.area_km2 * 1e6) / s.inflow_cms / 3600
    return {
      value: hours < 100 ? hours.toFixed(1) : Math.round(hours).toString(),
      unit: 'hr',
      basis: `${head.toFixed(1)} m of head × ${s.area_km2} km² ÷ ${s.inflow_cms} m³/s (level rises at constant area)`,
    }
  }
  if (s.storage_mcm > 0) {
    const hours = (s.storage_mcm * 1e6) / s.inflow_cms / 3600
    return {
      value: hours < 100 ? hours.toFixed(1) : Math.round(hours).toString(),
      unit: 'hr',
      basis: `${s.storage_mcm} MCM ÷ ${s.inflow_cms} m³/s — set reservoir area for a level-based number`,
    }
  }
  return { value: '—', basis: 'set reservoir area (km²) or storage (MCM) to estimate the fill time' }
}

function circlePolygon(lon: number, lat: number, radiusKm: number) {
  const dLat = radiusKm / 111.32
  const dLon = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05))
  const ring: number[][] = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: 'Polygon' as const, coordinates: [ring] }
}

/** Config overlays for the BUILD page:
 *  Shows the upstream reservoir water spread, active downstream river flood reach,
 *  reach terminus marker, and breach location.
 *
 *  The simulation domain ring is NOT here — it is global (see
 *  `useDomainRingFeature`, mounted by every map shell from context alone), so
 *  no page has to remember to draw it.
 */
export function buildOverlays(
  s: BuildConfig,
  dam: { id: string; name?: string; lon?: number | null; lat?: number | null } | null,
  riverPath?: { coordinates: [number, number][] } | null,
  /** Corridor half-width in km — the domain ring follows the river at this width. */
  bufferKm?: number | null,
): MapFeature[] {
  const out: MapFeature[] = []
  const id = dam?.id ?? s.damId ?? null
  const name = dam?.name ?? null
  // No coordinates from the registry → no overlay. A guessed dam position is
  // worse than no dam marker.
  if (typeof dam?.lon !== 'number' || typeof dam?.lat !== 'number') return out
  const lon = dam.lon
  const lat = dam.lat

  const reachKm = effectiveReachKm(s.reach_km)
  const reachInfo =
    reachKm > 0 ? sliceDownstreamRiverPath(dam, riverPath, reachKm, bufferKm) : null

  // 1. Upstream Reservoir Footprint — only when the dam record carries storage.
  const resArea = s.area_km2 > 0 ? s.area_km2 : 0
  if (resArea > 0) {
    out.push({
      id: 'build-reservoir',
      label: `Reservoir footprint (≈ ${resArea.toFixed(1)} km²)`,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: `${name} Reservoir`, area_km2: resArea },
            geometry: circlePolygon(lon, lat, Math.sqrt(resArea / Math.PI)),
          },
        ],
      },
      kind: 'fill',
      color: '#2e90fa',
      fillOpacity: 0.16,
      dasharray: [4, 3],
    })
  }

  // 2. Active Selected Downstream River Flood Path
  if (reachInfo && reachInfo.coords.length >= 2) {
    out.push({
      id: 'build-downstream-reach',
      label: `Active Flood Path (${reachInfo.actualKm} km downstream)`,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Active Downstream Flood Reach' },
            geometry: {
              type: 'LineString',
              coordinates: reachInfo.coords,
            },
          },
        ],
      },
      kind: 'line',
      color: '#00e5ff',
      width: 5,
    })
  }

  // 3. Reach Terminus Marker
  if (reachInfo?.endCoord) {
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
            geometry: {
              type: 'Point',
              coordinates: reachInfo.endCoord,
            },
          },
        ],
      },
      kind: 'circle',
      color: '#00e5ff',
      radius: 8,
    })
  }

  // 5. Breach Location Marker
  out.push({
    id: 'build-breach',
    label: s.width_m > 0 ? `Breach notch (≈ ${s.width_m.toFixed(1)} m wide)` : `Breach location (${name})`,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id, name },
          geometry: { type: 'Point', coordinates: [lon, lat] },
        },
      ],
    },
    kind: 'circle',
    color: '#d81b9b',
    radius: 11,
  })

  return out
}

export function buildLegend(s: BuildConfig, reachActualKm?: number): LegendItem[] {
  const out: LegendItem[] = []
  const resArea = s.area_km2 > 0 ? s.area_km2 : 0
  if (resArea > 0)
    out.push({
      id: 'build-reservoir',
      label: `Reservoir (≈ ${resArea.toFixed(1)} km²)`,
      color: '#2e90fa',
      dashed: true,
    })
  if (reachActualKm != null && reachActualKm > 0)
    out.push({
      id: 'build-downstream-reach',
      label: `Active Flood Path (${reachActualKm} km)`,
      color: '#00e5ff',
    })
  // No domain row: the global ring carries its own legend entry (MapShell
  // derives it from the feature), so pages never list it twice.
  out.push({
    id: 'build-breach',
    label: s.width_m > 0 ? `Breach (${s.width_m.toFixed(1)} m)` : 'Breach point',
    color: '#d81b9b',
  })
  return out
}

/**
 * The GLOBAL domain ring. Reads only the mission context — river, dam, draft
 * reach, corridor width — plus the shared river-path cache entry. No props, no
 * page knowledge: every map shell mounts this, so the amber study domain is
 * identical on Discover, Build, Run, Results and Compare without any page
 * wiring it in. null until the context carries a dam with coordinates.
 */
export function useDomainRingFeature(): MapFeature | null {
  const riverId = useRiverContext((st) => st.river?.id ?? null)
  const damId = useRiverContext((st) => st.river?.damId ?? null)
  const damLon = useRiverContext((st) => st.river?.damLon ?? null)
  const damLat = useRiverContext((st) => st.river?.damLat ?? null)
  const bufferOverride = useRiverContext((st) => st.river?.bufferKm ?? null)
  const lengthKm = useRiverContext((st) => st.river?.lengthKm ?? null)
  const reachKm = useBuildConfig((st) => st.reach_km)

  // Shared cache keys — the same entries Discover and Build already fetch.
  const riverDetail = useApi(['river', riverId], () => api.river(riverId!), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
  })

  const dam =
    damId && typeof damLon === 'number' && typeof damLat === 'number'
      ? { lon: damLon, lat: damLat }
      : null
  // Same corridor-width default Discover's slider uses.
  const bufferKm =
    bufferOverride ?? (lengthKm ? Math.min(50, Math.max(5, Math.round(lengthKm * 0.01))) : 20)
  const reachInfo =
    dam != null
      ? sliceDownstreamRiverPath(dam, riverDetail.data?.path, effectiveReachKm(reachKm), bufferKm)
      : null
  const ring = reachInfo?.ring
  if (!reachInfo || !ring || ring.length < 4) return null
  return {
    id: 'build-domain',
    label: `Domain AOI (${reachInfo.tileCountEstimate} tiles · ${reachInfo.actualKm} km reach · follows river)`,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Simulation Domain Reach' },
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        },
      ],
    },
    kind: 'fill',
    color: '#e8930c',
    fillOpacity: 0.08,
    dasharray: [4, 3],
  }
}

/** Null when the registry carries no coordinates — no camera guess. */
export function damFit(dam: { id?: string; lon?: number | null; lat?: number | null } | null): number[] | null {
  if (typeof dam?.lon !== 'number' || typeof dam?.lat !== 'number') return null
  return [dam.lon - 0.07, dam.lat - 0.05, dam.lon + 0.07, dam.lat + 0.05]
}

