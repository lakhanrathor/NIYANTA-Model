import type { RunStation } from '../../lib/api'
import { clock, EM_DASH, num } from '../../lib/format'

/**
 * Area picker: one chip per in-domain gauge (real station rows), plus a
 * two-click box select. Picking an area flies the panes there and pins the
 * probe — it clips the *view* only. No polygon aggregates are claimed,
 * because no on-the-fly zonal-stats endpoint exists (see D9).
 */
export function CompareAreasStrip({
  stationsA,
  stationsB,
  shortA,
  shortB,
  boxMode,
  hasCorner,
  activeIdx,
  onPick,
  onToggleBox,
  onClear,
}: {
  stationsA: RunStation[] | undefined
  stationsB: RunStation[] | undefined
  shortA: string
  shortB: string
  boxMode: boolean
  hasCorner: boolean
  activeIdx: number | null
  onPick: (idx: number, lat: number, lon: number) => void
  onToggleBox: () => void
  onClear: () => void
}) {
  const list = (stationsA ?? []).filter(
    (s) => typeof s.lon === 'number' && typeof s.lat === 'number' && s.in_domain !== false,
  )
  const arrB = (km: number) => {
    const b = (stationsB ?? []).find((t) => Math.abs(t.km - km) < 1e-6)
    return b?.in_domain === false ? 'beyond reach' : b?.arrival_hr != null ? clock(b.arrival_hr * 3600) : EM_DASH
  }

  return (
    <div className="shrink-0 rounded border border-[var(--line)] bg-white px-2 py-1.5 shadow-xs">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Areas
        </span>
        {list.map((s, i) => {
          const active = activeIdx === i
          return (
            <button
              key={`${s.km}-${s.name}`}
              onClick={() => onPick(i, s.lat as number, s.lon as number)}
              title={`${s.name ?? `CH${s.km}`} · ${shortA} arrival ${s.arrival_hr != null ? clock(s.arrival_hr * 3600) : EM_DASH} · ${shortB} arrival ${arrB(s.km)}`}
              className={`shrink-0 rounded border px-2 py-1 text-left text-[10px] leading-tight ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'border-[var(--line-strong)] bg-white text-[var(--muted)] hover:border-[var(--accent)]'
              }`}
            >
              <span className="block font-semibold">{s.name ?? `CH${s.km}`}</span>
              <span className="num block text-[var(--faint)]">
                {num(s.km, 0)} km · {s.arrival_hr != null ? clock(s.arrival_hr * 3600) : EM_DASH}
              </span>
            </button>
          )
        })}
        {!list.length && (
          <span className="text-[10px] text-[var(--faint)]">No gauges with coordinates published.</span>
        )}
        <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--line)]" />
        <button
          onClick={onToggleBox}
          title="Click two opposite corners on the map to zoom both panes there"
          className={`shrink-0 rounded border px-2 py-1 text-[10px] font-medium ${
            boxMode
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--line-strong)] bg-white text-[var(--muted)] hover:border-[var(--accent)]'
          }`}
        >
          Box select
        </button>
        <button
          onClick={onClear}
          title="Back to the full modelled reach"
          className="shrink-0 rounded border border-[var(--line-strong)] bg-white px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--accent)]"
        >
          Full reach
        </button>
      </div>
      {boxMode && (
        <p className="pt-1 text-[10px] leading-snug text-[var(--accent)]">
          {hasCorner
            ? 'Corner 1 set — click the opposite corner on either pane.'
            : 'Box select on — click two opposite corners on either pane.'}
        </p>
      )}
    </div>
  )
}
