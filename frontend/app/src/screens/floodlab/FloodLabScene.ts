import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BreachHydrograph, RunInfra, Terrain3D } from '../../lib/api'
import { loadImagery, mercY } from '../PlayerScene'
import { createWaterMaterial } from '../player/waterMaterial'
import { FloodSim } from './simulation'

/**
 * Live Flood Lab scene: the run's real terrain, a dam across the valley, the
 * reservoir, and a live GPU shallow-water simulation fed by the run's breach
 * hydrograph. Game-style presentation (stylised terrain, trees, foam) is
 * illustrative; the simulation is a preview, not the validated solver.
 */

const WORLD = 600

export interface LabDam {
  name: string
  lon: number
  lat: number
  height_m: number | null
  crest_length_m: number | null
}

export interface LabInput {
  terrain: Terrain3D
  dam: LabDam | null
  hydro: BreachHydrograph | null
  /** river base inflow (m³/s), from the scenario */
  inflowCms: number
  /** reservoir level at the start (m a.s.l.) */
  levelM: number | null
  breachWidthM: number | null
  breachFormS: number
  infra: RunInfra | null
}

export interface LabStats {
  /** simulated seconds since load (river warm-up excluded) */
  t: number
  /** seconds since the breach, null before */
  sinceBreach: number | null
  /** discharge entering at the dam now (m³/s) */
  q: number
  areaKm2: number
  maxDepth: number
  maxSpeed: number
  volumeM3: number
  injectedM3: number
  lakeLevel: number | null
  frontKm: number | null
  buildingsWet: number
  buildingsEver: number
  roadKmCut: number
  bridgesWet: number
  /** simulated seconds per real second actually achieved */
  rate: number
  warming: boolean
}

