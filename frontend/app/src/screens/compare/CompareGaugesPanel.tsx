import type { RunStation } from '../../lib/api'
import { clock, EM_DASH, num } from '../../lib/format'
import { EmptyRow, Panel, Table } from '../../components/ui'

/**
 * Station-by-station A/B gauge table from `GET /runs/{id}/stations`.
 * Stations outside the modelled reach are marked "beyond reach" rather than
 * showing clamped values as if they were measured.
 */
export function CompareGaugesPanel({
  shortA,
  shortB,
  stationsA,
  stationsB,
  pending,
}: {
  shortA: string
  shortB: string
  stationsA: RunStation[] | undefined
  stationsB: RunStation[] | undefined
  pending: boolean
}) {
  const arr = (v: number | null | undefined, inside: boolean | undefined) =>
    inside === false ? (
      <span className="text-[9.5px] text-[var(--faint)]">beyond reach</span>
    ) : v != null ? (
      clock(v * 3600)
    ) : (
      EM_DASH
    )

  return (
    <Panel title={`Gauges — ${shortA} (A) vs ${shortB} (B)`}>
      <Table head={['Gauge', `${shortA} (A) arrival`, `${shortB} (B) arrival`, 'Δ depth']}>
        {(stationsA ?? []).map((s) => {
          const b = (stationsB ?? []).find((t) => Math.abs(t.km - s.km) < 1e-6)
          const depthA = s.in_domain === false ? null : s.max_depth_m ?? null
          const depthB = b?.in_domain === false ? null : b?.max_depth_m ?? null
          const delta = depthA != null && depthB != null ? depthB - depthA : null
          return (
            <tr key={`${s.km}-${s.name}`} className="border-b border-[var(--line)] last:border-0">
              <td className="px-2 py-1.5">
                <span className="font-semibold">{s.name ?? `CH${s.km}`}</span>
                <span className="ml-1.5 text-[9.5px] text-[var(--faint)]">{num(s.km, 0)} km</span>
              </td>
              <td className="num px-2 py-1.5 text-right">{arr(s.arrival_hr, s.in_domain)}</td>
              <td className="num px-2 py-1.5 text-right">{arr(b?.arrival_hr, b?.in_domain)}</td>
              <td
                className={`num px-2 py-1.5 text-right ${
                  delta == null ? '' : delta > 0 ? 'text-[var(--bad)]' : 'text-[var(--ok)]'
                }`}
              >
                {delta == null ? EM_DASH : `${delta > 0 ? '+' : ''}${num(delta, 2)} m`}
              </td>
            </tr>
          )
        })}
        {!(stationsA ?? []).length && (
          <EmptyRow colSpan={4}>
            {pending ? 'Loading gauges…' : 'No gauges published for these runs.'}
          </EmptyRow>
        )}
      </Table>
    </Panel>
  )
}
