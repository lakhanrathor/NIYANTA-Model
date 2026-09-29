import { useEffect, useState } from 'react'
import type { Frame } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { Icon, Pill, Seg } from '../../components/ui'
import { FrameStrip } from '../../components/FrameStrip'
import { useRiverContext } from '../../lib/river-context'
import { useMapScopes } from '../../lib/useMapScope'

/**
 * Interactive simulation timeline: playback controls, scrubber, and the
 * shared filmstrip. Frame cursor and max-view live in the map scope — the
 * panes read the same context, so strip and map can never disagree. Playback
 * speed is the only local state (a player cadence, not shared truth).
 */
export function ResultsTimelinePanel({
  scope,
  thumbs,
  simHours,
  reachKm,
}: {
  scope: string | string[]
  thumbs: Frame[]
  simHours: number | null
  reachKm: number
}) {
  const { intent, publishAll, keys } = useMapScopes(scope)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')

  const frameCount = thumbs.length
  const frame = intent?.frame ?? 0
  const showMax = intent?.showMax ?? true
  const last = Math.max(0, frameCount - 1)

  // Open on max extent; the first scrub takes over from there.
  useEffect(() => {
    if (showMax && frameCount > 0 && frame !== frameCount - 1) publishAll({ frame: frameCount - 1 })
  }, [showMax, frameCount, frame, publishAll])

  // Live playback: advance one frame per tick, loop at the end.
  useEffect(() => {
    if (!playing || frameCount <= 1) return
    const raw = 1200 / Number(speed)
    const ms = Number.isFinite(raw) && raw > 0 ? raw : 1200
    const t = window.setInterval(() => {
      const st = useRiverContext.getState()
      const cur = keys.length ? (st.mapIntents[keys[0]]?.frame ?? 0) : 0
      publishAll({ frame: cur + 1 >= frameCount ? 0 : cur + 1, showMax: false })
    }, ms)
    return () => window.clearInterval(t)
  }, [playing, speed, frameCount, keys, publishAll])

  const setF = (n: number) => publishAll({ frame: n, showMax: false })
  const togglePlay = () => {
    if (!playing) publishAll({ showMax: false })
    setPlaying((p) => !p)
  }
  const showMaxView = () => {
    setPlaying(false)
    publishAll({ showMax: true })
  }
  const tLabel =
    showMax || simHours == null || frameCount <= 1
      ? showMax
        ? 'Max extent'
        : EM_DASH
      : `T+${((frame * simHours) / (frameCount - 1)).toFixed(1)} h`

  return (
    <div className="shrink-0 rounded-xl border border-[var(--line)] bg-white p-2 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-2">
        {/* Playback Controls & Frame Navigation */}
        <div className="flex items-center gap-2">
          <button
            title="First frame (Breach Start)"
            onClick={() => setF(0)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-sky-50 transition-colors"
          >
            <Icon name="skipBack" size={14} />
          </button>
          <button
            title={playing ? 'Pause Simulation' : 'Play Inundation Progression'}
            onClick={togglePlay}
            className={`flex h-8 items-center gap-1.5 px-3.5 rounded-lg font-semibold text-[12px] transition-all shadow-xs ${
              playing
                ? 'bg-amber-500 text-white shadow-amber-200 ring-2 ring-amber-300 animate-pulse'
                : 'bg-[var(--accent)] text-white hover:bg-blue-700'
            }`}
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
            <span>{playing ? 'Pause' : 'Play Timeline'}</span>
          </button>
          <button
            title="Previous Step"
            onClick={() => setF(Math.max(0, frame - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            title="Next Step"
            onClick={() => setF(Math.min(last, frame + 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <Icon name="chevronRight" size={14} />
          </button>
          <button
            title="Last Frame (Max Extent)"
            onClick={() => setF(last)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-sky-50 transition-colors"
          >
            <Icon name="skipFwd" size={14} />
          </button>
          <button
            title="Max-extent union grid (every cell's deepest moment)"
            onClick={showMaxView}
            className={`h-8 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
              showMax
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--line)] text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)]'
            }`}
          >
            Max
          </button>
        </div>

        {/* Time Step & Progress Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1 rounded-lg">
            <span className="text-[10px] uppercase font-bold text-[var(--muted)]">Sim Time:</span>
            <span className="font-mono text-[13px] font-bold text-slate-900">{tLabel}</span>
            <span className="text-[11px] text-[var(--muted)]">
              / {simHours != null ? `${num(simHours, 1)} h` : EM_DASH}
            </span>
            <Pill tone={showMax ? 'ok' : frame === 0 ? 'accent' : frame === last ? 'bad' : 'ok'}>
              {showMax ? 'Max union' : `Frame ${frame + 1}/${frameCount}`}
            </Pill>
          </div>

          {/* Speed selector */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[var(--muted)] font-medium">Speed:</span>
            <Seg
              size="sm"
              options={['0.5', '1', '2', '4'].map((s) => ({ value: s, label: `${s}x` }))}
              value={speed}
              onChange={setSpeed}
            />
          </div>
        </div>
      </div>

      {/* Time Scrubber Slider */}
      <div className="pt-1.5 pb-0.5">
        <input
          type="range"
          min={0}
          max={last}
          value={frame}
          onChange={(e) => setF(Number(e.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[9px] text-[var(--muted)] pt-0.5 font-mono">
          <span>T+0.0h (Breach Initiation)</span>
          <span>{simHours != null ? `T+${(simHours * 0.5).toFixed(1)}h` : EM_DASH} (Wave Peak Surge)</span>
          <span>{simHours != null ? `T+${num(simHours, 1)}h` : EM_DASH} (Max Inundation)</span>
        </div>
      </div>

      {/* Frame Thumbnail Preview Cards with Water Level Indicator */}
      <FrameStrip
        compact
        scope={scope}
        frames={thumbs}
        simHours={simHours}
        caption={(idx, total) =>
          idx === 0
            ? 'Reservoir breach'
            : idx === total - 1
              ? 'Max domain reach'
              : `Wave advance ${(idx * (reachKm / total)).toFixed(0)}km`
        }
      />
    </div>
  )
}
