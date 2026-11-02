import * as THREE from 'three'

/**
 * GPU water surface for the 3D player. Every depth frame of the run lives in
 * one texture array; the vertex shader blends frame A→B by `uMix` so playback
 * is continuous at the display frame rate, and lifts each vertex to
 * bed + depth (true scale × the analyst's water exaggeration).
 *
 * Look ("natural" mode): colour deepens with depth, ripples drift down the
 * water-surface slope (the direction water actually flows), white foam marks
 * cells whose depth is rising — the advancing flood front — and the wet edge.
 * Analyst modes colour by the server ramps (depth / arrival / peak velocity).
 * Physics is untouched: heights and colours come only from solver frames.
 */

export const WATER_MODE = { natural: 0, depth: 1, overlay: 2 } as const

const vertex = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uDepth;
uniform sampler2D uLive;
uniform sampler2D uBed;
uniform vec2 uGrid;
uniform vec2 uCell;
uniform int uFrameA;
uniform int uFrameB;
uniform float uMix;
uniform float uBedScale;
uniform float uDepthScale;

out float vDepth;
out float vRise;
out vec3 vWorld;
out vec3 vNormalW;
out vec2 vFlow;
out vec2 vTex;
out float vSpeed;

#include <fog_pars_vertex>

ivec2 clampCell(ivec2 p) { return clamp(p, ivec2(0), ivec2(uGrid) - 1); }
#ifdef LIVE
// live simulation texture: R depth, G speed, B dh/dt
float depthMix(ivec2 p) { return texelFetch(uLive, clampCell(p), 0).r; }
#else
float depthAt(ivec2 p, int layer) { return texelFetch(uDepth, ivec3(clampCell(p), layer), 0).r; }
float depthMix(ivec2 p) { return mix(depthAt(p, uFrameA), depthAt(p, uFrameB), uMix); }
#endif
float bedAt(ivec2 p) { return texelFetch(uBed, clampCell(p), 0).r * uBedScale; }
float surfAt(ivec2 p) { return bedAt(p) + depthMix(p) * uDepthScale; }

