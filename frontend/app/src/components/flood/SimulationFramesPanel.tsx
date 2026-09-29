import type { Frame } from '../../lib/api'
import { DEPTH_STOPS, EM_DASH } from '../../lib/format'
import { Icon, Panel } from '../ui'

/**
 * The frame strip the Player page uses: one thumbnail per output frame with a
 * chevron stepper, the active frame outlined. Shared so Results shows exactly
 * the same strip instead of a second, different timeline widget.
 */
export function SimulationFramesPanel({
  frames,
  frame,
  frameCount,
  offline,
  onSelect,
  title = 'Simulation Frames (Water Depth)',
}: {
  frames: Frame[] | null | undefined
  frame: number
  frameCount: number
  offline?: boolean
  onSelect: (index: number) => void
  title?: string
}) {
  const list = frames ?? []
  const last = Math.max(0, Math.max(frameCount, list.length) - 1)
  return (
    <Panel title={title}>
      {offline || list.length === 0 ? (
        <div className="flex gap-2 overflow-x-auto p-2">
          {DEPTH_STOPS.map((_s, i) => (
            <div
              key={i}
              className="flex h-[64px] w-[92px] shrink-0 flex-col items-center justify-center rounded border border-dashed border-[var(--line-strong)] bg-[var(--bg)] text-[var(--faint)]"
            >
              <Icon name="image" size={14} />
              <span className="num mt-1 text-[10px]">{EM_DASH}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto p-2">
          <button
            onClick={() => onSelect(Math.max(0, frame - 1))}
            className="flex w-5 shrink-0 items-center justify-center text-[var(--faint)] hover:text-[var(--accent)]"
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          {list.map((f, i) => (
            <button
              key={f.i}
              onClick={() => onSelect(i)}
              title={`${f.t_label} · frame ${f.i + 1}`}
              className={`h-[64px] w-[92px] shrink-0 overflow-hidden rounded border-2 bg-[var(--bg)] ${
                i === frame ? 'border-[var(--accent)]' : 'border-transparent'
              }`}
            >
              {f.thumbnail ? (
                <img src={f.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : null}
              <span className="num block text-[10px] text-[var(--muted)]">{f.t_label}</span>
            </button>
          ))}
          <button
            onClick={() => onSelect(Math.min(last, frame + 1))}
            className="flex w-5 shrink-0 items-center justify-center text-[var(--faint)] hover:text-[var(--accent)]"
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      )}
    </Panel>
  )
}
