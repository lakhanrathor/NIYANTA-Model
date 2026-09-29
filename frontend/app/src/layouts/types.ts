/**
 * APP-LEVEL LAYOUT AREAS
 *
 * Every page is composed of the same named areas. The top bar already lives
 * in the app shell (`app.tsx` header: logo, nav, river context, jobs, help).
 * The layouts below own everything under it:
 *
 *   left   — drawer beside the map (scenario, filters, summary…)
 *   center — the map itself (always the flexible area)
 *   right  — drawer beside the map (parameters, outputs, details…)
 *   dock   — the strip docked below the map (logs, timeline, telemetry…)
 *
 * "Dock", not "console": the area is generic — Run happens to dock its
 * Console/Logs there, another page may dock a timeline or a telemetry strip.
 * Pages place components into these slots; dragging, collapsing and showing
 * are managed here, once, for all pages.
 */

export type LayoutArea = 'left' | 'right' | 'dock'

export interface AreaSize {
  width: number
  min: number
  max: number
}

export const AREA_DEFAULTS: Record<'left' | 'right', AreaSize> = {
  left: { width: 330, min: 260, max: 520 },
  right: { width: 420, min: 340, max: 680 },
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function storageKey(layoutId: string, area: LayoutArea, field: 'w' | 'open'): string {
  return `niyanta.layout.${layoutId}.${area}.${field}`
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const v = Number(raw)
    return Number.isFinite(v) ? v : fallback
  } catch {
    return fallback
  }
}

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — sizes just don't persist */
  }
}

export function loadWidth(layoutId: string, area: 'left' | 'right'): number {
  const d = AREA_DEFAULTS[area]
  return clamp(readNumber(storageKey(layoutId, area, 'w'), d.width), d.min, d.max)
}

export function saveWidth(layoutId: string, area: 'left' | 'right', width: number): void {
  write(storageKey(layoutId, area, 'w'), String(width))
}

export function loadOpen(layoutId: string, area: LayoutArea, fallback: boolean): boolean {
  return readOpen(storageKey(layoutId, area, 'open'), fallback)
}

export function saveOpen(layoutId: string, area: LayoutArea, open: boolean): void {
  write(storageKey(layoutId, area, 'open'), open ? '1' : '0')
}
