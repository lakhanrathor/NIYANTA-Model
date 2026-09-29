import { Icon, Pill, Prov, Seg } from '../../components/ui'
import { usePlayer } from './PlayerProvider'
import type { TimeFormat } from './types'

/**
 * CENTRE BOTTOM — playback chrome. Frame times come from frames.json;
 * thumbnails are server-rendered. No frames → controls disable honestly.
 */
export function PlaybackBar() {
  const {
    frameList, frameCount, clamped, formattedTime,
    setFrame, playing, setPlaying, speed, setSpeed,
    timeFormat, setTimeFormat, framesDoc, runId,
  } = usePlayer()

  const stepBack = () =>
    setFrame((f) => Math.max(0, (frameCount ? Math.min(f, frameCount - 1) : 0) - 1))

  return (
    <div className="shrink-0 rounded-lg border border-[var(--line)] bg-white px-3 pb-2.5 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <button title="First frame" onClick={() => setFrame(0)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]">
            <Icon name="skipBack" size={13} />
          </button>
          <button title="Previous frame" onClick={stepBack} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]">
            <Icon name="chevronLeft" size={13} />
          </button>
          <button
            title={playing ? 'Pause' : 'Play'}
            onClick={() => frameCount > 1 && setPlaying((prev) => !prev)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white ${playing ? 'bg-amber-500' : 'bg-[var(--accent)]'}`}
          >
            <Icon name={playing ? 'pause' : 'play'} size={13} />
            {playing ? 'Pause' : 'Play'}
          </button>
          <button title="Next frame" onClick={() => setFrame((f) => Math.min(frameCount - 1, f + 1))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]">
            <Icon name="chevronRight" size={13} />
          </button>
          <button title="Last frame" onClick={() => setFrame(Math.max(0, frameCount - 1))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--accent)]">
            <Icon name="skipFwd" size={13} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Time</span>
          <span className="num text-[13px] font-semibold">{formattedTime}</span>
          <Pill tone={clamped === 0 ? 'accent' : clamped === frameCount - 1 && frameCount > 0 ? 'bad' : 'ok'}>
            {frameCount ? `Frame ${clamped + 1}/${frameCount}` : 'No frames'}
          </Pill>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Seg
            size="sm"
            options={[
              { value: 'hhmm', label: 'HH:MM' },
              { value: 'minutes', label: 'MIN' },
              { value: 'hours', label: 'HR' },
            ]}
            value={timeFormat}
            onChange={(v) => setTimeFormat(v as TimeFormat)}
          />
          <span className="text-[11px] text-[var(--muted)]">Speed</span>
          <Seg
            size="sm"
            options={['0.5', '1', '2', '4'].map((s) => ({ value: s, label: `${s}×` }))}
            value={speed}
            onChange={setSpeed}
          />
        </div>
      </div>

      <input
        type="range"
        aria-label="Simulation frame"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={clamped}
        disabled={frameCount < 2}
        onChange={(e) => setFrame(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded bg-[var(--line)] accent-[var(--accent)] disabled:opacity-50"
      />

      {frameCount > 0 && !framesDoc.offline && (
        <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
          {frameList.map((f, idx) =>
            f.thumbnail ? (
              <button
                key={f.i}
                title={f.t_label}
                onClick={() => setFrame(idx)}
                className={`h-9 w-14 shrink-0 overflow-hidden rounded border ${idx === clamped ? 'border-[var(--accent)]' : 'border-[var(--line)] opacity-70 hover:opacity-100'}`}
              >
                <img
                  src={f.thumbnail}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).parentElement!.style.display = 'none'
                  }}
                />
              </button>
            ) : null,
          )}
        </div>
      )}
      {framesDoc.offline && <Prov offline>Frame stack offline — GET /runs/{runId?.slice(0, 8)}/frames.json</Prov>}
    </div>
  )
}
