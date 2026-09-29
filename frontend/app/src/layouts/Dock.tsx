import type { ReactNode } from 'react'
import { Icon } from '../components/ui'

interface Props {
  title: string
  open: boolean
  onToggle: () => void
  /** Page-owned header row (status, ids, actions) — the dock only frames it. */
  header?: ReactNode
  children: ReactNode
}

/**
 * The strip docked below the map. Collapsible; the page owns the header and
 * the content — the dock only manages showing. (Run docks its Console/Logs
 * here; another page may dock a timeline or telemetry.)
 */
export function Dock({ title, open, onToggle, header, children }: Props) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title={`Show ${title}`}
        className="flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white text-[11px] font-semibold text-[var(--accent)] shadow-sm transition-colors hover:border-[var(--accent)]"
      >
        <Icon name="chevronUp" size={13} />
        {title}
      </button>
    )
  }
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm">
      <div className="flex items-center gap-2 bg-[var(--bg-subtle)] px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
        <button
          onClick={onToggle}
          title={`Hide ${title}`}
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)]"
        >
          Hide
          <Icon name="chevronDown" size={13} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">{children}</div>
    </div>
  )
}
