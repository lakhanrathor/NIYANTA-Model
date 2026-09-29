import type { CascadeDam } from '../../lib/api'
import { EM_DASH, clock, m, num } from '../../lib/format'
import { Empty, Icon, Pill } from '../ui'
import { cascadeLabel, cascadeTone } from './useCascade'

/**
 * Shared cascade dam list: search filter, status pills, per-dam numbers,
 * optional row-click (Player focuses the 3D camera) and counterpart handoff.
 */
export function CascadeRows({
  dams,
  total,
  filter,
  setFilter,
  selectedId,
  onSelect,
  onOpenBuild,
}: {
  dams: CascadeDam[]
  total: number
  filter: string
  setFilter: (v: string) => void
  selectedId: string | null
  onSelect?: (dam: CascadeDam) => void
  onOpenBuild?: (dam: CascadeDam) => void
}) {
  const q = filter.trim().toLowerCase()
  return (
    <>
      {total > 0 && (
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-2.5 py-1.5">
          <Icon name="search" size={12} className="text-[var(--faint)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${total} dams…`}
            aria-label="Filter cascade dams"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--faint)]"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="text-[var(--faint)] hover:text-[var(--text)]" title="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}
      {dams.length === 0 && (
        <Empty>{q ? `No dam matches “${filter}”.` : 'No registry dams inside this run\u2019s domain.'}</Empty>
      )}
      {dams.length > 0 && (
        <ul className="py-1">
          {dams.map((d) => (
            <li key={d.dam_id}>
              <button
                onClick={() => onSelect?.(d)}
                title={onSelect ? 'Focus this dam' : undefined}
                className={`block w-full px-3 py-2 text-left hover:bg-[var(--bg)] ${
                  selectedId === d.dam_id ? 'bg-[var(--accent-soft)]' : ''
                } ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{d.name ?? EM_DASH}</span>
                  <Pill tone={cascadeTone(d.status)}>{cascadeLabel(d.status)}</Pill>
                </div>
                <div className="num mt-0.5 text-[10.5px] text-[var(--muted)]">
                  {[
                    d.distance_km != null ? `${num(d.distance_km, 1)} km` : null,
                    d.max_depth_m != null ? `${num(d.max_depth_m, 1)} m deep` : null,
                    d.max_vel_ms != null ? `${num(d.max_vel_ms, 1)} m/s` : null,
                    d.arrival_hr != null ? `arr ${clock(d.arrival_hr * 3600)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || EM_DASH}
                </div>
              </button>
              {d.status === 'exposed' && d.crest_m != null && d.max_depth_m != null && (
                <p className="px-3 pb-1 text-[10.5px] text-[var(--muted)]">
                  Water {m(d.max_depth_m, 1)} against {m(d.crest_m, 0)} crest — held.
                </p>
              )}
              {d.scenario_id && onOpenBuild && (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => onOpenBuild(d)}
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
                  >
                    <Icon name="arrowLeft" size={11} />
                    Open counterpart in Build
                    <span className="num text-[10px] text-[var(--faint)]">{d.scenario_id.slice(0, 8)}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
