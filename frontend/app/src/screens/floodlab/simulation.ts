import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'

/**
 * Live shallow-water simulation on the GPU — the "virtual pipes" scheme games
 * use (Mei et al. 2007), with wet-cross-section pipes so waves travel at
 * √(g·h) and a semi-implicit Manning friction. Runs on the run's own DEM grid.
 *
 *   flux texture  RGBA = outflow to −x, +x, −row, +row (m³/s)
 *   water texture R = depth (m), G = speed (m/s), B = dh/dt (m/s), A = max depth (m)
 *
 * Grid rows are memory rows (row 0 = north edge, as in terrain.json). Domain
 * edges are open: water leaves freely. Sources add a discharge (m³/s) over a
 * disc of cells. This is a LIVE PREVIEW — fast and stable, not the validated
 * solver; the Player's results remain the record.
 */

const G = 9.81

const fluxShader = /* glsl */ `
uniform sampler2D textureFlux;
uniform sampler2D textureWater;
uniform sampler2D uBed;
uniform float uDt;
uniform float uCell;
uniform float uManning;

float headAt(ivec2 q, float bSelf) {
  ivec2 R = ivec2(resolution);
  // outside the domain: open boundary at the edge cell's own bed
  if (q.x < 0 || q.y < 0 || q.x >= R.x || q.y >= R.y) return bSelf;
  return texelFetch(uBed, q, 0).r + texelFetch(textureWater, q, 0).r;
}
float depthAt(ivec2 q) {
  ivec2 R = ivec2(resolution);
  if (q.x < 0 || q.y < 0 || q.x >= R.x || q.y >= R.y) return 0.0;
  return texelFetch(textureWater, q, 0).r;
}
float pipe(float f, float h, float hn, float dH) {
  // wet cross-section of the pipe (upwind-ish: the deeper side)
  float hE = max(h, hn);
  if (hE < 1e-4) return 0.0;
  float a = uDt * G_ACC * hE * uCell * dH / uCell;
  float u = abs(f) / (uCell * max(hE, 0.05));
  float fr = 1.0 + uDt * G_ACC * uManning * uManning * u / pow(max(hE, 0.05), 1.3333);
  return max(0.0, (f + a) / fr);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float b = texelFetch(uBed, p, 0).r;
  float h = texelFetch(textureWater, p, 0).r;
  float H = b + h;
  vec4 f = texelFetch(textureFlux, p, 0);
  vec4 o;
  o.x = pipe(f.x, h, depthAt(p + ivec2(-1, 0)), H - headAt(p + ivec2(-1, 0), b));
  o.y = pipe(f.y, h, depthAt(p + ivec2(1, 0)), H - headAt(p + ivec2(1, 0), b));
  o.z = pipe(f.z, h, depthAt(p + ivec2(0, -1)), H - headAt(p + ivec2(0, -1), b));
  o.w = pipe(f.w, h, depthAt(p + ivec2(0, 1)), H - headAt(p + ivec2(0, 1), b));
  // never send out more water than the cell holds this step
  float out_ = o.x + o.y + o.z + o.w;
  float vol = h * uCell * uCell;
  if (out_ * uDt > vol) o *= vol / max(out_ * uDt, 1e-9);
  gl_FragColor = o;
}
`