void main() {
  ivec2 cell = ivec2(round(uv.x * (uGrid.x - 1.0)), round((1.0 - uv.y) * (uGrid.y - 1.0)));
  float d = max(depthMix(cell), 0.0);
  float bed = bedAt(cell);
  vDepth = d;
  // a dry vertex next to wet cells carries their water level, so a river one
  // or two cells wide renders at its full width and meets the bank exactly
  // (terrain above that level hides the rest)
  float level = -1e9;
  if (d <= 0.01) {
    ivec2 nb[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    for (int k = 0; k < 4; k++) {
      if (depthMix(cell + nb[k]) > 0.01) level = max(level, surfAt(cell + nb[k]));
    }
  }
#ifdef LIVE
  vec4 lv = texelFetch(uLive, clampCell(cell), 0);
  vRise = lv.b * 30.0; // metres of rise per 30 s — same scale as one solver frame
  vSpeed = lv.g;
#else
  vRise = depthAt(cell, uFrameB) - depthAt(cell, uFrameA);
  vSpeed = 0.0;
#endif
  vTex = vec2(cell) / max(uGrid - 1.0, vec2(1.0));
  // dry vertices with no wet neighbour tuck under the bed
  float y = d > 0.01 ? bed + d * uDepthScale + 0.04 : level > -1e8 ? level + 0.04 : bed - 0.35;
  if (d <= 0.01 && level > -1e8) vDepth = 0.15;

  float hx = surfAt(cell + ivec2(1, 0)) - surfAt(cell - ivec2(1, 0));
  float hz = surfAt(cell + ivec2(0, 1)) - surfAt(cell - ivec2(0, 1));
  vec2 g = vec2(hx / (2.0 * uCell.x), hz / (2.0 * uCell.y));
  vNormalW = normalize(vec3(-g.x, 1.0, -g.y));
  vFlow = -g; // downhill on the water surface

  vec4 world = modelMatrix * vec4(position.x, y, position.z, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
uniform int uMode;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform sampler2D uRamp;
uniform float uRampMin;
uniform float uRampMax;
uniform sampler2D uOverlay;
uniform sampler2D uOverlayRamp;
uniform float uOvMin;
uniform float uOvMax;
uniform vec2 uGrid;

in float vDepth;
in float vRise;
in vec3 vWorld;
in vec3 vNormalW;
in vec2 vFlow;
in vec2 vTex;
in float vSpeed;

#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float ripples(vec2 p, vec2 off) {
  return noise(p * 1.1 - off) * 0.6 + noise(p * 2.9 - off * 1.8 + 7.3) * 0.3 + noise(p * 6.1 - off * 2.6 + 3.1) * 0.1;
}

void main() {
  float wet = smoothstep(0.01, 0.12, vDepth);
  if (wet < 0.02) discard;

  float slope = length(vFlow);
  vec2 dir = slope > 1e-5 ? vFlow / slope : vec2(0.6, 0.8);
  // ripples drift with the flow; faster on steeper water
  vec2 off = dir * uTime * (0.25 + min(slope * 60.0, 2.5));
  vec2 p = vWorld.xz * 0.55;
  float e = 0.08;
  float r0 = ripples(p, off);
  vec2 rg = vec2(ripples(p + vec2(e, 0.0), off) - r0, ripples(p + vec2(0.0, e), off) - r0) / e;
  vec3 n = normalize(vNormalW + vec3(-rg.x, 0.0, -rg.y) * 0.18);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);
  float diff = max(dot(n, L), 0.0) * 0.55 + 0.45;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 90.0);

  vec3 col;
  float alpha = uOpacity;
  if (uMode == 0) {
    // saturated flood blue so it reads against forest and satellite imagery
    vec3 shallow = vec3(0.05, 0.45, 0.85);
    vec3 deep = vec3(0.01, 0.13, 0.48);
    col = mix(shallow, deep, 1.0 - exp(-vDepth / 4.0)) * diff;
    col = mix(col, uSky, fres * 0.25) + spec * 0.7;
    // foam: rising water (the front) + the thin wet edge
    float front = smoothstep(0.02, 0.5, vRise);
    float edge = (1.0 - smoothstep(0.03, 0.45, vDepth)) * 0.3;
    float fn = noise(p * 3.7 - off * 2.0);
    float white = smoothstep(5.0, 12.0, vSpeed); // fast water churns white (live mode)
    float foam = clamp(front * 0.95 + edge * 0.55 + white * 0.7, 0.0, 1.0) * smoothstep(0.25, 0.7, fn + front * 0.45 + white * 0.3);
    col = mix(col, vec3(0.92, 0.95, 0.97), foam);
    alpha = mix(uOpacity, 1.0, foam * 0.7);
  } else if (uMode == 1) {
    float t = clamp((vDepth - uRampMin) / max(uRampMax - uRampMin, 1e-6), 0.0, 1.0);
    col = texture(uRamp, vec2(t, 0.5)).rgb * diff + spec * 0.4;
  } else {
    ivec2 c = ivec2(round(vTex * (uGrid - 1.0)));
    float v = texelFetch(uOverlay, c, 0).r;
    if (v < -1.0e8) {
      col = vec3(0.02, 0.4, 0.62) * diff;
    } else {
      float t = clamp((v - uOvMin) / max(uOvMax - uOvMin, 1e-6), 0.0, 1.0);
      col = texture(uOverlayRamp, vec2(t, 0.5)).rgb * diff + spec * 0.4;
    }
  }
  gl_FragColor = vec4(col, alpha * wet);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const blank = () => {
  const t = new THREE.DataTexture(new Float32Array([-1e9]), 1, 1, THREE.RedFormat, THREE.FloatType)
  t.needsUpdate = true
  return t
}
const blankRamp = () => {
  const t = new THREE.DataTexture(new Uint8Array([0, 110, 170, 255]), 1, 1, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** `live`: depth comes from a simulation texture (`uLive`) instead of frames. */
export function createWaterMaterial(opts: { live?: boolean } = {}): THREE.ShaderMaterial {
  const empty = new THREE.DataArrayTexture(new Uint16Array(1), 1, 1, 1)
  empty.format = THREE.RedFormat
  empty.type = THREE.HalfFloatType
  empty.needsUpdate = true
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: opts.live ? { LIVE: '' } : {},
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    // (UniformsUtils.merge would clone the textures and lose their upload flag)
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uDepth: { value: empty },
      uLive: { value: null },
      uBed: { value: blank() },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uCell: { value: new THREE.Vector2(1, 1) },
      uFrameA: { value: 0 },
      uFrameB: { value: 0 },
      uMix: { value: 0 },
      uBedScale: { value: 1 },
      uDepthScale: { value: 1 },
      uMode: { value: WATER_MODE.natural },
      uTime: { value: 0 },
      uOpacity: { value: 0.95 },
      uSunDir: { value: new THREE.Vector3(250, 480, 220).normalize() },
      uSky: { value: new THREE.Color('#cfdbe8') },
      uRamp: { value: blankRamp() },
      uRampMin: { value: 0 },
      uRampMax: { value: 1 },
      uOverlay: { value: blank() },
      uOverlayRamp: { value: blankRamp() },
      uOvMin: { value: 0 },
      uOvMax: { value: 1 },
    },
  })
}

/** Server colour ramp (sRGB stops) → 256-texel lookup texture + its value range. */
export function rampTexture(
  vs: number[],
  cols: [number, number, number][],
): { tex: THREE.DataTexture; min: number; max: number } {
  const N = 256
  const min = vs[0]
  const max = vs[vs.length - 1]
  const data = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) {
    const v = min + ((max - min) * i) / (N - 1)
    let k = 0
    while (k < vs.length - 2 && v > vs[k + 1]) k++
    const t = Math.min(1, Math.max(0, (v - vs[k]) / Math.max(1e-9, vs[k + 1] - vs[k])))
    for (let j = 0; j < 3; j++) data[i * 4 + j] = Math.round(cols[k][j] + (cols[k + 1][j] - cols[k][j]) * t)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return { tex, min, max }
}

/** Parsed `/runs/{id}/frames.bin`: header + raw float16 bits (n, rows, cols). */
export interface FrameStack {
  n: number
  rows: number
  cols: number
  step: number
  times_s: number[]
  max_depth_m: number
  half: Uint16Array
}

export function parseFrameStack(buf: ArrayBuffer): FrameStack | null {
  if (buf.byteLength < 8) return null
  const len = new DataView(buf).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as Omit<FrameStack, 'half'>
  const off = 4 + len
  const count = head.n * head.rows * head.cols
  if (off % 2 || buf.byteLength < off + count * 2) return null
  return { ...head, half: new Uint16Array(buf, off, count) }
}
