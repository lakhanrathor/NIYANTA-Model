import { EmptyRow, LinkBtn, Panel, Pill, Prov, Table } from '../../components/ui'
import type { RiverDam } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import type { ApiResult } from '../../lib/useApi'
import { useRiverContext } from '../../lib/river-context'

/** Cascade flag for one dam row — reads the mission screening, needs no props. */
function CascadeBadge({ damId }: { damId: string }) {
  const cascade = useRiverContext((s) => s.cascade)
  const ctxRunId = useRiverContext((s) => s.run?.runId ?? null)
  if (!cascade || (ctxRunId && cascade.runId !== ctxRunId)) return null
  const hit = cascade.dams.find((d) => d.dam_id === damId)
  if (!hit || hit.status === 'dry' || hit.status === 'outside-domain') return null
  const tone = hit.status === 'overtopped' ? 'bad' : 'warn'
  const label =
    hit.status === 'overtopped'
      ? 'overtopped'
      : hit.status === 'exposed'
        ? 'exposed'
        : 'wet · geometry unknown'
  return (
    <span className="ml-1.5" title={`Screened by run ${cascade.runId?.slice(0, 8) ?? '—'} — a flag, not a prediction`}>
      <Pill tone={tone}>{label}</Pill>
    </span>
  )
}

interface Props {
  dams: ApiResult<RiverDam[]>
  hasId: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Shared with the map: hovering either side lights up the other. */
  hoverId: string | null
  onHover: (id: string | null) => void
}

export function DamList({ dams, hasId, selectedId, onSelect, hoverId, onHover }: Props) {
  const selected = dams.data?.find((d) => d.id === selectedId) ?? null
  const rows = dams.data ?? []
  const inCorridor = rows.filter((d) => d.in_corridor !== false).length
  const title = hasId
    ? `Dams Along This River (${rows.length}${rows.length ? ` · ${inCorridor} in corridor` : ''})`
    : 'Dams Along This River'
  return (
    <Panel className="max-h-[46vh]" title={title} actions={selected ? <LinkBtn onClick={() => onSelect(null)}>Clear</LinkBtn> : undefined}>
      <Table head={['#', 'Dam Name', 'State', 'Status', 'Distance']}>
        {dams.pending && hasId && !dams.data ? (
          <EmptyRow colSpan={5}>Loading dams…</EmptyRow>
        ) : !dams.data?.length ? (
          <EmptyRow colSpan={5}>
            {dams.offline && hasId
              ? 'Dam list unavailable'
              : hasId
                ? 'No dams recorded for this river'
                : 'Select a river first'}
          </EmptyRow>
        ) : (
          dams.data.map((d, i) => {
            const active = d.id === selectedId
            const hovered = d.id === hoverId
            const outside = d.in_corridor === false
            return (
              <tr
                key={`${d.id}-${i}`}
                onClick={() => onSelect(active ? null : d.id)}
                onMouseEnter={() => onHover(d.id)}
                onMouseLeave={() => onHover(null)}
                className={`cursor-pointer border-b border-[var(--line)] last:border-b-0 ${
                  active
                    ? 'bg-[var(--accent-soft)]'
                    : hovered
                      ? 'bg-[var(--bg)]'
                      : 'hover:bg-[var(--bg)]'
                } ${outside ? 'text-[var(--muted)]' : ''}`}
              >
                <td
                  className={`num px-2 py-1.5 ${
                    active ? 'font-semibold text-[var(--accent)]' : 'text-[var(--faint)]'
                  }`}
                >
                  {active ? '▸' : i + 1}
                </td>
                <td className="px-2 py-1.5 font-medium">
                  {d.name}
                  {outside && (
                    <span className="ml-1.5 rounded border border-[var(--line-strong)] px-1 text-[9px] font-medium text-[var(--faint)]">
                      outside corridor
                    </span>
                  )}
                  <CascadeBadge damId={d.id} />
                </td>
                <td className="px-2 py-1.5 text-[var(--muted)]">{d.state ?? EM_DASH}</td>
                <td className="px-2 py-1.5">
                  <span
                    className={`num text-[11px] ${d.status === 'in_db' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}
                  >
                    {d.status === 'in_db' ? 'In DB' : 'Missing'}
                  </span>
                </td>
                <td className="num px-2 py-1.5 text-right text-[var(--muted)]">
                  {d.distance_km === null || d.distance_km === undefined
                    ? EM_DASH
                    : `${num(d.distance_km, 1)} km`}
                </td>
              </tr>
            )
          })
        )}
      </Table>
      <Prov offline={dams.offline}>
        {dams.data?.length
          ? 'Distance along the river path · “outside corridor” = curated dam the corridor does not cover · click a dam to take it into Build'
          : hasId
            ? 'Distance measured along the river path'
            : 'No river selected'}
      </Prov>
    </Panel>
  )
}