const waterShader = /* glsl */ `
uniform sampler2D textureFlux;
uniform sampler2D textureWater;
uniform float uDt;
uniform float uCell;
uniform vec2 uSrc;
uniform float uSrcR;
uniform float uSrcQ;
uniform float uRain;

vec4 fluxAt(ivec2 q) {
  ivec2 R = ivec2(resolution);
  if (q.x < 0 || q.y < 0 || q.x >= R.x || q.y >= R.y) return vec4(0.0);
  return texelFetch(textureFlux, q, 0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 w = texelFetch(textureWater, p, 0);
  vec4 f = texelFetch(textureFlux, p, 0);
  vec4 fl = fluxAt(p + ivec2(-1, 0));
  vec4 fr = fluxAt(p + ivec2(1, 0));
  vec4 fu = fluxAt(p + ivec2(0, -1));
  vec4 fd = fluxAt(p + ivec2(0, 1));
  float inflow = fl.y + fr.x + fu.w + fd.z;
  float outflow = f.x + f.y + f.z + f.w;
  float dV = uDt * (inflow - outflow);
  if (uSrcQ > 0.0 && distance(vec2(p), uSrc) <= uSrcR) dV += uSrcQ * uDt;
  dV += uRain * uDt * uCell * uCell;
  float h0 = w.r;
  float h = max(0.0, h0 + dV / (uCell * uCell));
  if (isnan(h) || isinf(h)) h = 0.0; // a bad cell must never spread
  float hm = max(0.5 * (h0 + h), 0.05);
  float ux = 0.5 * ((fl.y - f.x) + (f.y - fr.x)) / (uCell * hm);
  float uy = 0.5 * ((fu.w - f.z) + (f.w - fd.z)) / (uCell * hm);
  float speed = h > 0.01 ? min(length(vec2(ux, uy)), 40.0) : 0.0;
  gl_FragColor = vec4(h, speed, (h - h0) / uDt, max(w.a, h));
}
`

export interface SimGrid {
  cols: number
  rows: number
  /** cell size (m) */
  cell: number
  /** bed elevation (m), row-major, row 0 = north */
  bed: Float32Array
}

export interface SimStats {
  /** wet cells (> 0.1 m) */
  wet: number
  areaKm2: number
  maxDepth: number
  maxSpeed: number
  /** water volume now in the domain (m³) */
  volume: number
  /** depth per cell (m) for exposure lookups */
  depth: Float32Array
  /** peak depth per cell so far (m) */
  maxDepthGrid: Float32Array
}

export class FloodSim {
  readonly grid: SimGrid
  private gpu: GPUComputationRenderer
  private renderer: THREE.WebGLRenderer
  private bedTex: THREE.DataTexture
  /** ping-pong targets; index `cur` holds the latest state */
  private fluxRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private waterRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private cur = 0
  private fluxMat: THREE.ShaderMaterial
  private waterMat: THREE.ShaderMaterial
  private readBuf: Float32Array
  /** simulated seconds since reset */
  t = 0
  /** volume injected by sources + rain since reset (m³) */
  injected = 0
  private src = { col: 0, row: 0, radius: 1, q: 0, cells: 1 }
  private rain = 0
  manning = 0.045

  constructor(renderer: THREE.WebGLRenderer, grid: SimGrid) {
    this.renderer = renderer
    this.grid = grid
    const { cols, rows } = grid
    // used only for its full-screen-quad pass + float render targets; the two
    // passes are sequenced by hand (its compute() would feed the water pass
    // the previous step's flux and break mass conservation)
    this.gpu = new GPUComputationRenderer(cols, rows, renderer)
    this.bedTex = new THREE.DataTexture(grid.bed, cols, rows, THREE.RedFormat, THREE.FloatType)
    this.bedTex.needsUpdate = true
    const rt = () =>
      this.gpu.createRenderTarget(cols, rows, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter)
    this.fluxRT = [rt(), rt()]
    this.waterRT = [rt(), rt()]
    this.fluxMat = this.gpu.createShaderMaterial(fluxShader, {
      textureFlux: { value: null },
      textureWater: { value: null },
      uBed: { value: this.bedTex },
      uDt: { value: 1 },
      uCell: { value: grid.cell },
      uManning: { value: this.manning },
    })
    this.fluxMat.defines.G_ACC = G.toFixed(3)
    this.waterMat = this.gpu.createShaderMaterial(waterShader, {
      textureFlux: { value: null },
      textureWater: { value: null },
      uDt: { value: 1 },
      uCell: { value: grid.cell },
      uSrc: { value: new THREE.Vector2() },
      uSrcR: { value: 1 },
      uSrcQ: { value: 0 },
      uRain: { value: 0 },
    })
    const gl = renderer.getContext() as WebGL2RenderingContext
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('this GPU cannot render float textures')
    this.readBuf = new Float32Array(cols * rows * 4)
    this.reset()
  }

  /** Water texture for rendering: R depth, G speed, B dh/dt, A max depth. */
  get texture(): THREE.Texture {
    return this.waterRT[this.cur].texture
  }

