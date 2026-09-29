import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { INFRA_COLORS, infraDepthAt, tiles } from '../lib/api'
import type { InfraExposure, RampStop, RunInfra, Terrain3D } from '../lib/api'

/* ------------------------------------------------------------------ tiles */

const WORLD = 600
const TILE_PX = 256
const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const GOOGLE_TILES = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'

function mercX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z
}

function mercY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

function mercYInv(y: number, z: number) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z)
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI
}

function lonToTile(lon: number, z: number) {
  return Math.floor(mercX(lon, z))
}

function latToTile(lat: number, z: number) {
  return Math.floor(mercY(lat, z))
}

interface TileWin {
  z: number
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Highest zoom whose tile window stays within `limit` tiles. */
function tileWindow(bbox: [number, number, number, number], limit = 8): TileWin {
  for (let z = 14; z >= 8; z--) {
    const x0 = lonToTile(bbox[0], z)
    const x1 = lonToTile(bbox[2], z)
    const y0 = latToTile(bbox[3], z)
    const y1 = latToTile(bbox[1], z)
    if (x1 - x0 + 1 <= limit && y1 - y0 + 1 <= limit * 2) return { z, x0, x1, y0, y1 }
  }
  const z = 10
  return {
    z,
    x0: lonToTile(bbox[0], z),
    x1: lonToTile(bbox[2], z),
    y0: latToTile(bbox[3], z),
    y1: latToTile(bbox[1], z),
  }
}

function loadImage(src: string, timeoutMs = 15000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const done = (ok: boolean) => resolve(ok ? img : null)
    const timer = window.setTimeout(() => done(false), timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      done(true)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      done(false)
    }
    img.src = src
  })
}

