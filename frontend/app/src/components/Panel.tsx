import type { ReactNode } from 'react'

/** A titled flat panel. Flat, 1px border, dense — no glass, no glow. */
export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}

/** A measured value: monospace, tabular, always with a unit. */
export function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit?: string
  tone?: 'ok' | 'warn' | 'bad'
}) {
  const color =
    tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]' : tone === 'bad' ? 'text-[var(--bad)]' : ''
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-3 py-1.5 last:border-0">
      <span className="text-[11px] text-[var(--muted)]">{label}</span>
      <span className={`num text-[12px] font-medium ${color}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-[var(--faint)]">{unit}</span>}
      </span>
    </div>
  )
}

/** Empty-state copy so no screen ever looks broken. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-[var(--faint)]">
      {children}
    </div>
  )
}