  /** Discharge source (m³/s) over a disc of `radiusCells` around a cell. */
  setSource(col: number, row: number, radiusCells: number, q: number) {
    let cells = 0
    const r = Math.max(0.5, radiusCells)
    for (let y = Math.floor(row - r); y <= Math.ceil(row + r); y++) {
      for (let x = Math.floor(col - r); x <= Math.ceil(col + r); x++) {
        if (x < 0 || y < 0 || x >= this.grid.cols || y >= this.grid.rows) continue
        if (Math.hypot(x - col, y - row) <= r) cells++
      }
    }
    this.src = { col, row, radius: r, q: Math.max(0, q), cells: Math.max(1, cells) }
  }

  /** Uniform rain over the domain (mm/h). */
  setRain(mmPerHour: number) {
    this.rain = Math.max(0, mmPerHour) / 1000 / 3600
  }

  /** Advance `n` steps of `dt` seconds. */
  step(n: number, dt: number) {
    const fu = this.fluxMat.uniforms
    const wu = this.waterMat.uniforms
    fu.uDt.value = dt
    fu.uManning.value = this.manning
    wu.uDt.value = dt
    wu.uSrc.value.set(this.src.col, this.src.row)
    wu.uSrcR.value = this.src.radius
    wu.uSrcQ.value = this.src.q / this.src.cells
    wu.uRain.value = this.rain
    for (let i = 0; i < n; i++) {
      const nxt = 1 - this.cur
      fu.textureWater.value = this.waterRT[this.cur].texture
      fu.textureFlux.value = this.fluxRT[this.cur].texture
      this.gpu.doRenderTarget(this.fluxMat, this.fluxRT[nxt])
      wu.textureWater.value = this.waterRT[this.cur].texture
      wu.textureFlux.value = this.fluxRT[nxt].texture
      this.gpu.doRenderTarget(this.waterMat, this.waterRT[nxt])
      this.cur = nxt
      this.t += dt
      this.injected += (this.src.q + this.rain * this.grid.cols * this.grid.rows * this.grid.cell ** 2) * dt
    }
  }

  /** Read the water state back without stalling the frame (GPU fence +
   *  async copy); a few MB — call a couple of times a second, one at a time. */
  async stats(): Promise<SimStats> {
    const { cols, rows, cell } = this.grid
    await this.renderer.readRenderTargetPixelsAsync(this.waterRT[this.cur], 0, 0, cols, rows, this.readBuf)
    const n = cols * rows
    const depth = new Float32Array(n)
    const maxDepthGrid = new Float32Array(n)
    let wet = 0
    let maxDepth = 0
    let maxSpeed = 0
    let volume = 0
    for (let k = 0; k < n; k++) {
      const h = this.readBuf[k * 4]
      depth[k] = h
      maxDepthGrid[k] = this.readBuf[k * 4 + 3]
      volume += h
      if (h > 0.1) {
        wet++
        if (h > maxDepth) maxDepth = h
        const s = this.readBuf[k * 4 + 1]
        if (s > maxSpeed) maxSpeed = s
      }
    }
    return { wet, areaKm2: (wet * cell * cell) / 1e6, maxDepth, maxSpeed, volume: volume * cell * cell, depth, maxDepthGrid }
  }

  /** Stable step for the current depth: CFL 0.35 on √(g·h), with headroom
   *  for the depth to double before the next measurement. */
  stableDt(maxDepth: number): number {
    return Math.min(1, Math.max(0.05, (0.35 * this.grid.cell) / Math.sqrt(G * Math.max(maxDepth * 2, 2))))
  }

  /** Back to a dry domain at t = 0. */
  reset() {
    const blank = this.gpu.createTexture()
    for (const rt of [...this.fluxRT, ...this.waterRT]) this.gpu.renderTexture(blank, rt)
    blank.dispose()
    this.cur = 0
    this.t = 0
    this.injected = 0
  }

  dispose() {
    for (const rt of [...this.fluxRT, ...this.waterRT]) rt.dispose()
    this.fluxMat.dispose()
    this.waterMat.dispose()
    this.gpu.dispose()
    this.bedTex.dispose()
  }
}
