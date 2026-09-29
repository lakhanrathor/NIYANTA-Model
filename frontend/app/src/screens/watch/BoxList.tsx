import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useWatchContext } from '../../lib/watch-context'
import { EM_DASH, num, relativeTime } from '../../lib/format'
import { Empty, Panel, Pill } from '../../components/ui'

/** Fixed target areas — the "always watched" list. Selection publishes to the
 *  watch context; the map, the detail panel and the trigger all follow. */
export function BoxList() {
  const selectedBoxId = useWatchContext((s) => s.selectedBoxId)
  const selectBox = useWatchContext((s) => s.selectBox)

  const boxes = useApi(['boxes'], api.watchBoxes)
  const changes = useApi(['changes'], api.watchChanges)

  const rows = boxes.data ?? []
  const changeCount = (boxId: string) => changes.data?.filter((c) => c.box_id === boxId).length ?? 0
  const flaggedCount = (boxId: string) =>
    changes.data?.filter((c) => c.box_id === boxId && c.flagged).length ?? 0
  const lastTs = (boxId: string) => {
    const ts = changes.data
      ?.filter((c) => c.box_id === boxId && c.ts)
      .map((c) => c.ts as string)
      .sort()
      .pop()
    return ts ?? null
  }

  return (
    <Panel
      title="Watch Boxes"
      actions={<Pill tone={rows.length ? undefined : 'muted'}>{rows.length || EM_DASH}</Pill>}
    >
      {boxes.offline && rows.length === 0 ? (
        <Empty>Source offline — GET /api/watch/boxes</Empty>
      ) : rows.length === 0 ? (
        <Empty>No target areas yet — create the first watch box</Empty>
      ) : (
        <ul className="max-h-[260px] overflow-auto">
          {rows.map((b, i) => {
            const active = selectedBoxId === b.id
            const flagged = flaggedCount(b.id)
            return (
              <li key={b.id} className={active ? 'bg-[var(--accent-soft)]' : ''}>
                <button
                  type="button"
                  onClick={() => selectBox(active ? null : b.id)}
                  style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
                  className="ct-rise flex w-full items-center gap-2 border-b border-[var(--line)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--bg)]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-sm ${b.active === false ? 'bg-[var(--faint)]' : 'bg-[#d81b9b]'}`}
                    title={b.active === false ? 'paused' : 'watching'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{b.name}</span>
                    <span className="num block truncate text-[10px] text-[var(--faint)]">
                      {b.preset ?? b.kind ?? 'custom'}
                      {(() => {
                        const ts = lastTs(b.id)
                        return ts ? ` · ${relativeTime(ts)}` : ''
                      })()}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {flagged > 0 && (
                      <span className="num rounded-full bg-[var(--bad)] px-1.5 text-[9px] font-bold text-white">
                        {flagged}
                      </span>
                    )}
                    <span className="num text-[10px] text-[var(--muted)]">
                      {changeCount(b.id) ? num(changeCount(b.id)) : EM_DASH}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="num border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--faint)]">
        GET /api/watch/boxes · {rows.length} boxes
      </p>
    </Panel>
  )
}
