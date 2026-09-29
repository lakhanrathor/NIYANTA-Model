/**
 * What the prepare job is downloading right now, as four stage chips.
 *
 * Bands mirror the backend (`_PREPARE_BANDS` in modules/discover): dams
 * 10–50, corridor DEM 50–68, imagery 68–84, population 84–95. The progress
 * bar stays the source of truth; these only name the band it is in.
 */
const STAGES = [
  { key: 'dams', label: 'Dam DEMs', from: 10, to: 50 },
  { key: 'dem', label: 'Corridor DEM', from: 50, to: 68 },
  { key: 'osm', label: 'Imagery', from: 68, to: 84 },
  { key: 'worldpop', label: 'Population', from: 84, to: 95 },
]

export function PrepareStages({ progress }: { progress: number }) {
  return (
    <div className="px-3 py-1.5">
      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => {
          const done = progress >= s.to
          const active = !done && progress >= s.from
          return (
            <span
              key={s.key}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  done ? 'bg-[var(--ok)]' : active ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]'
                }`}
              />
              {s.label}
            </span>
          )
        })}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[var(--faint)]">
        Prepare fetches these automatically — individual Download buttons are for re-fetching
        afterwards.
      </p>
    </div>
  )
}
