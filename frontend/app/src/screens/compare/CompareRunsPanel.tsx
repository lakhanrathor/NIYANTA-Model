import type { ReactNode } from 'react'
import type { Run } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { Icon, Panel } from '../../components/ui'

/**
 * Run A / B pickers with swap, honest near-field warnings (a clipped depth
 * raster must not be read as zero flooding outside its window), and run states.
 */
export function CompareRunsPanel({
  list,
  idA,
  idB,
  onPickA,
  onPickB,
  onSwap,
  engineA,
  engineB,
  stateA,
  stateB,
  nearFields,
  configA,
  configB,
}: {
  list: Run[]
  idA: string
  idB: string
  onPickA: (id: string) => void
  onPickB: (id: string) => void
  onSwap: () => void
  engineA: string
  engineB: string
  stateA: string | null
  stateB: string | null
  nearFields: { label: string; windowM: number | null }[]
  configA: string | null
  configB: string | null
}) {
  const row = (
    accent: string,
    title: string,
    id: string,
    engine: string,
    state: string | null,
    config: string | null,
    onPick: (id: string) => void,
    body?: ReactNode,
  ) => (
    <div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          {title}
        </span>
        <span className="num ml-auto text-[10px] text-[var(--text)]">{engine}</span>
      </div>
      <p className="num mb-1 truncate text-[11px]" title={id || undefined}>
        {id || EM_DASH}
      </p>
      {config && (
        <p className="mb-1 truncate text-[10px] text-[var(--muted)]" title={config}>
          {config}
        </p>
      )}
      <select
        value={id}
        onChange={(e) => onPick(e.target.value)}
        className="h-6 w-full rounded border border-[var(--line-strong)] bg-white px-1.5 text-[11px]"
      >
        {list.map((r) => (
          <option key={r.id} value={r.id}>
            {r.id.slice(0, 8)} · {r.engine}
          </option>
        ))}
      </select>
      {state != null && (
        <p className="num mt-0.5 text-[10px] text-[var(--faint)]">state: {state}</p>
      )}
      {body}
    </div>
  )

  return (
    <Panel title="Runs">
      <div className="space-y-2 px-3 py-2">
        {row('#0b6bcb', 'Run ID A', idA, engineA, stateA, configA, onPickA)}
        <div className="flex justify-center py-0.5">
          <button
            title="Swap A and B"
            onClick={onSwap}
            className="flex h-6 w-6 items-center justify-center rounded border border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Icon name="swap" size={13} />
          </button>
        </div>
        {row('#b42318', 'Run ID B', idB, engineB, stateB, configB, onPickB)}
        {nearFields.map((n) => (
          <p
            key={n.label}
            className="border-t border-[var(--line)] pt-2 text-[11px] leading-snug text-[var(--warn)]"
          >
            Near-field run ({n.label}) — its depth raster is clipped to a{' '}
            {n.windowM != null ? `${num(n.windowM, 0)} m` : 'narrow'} breach window, so the
            difference outside that square is no data from that engine, not zero flooding.
          </p>
        ))}
      </div>
    </Panel>
  )
}
