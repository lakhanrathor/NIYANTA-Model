import { clock, num } from '../../lib/format'
import { usePlayer } from './PlayerProvider'
import { outflowAt, type StoryEvent } from './story'
import { useStory } from './useStory'

const ICON: Record<StoryEvent['kind'], string> = {
  breach: '💥',
  peak: '🌊',
  building: '🏠',
  road: '🛣️',
  bridge: '🌉',
  gauge: '📍',
  extent: '🗺️',
  recede: '↘️',
}

/**
 * Viewport narration: what the model is showing right now (latest event at
 * or before the playhead), what happens next, and the live breach outflow.
 * Every line comes from the run's outputs — see story.ts.
 */
export function StoryCaption() {
  const { frameT, hydro } = usePlayer()
  const events = useStory()
  if (frameT == null || !events.length) return null
  const nowIdx = events.reduce((k, e, i) => (e.t <= frameT + 1e-6 ? i : k), -1)
  const now = nowIdx >= 0 ? events[nowIdx] : null
  const next = events[nowIdx + 1] ?? null
  const q = outflowAt(hydro.data, frameT)

  return (
    <div className="pointer-events-none mx-auto w-[min(560px,calc(100%-24px))]">
      <div className="rounded-lg border border-white/40 bg-slate-900/80 px-3.5 py-2 text-white shadow-lg backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-sky-200">T+{clock(frameT)}</span>
          <span className="truncate text-[13.5px] font-semibold">
            {now ? `${ICON[now.kind]} ${now.title}` : 'Before the breach'}
          </span>
        </div>
        {now?.detail && <div className="truncate text-[11px] text-slate-300">{now.detail}</div>}
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10.5px] text-slate-300">
          {q != null && (
            <span>
              Breach outflow now <b className="font-mono text-white">{num(q, 0)} m³/s</b>
            </span>
          )}
          {next && (
            <span className="truncate">
              Next in {clock(Math.max(0, next.t - frameT))}: {next.title}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
