import type { RunStation } from '../../lib/api'
import { EM_DASH, clock, num } from '../../lib/format'
import { EmptyRow, Table } from '../ui'

/**
 * Gauge table — CH0 is the breach, CH5/CH10/… are chainage marks downstream.
 * A station beyond the modelled centreline reports nothing: its numbers would
 * be the clamped end-cell, so we say "outside domain" instead.
 */
export function StationsPanel({ stations }: { stations: RunStation[] | null | undefined }) {
  const list = stations ?? []
  if (!list.length) {
    return (
      <div className="px-3 py-2 text-[11px] text-[var(--faint)]">
        {stations === undefined ? 'Loading gauges…' : 'No gauges published for this run yet.'}
      </div>
    )
  }
  const inside = list.filter((s) => s.in_domain !== false)
  const outside = list.filter((s) => s.in_domain === false)
  return (
    <div>
      <Table head={['Gauge', 'Arrival', 'Max depth', 'Peak Q']}>
        {inside.length === 0 && <EmptyRow colSpan={4}>No gauge inside the modelled domain.</EmptyRow>}
        {inside.map((s) => (
          <tr key={`${s.km}-${s.name}`} className="border-b border-[var(--line)] last:border-0">
            <td className="px-2 py-1.5">
              <span className="font-semibold">{s.name ?? `CH${s.km}`}</span>
              <span className="ml-1.5 text-[9.5px] text-[var(--faint)]">{num(s.km, 0)} km</span>
            </td>
            <td className="num px-2 py-1.5">
              {s.arrival_hr != null ? (
                <span>
                  {clock(s.arrival_hr * 3600)}{' '}
                  <span className="text-[9.5px] text-[var(--faint)]">({num(s.arrival_hr * 60, 0)} min)</span>
                </span>
              ) : (
                <span className="text-[var(--faint)]">not reached</span>
              )}
            </td>
            <td className="num px-2 py-1.5">{s.max_depth_m ? `${num(s.max_depth_m, 2)} m` : EM_DASH}</td>
            <td className="num px-2 py-1.5">{s.peak_cms ? `${num(s.peak_cms, 0)} m³/s` : EM_DASH}</td>
          </tr>
        ))}
      </Table>
      {outside.length > 0 && (
        <p className="border-t border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[10px] text-[var(--faint)]">
          {outside.map((s) => s.name ?? `CH${s.km}`).join(', ')} lie beyond the modelled reach — flood never
          gets there, no reading.
        </p>
      )}
    </div>
  )
}
