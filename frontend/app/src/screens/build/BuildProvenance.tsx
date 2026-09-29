import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Head, Panel, Pill } from '../../components/ui'
import { STAGING_KINDS, api } from '../../lib/api'
import type { CorridorDataset } from '../../lib/api'
import { EM_DASH, bytes, pct } from '../../lib/format'
import { useRiverContext } from '../../lib/river-context'
import { ENGINES, effectiveReachKm, useBuildConfig } from './config'

interface CheckItem {
  sev: 'ok' | 'warn' | 'bad'
  label: string
  detail?: string
}

function findKind(rows: CorridorDataset[] | undefined, kinds: string[]): CorridorDataset | null {
  if (!rows) return null
  for (const k of kinds) {
    const hit = rows.find((r) => r.kind === k)
    if (hit) return hit
  }
  return null
}

/** Right column top — where every number came from, what's missing, and whether
 *  the draft passes the ScenarioSpec rules (the server re-validates on save;
 *  this is the honest client pre-check). */
export function BuildProvenance() {
  const riverId = useRiverContext((st) => st.river?.id ?? null)
  const riverName = useRiverContext((st) => st.river?.name ?? null)
  const damId = useRiverContext((st) => st.river?.damId ?? null)
  const s = useBuildConfig()

  const [result, setResult] = useState<CheckItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const damDetail = useQuery({
    queryKey: ['dam', damId],
    queryFn: () => api.dam(damId!),
    enabled: Boolean(damId),
    staleTime: 60_000,
    retry: false,
  })
  const riverDetail = useQuery({
    queryKey: ['river', riverId],
    queryFn: () => api.river(riverId!),
    enabled: Boolean(riverId),
    staleTime: 60_000,
    retry: false,
  })
  const corridors = useQuery({
    queryKey: ['corridors'],
    queryFn: api.corridors,
    enabled: Boolean(riverId),
    staleTime: 60_000,
    retry: false,
  })
  const corridorRow = corridors.data?.find((c) => c.river_id === riverId) ?? null
  const corridorId = corridorRow?.id ?? null
  const sets = useQuery({
    queryKey: ['corridor-datasets', corridorId],
    queryFn: () => api.corridorDatasets(corridorId!),
    enabled: Boolean(corridorId),
    staleTime: 30_000,
    retry: false,
  })

  const rows = sets.data ?? []
  const staging = rows.filter((r) => STAGING_KINDS.has(r.kind))
  const missing = staging.filter((r) => r.status === 'missing' || r.status === 'failed')
  const demRow = findKind(rows, ['dem'])
  const imgRow = findKind(rows, ['sentinel-2', 'sentinel', 's2', 'imagery'])
  const popRow = findKind(rows, ['worldpop'])
  const dam = damDetail.data ?? null
  const river = riverDetail.data ?? null

  const validate = () => {
    const items: CheckItem[] = []
    const hard = (ok: boolean, label: string, detail?: string) =>
      items.push({ sev: ok ? 'ok' : 'bad', label, detail })
    const soft = (ok: boolean, label: string, detail?: string) =>
      items.push({ sev: ok ? 'ok' : 'warn', label, detail })

    hard(Boolean(damId), 'Dam selected', dam?.name ?? riverName ?? undefined)
    hard(s.level_m > 0, 'Reservoir level set', `${s.level_m} m`)
    hard(s.crest_m > 0, 'Crest level set', `${s.crest_m} m`)
    if (s.crest_m > 0 && s.crest_m <= s.bed_m)
      items.push({ sev: 'warn', label: 'Crest at or below bed', detail: 'check the levels' })
    hard(s.width_m > 0 && s.depth_m > 0, 'Breach geometry set', `${s.width_m} × ${s.depth_m} m`)
    if (s.width_m > 0 && s.depth_m > 0 && s.width_m < 2 * s.depth_m * s.side_slope)
      items.push({ sev: 'warn', label: 'Side slopes meet before full depth', detail: 'widen the breach or ease the slope' })
    hard(effectiveReachKm(s.reach_km) > 0, 'Study reach set', `${effectiveReachKm(s.reach_km)} km`)
    hard(s.duration_hr > 0, 'Horizon set', `${s.duration_hr} hr`)
    hard(ENGINES.includes(s.engine as (typeof ENGINES)[number]), 'Engine selected', s.engine)
    soft(Boolean(corridorId), 'Corridor prepared', corridorId ? corridorRow?.status : 'prepare in Discover')
    soft(demRow?.status === 'available', 'DEM on disk', demRow ? demRow.status : 'no row')
    soft(
      s.impactSource === 'manual' ? s.population != null : popRow?.status === 'available',
      'Population source ready',
      s.impactSource === 'manual' ? 'manual count' : (popRow?.status ?? 'falls back to manual'),
    )
    setResult(items)
  }

  const downloadMissing = async () => {
    if (!corridorId || busy || missing.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      for (const r of missing) {
        await api.downloadCorridorDataset(corridorId, r.kind)
      }
      setNotice(`queued ${missing.length} download${missing.length === 1 ? '' : 's'}`)
      await sets.refetch()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'download failed to queue')
    } finally {
      setBusy(false)
    }
  }

  const allOk = result !== null && result.every((i) => i.sev === 'ok')

  const datasetLine = (row: CorridorDataset | null) =>
    row
      ? `${row.source || row.label || row.kind} · ${pct(row.coverage_pct, 0)} · ${row.size_bytes ? bytes(row.size_bytes) : EM_DASH}`
      : EM_DASH

  return (
    <Panel
      title="Provenance"
      actions={
        <>
          {missing.length > 0 && <Pill tone="bad">{missing.length} missing</Pill>}
          {result !== null && (
            <Pill tone={allOk ? 'ok' : 'warn'}>{allOk ? 'spec valid ✓' : 'needs attention'}</Pill>
          )}
        </>
      }
    >
      <Head>Every pixel is evidence</Head>
      <div className="px-3 py-1 text-[11px] leading-relaxed">
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">DEM</span>
          <span className="num truncate text-right">{datasetLine(demRow)}</span>
        </div>
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">Imagery</span>
          <span className="num truncate text-right">{datasetLine(imgRow)}</span>
        </div>
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">River</span>
          <span className="num truncate text-right">
            {river ? (river.source_name ?? river.source ?? riverName ?? EM_DASH) : EM_DASH}
          </span>
        </div>
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">Dam</span>
          <span className="num truncate text-right">
            {dam ? `${dam.name} · ${dam.height_m ?? EM_DASH} m` : EM_DASH}
          </span>
        </div>
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">Corridor</span>
          <span className="num truncate text-right">
            {corridorRow ? `${corridorRow.status} · ${pct(corridorRow.coverage_pct, 0)}` : 'not prepared'}
          </span>
        </div>
        <div className="flex justify-between gap-2 py-[3px]">
          <span className="text-[var(--muted)]">Engine</span>
          <span className="num truncate text-right">{s.engine}</span>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="border-t border-[var(--line)] px-3 py-2">
          <button
            type="button"
            onClick={() => void downloadMissing()}
            disabled={busy}
            className="h-7 w-full rounded bg-[var(--bad)] px-2 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Queueing…' : `Download missing data (${missing.length})`}
          </button>
        </div>
      )}

      <div className="border-t border-[var(--line)] p-3">
        <button
          type="button"
          onClick={validate}
          className="h-8 w-full rounded bg-[var(--accent)] px-2 text-[12px] font-medium text-white hover:opacity-90"
        >
          Validate spec
        </button>
        {notice && <p className="mt-1.5 text-[10px] text-[var(--muted)]">{notice}</p>}
        {result && (
          <ul className="mt-2">
            {result.map((c) => (
              <li key={c.label} className="flex items-start gap-1.5 py-[3px] text-[11px]">
                <span
                  className={`mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    c.sev === 'ok'
                      ? 'bg-[var(--ok)] text-white'
                      : c.sev === 'warn'
                        ? 'bg-[var(--warn)] text-white'
                        : 'bg-[var(--bad)] text-white'
                  }`}
                >
                  {c.sev === 'ok' ? '✓' : '!'}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{c.label}</span>
                  {c.detail && <span className="num block text-[10px] text-[var(--muted)]">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-snug text-[var(--faint)]">
          Client pre-check against the ScenarioSpec rules — the server re-validates on save and
          reports the exact error.
        </p>
      </div>
    </Panel>
  )
}
