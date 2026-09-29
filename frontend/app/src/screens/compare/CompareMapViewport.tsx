import { useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * The big comparison viewport: side-by-side halves, the swipe clip, or the
 * difference map. Panes arrive as render callbacks so each layout mounts its
 * own maps; engine headers, the probe readout and legends ride in as
 * `children` overlays.
 */
export function CompareMapViewport({
  mode,
  split,
  onSplit,
  labelA,
  labelB,
  renderA,
  renderB,
  children,
}: {
  mode: string
  split: number
  onSplit: (pct: number) => void
  labelA: string
  labelB: string
  renderA: () => ReactNode
  renderB: () => ReactNode
  children?: ReactNode
}) {
  const swipeRef = useRef<HTMLDivElement | null>(null)

  const dragTo = (clientX: number) => {
    const el = swipeRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onSplit(Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100)))
  }

  return (
    <div
      ref={swipeRef}
      className="relative h-full min-h-0 overflow-hidden rounded border border-[var(--line)] bg-white"
    >
      {mode === 'side' ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-px bg-[var(--line)]">
          <div className="relative min-h-0">{renderA()}</div>
          <div className="relative min-h-0">{renderB()}</div>
        </div>
      ) : mode === 'diff' ? (
        renderB()
      ) : (
        <>
          {renderA()}
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            {renderB()}
          </div>
          <div
            className="absolute inset-y-0 z-30 w-6 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${split}%` }}
            title="Drag to compare"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.buttons === 1) dragTo(e.clientX)
            }}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
            <span className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--line-strong)] bg-white text-[11px] text-[var(--muted)] shadow-[var(--shadow)]">
              ⟨⟩
            </span>
          </div>
        </>
      )}

      {/* engine headers */}
      <div className="pointer-events-none absolute left-3 top-3 z-40 flex max-w-[60%] flex-col gap-1.5">
        <span
          title={labelA}
          className="num flex items-center gap-1.5 truncate rounded border border-[#b9d7f4] bg-white/95 px-2 py-1 text-[10px] shadow-[var(--shadow)]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#0b6bcb]" />
          <span className="truncate">{labelA} (A)</span>
        </span>
        {mode !== 'diff' && (
          <span
            title={labelB}
            className="num flex items-center gap-1.5 truncate rounded border border-[#f3c1bc] bg-white/95 px-2 py-1 text-[10px] shadow-[var(--shadow)]"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#b42318]" />
            <span className="truncate">{labelB} (B)</span>
          </span>
        )}
      </div>

      {children}
    </div>
  )
}