/** One depth-tile PNG as an ImageBitmap via same-origin fetch (never taints). */
async function loadTileBitmap(url: string, timeoutMs = 15000): Promise<ImageBitmap | null> {
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    window.clearTimeout(timer)
    if (!res.ok) return null
    const blob = await res.blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

/** Satellite mosaic cropped to the exact model bbox (Mercator pixel rect). */
async function loadImagery(
  bbox: [number, number, number, number],
): Promise<{ canvas: HTMLCanvasElement; z: number; yf0: number; yf1: number } | null> {
  const win = tileWindow(bbox, 8)
  const cols = win.x1 - win.x0 + 1
  const rows = win.y1 - win.y0 + 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(4096, cols * TILE_PX)
  canvas.height = Math.min(4096, rows * TILE_PX)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#8fa3b0'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const tileW = canvas.width / cols
  const tileH = canvas.height / rows
  const jobs: Promise<void>[] = []
  for (let x = win.x0; x <= win.x1; x++) {
    for (let y = win.y0; y <= win.y1; y++) {
      const cx = (x - win.x0) * tileW
      const cy = (y - win.y0) * tileH
      const primary = ESRI_TILES.replace('{z}', String(win.z))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
      const fallback = GOOGLE_TILES.replace('{z}', String(win.z))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
      jobs.push(
        (async () => {
          const img = (await loadImage(primary)) ?? (await loadImage(fallback))
          if (img) ctx.drawImage(img, cx, cy, tileW, tileH)
        })(),
      )
    }
  }
  await Promise.all(jobs)
  // Crop to the exact bbox rect so the texture maps 1:1 in u.
  const xf0 = mercX(bbox[0], win.z)
  const xf1 = mercX(bbox[2], win.z)
  const yf0 = mercY(bbox[3], win.z)
  const yf1 = mercY(bbox[1], win.z)
  const left = Math.max(0, Math.floor((xf0 - win.x0) * TILE_PX * (canvas.width / (cols * TILE_PX))))
  const top = Math.max(0, Math.floor((yf0 - win.y0) * TILE_PX * (canvas.height / (rows * TILE_PX))))
  const right = Math.min(
    canvas.width,
    Math.ceil((xf1 - win.x0) * TILE_PX * (canvas.width / (cols * TILE_PX))),
  )
  const bottom = Math.min(
    canvas.height,
    Math.ceil((yf1 - win.y0) * TILE_PX * (canvas.height / (rows * TILE_PX))),
  )
  if (right - left < 4 || bottom - top < 4) return { canvas, z: win.z, yf0, yf1 }
  const cropped = document.createElement('canvas')
  cropped.width = right - left
  cropped.height = bottom - top
  const cctx = cropped.getContext('2d')
  if (!cctx) return { canvas, z: win.z, yf0, yf1 }
  cctx.drawImage(canvas, left, top, right - left, bottom - top, 0, 0, cropped.width, cropped.height)
  return { canvas: cropped, z: win.z, yf0, yf1 }
}

/* ------------------------------------------------------------------- ramp */

interface RampLUT {
  vs: number[]
  cols: [number, number, number][]
}

function parseHex(c: string): [number, number, number] {
  const h = c.startsWith('#') ? c.slice(1) : c
  const n = parseInt(h.length === 3 ? h.split('').map((d) => d + d).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function buildLUT(stops: RampStop[]): RampLUT | null {
  if (!stops || stops.length < 2) return null
  const rows = [...stops].sort((a, b) => a.v - b.v)
  return { vs: rows.map((r) => r.v), cols: rows.map((r) => parseHex(r.color)) }
}

/** Invert the server-painted RGB back to a depth in metres (piecewise-linear ramp). */
function depthFromRGB(r: number, g: number, b: number, lut: RampLUT): number {
  let best = Infinity
  let out = 0
  for (let k = 0; k < lut.cols.length - 1; k++) {
    const a = lut.cols[k]
    const c = lut.cols[k + 1]
    const abx = c[0] - a[0]
    const aby = c[1] - a[1]
    const abz = c[2] - a[2]
    const len2 = abx * abx + aby * aby + abz * abz
    let t = len2 > 0 ? ((r - a[0]) * abx + (g - a[1]) * aby + (b - a[2]) * abz) / len2 : 0
    t = Math.min(1, Math.max(0, t))
    const dx = r - (a[0] + abx * t)
    const dy = g - (a[1] + aby * t)
    const dz = b - (a[2] + abz * t)
    const err = dx * dx + dy * dy + dz * dz
    if (err < best) {
      best = err
      out = lut.vs[k] + (lut.vs[k + 1] - lut.vs[k]) * t
    }
  }
  return out
}

/** Forward direction: depth in metres → display colour. */
function colorForDepth(d: number, lut: RampLUT): [number, number, number] {
  const { vs, cols } = lut
  if (d <= vs[0]) return cols[0]
  for (let k = 0; k < vs.length - 1; k++) {
    if (d <= vs[k + 1]) {
      const span = Math.max(1e-9, vs[k + 1] - vs[k])
      const t = (d - vs[k]) / span
      const a = cols[k]
      const c = cols[k + 1]
      return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]
    }
  }
  return cols[cols.length - 1]
}

/* ------------------------------------------------------------------ scene */

export interface SceneDam {
  name: string
  lon: number
  lat: number
  height_m?: number | null
  crest_length_m?: number | null
  heading_deg?: number | null
}

export interface SceneOptions {
  terrainExag: number
  waterExag: number
  waterOpacity: number
  showTerrain: boolean
  showDam: boolean
  showWater: boolean
  showVillages: boolean
  showCascade: boolean
  showInfra: boolean
}

/* OSM infrastructure colours: dry → submerged (depth-graded) → flooded earlier. */
const INFRA_DRY_BUILDING = new THREE.Color(INFRA_COLORS.dryBuilding)
const INFRA_DRY_ROAD = new THREE.Color(INFRA_COLORS.dryRoad)
const INFRA_DRY_POINT = new THREE.Color(INFRA_COLORS.dryPoint)
const INFRA_WAS = new THREE.Color(INFRA_COLORS.was)
const INFRA_WET_LO = new THREE.Color(INFRA_COLORS.wetLo)
const INFRA_WET_HI = new THREE.Color(INFRA_COLORS.wetHi)

/** Colour of one feature at frame i: depth over `thr` → orange→dark red by
 *  depth (3 m+ saturates); past its wet window → amber; otherwise `dry`. */
function infraColor(f: InfraExposure, i: number, thr: number, dry: THREE.Color, out: THREE.Color) {
  const d = infraDepthAt(f, i)
  if (d != null && d > thr) return out.copy(INFRA_WET_LO).lerp(INFRA_WET_HI, Math.min(1, d / 3))
  if (f.f0 != null && i >= f.f0) return out.copy(INFRA_WAS)
  return out.copy(dry)
}

/** Water surface colouring: true depth, modelled arrival (h), or peak velocity (m/s). */
export type WaterColorMode = 'depth' | 'arrival' | 'velocity'

export type OverlayStatus = 'loading' | 'ready' | 'no-tiles' | 'no-ramp'

/** One affected village — geometry + modelled values from hazard-villages. */
export interface SceneVillage {
  name: string
  lon: number
  lat: number
  hazard: string
  depth_m?: number | null
  arrival_hr?: number | null
  population?: number | null
}

/** Marker colours by modelled hazard class (display only). */
export const HAZARD_COLORS: Record<string, string> = {
  HIGH: '#b42318',
  MODERATE: '#dd6b20',
  LOW: '#0b6bcb',
}

/** One screened dam pin — cascade status from POST /runs/{id}/cascade. */
export interface SceneCascadeDam {
  id: string
  name: string
  lon: number
  lat: number
  status: string
}

/** Pin colours by cascade screening flag (display only). */
export const CASCADE_COLORS: Record<string, string> = {
  overtopped: '#b42318',
  exposed: '#dd6b20',
  'exposed-unknown-geometry': '#b58900',
}

export type FrameWaterStatus = 'no-domain' | 'no-tiles' | 'dry' | 'wet'
export interface FrameWaterResult {
  status: FrameWaterStatus
  wet: number
  total: number
}

interface Grid {
  bbox: [number, number, number, number]
  nR: number
  nC: number
  /** True elevation in metres, row-major (rows[0] = north). NaN when no DEM. */
  elev: Float32Array
  elevMin: number
  hasTerrain: boolean
}

function geoWidthMetres(bbox: [number, number, number, number]): number {
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  return Math.max(100, (bbox[2] - bbox[0]) * 111320 * Math.cos(midLat))
}

/** Round soft-edged sprite for SPH particles, built once. */
let spriteTex: THREE.Texture | null = null
function particleSprite(): THREE.Texture {
  if (spriteTex) return spriteTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  spriteTex = new THREE.CanvasTexture(c)
  return spriteTex
}

/** One SPH output frame: flat [col, row, z m, speed m/s, …] on the solve grid. */
export interface SceneParticles {
  data: number[]
  l0_m: number
}

export class PlayerScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private ro: ResizeObserver | null = null
  private raf = 0
  private raycaster = new THREE.Raycaster()

  private terrainMesh: THREE.Mesh | null = null
  private terrainMat: THREE.MeshStandardMaterial | null = null
  private waterMesh: THREE.Mesh | null = null
  private waterMat: THREE.MeshStandardMaterial | null = null
  private damGroup: THREE.Group | null = null
  private villageGroup: THREE.Group | null = null
  private villageSelected: THREE.Mesh | null = null
  private villages: SceneVillage[] = []
  private cascadeGroup: THREE.Group | null = null
  private cascadeSelected: THREE.Mesh | null = null
  private cascadeDams: SceneCascadeDam[] = []
  private pickMarker: THREE.Mesh | null = null
  private hitPlane: THREE.Mesh | null = null

  private grid: Grid | null = null
  /** terrain.json row/col stride over the solve grid (1 for detail=full). */
  private gridStep = 1
  /** SPH particles for the current frame; when set they replace the depth surface. */
  private particles: THREE.Points | null = null
  private particleData: SceneParticles | null = null
  /** OSM roads/buildings/bridges, recoloured per frame from their exposure. */
  private infra: RunInfra | null = null
  private infraFrame = 0
  private infraGroup: THREE.Group | null = null
  private infraBuildings: THREE.InstancedMesh | null = null
  private infraRoads: THREE.LineSegments | null = null
  private infraPoints: THREE.InstancedMesh | null = null
  private horizM = WORLD / 26000
  private depthArr: Float32Array | null = null
  private lut: RampLUT | null = null
  private colorMode: WaterColorMode = 'depth'
  private overlayLUTs: Partial<Record<'arrival' | 'velocity', RampLUT>> = {}
  private overlayData: Partial<Record<'arrival' | 'velocity', Float32Array>> = {}
  private overlayStat: Partial<Record<'arrival' | 'velocity', OverlayStatus>> = {}
  private runId: string | null = null
  private frameToken = 0
  private overlayToken = 0
  private imageryToken = 0
  private imgGeo: { z: number; yf0: number; yf1: number } | null = null
  private dam: SceneDam | null = null
  private opts: SceneOptions
  onPick: ((lon: number, lat: number) => void) | null = null
  onVillage: ((v: SceneVillage) => void) | null = null
  onCascadeDam: ((d: SceneCascadeDam) => void) | null = null
  onOverlayState: ((kind: 'arrival' | 'velocity', status: OverlayStatus) => void) | null = null
  private downPos: { x: number; y: number } | null = null

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container
    this.opts = { ...opts }
    const w = container.clientWidth || 800
    const h = container.clientHeight || 600

    this.scene.background = new THREE.Color('#dfe7f1')
    this.scene.fog = new THREE.FogExp2('#dfe7f1', 0.00035)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.5, 8000)
    this.camera.position.set(-160, 200, 320)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.minDistance = 10
    this.controls.maxDistance = 3000

    this.scene.add(new THREE.AmbientLight('#ffffff', 0.85))
    const sun = new THREE.DirectionalLight('#fffbeb', 1.6)
    sun.position.set(250, 480, 220)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.bias = -0.0001
    sun.shadow.camera.left = -380
    sun.shadow.camera.right = 380
    sun.shadow.camera.top = 380
    sun.shadow.camera.bottom = -380
    sun.shadow.camera.far = 2500
    this.scene.add(sun)
    this.scene.add(new THREE.HemisphereLight('#bae6fd', '#cbd5e1', 0.5))

    // Invisible pick plane at base height — clicks that miss both meshes.
    const hitGeo = new THREE.PlaneGeometry(WORLD, WORLD)
    hitGeo.rotateX(-Math.PI / 2)
    this.hitPlane = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }))
    this.hitPlane.position.y = 0
    this.scene.add(this.hitPlane)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY }
    })
    canvas.addEventListener('pointerup', (e) => {
      if (!this.downPos || !this.grid) return
      const dx = e.clientX - this.downPos.x
      const dy = e.clientY - this.downPos.y
      this.downPos = null
      if (dx * dx + dy * dy > 36) return
      const cascade = this.cascadeHit(e)
      if (cascade && this.onCascadeDam) {
        this.onCascadeDam(cascade)
        return
      }
      const village = this.villageHit(e)
      if (village && this.onVillage) {
        this.onVillage(village)
        return
      }
      if (!this.onPick) return
      const ll = this.pick(e)
      if (ll) this.onPick(ll.lon, ll.lat)
    })

    this.ro = new ResizeObserver(() => {
      const cw = container.clientWidth || 1
      const ch = container.clientHeight || 1
      this.camera.aspect = cw / ch
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(cw, ch)
    })
    this.ro.observe(container)

    const animate = () => {
      this.raf = requestAnimationFrame(animate)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    animate()
  }

  /* ------------------------------------------------------------ data in */

  setRun(runId: string | null) {
    if (this.runId === runId) return
    this.runId = runId
    this.depthArr = null
    this.overlayData = {}
    this.overlayStat = {}
    this.colorMode = 'depth'
    this.setVillages([])
    this.setParticles(null)
    this.setInfrastructure(null)
    this.paintWater()
  }

  setRamp(stops: RampStop[] | null | undefined) {
    this.lut = stops?.length ? buildLUT(stops) : null
    if (this.depthArr) this.paintWater()
  }

  /** Build terrain + water shells for the domain. `terrain` null → flat plane. */
  setGrid(terrain: Terrain3D | null, bbox: [number, number, number, number] | null) {
    // Tear down previous shells.
    for (const m of [this.terrainMesh, this.waterMesh]) {
      if (m) {
        this.scene.remove(m)
        m.geometry.dispose()
      }
    }
    this.terrainMat?.dispose()
    this.waterMat?.dispose()
    this.terrainMat = null
    this.waterMat = null
    if (this.villageGroup) {
      this.scene.remove(this.villageGroup)
      this.villageGroup = null
    }
    this.villageSelected = null
    if (this.cascadeGroup) {
      this.scene.remove(this.cascadeGroup)
      this.cascadeGroup = null
    }
    this.cascadeSelected = null
    this.terrainMesh = null
    this.waterMesh = null
    this.depthArr = null
    this.overlayData = {}
    this.overlayStat = {}
    if (!bbox) {
      this.grid = null
      return
    }
    const rows = terrain?.rows
    const hasT = Boolean(rows?.length && rows[0]?.length && terrain?.bounds?.length === 4)
    const nR = hasT ? rows!.length : 96
    const nC = hasT ? rows![0].length : 96
    const elev = new Float32Array(nR * nC)
    let emin = Infinity
    if (hasT) {
      for (let r = 0; r < nR; r++) {
        for (let c = 0; c < nC; c++) {
          const v = Number(rows![r]?.[c])
          elev[r * nC + c] = Number.isFinite(v) ? v : NaN
          if (Number.isFinite(v) && v < emin) emin = v
        }
      }
    } else {
      elev.fill(0)
      emin = 0
    }
    if (!Number.isFinite(emin)) emin = 0
    this.grid = { bbox, nR, nC, elev, elevMin: emin, hasTerrain: hasT }
    this.gridStep = hasT ? Math.max(1, terrain?.step ?? 1) : 1
    this.horizM = WORLD / geoWidthMetres(bbox)

    const tGeo = new THREE.PlaneGeometry(WORLD, WORLD, nC - 1, nR - 1)
    tGeo.rotateX(-Math.PI / 2)
    this.terrainMat = new THREE.MeshStandardMaterial({
      color: '#9fb3a8',
      roughness: 1,
      metalness: 0,
    })
    const tMesh = new THREE.Mesh(tGeo, this.terrainMat)
    tMesh.receiveShadow = true
    tMesh.visible = this.opts.showTerrain
    this.scene.add(tMesh)
    this.terrainMesh = tMesh

    const wGeo = new THREE.PlaneGeometry(WORLD, WORLD, nC - 1, nR - 1)
    wGeo.rotateX(-Math.PI / 2)
    this.waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.opts.waterOpacity,
      roughness: 0.3,
      metalness: 0,
    })
    const wMesh = new THREE.Mesh(wGeo, this.waterMat)
    wMesh.visible = this.opts.showWater
    this.scene.add(wMesh)
    this.waterMesh = wMesh
    this.applyHeights()
    this.rebuildDam()
    this.rebuildVillages()
    this.rebuildCascade()
    this.rebuildInfra()
    // Overlays are grid-aligned — reload the active one for the new shell.
    if (this.colorMode !== 'depth') void this.loadOverlay(this.colorMode)
    void this.loadImagery(bbox)
    // particles are placed on the grid — re-seat them on the new shell
    this.setParticles(this.particleData)
  }

  setDam(dam: SceneDam | null) {
    this.dam =
      dam && Number.isFinite(dam.lon) && Number.isFinite(dam.lat) ? { ...dam } : null
    this.rebuildDam()
  }

  setOptions(opts: Partial<SceneOptions>) {
    const prev = this.opts
    this.opts = { ...this.opts, ...opts }
    if (this.terrainMesh) this.terrainMesh.visible = this.opts.showTerrain
    if (this.damGroup) this.damGroup.visible = this.opts.showDam
    if (this.waterMesh) this.waterMesh.visible = this.opts.showWater && !this.particles
    if (this.particles) {
      this.particles.visible = this.opts.showWater
      ;(this.particles.material as THREE.PointsMaterial).opacity = this.opts.waterOpacity
    }
    if (this.villageGroup) this.villageGroup.visible = this.opts.showVillages
    if (this.cascadeGroup) this.cascadeGroup.visible = this.opts.showCascade
    if (this.infraGroup) this.infraGroup.visible = this.opts.showInfra
    if (this.waterMat) this.waterMat.opacity = this.opts.waterOpacity
    if (
      this.grid &&
      (prev.terrainExag !== this.opts.terrainExag || prev.waterExag !== this.opts.waterExag)
    ) {
      this.applyHeights()
      if (this.particleData) this.setParticles(this.particleData)
    }
  }

  /** OSM infrastructure for the run (null clears it). */
  setInfrastructure(doc: RunInfra | null) {
    this.infra = doc
    this.rebuildInfra()
  }

  /** Recolour infrastructure for output frame i — no geometry rebuild. */
  setInfraFrame(i: number) {
    this.infraFrame = i
    this.paintInfra()
  }

  private clearInfra() {
    if (!this.infraGroup) return
    this.scene.remove(this.infraGroup)
    this.infraGroup.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | undefined
      mat?.dispose()
    })
    this.infraGroup = null
    this.infraBuildings = null
    this.infraRoads = null
    this.infraPoints = null
  }

  private rebuildInfra() {
    this.clearInfra()
    const grid = this.grid
    const doc = this.infra
    if (!grid || !doc) return
    const g = new THREE.Group()
    const exag = this.opts.terrainExag
    const dummy = new THREE.Object3D()

    // Buildings: footprint-sized blocks (≥ ~25 m so they read at valley scale)
    const bs = doc.buildings
      .map((b) => ({ b, p: this.lonLatToWorld(b.x, b.y) }))
      .filter((o): o is { b: (typeof doc.buildings)[number]; p: { x: number; y: number; z: number } } => o.p != null)
    if (bs.length) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }),
        bs.length,
      )
      bs.forEach(({ b, p }, i) => {
        const side = Math.max(b.a * this.horizM, 0.9)
        const h = Math.max(12 * this.horizM * exag, 0.8)
        dummy.position.set(p.x, p.y + h / 2, p.z)
        dummy.scale.set(side, h, side)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, INFRA_DRY_BUILDING)
      })
      mesh.userData.items = bs.map((o) => o.b)
      this.infraBuildings = mesh
      g.add(mesh)
    }

    // Roads: segments draped just above the terrain
    const segs = doc.roads
      .map((r) => ({ r, a: this.lonLatToWorld(r.p[0], r.p[1]), b: this.lonLatToWorld(r.p[2], r.p[3]) }))
      .filter((o) => o.a && o.b)
    if (segs.length) {
      const pos = new Float32Array(segs.length * 6)
      const lift = 0.5 * exag
      segs.forEach(({ a, b }, i) => {
        pos.set([a!.x, a!.y + lift, a!.z, b!.x, b!.y + lift, b!.z], i * 6)
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs.length * 6), 3))
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
      lines.userData.items = segs.map((o) => o.r)
      this.infraRoads = lines
      g.add(lines)
    }

    // Bridges / hospitals / schools: small upright markers
    const ps = doc.points
      .map((pt) => ({ pt, p: this.lonLatToWorld(pt.x, pt.y) }))
      .filter((o): o is { pt: (typeof doc.points)[number]; p: { x: number; y: number; z: number } } => o.p != null)
    if (ps.length) {
      const mesh = new THREE.InstancedMesh(
        new THREE.OctahedronGeometry(1.4),
        new THREE.MeshStandardMaterial({ roughness: 0.5 }),
        ps.length,
      )
      ps.forEach(({ p }, i) => {
        dummy.position.set(p.x, p.y + 3, p.z)
        dummy.scale.set(1, 1.4, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, INFRA_DRY_POINT)
      })
      mesh.userData.items = ps.map((o) => o.pt)
      this.infraPoints = mesh
      g.add(mesh)
    }

    g.visible = this.opts.showInfra
    this.infraGroup = g
    this.scene.add(g)
    this.paintInfra()
  }

  private paintInfra() {
    const doc = this.infra
    if (!doc) return
    const i = this.infraFrame
    const c = new THREE.Color()
    const { building_m: bThr, road_cut_m: rThr } = doc.thresholds
    const bm = this.infraBuildings
    if (bm) {
      const items = bm.userData.items as InfraExposure[]
      items.forEach((f, k) => bm.setColorAt(k, infraColor(f, i, bThr, INFRA_DRY_BUILDING, c)))
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true
    }
    const rl = this.infraRoads
    if (rl) {
      const items = rl.userData.items as InfraExposure[]
      const col = rl.geometry.getAttribute('color') as THREE.BufferAttribute
      items.forEach((f, k) => {
        infraColor(f, i, rThr, INFRA_DRY_ROAD, c)
        col.setXYZ(k * 2, c.r, c.g, c.b)
        col.setXYZ(k * 2 + 1, c.r, c.g, c.b)
      })
      col.needsUpdate = true
    }
    const pm = this.infraPoints
    if (pm) {
      const items = pm.userData.items as InfraExposure[]
      items.forEach((f, k) => pm.setColorAt(k, infraColor(f, i, bThr, INFRA_DRY_POINT, c)))
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true
    }
  }

  /** Draw SPH particles (null clears them and brings the depth surface back).
   *  Each particle sits at its solved position; colour runs pale → deep blue
   *  with speed (0 → 25 m/s, the solver's velocity cap). */
  setParticles(p: SceneParticles | null) {
    this.particleData = p
    if (this.particles) {
      this.scene.remove(this.particles)
      this.particles.geometry.dispose()
      ;(this.particles.material as THREE.Material).dispose()
      this.particles = null
    }
    const grid = this.grid
    if (grid && p && p.data.length >= 4) {
      const n = Math.floor(p.data.length / 4)
      const pos = new Float32Array(n * 3)
      const col = new Float32Array(n * 3)
      const segW = WORLD / (grid.nC - 1)
      const segH = WORLD / (grid.nR - 1)
      const s = this.gridStep
      for (let i = 0; i < n; i++) {
        const c = p.data[i * 4] / s
        const r = p.data[i * 4 + 1] / s
        const zM = p.data[i * 4 + 2]
        const t = Math.min(1, Math.max(0, p.data[i * 4 + 3] / 25))
        pos[i * 3] = c * segW - WORLD / 2
        pos[i * 3 + 1] = (zM - grid.elevMin) * this.horizM * this.opts.terrainExag
        pos[i * 3 + 2] = -WORLD / 2 + r * segH
        // slow = light water blue, fast (25 m/s) = deep blue
        col[i * 3] = 0.3 - 0.26 * t
        col[i * 3 + 1] = 0.66 - 0.44 * t
        col[i * 3 + 2] = 1.0 - 0.22 * t
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const mat = new THREE.PointsMaterial({
        // a particle is a water cube of side l0; drawn ~2× so neighbours merge
        // into a body of water instead of reading as separate dots
        size: Math.max(p.l0_m * this.horizM * 2.2, 1.2),
        sizeAttenuation: true,
        vertexColors: true,
        map: particleSprite(),
        alphaTest: 0.05,
        transparent: true,
        opacity: this.opts.waterOpacity,
        depthWrite: false,
        fog: false,
      })
      this.particles = new THREE.Points(geo, mat)
      this.particles.visible = this.opts.showWater
      this.scene.add(this.particles)
    }
    if (this.waterMesh) this.waterMesh.visible = this.opts.showWater && !this.particles
  }

  /** Water colouring: true depth, modelled arrival (h), or peak velocity (m/s). */
  setColorMode(mode: WaterColorMode) {
    if (this.colorMode === mode) {
      if (mode === 'depth' || this.overlayData[mode]) this.paintWater()
      else void this.loadOverlay(mode)
      return
    }
    this.colorMode = mode
    if (mode === 'depth' || this.overlayData[mode]) {
      this.paintWater()
      return
    }
    void this.loadOverlay(mode)
  }

  /** Server ramp for an overlay kind — triggers the load once both halves exist. */
  setOverlayRamp(kind: 'arrival' | 'velocity', stops: RampStop[] | null | undefined) {
    this.overlayLUTs[kind] = stops?.length ? buildLUT(stops) ?? undefined : undefined
    if (this.colorMode === kind && !this.overlayData[kind]) void this.loadOverlay(kind)
    else this.paintWater()
  }

  overlayStatus(kind: 'arrival' | 'velocity'): OverlayStatus {
    return this.overlayStat[kind] ?? 'loading'
  }

  /** Static per-run mosaic (arrival hours / peak m/s) sampled onto the grid. */
  private async loadOverlay(kind: 'arrival' | 'velocity'): Promise<void> {
    const my = ++this.overlayToken
    const lut = this.overlayLUTs[kind]
    if (!lut) {
      this.overlayStat[kind] = 'no-ramp'
      this.onOverlayState?.(kind, 'no-ramp')
      return
    }
    this.overlayStat[kind] = 'loading'
    this.onOverlayState?.(kind, 'loading')
    const loaded = await this.loadKindPixels(kind, null)
    if (my !== this.overlayToken) return
    if (!loaded) {
      this.overlayStat[kind] = 'no-tiles'
      this.onOverlayState?.(kind, 'no-tiles')
      if (this.colorMode === kind) this.paintWater()
      return
    }
    const grid = this.grid!
    const { img, win } = loaded
    const { nR, nC, bbox } = grid
    const yf0 = mercY(bbox[3], win.z)
    const yf1 = mercY(bbox[1], win.z)
    const W = img.width
    const H = img.height
    const data = img.data
    const vals = new Float32Array(nR * nC)
    for (let r = 0; r < nR; r++) {
      const lat = bbox[3] - (r / (nR - 1)) * (bbox[3] - bbox[1])
      const fy = (mercY(lat, win.z) - yf0) / Math.max(1e-9, yf1 - yf0)
      const py = Math.min(H - 1, Math.max(0, Math.round(fy * (H - 1))))
      for (let c = 0; c < nC; c++) {
        const lon = bbox[0] + (c / (nC - 1)) * (bbox[2] - bbox[0])
        const px = Math.min(W - 1, Math.max(0, Math.round(((lon - bbox[0]) / (bbox[2] - bbox[0])) * (W - 1))))
        const o = (py * W + px) * 4
        vals[r * nC + c] = data[o + 3] >= 128 ? depthFromRGB(data[o], data[o + 1], data[o + 2], lut) : NaN
      }
    }
    if (my !== this.overlayToken) return
    this.overlayData[kind] = vals
    this.overlayStat[kind] = 'ready'
    this.onOverlayState?.(kind, 'ready')
    if (this.colorMode === kind) this.paintWater()
  }

  /** One raster mosaic cropped to the model bbox. `frame` null → static kind. */
  private async loadKindPixels(
    kind: string,
    frame: number | null,
  ): Promise<{ img: ImageData; win: TileWin } | null> {
    const grid = this.grid
    if (!grid || !this.runId) return null
    const win = tileWindow(grid.bbox, 6)
    const template =
      frame == null ? tiles.url(this.runId, kind) : tiles.url(this.runId, kind, undefined, frame)
    const jobs: Promise<{ bx: ImageBitmap | null; x: number; y: number }>[] = []
    for (let x = win.x0; x <= win.x1; x++) {
      for (let y = win.y0; y <= win.y1; y++) {
        const url = template.replace('{z}', String(win.z)).replace('{x}', String(x)).replace('{y}', String(y))
        jobs.push(loadTileBitmap(url).then((bx) => ({ bx, x, y })))
      }
    }
    const parts = await Promise.all(jobs)
    const got = parts.filter((p) => p.bx)
    if (!got.length) return null
    const cols = win.x1 - win.x0 + 1
    const rows = win.y1 - win.y0 + 1
    const mosaic = document.createElement('canvas')
    mosaic.width = cols * TILE_PX
    mosaic.height = rows * TILE_PX
    const mctx = mosaic.getContext('2d', { willReadFrequently: true })
    if (!mctx) return null
    mctx.clearRect(0, 0, mosaic.width, mosaic.height)
    for (const p of got) {
      mctx.drawImage(p.bx!, (p.x - win.x0) * TILE_PX, (p.y - win.y0) * TILE_PX)
      p.bx!.close()
    }
    const xf0 = mercX(grid.bbox[0], win.z)
    const xf1 = mercX(grid.bbox[2], win.z)
    const yf0 = mercY(grid.bbox[3], win.z)
    const yf1 = mercY(grid.bbox[1], win.z)
    const L = Math.max(0, Math.round((xf0 - win.x0) * TILE_PX))
    const T = Math.max(0, Math.round((yf0 - win.y0) * TILE_PX))
    const R = Math.min(mosaic.width, Math.round((xf1 - win.x0) * TILE_PX))
    const B = Math.min(mosaic.height, Math.round((yf1 - win.y0) * TILE_PX))
    if (R - L < 2 || B - T < 2) return null
    try {
      return { img: mctx.getImageData(L, T, R - L, B - T), win }
    } catch {
      return null
    }
  }

  /** Load frame `i` of the depth raster, drape it on the water shell. */
  async setFrame(i: number): Promise<FrameWaterResult> {
    const my = ++this.frameToken
    const grid = this.grid
    if (!grid || !this.runId || !this.waterMesh) return { status: 'no-domain', wet: 0, total: 0 }
    const loaded = await this.loadKindPixels('depth', i)
    if (my !== this.frameToken) return { status: 'no-tiles', wet: 0, total: grid.nR * grid.nC }
    if (!loaded) return { status: 'no-tiles', wet: 0, total: grid.nR * grid.nC }

    const { img, win } = loaded
    const { nR, nC, bbox } = grid
    const yf0 = mercY(bbox[3], win.z)
    const yf1 = mercY(bbox[1], win.z)
    const depths = new Float32Array(nR * nC)
    let wet = 0
    const W = img.width
    const H = img.height
    const data = img.data
    for (let r = 0; r < nR; r++) {
      const lat = bbox[3] - (r / (nR - 1)) * (bbox[3] - bbox[1])
      const fy = (mercY(lat, win.z) - yf0) / Math.max(1e-9, yf1 - yf0)
      const py = Math.min(H - 1, Math.max(0, Math.round(fy * (H - 1))))
      for (let c = 0; c < nC; c++) {
        const lon = bbox[0] + (c / (nC - 1)) * (bbox[2] - bbox[0])
        const px = Math.min(W - 1, Math.max(0, Math.round(((lon - bbox[0]) / (bbox[2] - bbox[0])) * (W - 1))))
        const o = (py * W + px) * 4
        const a = data[o + 3]
        let d = 0
        if (a >= 128) {
          d = this.lut ? depthFromRGB(data[o], data[o + 1], data[o + 2], this.lut) : 0.5
        }
        depths[r * nC + c] = d
        if (d > 0.01) wet++
      }
    }
    if (my !== this.frameToken) return { status: 'no-tiles', wet: 0, total: nR * nC }
    this.depthArr = depths
    this.paintWater()
    return { status: wet > 0 ? 'wet' : 'dry', wet, total: nR * nC }
  }

  /* -------------------------------------------------------------- camera */

  preset(view: 'dam' | 'valley' | 'top' | 'drone') {
    const c = new THREE.Vector3(0, 0, 0)
    const target = this.damWorld() ?? c
    const cam = this.camera
    const ctrl = this.controls
    if (view === 'dam') {
      cam.position.set(target.x, target.y + 85, target.z + 150)
      ctrl.target.copy(target)
    } else if (view === 'valley') {
      cam.position.set(c.x - 170, 130, c.z + 230)
      ctrl.target.set(c.x, 10, c.z + 60)
    } else if (view === 'top') {
      cam.position.set(c.x, 540, c.z + 1)
      ctrl.target.copy(c)
    } else {
      cam.position.set(c.x + 235, 175, c.z - 175)
      ctrl.target.copy(target)
    }
    ctrl.update()
  }

  /** World-space marker where the analyst clicked — the panel probes it. */
  markPick(lon: number, lat: number) {
    const p = this.lonLatToWorld(lon, lat)
    if (!p) return
    if (!this.pickMarker) {
      const geo = new THREE.RingGeometry(4, 6, 32)
      geo.rotateX(-Math.PI / 2)
      this.pickMarker = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: '#b42318', side: THREE.DoubleSide, depthTest: false }),
      )
      this.pickMarker.renderOrder = 10
      this.scene.add(this.pickMarker)
    }
    this.pickMarker.position.set(p.x, p.y + 1.5, p.z)
    this.pickMarker.visible = this.opts.showWater || this.opts.showTerrain
  }

  /* ------------------------------------------------------------- helpers */

  lonLatToWorld(lon: number, lat: number): { x: number; y: number; z: number } | null {
    const grid = this.grid
    if (!grid) return null
    const [w, s, e, n] = grid.bbox
    if (lon < w || lon > e || lat < s || lat > n) return null
    const x = ((lon - w) / (e - w) - 0.5) * WORLD
    const frac = (n - lat) / (n - s)
    const z = -WORLD / 2 + frac * WORLD
    const r = Math.round(frac * (grid.nR - 1))
    const c = Math.round(((lon - w) / (e - w)) * (grid.nC - 1))
    const elev = grid.elev[Math.min(grid.nR - 1, Math.max(0, r)) * grid.nC + Math.min(grid.nC - 1, Math.max(0, c))]
    const y = (Number.isFinite(elev) ? elev - grid.elevMin : 0) * this.horizM * this.opts.terrainExag
    return { x, y, z }
  }

  private damWorld(): THREE.Vector3 | null {
    if (!this.dam) return null
    const p = this.lonLatToWorld(this.dam.lon, this.dam.lat)
    return p ? new THREE.Vector3(p.x, p.y, p.z) : null
  }

  private waterY(elevM: number, depthM: number): number {
    const bed = (Number.isFinite(elevM) ? elevM - (this.grid?.elevMin ?? 0) : 0) * this.horizM
    if (depthM <= 0.01) return bed * this.opts.terrainExag - 1.2
    return (bed + depthM * this.opts.waterExag) * this.opts.terrainExag
  }

  private applyHeights() {
    const grid = this.grid
    if (!grid || !this.terrainMesh) return
    const tPos = (this.terrainMesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute
    const segW = WORLD / (grid.nC - 1)
    const segH = WORLD / (grid.nR - 1)
    for (let r = 0; r < grid.nR; r++) {
      for (let c = 0; c < grid.nC; c++) {
        const idx = r * grid.nC + c
        const e = grid.elev[idx]
        const y = (Number.isFinite(e) ? e - grid.elevMin : 0) * this.horizM * this.opts.terrainExag
        tPos.setXYZ(idx, c * segW - WORLD / 2, y, -WORLD / 2 + r * segH)
      }
    }
    tPos.needsUpdate = true
    this.terrainMesh.geometry.computeVertexNormals()
    if (!this.grid?.hasTerrain && this.terrainMat) {
      this.terrainMat.color.set('#7d8b96')
    }
    this.paintWater()
    this.rebuildDam()
    this.rebuildVillages()
    this.rebuildCascade()
    this.rebuildInfra()
  }

  private paintWater() {
    const grid = this.grid
    const mesh = this.waterMesh
    if (!grid || !mesh) return
    const geo = mesh.geometry as THREE.BufferGeometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    let col = geo.attributes.color as THREE.BufferAttribute | undefined
    if (!col) {
      col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3)
      geo.setAttribute('color', col)
    }
    const segW = WORLD / (grid.nC - 1)
    const segH = WORLD / (grid.nR - 1)
    const flat: [number, number, number] = [2 / 255, 132 / 255, 199 / 255]
    // Overlay colouring (arrival hours / peak m/s) rides on the same wet mask
    // as depth — height always comes from the depth frame.
    const ov = this.colorMode === 'depth' ? null : this.overlayData[this.colorMode]
    const ovLut = this.colorMode === 'depth' ? null : this.overlayLUTs[this.colorMode]
    for (let r = 0; r < grid.nR; r++) {
      for (let c = 0; c < grid.nC; c++) {
        const idx = r * grid.nC + c
        const e = grid.elev[idx]
        const d = this.depthArr ? this.depthArr[idx] : 0
        pos.setXYZ(idx, c * segW - WORLD / 2, this.waterY(e, d), -WORLD / 2 + r * segH)
        if (d <= 0.01) {
          col.setXYZ(idx, 0.1, 0.2, 0.3)
        } else if (ov && ovLut) {
          const v = ov[idx]
          if (Number.isFinite(v)) {
            const [cr, cg, cb] = colorForDepth(v, ovLut)
            col.setXYZ(idx, cr / 255, cg / 255, cb / 255)
          } else {
            col.setXYZ(idx, flat[0], flat[1], flat[2])
          }
        } else if (this.colorMode === 'depth' && this.lut) {
          const [cr, cg, cb] = colorForDepth(d, this.lut)
          col.setXYZ(idx, cr / 255, cg / 255, cb / 255)
        } else {
          col.setXYZ(idx, flat[0], flat[1], flat[2])
        }
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  }

  private async loadImagery(bbox: [number, number, number, number]) {
    const my = ++this.imageryToken
    const res = await loadImagery(bbox)
    if (my !== this.imageryToken || !res || !this.terrainMesh) return
    const tex = new THREE.CanvasTexture(res.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    // Vertices are spaced linearly in lat; the mosaic is Mercator — correct
    // each vertex's v so the imagery lands on the true latitude.
    const geo = this.terrainMesh.geometry as THREE.BufferGeometry
    const uv = geo.attributes.uv as THREE.BufferAttribute
    const grid = this.grid
    if (grid) {
      const [, s, , n] = grid.bbox
      for (let r = 0; r < grid.nR; r++) {
        const lat = n - (r / (grid.nR - 1)) * (n - s)
        const v = 1 - (mercY(lat, res.z) - res.yf0) / Math.max(1e-9, res.yf1 - res.yf0)
        for (let c = 0; c < grid.nC; c++) {
          uv.setXY(r * grid.nC + c, c / (grid.nC - 1), Math.min(1, Math.max(0, v)))
        }
      }
      uv.needsUpdate = true
      this.imgGeo = { z: res.z, yf0: res.yf0, yf1: res.yf1 }
    }
    if (this.terrainMat) {
      const old = this.terrainMat.map
      this.terrainMat.map = tex
      this.terrainMat.color.set('#ffffff')
      this.terrainMat.needsUpdate = true
      old?.dispose()
    }
  }

  private rebuildDam() {
    if (this.damGroup) {
      this.scene.remove(this.damGroup)
      this.damGroup = null
    }
    const at = this.damWorld()
    if (!at || !this.grid) return
    const g = new THREE.Group()
    const accent = new THREE.MeshStandardMaterial({ color: '#b42318', roughness: 0.5 })
    const concrete = new THREE.MeshStandardMaterial({ color: '#dde3ea', roughness: 0.4, metalness: 0.2 })

    // Pin — always drawn, a UI marker rather than a dimension claim.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 26, 10), accent)
    pole.position.set(at.x, at.y + 13, at.z)
    pole.castShadow = true
    g.add(pole)
    const head = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 14), accent)
    head.position.set(at.x, at.y + 30, at.z)
    head.rotation.x = Math.PI
    g.add(head)
    const ringGeo = new THREE.RingGeometry(6, 8, 40)
    ringGeo.rotateX(-Math.PI / 2)
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#b42318', side: THREE.DoubleSide }))
    ring.position.set(at.x, at.y + 0.6, at.z)
    g.add(ring)

    // Wall — only when the registry actually knows the height.
    const h = this.dam?.height_m
    if (typeof h === 'number' && h > 0) {
      const lenM = this.dam?.crest_length_m && this.dam.crest_length_m > 0 ? this.dam.crest_length_m : h * 3
      const hW = h * this.horizM * this.opts.terrainExag
      const lW = Math.min(WORLD * 0.4, lenM * this.horizM)
      const tW = Math.max(1.5, lW * 0.07)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(lW, hW, tW), concrete)
      wall.position.set(at.x, at.y + hW / 2 - 0.4, at.z)
      wall.castShadow = true
      wall.receiveShadow = true
      if (typeof this.dam?.heading_deg === 'number') {
        wall.rotation.y = Math.PI / 2 - (this.dam.heading_deg * Math.PI) / 180
      }
      g.add(wall)
    }
    g.visible = this.opts.showDam
    this.scene.add(g)
    this.damGroup = g
  }

  /** Affected-village pins from hazard-villages, coloured by modelled hazard. */
  setVillages(list: SceneVillage[]) {
    this.villages = (list ?? []).filter(
      (v) => Number.isFinite(v.lon) && Number.isFinite(v.lat),
    )
    this.rebuildVillages()
  }

  private rebuildVillages() {
    if (this.villageGroup) {
      this.scene.remove(this.villageGroup)
      this.villageGroup = null
    }
    this.villageSelected = null
    const grid = this.grid
    if (!grid || !this.villages.length) return
    const [w, s, e, n] = grid.bbox
    const g = new THREE.Group()
    for (const v of this.villages) {
      if (v.lon < w || v.lon > e || v.lat < s || v.lat > n) continue
      const p = this.lonLatToWorld(v.lon, v.lat)
      if (!p) continue
      const color = HAZARD_COLORS[(v.hazard ?? '').toUpperCase()] ?? '#64748b'
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 12, 10),
        new THREE.MeshBasicMaterial({ color }),
      )
      dot.position.set(p.x, p.y + 4, p.z)
      dot.userData.village = v
      g.add(dot)
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 4, 6),
        new THREE.MeshBasicMaterial({ color }),
      )
      stem.position.set(p.x, p.y + 1, p.z)
      stem.userData.village = v
      g.add(stem)
    }
    const selGeo = new THREE.RingGeometry(4.5, 6.5, 32)
    selGeo.rotateX(-Math.PI / 2)
    this.villageSelected = new THREE.Mesh(
      selGeo,
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, depthTest: false }),
    )
    this.villageSelected.renderOrder = 11
    this.villageSelected.visible = false
    g.add(this.villageSelected)
    g.visible = this.opts.showVillages
    this.scene.add(g)
    this.villageGroup = g
  }

  /** Highlight one village pin (null clears). */
  selectVillage(v: SceneVillage | null) {
    if (!this.villageSelected) return
    if (!v) {
      this.villageSelected.visible = false
      return
    }
    const p = this.lonLatToWorld(v.lon, v.lat)
    if (!p) return
    this.villageSelected.position.set(p.x, p.y + 1.2, p.z)
    this.villageSelected.visible = true
  }

  /** Swing the camera target to a lon/lat, keeping the current offset. */
  focusAt(lon: number, lat: number) {
    const p = this.lonLatToWorld(lon, lat)
    if (!p) return
    const target = new THREE.Vector3(p.x, p.y, p.z)
    const offset = this.camera.position.clone().sub(this.controls.target)
    if (offset.length() > 600) offset.setLength(320)
    if (offset.length() < 60) offset.setLength(160)
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(offset)
    this.controls.update()
  }

  /** Screened cascade dams — wet structures get warning pins, dry ones none. */
  setCascadeDams(list: SceneCascadeDam[]) {
    this.cascadeDams = (list ?? []).filter(
      (d) => Number.isFinite(d.lon) && Number.isFinite(d.lat) && d.status !== 'dry' && d.status !== 'outside-domain',
    )
    this.rebuildCascade()
  }

  private rebuildCascade() {
    if (this.cascadeGroup) {
      this.scene.remove(this.cascadeGroup)
      this.cascadeGroup = null
    }
    this.cascadeSelected = null
    const grid = this.grid
    if (!grid || !this.cascadeDams.length) return
    const [w, s, e, n] = grid.bbox
    const g = new THREE.Group()
    for (const d of this.cascadeDams) {
      if (d.lon < w || d.lon > e || d.lat < s || d.lat > n) continue
      const p = this.lonLatToWorld(d.lon, d.lat)
      if (!p) continue
      const color = CASCADE_COLORS[d.status] ?? '#64748b'
      const pin = new THREE.Mesh(
        new THREE.ConeGeometry(3.4, 10, 4),
        new THREE.MeshBasicMaterial({ color }),
      )
      pin.position.set(p.x, p.y + 12, p.z)
      pin.userData.cascade = d
      g.add(pin)
    }
    const selGeo = new THREE.RingGeometry(6, 8.5, 32)
    selGeo.rotateX(-Math.PI / 2)
    this.cascadeSelected = new THREE.Mesh(
      selGeo,
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, depthTest: false }),
    )
    this.cascadeSelected.renderOrder = 12
    this.cascadeSelected.visible = false
    g.add(this.cascadeSelected)
    g.visible = this.opts.showCascade
    this.scene.add(g)
    this.cascadeGroup = g
  }

  /** Highlight one cascade pin by dam id (null clears). */
  selectCascadeDam(id: string | null) {
    if (!this.cascadeSelected) return
    const d = id ? this.cascadeDams.find((x) => x.id === id) : undefined
    if (!d) {
      this.cascadeSelected.visible = false
      return
    }
    const p = this.lonLatToWorld(d.lon, d.lat)
    if (!p) return
    this.cascadeSelected.position.set(p.x, p.y + 1.2, p.z)
    this.cascadeSelected.visible = true
  }

  private cascadeHit(e: PointerEvent): SceneCascadeDam | null {
    if (!this.cascadeGroup?.visible) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.cascadeGroup.children, false)
    for (const h of hits) {
      const d = (h.object.userData as { cascade?: SceneCascadeDam }).cascade
      if (d) return d
    }
    return null
  }

  /** True when the pointer event hit a village pin (handled before probing). */
  private villageHit(e: PointerEvent): SceneVillage | null {
    if (!this.villageGroup?.visible) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.villageGroup.children, false)
    for (const h of hits) {
      const v = (h.object.userData as { village?: SceneVillage }).village
      if (v) return v
    }
    return null
  }

  private pick(e: PointerEvent): { lon: number; lat: number } | null {
    const grid = this.grid
    if (!grid) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = []
    if (this.waterMesh?.visible) targets.push(this.waterMesh)
    if (this.terrainMesh?.visible) targets.push(this.terrainMesh)
    targets.push(this.hitPlane!)
    const hits = this.raycaster.intersectObjects(targets, false)
    if (!hits.length) return null
    const hit = hits[0]
    const [w, s, ee, n] = grid.bbox
    if (hit.object !== this.hitPlane && hit.uv && this.imgGeo) {
      const lon = w + hit.uv.x * (ee - w)
      const my = this.imgGeo.yf0 + (1 - hit.uv.y) * (this.imgGeo.yf1 - this.imgGeo.yf0)
      return { lon, lat: mercYInv(my, this.imgGeo.z) }
    }
    const fx = hit.point.x / WORLD + 0.5
    const fz = hit.point.z / WORLD + 0.5
    return { lon: w + fx * (ee - w), lat: n - fz * (n - s) }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.ro = null
    this.frameToken++
    this.imageryToken++
    this.setParticles(null)
    this.clearInfra()
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      }
    })
    this.controls.dispose()
    this.renderer.dispose()
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
