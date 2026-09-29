import type { Frame } from '../lib/api'
import { EM_DASH } from '../lib/format'
import { useMapScopes } from '../lib/useMapScope'

/**
 * Scrollable filmstrip of run frames — the analyst's time machine. Clicking a
 * card jumps the frame; playback continues from there. Shared by Results
 * (with per-card captions) and Compare (slim), so both screens scrub
 * identically. Times render EM_DASH until the run horizon is known.
 *
 * The frame cursor lives in the river context when `scope` is given (one
 * scope, or several for Compare's synced panes): read from the first scope,
 * every jump publishes `{ frame, showMax: false }` to all of them. The map
 * panes read the same scopes — strip and map can never disagree. Without a
 * scope the legacy `frame`/`onFrame` props drive it.
 */
export function FrameStrip({
  frames,
  frame = 0,
  simHours,
  onFrame,
  caption,
  scope,
  compact = false,
}: {
  frames: Frame[]
  frame?: number
  simHours: number | null
  onFrame?: (n: number) => void
  caption?: (idx: number, total: number) => string | null
  scope?: string | string[]
  /** Slim cards (no captions) for space-tight timelines. */
  compact?: boolean
}) {
  const { intent: shared, publishAll } = useMapScopes(scope ?? [])

  const total = frames.length
  if (!total) return null

  const effFrame = scope ? (shared?.frame ?? 0) : frame
  const jump = (n: number) => {
    if (!scope) {
      onFrame?.(n)
      return
    }
    publishAll({ frame: n, showMax: false })
  }

  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 scrollbar-thin ${compact ? 'pt-1' : 'pt-2'}`}>
      {frames.map((f, idx) => {
        const isActive = idx === effFrame
        const t = simHours != null && total > 1 ? ((idx * simHours) / (total - 1)).toFixed(1) : EM_DASH
        const cap = !compact ? (caption?.(idx, total) ?? null) : null
        return (
          <button
            key={idx}
            onClick={() => jump(idx)}
            title={`${f.t_label || `Frame ${idx + 1}`}${cap ? ` — ${cap}` : ''}`}
            className={`group relative flex shrink-0 flex-col justify-between overflow-hidden rounded-lg border-2 text-left transition-all ${
              compact ? 'h-[52px] w-[92px] p-1' : 'h-[72px] w-[110px] p-1.5'
            } ${
              isActive
                ? 'border-[var(--accent)] bg-blue-50/60 shadow-md ring-2 ring-blue-200'
                : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            {f.thumbnail && (
              <img src={f.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 pointer-events-none" />
            )}
            <div className="flex items-center justify-between text-[10px]">
              <span className={`font-mono font-bold ${isActive ? 'text-[var(--accent)]' : 'text-slate-700'}`}>
                T+{t}h
              </span>
              <span className="text-[9px] text-[var(--muted)]">
                #{idx + 1}
              </span>
            </div>

            {/* Water Level / Wave Progress Bar */}
            <div className="w-full">
              <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-600 transition-all duration-300"
                  style={{ width: `${Math.round(((idx + 1) / total) * 100)}%` }}
                />
              </div>
              {cap && (
                <span className="block truncate text-[9.5px] font-medium text-[var(--muted)]">
                  {cap}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