export type LabLook = 'stylised' | 'satellite'

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export class FloodLabScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private ro: ResizeObserver
  private raf = 0
  private lastT = performance.now()
  private t0 = performance.now()

  private sim: FloodSim | null = null
  private input: LabInput | null = null
  private nR = 0
  private nC = 0
  private worldW = WORLD
  private worldH = WORLD
  private horizM = 1
  private elevMin = 0
  private exag = 1.4
  private bed: Float32Array | null = null

  private terrain: THREE.Mesh | null = null
  private terrainMat: THREE.MeshStandardMaterial | null = null
  private satTex: THREE.Texture | null = null
  private look: LabLook = 'stylised'
  private trees: THREE.Group | null = null
  private water: THREE.Mesh | null = null
  private waterMat: THREE.ShaderMaterial | null = null
  private lake: THREE.Mesh | null = null
  private damGroup: THREE.Group | null = null
  private damBlocks: { mesh: THREE.Mesh; x: number; fall: number }[] = []
  private infraGroup: THREE.Group | null = null

  private damCell: { col: number; row: number } | null = null
  private downDir = new THREE.Vector2(0, 1)
  private running = false
  private speed = 60
  private breachAt: number | null = null
  private warmLeft = 0
  private dtStable = 1
  private statsAcc = 0
  private statsBusy = false
  private rateSim = 0
  private rateWall = 0
  private rate = 0
  private follow = false
  private everWet: Uint8Array | null = null
  onStats: ((s: LabStats) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    const w = container.clientWidth || 800
    const h = container.clientHeight || 600
    this.scene.background = new THREE.Color('#bcd3ea')
    this.scene.fog = new THREE.Fog('#bcd3ea', 900, 2600)
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 6000)
    this.camera.position.set(-220, 260, 380)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // terrain, trees and buildings are static — shadows are drawn on demand
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    container.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03
    this.controls.minDistance = 8
    this.controls.maxDistance = 2500

    this.scene.add(new THREE.HemisphereLight('#dbeafe', '#6b5b45', 0.75))
    const sun = new THREE.DirectionalLight('#fff4dc', 2.1)
    sun.position.set(-320, 420, 180)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -420
    sun.shadow.camera.right = 420
    sun.shadow.camera.top = 420
    sun.shadow.camera.bottom = -420
    sun.shadow.camera.far = 2000
    sun.shadow.bias = -0.0004
    this.scene.add(sun)

    this.ro = new ResizeObserver(() => {
      const cw = container.clientWidth || 1
      const ch = container.clientHeight || 1
      this.camera.aspect = cw / ch
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(cw, ch)
    })
    this.ro.observe(container)
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.frame()
    }
    loop()
  }

  /* ---------------------------------------------------------------- build */

  load(input: LabInput) {
    this.clear()
    this.input = input
    const rows = input.terrain.rows
    const nR = rows.length
    const nC = rows[0]?.length ?? 0
    if (nR < 4 || nC < 4) return
    this.nR = nR
    this.nC = nC
    const [w, s, e, n] = input.terrain.bounds
    const midLat = ((s + n) / 2) * (Math.PI / 180)
    const geoW = (e - w) * 111320 * Math.cos(midLat)
    const geoH = (n - s) * 111320
    this.worldW = WORLD
    this.worldH = WORLD * (geoH / geoW)
    this.horizM = WORLD / geoW
    const bed = new Float32Array(nR * nC)
    let emin = Infinity
    for (let r = 0; r < nR; r++)
      for (let c = 0; c < nC; c++) {
        const v = Number(rows[r][c])
        bed[r * nC + c] = Number.isFinite(v) ? v : NaN
        if (Number.isFinite(v) && v < emin) emin = v
      }
    for (let k = 0; k < bed.length; k++) if (!Number.isFinite(bed[k])) bed[k] = emin
    this.elevMin = emin
    this.bed = bed
    this.everWet = new Uint8Array(nR * nC)

    const cell = (geoW / nC + geoH / nR) / 2
    this.sim = new FloodSim(this.renderer, { cols: nC, rows: nR, cell, bed })
    this.buildTerrain()
    this.buildWater()
    this.locateDam()
    this.buildDam()
    this.buildLake()
    this.buildTrees()
    this.buildInfra()
    void this.loadSatellite()
    this.renderer.shadowMap.needsUpdate = true
    this.resetSim()
    this.view('overview')
  }

  private worldY(elevM: number) {
    return (elevM - this.elevMin) * this.horizM * this.exag
  }

  private cellToWorld(col: number, row: number, elev?: number) {
    const x = (col / (this.nC - 1) - 0.5) * this.worldW
    const z = (row / (this.nR - 1) - 0.5) * this.worldH
    const e = elev ?? this.bedAt(col, row)
    return new THREE.Vector3(x, this.worldY(e), z)
  }

  private bedAt(col: number, row: number) {
    const c = Math.min(this.nC - 1, Math.max(0, Math.round(col)))
    const r = Math.min(this.nR - 1, Math.max(0, Math.round(row)))
    return this.bed ? this.bed[r * this.nC + c] : 0
  }

  private lonLatToCell(lon: number, lat: number): { col: number; row: number } | null {
    const [w, s, e, n] = this.input!.terrain.bounds
    if (lon < w || lon > e || lat < s || lat > n) return null
    return { col: ((lon - w) / (e - w)) * (this.nC - 1), row: ((n - lat) / (n - s)) * (this.nR - 1) }
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(this.worldW, this.worldH, this.nC - 1, this.nR - 1)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let r = 0; r < this.nR; r++)
      for (let c = 0; c < this.nC; c++) {
        const i = r * this.nC + c
        pos.setY(i, this.worldY(this.bed![i]))
      }
    geo.computeVertexNormals()
    // stylised palette by slope and height (illustrative)
    const nrm = geo.attributes.normal as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const emax = this.bed!.reduce((m, v) => Math.max(m, v), -Infinity)
    const grass = new THREE.Color('#5d7a3a')
    const dry = new THREE.Color('#9b9467')
    const rock = new THREE.Color('#7d746a')
    const snow = new THREE.Color('#eef2f6')
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const slope = 1 - nrm.getY(i)
      const e = this.bed![i]
      const rel = (e - this.elevMin) / Math.max(1, emax - this.elevMin)
      tmp.copy(grass).lerp(dry, Math.min(1, rel * 1.6))
      tmp.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.18, 0.42))
      if (e > 4200) tmp.lerp(snow, THREE.MathUtils.smoothstep(e, 4200, 4900) * (1 - THREE.MathUtils.smoothstep(slope, 0.4, 0.7)))
      const j = 0.9 + hash(i % this.nC, Math.floor(i / this.nC)) * 0.2
      col[i * 3] = tmp.r * j
      col[i * 3 + 1] = tmp.g * j
      col[i * 3 + 2] = tmp.b * j
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    this.terrain = new THREE.Mesh(geo, this.terrainMat)
    this.terrain.receiveShadow = true
    this.terrain.castShadow = true
    this.scene.add(this.terrain)
  }

  private async loadSatellite() {
    const t = this.input?.terrain
    if (!t || !this.terrain) return
    const bbox: [number, number, number, number] = [t.bounds[0], t.bounds[1], t.bounds[2], t.bounds[3]]
    const res = await loadImagery(bbox)
    if (!res || !this.terrain || this.input?.terrain !== t) return
    const tex = new THREE.CanvasTexture(res.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const uv = (this.terrain.geometry as THREE.BufferGeometry).attributes.uv as THREE.BufferAttribute
    const [, s, , n] = bbox
    for (let r = 0; r < this.nR; r++) {
      const lat = n - (r / (this.nR - 1)) * (n - s)
      const v = 1 - (mercY(lat, res.z) - res.yf0) / Math.max(1e-9, res.yf1 - res.yf0)
      for (let c = 0; c < this.nC; c++) uv.setXY(r * this.nC + c, c / (this.nC - 1), Math.min(1, Math.max(0, v)))
    }
    uv.needsUpdate = true
    this.satTex = tex
    this.setLook(this.look)
  }

  /** Stylised colours or the real satellite image on the terrain. */
  setLook(look: LabLook) {
    this.look = look
    const m = this.terrainMat
    if (!m) return
    if (look === 'satellite' && this.satTex) {
      m.map = this.satTex
      m.vertexColors = false
    } else {
      m.map = null
      m.vertexColors = true
    }
    m.needsUpdate = true
    if (this.trees) this.trees.visible = look === 'stylised' && this.treesOn
  }

  private treesOn = true
  setTrees(on: boolean) {
    this.treesOn = on
    if (this.trees) this.trees.visible = on && this.look === 'stylised'
  }

  private buildTrees() {
    if (!this.bed || !this.terrain) return
    const nrm = (this.terrain.geometry as THREE.BufferGeometry).attributes.normal as THREE.BufferAttribute
    const pts: THREE.Vector3[] = []
    const emax = this.bed.reduce((m, v) => Math.max(m, v), -Infinity)
    const treeline = Math.min(emax - 200, 3900)
    for (let r = 1; r < this.nR - 1; r++)
      for (let c = 1; c < this.nC - 1; c++) {
        const i = r * this.nC + c
        const slope = 1 - nrm.getY(i)
        if (slope > 0.35 || this.bed[i] > treeline) continue
        if (hash(c * 1.7, r * 2.3) > 0.16 * (1 - slope * 2)) continue
        const p = this.cellToWorld(c + hash(c, r) - 0.5, r + hash(r, c) - 0.5)
        pts.push(p)
        if (pts.length >= 9000) break
      }
    const g = new THREE.Group()
    const s = Math.max(1.2, 9 * this.horizM * 4)
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.45 * s, 1.6 * s, 6),
      new THREE.MeshStandardMaterial({ color: '#2f5a2a', roughness: 0.9 }),
      pts.length,
    )
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.5 * s, 5),
      new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 1 }),
      pts.length,
    )
    const d = new THREE.Object3D()
    pts.forEach((p, k) => {
      const sc = 0.75 + hash(k, 3) * 0.6
      d.position.set(p.x, p.y + 0.25 * s * sc, p.z)
      d.scale.setScalar(sc)
      d.updateMatrix()
      trunk.setMatrixAt(k, d.matrix)
      d.position.set(p.x, p.y + (0.5 + 0.8) * s * sc, p.z)
      d.updateMatrix()
      crown.setMatrixAt(k, d.matrix)
    })
    crown.castShadow = true
    g.add(crown, trunk)
    this.trees = g
    g.visible = this.treesOn && this.look === 'stylised'
    this.scene.add(g)
  }

  private buildWater() {
    const geo = new THREE.PlaneGeometry(this.worldW, this.worldH, this.nC - 1, this.nR - 1)
    geo.rotateX(-Math.PI / 2)
    const mat = createWaterMaterial({ live: true })
    const u = mat.uniforms
    const rel = new Float32Array(this.bed!.length)
    for (let k = 0; k < rel.length; k++) rel[k] = this.bed![k] - this.elevMin
    const bedTex = new THREE.DataTexture(rel, this.nC, this.nR, THREE.RedFormat, THREE.FloatType)
    bedTex.needsUpdate = true
    ;(u.uBed.value as THREE.Texture).dispose()
    u.uBed.value = bedTex
    u.uGrid.value.set(this.nC, this.nR)
    u.uCell.value.set(this.worldW / (this.nC - 1), this.worldH / (this.nR - 1))
    u.uBedScale.value = this.horizM * this.exag
    // a touch of vertical exaggeration so shallow sheets read at valley scale
    u.uDepthScale.value = this.horizM * this.exag * 2
    u.uOpacity.value = 0.92
    u.uSunDir.value.set(-320, 420, 180).normalize()
    this.waterMat = mat
    this.water = new THREE.Mesh(geo, mat)
    this.water.frustumCulled = false
    this.water.renderOrder = 2
    this.scene.add(this.water)
  }

  /** Dam cell + downstream direction (steepest fall of the valley floor). */
  private locateDam() {
    const d = this.input?.dam
    this.damCell = d ? this.lonLatToCell(d.lon, d.lat) : null
    if (!this.damCell) return
    const { col, row } = this.damCell
    let best = Infinity
    const R = 6
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      const e = this.bedAt(col + Math.cos(a) * R, row + Math.sin(a) * R)
      if (e < best) {
        best = e
        this.downDir.set(Math.cos(a), Math.sin(a))
      }
    }
  }

  private damHeight(): number {
    const d = this.input?.dam
    if (d?.height_m && d.height_m > 0) return d.height_m
    const lvl = this.input?.levelM
    if (lvl != null && this.damCell) {
      const h = lvl - this.bedAt(this.damCell.col, this.damCell.row)
      if (h > 2) return h
    }
    return Math.max(10, this.input?.breachWidthM ? 20 : 15)
  }

  private buildDam() {
    if (!this.damCell || !this.input) return
    const { col, row } = this.damCell
    const base = this.bedAt(col, row)
    const h = this.damHeight()
    const crest = base + h
    // span the valley: walk along the axis until the ground reaches the crest
    const axis = new THREE.Vector2(-this.downDir.y, this.downDir.x)
    const cellM = this.sim!.grid.cell
    const reach = (sgn: number) => {
      for (let k = 1; k < 80; k++) {
        if (this.bedAt(col + axis.x * k * sgn, row + axis.y * k * sgn) >= crest) return k
      }
      return 80
    }
    const recorded = this.input.dam?.crest_length_m
    const lenCells = recorded && recorded > 0 ? recorded / cellM : reach(1) + reach(-1) + 1
    const lenW = lenCells * (this.worldW / (this.nC - 1))
    const hW = h * this.horizM * this.exag
    const thickW = Math.max(1.5, h * 0.7 * this.horizM)
    const centre = this.cellToWorld(col, row, base)
    const g = new THREE.Group()
    g.position.copy(centre)
    g.rotation.y = -Math.atan2(axis.y, axis.x)
    const mat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.75 })
    const n = 36
    const bw = Math.max(lenW * 0.08, (this.input.breachWidthM ?? 0) * this.horizM)
    this.damBlocks = []
    for (let i = 0; i < n; i++) {
      const x = -lenW / 2 + (i + 0.5) * (lenW / n)
      // tapered gravity section: thick base, narrow crest
      const shape = new THREE.Shape()
      shape.moveTo(-thickW / 2, 0)
      shape.lineTo(thickW / 2, 0)
      shape.lineTo(-thickW / 2 + thickW * 0.22, hW)
      shape.lineTo(-thickW / 2, hW)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: lenW / n + 0.05, bevelEnabled: false })
      geo.rotateY(Math.PI / 2)
      geo.translate(-(lenW / n) / 2, 0, 0)
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, -hW * 0.25, 0)
      m.scale.y = 1.25 // seat the wall into the valley sides
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      this.damBlocks.push({ mesh: m, x, fall: Math.abs(x) <= bw / 2 ? 1 : 0 })
    }
    this.damGroup = g
    this.scene.add(g)
  }

  /** Reservoir lake behind the dam: cells below the start level, upstream. */
  private buildLake() {
    const lvl = this.input?.levelM
    if (lvl == null || !this.damCell || !this.bed) return
    const { col, row } = this.damCell
    const nC = this.nC
    const mask = new Uint8Array(this.nR * nC)
    const up = { c: Math.round(col - this.downDir.x * 2), r: Math.round(row - this.downDir.y * 2) }
    const q: number[] = []
    const push = (c: number, r: number) => {
      if (c < 0 || r < 0 || c >= nC || r >= this.nR) return
      const k = r * nC + c
      if (mask[k] || this.bed![k] >= lvl) return
      // stay on the upstream side of the dam line
      if ((c - col) * this.downDir.x + (r - row) * this.downDir.y > -0.5) return
      mask[k] = 1
      q.push(k)
    }
    push(up.c, up.r)
    for (let i = 0; i < q.length && q.length < 60000; i++) {
      const c = q[i] % nC
      const r = Math.floor(q[i] / nC)
      push(c + 1, r)
      push(c - 1, r)
      push(c, r + 1)
      push(c, r - 1)
    }
    if (!q.length) return
    const geo = new THREE.PlaneGeometry(this.worldW, this.worldH, nC - 1, this.nR - 1)
    geo.rotateX(-Math.PI / 2)
    const idx: number[] = []
    for (let r = 0; r < this.nR - 1; r++)
      for (let c = 0; c < nC - 1; c++) {
        const a = r * nC + c
        if (mask[a] || mask[a + 1] || mask[a + nC] || mask[a + nC + 1]) {
          idx.push(a, a + nC, a + 1, a + 1, a + nC, a + nC + 1)
        }
      }
    geo.setIndex(idx)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0)
    const mat = new THREE.MeshStandardMaterial({
      color: '#1d5f8a',
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9,
    })
    this.lake = new THREE.Mesh(geo, mat)
    this.lake.position.y = this.worldY(lvl)
    this.lake.renderOrder = 1
    this.scene.add(this.lake)
  }

  private buildInfra() {
    const doc = this.input?.infra
    if (!doc) return
    const g = new THREE.Group()
    const bs = doc.buildings
      .map((b) => ({ b, c: this.lonLatToCell(b.x, b.y) }))
      .filter((o): o is { b: (typeof doc.buildings)[number]; c: { col: number; row: number } } => o.c != null)
    if (bs.length) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.7 }),
        bs.length,
      )
      const d = new THREE.Object3D()
      const roof = new THREE.Color('#e6dccb')
      bs.forEach(({ b, c }, k) => {
        const p = this.cellToWorld(c.col, c.row)
        const side = Math.max(b.a * this.horizM, 0.8)
        const hh = Math.max(9 * this.horizM * this.exag, 0.7)
        d.position.set(p.x, p.y + hh / 2, p.z)
        d.scale.set(side, hh, side)
        d.updateMatrix()
        mesh.setMatrixAt(k, d.matrix)
        mesh.setColorAt(k, roof)
      })
      mesh.castShadow = true
      mesh.userData.cells = bs.map(({ c }) => Math.round(c.row) * this.nC + Math.round(c.col))
      g.add(mesh)
    }
    const segs = doc.roads
      .map((r) => ({ r, a: this.lonLatToCell(r.p[0], r.p[1]), b: this.lonLatToCell(r.p[2], r.p[3]) }))
      .filter((o) => o.a && o.b)
    if (segs.length) {
      const pos = new Float32Array(segs.length * 6)
      segs.forEach(({ a, b }, k) => {
        const pa = this.cellToWorld(a!.col, a!.row)
        const pb = this.cellToWorld(b!.col, b!.row)
        pos.set([pa.x, pa.y + 0.35, pa.z, pb.x, pb.y + 0.35, pb.z], k * 6)
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs.length * 6).fill(0.93), 3))
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
      lines.userData.items = segs.map(({ r, a, b }) => ({
        km: r.km,
        cell: Math.round((a!.row + b!.row) / 2) * this.nC + Math.round((a!.col + b!.col) / 2),
      }))
      g.add(lines)
    }
    this.infraGroup = g
    this.scene.add(g)
  }

  /* ------------------------------------------------------------- controls */

  /** Restart: dry valley, river warm-up, lake full, dam intact. */
  resetSim() {
    if (!this.sim) return
    this.sim.reset()
    this.breachAt = null
    this.everWet?.fill(0)
    this.damBlocks.forEach((b) => {
      b.mesh.visible = true
      b.mesh.position.y = -this.damHeight() * this.horizM * this.exag * 0.25
      b.mesh.rotation.set(0, 0, 0)
    })
    if (this.lake && this.input?.levelM != null) {
      this.lake.position.y = this.worldY(this.input.levelM)
      this.lake.visible = true
    }
    // fill the river channel first, like the game's always-on rivers
    this.warmLeft = this.input && this.input.inflowCms > 0 ? 1800 : 0
    this.updateSource()
    this.renderer.shadowMap.needsUpdate = true
  }

  /** Breach the dam now: the run's breach hydrograph starts flowing. */
  breach() {
    if (!this.sim || this.breachAt != null || this.warmLeft > 0) return
    this.breachAt = this.sim.t
    this.running = true
  }

  setRunning(on: boolean) {
    this.running = on
  }

  /** Simulated seconds per real second. */
  setSpeed(simPerSec: number) {
    this.speed = simPerSec
  }

  setRain(mmPerHour: number) {
    this.sim?.setRain(mmPerHour)
  }

  setFollow(on: boolean) {
    this.follow = on
  }

  view(v: 'overview' | 'dam' | 'downstream' | 'top') {
    const c = this.controls
    if (v === 'top') {
      this.camera.position.set(0, 760, 1)
      c.target.set(0, 0, 0)
    } else if (v === 'dam' && this.damCell) {
      const p = this.cellToWorld(this.damCell.col, this.damCell.row)
      const back = new THREE.Vector3(this.downDir.x, 0, this.downDir.y).multiplyScalar(-1)
      this.camera.position.copy(p).add(new THREE.Vector3(back.x * -90 + 40, 55, back.z * -90 + 40))
      c.target.copy(p)
    } else if (v === 'downstream' && this.damCell) {
      const p = this.cellToWorld(
        this.damCell.col + this.downDir.x * this.nC * 0.25,
        this.damCell.row + this.downDir.y * this.nR * 0.25,
      )
      this.camera.position.copy(p).add(new THREE.Vector3(-120, 150, 160))
      c.target.copy(p)
    } else {
      this.camera.position.set(-260, 300, this.worldH * 0.7)
      c.target.set(0, 20, 0)
    }
    c.update()
  }

  /* ---------------------------------------------------------------- loop */

  private hydroAt(arr: number[] | undefined, tb: number): number | null {
    const h = this.input?.hydro
    const ts = h?.time_s
    if (!ts?.length || !arr?.length) return null
    if (tb <= ts[0]) return arr[0]
    if (tb >= ts[ts.length - 1]) return arr[arr.length - 1]
    // hydrographs are evenly stepped (dt_s) — index directly
    const dt = ts[1] - ts[0] || 1
    const i = Math.min(ts.length - 2, Math.floor((tb - ts[0]) / dt))
    const k = (tb - ts[i]) / Math.max(1e-9, ts[i + 1] - ts[i])
    return arr[i] + (arr[i + 1] - arr[i]) * k
  }

  private currentQ(): number {
    const base = this.input?.inflowCms ?? 0
    if (this.breachAt == null || !this.sim) return base
    const q = this.hydroAt(this.input?.hydro?.q_cms, this.sim.t - this.breachAt)
    return Math.max(base, q ?? base)
  }

  private updateSource() {
    if (!this.sim || !this.damCell) return
    const cellM = this.sim.grid.cell
    const rad = Math.max(1, ((this.input?.breachWidthM ?? cellM * 2) / cellM) * 0.5)
    // inject just downstream of the wall
    this.sim.setSource(
      this.damCell.col + this.downDir.x * 1.5,
      this.damCell.row + this.downDir.y * 1.5,
      rad,
      this.currentQ(),
    )
  }

  private frame() {
    const now = performance.now()
    const wall = Math.min(0.1, (now - this.lastT) / 1000)
    this.lastT = now
    const sim = this.sim
    if (sim && this.waterMat) {
      if (this.warmLeft > 0) {
        const dt = this.dtStable
        const n = 60
        sim.step(n, dt)
        this.warmLeft -= n * dt
        if (this.warmLeft <= 0) {
          sim.t = 0
          sim.injected = 0
        }
      } else if (this.running) {
        const want = this.speed * wall
        const n = Math.min(120, Math.max(1, Math.ceil(want / this.dtStable)))
        const dt = Math.min(this.dtStable, want / n)
        this.updateSource()
        sim.step(n, dt)
        this.rateSim += n * dt
        this.rateWall += wall
        this.animateDam()
      }
      this.waterMat.uniforms.uLive.value = sim.texture
      this.waterMat.uniforms.uTime.value = (now - this.t0) / 1000
      this.statsAcc += wall
      if (this.statsAcc > 0.33 && !this.statsBusy) {
        this.statsAcc = 0
        this.statsBusy = true
        void this.publishStats().finally(() => {
          this.statsBusy = false
        })
      }
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private animateDam() {
    if (this.breachAt == null || !this.sim) return
    const tb = this.sim.t - this.breachAt
    const form = Math.max(this.input?.breachFormS ?? 0, 1)
    const p = Math.min(1, tb / form)
    const hW = this.damHeight() * this.horizM * this.exag
    for (const b of this.damBlocks) {
      if (!b.fall) continue
      // breached blocks topple downstream and sink as the opening forms
      const k = Math.min(1, p * 1.4)
      b.mesh.position.y = -hW * 0.25 - hW * 1.3 * k
      b.mesh.rotation.z = (b.x > 0 ? -1 : 1) * 0.6 * k
      b.mesh.visible = k < 1
    }
    if (p < 1) this.renderer.shadowMap.needsUpdate = true
    if (this.lake && this.input?.hydro?.level_m) {
      const lvl = this.hydroAt(this.input.hydro.level_m, tb)
      if (lvl != null) this.lake.position.y = this.worldY(lvl)
    }
  }

  private async publishStats() {
    const sim = this.sim
    if (!sim) return
    const s = await sim.stats()
    if (sim !== this.sim) return // reloaded while the read was in flight
    this.dtStable = sim.stableDt(s.maxDepth)
    if (this.rateWall > 0.5) {
      this.rate = this.rateSim / this.rateWall
      this.rateSim = 0
      this.rateWall = 0
    }
    // flood front: farthest wet cell from the dam
    let frontKm: number | null = null
    const ew = this.everWet!
    if (this.damCell) {
      let best = -1
      for (let k = 0; k < s.depth.length; k++) {
        if (s.depth[k] > 0.1) {
          ew[k] = 1
          const dc = (k % this.nC) - this.damCell.col
          const dr = Math.floor(k / this.nC) - this.damCell.row
          const d2 = dc * dc + dr * dr
          if (d2 > best) best = d2
        }
      }
      frontKm = best >= 0 ? (Math.sqrt(best) * sim.grid.cell) / 1000 : null
    }
    // exposure: OSM features under water now / ever (0.1 m buildings, 0.3 m roads)
    let buildingsWet = 0
    let buildingsEver = 0
    let roadKmCut = 0
    let bridgesWet = 0
    const g = this.infraGroup
    if (g) {
      for (const o of g.children) {
        const cells = o.userData.cells as number[] | undefined
        if (cells && o instanceof THREE.InstancedMesh) {
          const c = new THREE.Color()
          cells.forEach((k, i) => {
            const h = s.depth[k] ?? 0
            if (h > 0.1) buildingsWet++
            if (s.maxDepthGrid[k] > 0.1) buildingsEver++
            o.setColorAt(i, h > 0.1 ? c.set(h > 2 ? '#991b1b' : '#ea580c') : s.maxDepthGrid[k] > 0.1 ? c.set('#f59e0b') : c.set('#e6dccb'))
          })
          if (o.instanceColor) o.instanceColor.needsUpdate = true
        }
        const items = o.userData.items as { km: number; cell: number }[] | undefined
        if (items && o instanceof THREE.LineSegments) {
          const col = o.geometry.getAttribute('color') as THREE.BufferAttribute
          items.forEach((it, i) => {
            const h = s.depth[it.cell] ?? 0
            const cut = h > 0.3
            if (cut) roadKmCut += it.km
            const v = cut ? [0.86, 0.15, 0.15] : s.maxDepthGrid[it.cell] > 0.3 ? [0.96, 0.62, 0.04] : [0.93, 0.93, 0.93]
            col.setXYZ(i * 2, v[0], v[1], v[2])
            col.setXYZ(i * 2 + 1, v[0], v[1], v[2])
          })
          col.needsUpdate = true
        }
      }
      for (const p of this.input?.infra?.points ?? []) {
        if (p.k !== 'bridge') continue
        const c = this.lonLatToCell(p.x, p.y)
        if (c && (s.depth[Math.round(c.row) * this.nC + Math.round(c.col)] ?? 0) > 0.1) bridgesWet++
      }
    }
    if (this.follow && this.damCell && s.wet > 0) {
      // ease the camera target toward the front
      let bk = -1
      let best = -1
      for (let k = 0; k < s.depth.length; k += 3) {
        if (s.depth[k] <= 0.3) continue
        const dc = (k % this.nC) - this.damCell.col
        const dr = Math.floor(k / this.nC) - this.damCell.row
        const d2 = dc * dc + dr * dr
        if (d2 > best) {
          best = d2
          bk = k
        }
      }
      if (bk >= 0) {
        const p = this.cellToWorld(bk % this.nC, Math.floor(bk / this.nC))
        const off = this.camera.position.clone().sub(this.controls.target)
        this.controls.target.lerp(p, 0.25)
        this.camera.position.copy(this.controls.target).add(off)
      }
    }
    const tb = this.breachAt == null ? null : sim.t - this.breachAt
    this.onStats?.({
      t: sim.t,
      sinceBreach: tb,
      q: this.currentQ(),
      areaKm2: s.areaKm2,
      maxDepth: s.maxDepth,
      maxSpeed: s.maxSpeed,
      volumeM3: s.volume,
      injectedM3: sim.injected,
      lakeLevel: tb != null && this.input?.hydro?.level_m ? this.hydroAt(this.input.hydro.level_m, tb) : (this.input?.levelM ?? null),
      frontKm,
      buildingsWet,
      buildingsEver,
      roadKmCut,
      bridgesWet,
      rate: this.rate,
      warming: this.warmLeft > 0,
    })
  }

  /* -------------------------------------------------------------- teardown */

  private clear() {
    for (const o of [this.terrain, this.water, this.lake, this.damGroup, this.trees, this.infraGroup]) {
      if (!o) continue
      this.scene.remove(o)
      o.traverse((x) => {
        const m = x as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | undefined
        mat?.dispose()
      })
    }
    this.terrain = this.water = this.lake = null
    this.damGroup = this.trees = this.infraGroup = null
    this.damBlocks = []
    this.satTex?.dispose()
    this.satTex = null
    this.sim?.dispose()
    this.sim = null
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.clear()
    this.controls.dispose()
    this.renderer.dispose()
    if (this.container.contains(this.renderer.domElement)) this.container.removeChild(this.renderer.domElement)
  }
}
