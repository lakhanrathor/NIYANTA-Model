import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../components/ui'
import { AREA_DEFAULTS } from './types'

interface Props {
  side: 'left' | 'right'
  title: string
  width: number
  open: boolean
  onWidth: (width: number) => void
  onToggle: () => void
  children: ReactNode
}

/**
 * A layout drawer beside the map. Draggable edge (width, app-level clamps),
 * collapsible to a slim rail. Pages only supply the content.
 */
export function Panel({ side, title, width, open, onWidth, onToggle, children }: Props) {
  const dragging = useRef(false)
  const limits = AREA_DEFAULTS[side]

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      onWidth(
        side === 'left'
          ? Math.max(limits.min, Math.min(limits.max, e.clientX))
          : Math.max(limits.min, Math.min(limits.max, window.innerWidth - e.clientX)),
      )
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [open, side, limits.min, limits.max, onWidth])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  if (!open) {
    return (
      <button
        onClick={onToggle}
        title={`Show ${title}`}
        className="flex w-7 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-white py-3 shadow-sm transition-colors hover:border-[var(--accent)]"
      >
        <Icon name={side === 'left' ? 'chevronRight' : 'chevronLeft'} size={14} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] [writing-mode:vertical-rl]">
          {title}
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-h-0 shrink-0 items-stretch">
      {side === 'right' ? (
        <div
          onMouseDown={startDrag}
          title={`Drag to resize ${title}`}
          className="group relative z-10 flex w-2 cursor-col-resize items-center justify-center transition-colors hover:bg-sky-200 active:bg-sky-400"
        >
          <div className="h-8 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-[var(--accent)]" />
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-1 flex shrink-0 items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{title}</span>
          <button
            onClick={onToggle}
            title={`Hide ${title}`}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--faint)] hover:bg-slate-100 hover:text-[var(--foreground)]"
          >
            <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} size={12} />
          </button>
        </div>
        <div style={{ width: `${width}px` }} className="flex min-h-0 max-w-full flex-1 flex-col gap-2 overflow-y-auto [&>*]:shrink-0">
          {children}
        </div>
      </div>
      {side === 'left' ? (
        <div
          onMouseDown={startDrag}
          title={`Drag to resize ${title}`}
          className="group relative z-10 flex w-2 cursor-col-resize items-center justify-center transition-colors hover:bg-sky-200 active:bg-sky-400"
        >
          <div className="h-8 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-[var(--accent)]" />
        </div>
      ) : null}
    </div>
  )
}
