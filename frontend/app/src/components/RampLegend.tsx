import type { ReactNode } from 'react'
import type { RampStop } from '../lib/api'
import { EM_DASH } from '../lib/format'

/**
 * Colour-ramp legend drawn from the stops the server actually paints with
 * (`ramps` on /api/comparisons, `ramp` / `extent_ramp` on /api/tiles/…/meta.json).
 * A missing ramp renders an honest note — never a locally invented gradient.
 */
export function RampLegend({
  title,
  stops,
  note,
  width,
  footer,
  className = '',
}: {
  title: ReactNode
  stops: RampStop[] | null | undefined
  /** Small line under the title (units, provenance). */
  note?: ReactNode
  width?: number
  footer?: ReactNode
  className?: string
}) {
  const style = width != null ? { width } : undefined

  if (!stops || stops.length === 0) {
    return (
      <div
        style={style}
        className={`rounded border border-[var(--line)] bg-white/95 px-2.5 py-2 shadow-[var(--shadow)] backdrop-blur-sm ${className}`}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          {title}
        </div>
        <p className="text-[10px] leading-snug text-[var(--faint)]">
          {EM_DASH} · ramp unavailable from the API
        </p>
      </div>
    )
  }

  return (
    <div
      style={style}
      className={`rounded border border-[var(--line)] bg-white/95 px-2.5 py-2 shadow-[var(--shadow)] backdrop-blur-sm ${className}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
        {title}
      </div>
      {note && <div className="mt-0.5 text-[9px] text-[var(--faint)]">{note}</div>}
      <div className="mt-1 flex h-3 overflow-hidden rounded-[2px] border border-[var(--line)]">
        {stops.map((s, i) => (
          <span
            key={`${s.v}-${s.label}-${i}`}
            className="flex-1"
            style={{ background: s.color }}
            title={s.label}
          />
        ))}
      </div>
      <div className="num mt-0.5 flex justify-between gap-1 text-[9px] text-[var(--faint)]">
        {stops.map((s, i) => (
          <span key={`l-${s.v}-${s.label}-${i}`}>{s.label}</span>
        ))}
      </div>
      {footer}
    </div>
  )
}
