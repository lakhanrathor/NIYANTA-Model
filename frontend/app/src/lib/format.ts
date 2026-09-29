/** Units, coordinates, tabular numerals. Nothing renders a raw float. */

export const EM_DASH = '—'

function bad(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number.isNaN(value)
}

/** Thousands-separated plain number (no unit). */
export function num(value: number | null | undefined, digits = 0): string {
  if (bad(value)) return EM_DASH
  return value!.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function m(value: number | null | undefined, digits = 2): string {
  if (bad(value)) return EM_DASH
  return `${num(value, digits)} m`
}

export function km(value: number | null | undefined, digits = 1): string {
  if (bad(value)) return EM_DASH
  return `${num(value, digits)} km`
}

export function km2(value: number | null | undefined, digits = 2): string {
  if (bad(value)) return EM_DASH
  return `${num(value, digits)} km²`
}

export function cms(value: number | null | undefined, digits = 0): string {
  if (bad(value)) return EM_DASH
  return `${num(value, digits)} m³/s`
}

export function people(value: number | null | undefined): string {
  if (bad(value)) return EM_DASH
  return `${num(value, 0)} people`
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (bad(value)) return EM_DASH
  return `${num(value, digits)}%`
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/** `30.1451° N, 78.5975° E` */
export function latLon(lat: number | null | undefined, lon: number | null | undefined): string {
  if (bad(lat) || bad(lon)) return EM_DASH
  const ns = lat! >= 0 ? 'N' : 'S'
  const ew = lon! >= 0 ? 'E' : 'W'
  return `${Math.abs(lat!).toFixed(4)}° ${ns}, ${Math.abs(lon!).toFixed(4)}° ${ew}`
}

export function dms(lon: number, lat: number): string {
  const fmt = (v: number, pos: string, neg: string) => {
    const hemi = v >= 0 ? pos : neg
    const abs = Math.abs(v)
    const d = Math.floor(abs)
    const mn = Math.floor((abs - d) * 60)
    const s = ((abs - d) * 60 - mn) * 60
    return `${d}°${String(mn).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`
  }
  return `${fmt(lon, 'E', 'W')} ${fmt(lat, 'N', 'S')}`
}

/** `01:23:45` — always a clock, never a raw second count. */
export function clock(seconds: number | null | undefined): string {
  if (bad(seconds)) return EM_DASH
  const s = Math.max(0, Math.floor(seconds!))
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** `2h ago` / `3d ago`; `—` when the API sent no timestamp. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return EM_DASH
  const delta = Date.now() - t
  const min = Math.floor(delta / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(t).toISOString().slice(0, 10)
}

/** `2026-09-22 09:12` from an ISO string; `—` when absent. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return EM_DASH
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Fixed scientific colour ramp: shallow pale blue → deep purple (never neon). */
export const DEPTH_RAMP = [
  '#eaf3fb',
  '#9ec9ee',
  '#4a9bd8',
  '#1f6fb2',
  '#0d4a86',
  '#5b2a86',
] as const

/** Spec depth stops used by every depth legend in the app. */
export const DEPTH_STOPS = ['0', '0.5', '1', '2', '5', '10', '20+'] as const

/** Sample the ramp at t ∈ [0,1]. */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (DEPTH_RAMP.length - 1)
  const i = Math.floor(x)
  const j = Math.min(DEPTH_RAMP.length - 1, i + 1)
  const f = x - i
  const a = hex(DEPTH_RAMP[i])
  const b = hex(DEPTH_RAMP[j])
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`
}

function hex(h: string): number[] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
}
