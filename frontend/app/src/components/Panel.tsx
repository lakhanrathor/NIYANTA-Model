import type { ReactNode } from 'react'
import { useRailFold } from './rail'
import { Icon } from './ui'

/** A titled flat panel. Flat, 1px border, dense — no glass, no glow. */
export function Panel({
  title,
  actions,
  children,
  className = '',
  pinned = false,
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** never folds inside a rail */
  pinned?: boolean
}) {
  const fold = useRailFold(pinned ? null : title)
  return (
    <section className={`panel flex min-h-0 flex-col ${fold.open ? className : ''}`}>
      {title && (
        <header
          className={`flex h-10 shrink-0 items-center gap-2 px-3.5 ${fold.open ? 'border-b border-[var(--line)]' : ''} ${
            fold.foldable ? 'cursor-pointer select-none hover:bg-[var(--bg-subtle)]' : ''
          }`}
          onClick={fold.foldable ? fold.toggle : undefined}
          aria-expanded={fold.foldable ? fold.open : undefined}
        >
          {fold.foldable && (
            <Icon name={fold.open ? 'chevronDown' : 'chevronRight'} size={12} className="text-[var(--faint)]" />
          )}
          <h2 className="text-[12.5px] font-semibold text-[var(--text)]">{title}</h2>
          {fold.open && (
            <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
        </header>
      )}
      {fold.open && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
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
