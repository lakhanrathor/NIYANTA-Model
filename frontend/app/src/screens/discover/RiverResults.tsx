import { Count, Empty, Icon } from '../../components/ui'
import type { RiverSearchItem } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import type { ApiResult } from '../../lib/useApi'

/** The explicit online tier — off until the user asks for it by name. */
export interface WorldControl {
  active: boolean
  pending: boolean
  onSearch: () => void
}

interface Props {
  results: ApiResult<RiverSearchItem[]>
  list: RiverSearchItem[]
  selectedIdx: number | null
  onSelect: (i: number) => void
  submitted: string
  /** The box holds text that was never submitted — results and selection are separate. */
  typed: boolean
  hasMore: boolean
  onMore: () => void
  world: WorldControl
}

export function RiverResults({
  results,
  list,
  selectedIdx,
  onSelect,
  submitted,
  typed,
  hasMore,
  onMore,
  world,
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-1.5">
        <span className="text-[11px] font-semibold">Search Results</span>
        <Count>{submitted ? `${list.length} results` : EM_DASH}</Count>
      </div>

      {results.pending && submitted && <Empty>Searching…</Empty>}
      {results.offline && <Empty>Source unavailable — try again shortly</Empty>}
      {!submitted && typed && <Empty>Press Search to list rivers — the selection stays as it is.</Empty>}
      {!submitted && !typed && <Empty>Type a river name and press Search.</Empty>}
      {submitted && !results.pending && !results.offline && list.length === 0 && !world.pending && (
        <Empty>
          {world.active
            ? `“${submitted}” is not in the catalogue and nothing matched on OSM`
            : `No rivers matched “${submitted}” in your catalogue`}
        </Empty>
      )}

      <ul>
        {list.map((r, i) => {
          const active = (selectedIdx ?? 0) === i
          return (
            <li key={`${r.name}-${i}`} className="border-b border-[var(--line)] last:border-b-0">
              <button
                onClick={() => onSelect(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  active
                    ? 'border-l-2 border-l-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-l-2 border-l-transparent hover:bg-[var(--bg)]'
                }`}
              >
                <span className="text-[var(--accent)]">
                  <Icon name="river" size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">
                    {r.name}
                    {r.cached === false && (
                      <span className="ml-1.5 rounded bg-[var(--accent-soft)] px-1 text-[9px] font-medium text-[var(--accent)]">
                        saved from OSM
                      </span>
                    )}
                  </span>
                  <span className="num block truncate text-[10px] text-[var(--faint)]">
                    {r.length_km ? `${num(r.length_km, 1)} km` : EM_DASH}
                    {' · '}
                    {r.basin ? `${r.basin} Basin` : `${EM_DASH} Basin`}
                    {' · '}
                    {r.major_dam_count === null || r.major_dam_count === undefined
                      ? `${EM_DASH} major dams`
                      : `${num(r.major_dam_count)} major dams`}
                  </span>
                </span>
                <span className="text-[var(--faint)]">
                  <Icon name={active ? 'chevronDown' : 'chevronRight'} size={13} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <button
          onClick={onMore}
          className="w-full border-t border-[var(--line)] px-3 py-1.5 text-left text-[11px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        >
          Show more results
        </button>
      )}

      {world.pending && <Empty>Searching the open web — this can take a few seconds…</Empty>}
      {submitted && !world.pending && !world.active && (
        <button
          onClick={world.onSearch}
          className="flex w-full items-center gap-1.5 border-t border-[var(--line)] px-3 py-1.5 text-left text-[11px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        >
          <Icon name="globe" size={13} />
          Search the whole world for “{submitted}”
        </button>
      )}
    </>
  )
}
