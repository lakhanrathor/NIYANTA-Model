import { useEffect, useState } from 'react'
import type { Frame } from '../../lib/api'
import { clock, EM_DASH } from '../../lib/format'
import { Icon, Panel, Seg } from '../../components/ui'
import { FrameStrip } from '../../components/FrameStrip'
import { useRiverContext } from '../../lib/river-context'
import { useMapScopes } from '../../lib/useMapScope'
import { FRAME_FIELDS, type CompareField } from '../../components/flood/rasterFields'

/**
 * Frame scrubber + live playback + filmstrip, all context-backed: the frame
 * cursor and max-view live in the map scopes (one write fans out to every
 * scope passed in), so both panes and the strip read the same truth. Panes
 * apply the frame only to fields with per-frame tiles (`FRAME_FIELDS`).
 */
export function CompareTimePanel({
  scopes,
  thumbs,
  simHours,
}: {
  scopes: string | string[]
  thumbs: Frame[]
  simHours: number | null
}) {
  const { intent, publishAll, keys } = useMapScopes(scopes)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')

  const frameCount = thumbs.length
  const frame = intent?.frame ?? 0
  const showMax = intent?.showMax ?? true
  const field = (intent?.field ?? 'depth') as CompareField
  const framed = FRAME_FIELDS.has(field)
  const last = Math.max(0, frameCount - 1)

  // Open on max extent; the first scrub takes over from there.
  useEffect(() => {
    if (showMax && frameCount > 0 && frame !== frameCount - 1) publishAll({ frame: frameCount - 1 })
  }, [showMax, frameCount, frame, publishAll])

  // Live playback: advance one frame per tick, loop at the end.
  useEffect(() => {
    if (!playing || frameCount <= 1) return
    const raw = 1000 / Number(speed)
    const ms = Number.isFinite(raw) && raw > 0 ? raw : 1000
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

  return (
    <Panel title="Time Step">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          title="First frame"
          onClick={() => setF(0)}
          className="flex h-6 w-6 items-center justify-center rounded border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]"
        >
          <Icon name="skipBack" size={13} />
        </button>
        <button
          title={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
          className="flex h-6 w-6 items-center justify-center rounded border border-[var(--line-strong)] text-[var(--accent)] hover:border-[var(--accent)]"
        >
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <button
          title="Last frame"
          onClick={() => setF(last)}
          className="flex h-6 w-6 items-center justify-center rounded border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]"
        >
          <Icon name="skipFwd" size={13} />
        </button>
        <button
          title="Max-extent union grid (every cell's deepest moment)"
          onClick={showMaxView}
          className={`h-6 rounded border px-2 text-[10px] font-semibold ${
            showMax
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]'
          }`}
        >
          Max
        </button>
        <span className="num ml-1 truncate text-[11px] text-[var(--muted)]">
          {showMax ? 'Max extent' : (thumbs[frame]?.t_label ?? EM_DASH)} /{' '}
          {simHours != null ? clock(simHours * 3600) : EM_DASH}
        </span>
      </div>
      <div className="px-3 pb-2">
        <input
          type="range"
          min={0}
          max={last}
          value={frame}
          disabled={frameCount === 0}
          onChange={(e) => setF(Number(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded bg-[var(--line)] accent-[var(--accent)]"
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="text-[11px] text-[var(--muted)]">Playback Speed</span>
        <Seg
          size="sm"
          options={['0.5', '1', '2', '4'].map((s) => ({ value: s, label: `${s}x` }))}
          value={speed}
          onChange={setSpeed}
        />
      </div>
      <div className="px-3 pb-2">
        <FrameStrip compact scope={scopes} frames={thumbs} simHours={simHours} />
      </div>
      {!framed && (
        <p className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] leading-snug text-[var(--faint)]">
          This field has no per-frame tiles — the map shows the maximum grid.
        </p>
      )}
    </Panel>
  )
}
