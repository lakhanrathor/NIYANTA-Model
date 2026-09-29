import { useRiverContext } from '../../lib/river-context'
import { api } from '../../lib/api'
import type { CorridorDataset } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { Check, Head, Panel, Pill } from '../../components/ui'
import { useBuildConfig } from './config'

interface LayerRow {
  id: string
  label: string
  sub: string
  swatch: string
  /** Map feature ids this checkbox toggles (null = status row, no toggle). */
  toggle: string[] | null
  /** Corridor dataset kinds that grade this row (first hit wins). */
  kinds: string[] | null
  staticNote?: string
}

const ROWS: LayerRow[] = [
  { id: 'esri', label: 'Esri World Imagery', sub: 'satellite base map', swatch: '#0b6bcb', toggle: null, kinds: null, staticNote: 'base' },
  { id: 'sentinel', label: 'Sentinel-2 (Local)', sub: 'optical tile cache', swatch: '#10b981', toggle: null, kinds: ['imagery_s2', 'sentinel-2', 'sentinel', 's2', 'imagery'] },
  { id: 'dem', label: 'DEM (Copernicus 30m)', sub: 'terrain for the domain', swatch: '#8b5cf6', toggle: null, kinds: ['dem'] },
  { id: 'river', label: 'River Path (HydroRIVERS)', sub: 'channel centreline', swatch: '#4a9bd8', toggle: ['river-path'], kinds: null },
  { id: 'dams', label: 'Dams (GeoDAR/GRanD/CWC)', sub: 'structures in corridor', swatch: '#b42318', toggle: ['river-dams-inside', 'river-dams-outside'], kinds: ['dams', 'dam_registry'] },
  { id: 'reservoir', label: 'Reservoir (Selected)', sub: 'footprint from storage area', swatch: '#2e90fa', toggle: ['build-reservoir'], kinds: null },
  { id: 'osm', label: 'OSM Infrastructure', sub: 'roads · bridges · buildings', swatch: '#f59e0b', toggle: null, kinds: ['osm', 'infrastructure'] },
  { id: 'worldpop', label: 'WorldPop (Population)', sub: 'exposure grid', swatch: '#b25e09', toggle: null, kinds: ['worldpop'] },
]

function findKind(rows: CorridorDataset[] | undefined, kinds: string[] | null): CorridorDataset | null {
  if (!rows || !kinds) return null
  for (const k of kinds) {
    const hit = rows.find((r) => r.kind === k)
    if (hit) return hit
  }
  return null
}

/** Step 1 — which layers exist, which the map carries, which are on.
 *  Toggles publish to the shared view slice; rows without a map feature show
 *  their dataset status instead of a dead checkbox. */
export function BuildLayers() {
  const riverId = useRiverContext((st) => st.river?.id ?? null)
  const lengthKm = useRiverContext((st) => st.river?.lengthKm ?? null)
  const bufferOverride = useRiverContext((st) => st.river?.bufferKm ?? null)
  const hidden = useRiverContext((st) => st.view.hiddenLayers)
  const toggleLayer = useRiverContext((st) => st.toggleLayer)
  const areaKm2 = useBuildConfig((st) => st.area_km2)

  const bufferKm =
    bufferOverride ?? (lengthKm ? Math.min(50, Math.max(5, Math.round(lengthKm * 0.01))) : 20)

  // Shared keys with Discover — one cache entry, no second request.
  const riverDetail = useApi(['river', riverId], () => api.river(riverId!), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
  })
  const dams = useApi(['river-dams', riverId, bufferKm], () => api.riverDams(riverId!, bufferKm), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
  })
  const corridors = useApi(['corridors'], api.corridors, { enabled: Boolean(riverId) })
  const corridorId = corridors.data?.find((c) => c.river_id === riverId)?.id ?? null
  const sets = useApi(['corridor-datasets', corridorId], () => api.corridorDatasets(corridorId!), {
    enabled: Boolean(corridorId),
    staleTime: 30_000,
  })

  const hasFeature: Record<string, boolean> = {
    river: Boolean(riverDetail.data?.path),
    dams: (dams.data?.length ?? 0) > 0,
    reservoir: areaKm2 > 0,
  }

  const showAll = () => {
    for (const id of hidden) toggleLayer(id)
  }

  return (
    <Panel
      title="Data Layers"
      actions={
        hidden.length > 0 ? (
          <button
            type="button"
            onClick={showAll}
            className="h-6 rounded border border-[var(--line-strong)] px-2 text-[10px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Show all
          </button>
        ) : undefined
      }
    >
      <Head>Input layers</Head>
      <div className="pb-1.5">
        {ROWS.map((row) => {
          const ds = findKind(sets.data, row.kinds)
          const dsNote = ds
            ? `${ds.status}${ds.coverage_pct != null ? ` · ${Math.round(ds.coverage_pct)}%` : ''}`
            : row.kinds
              ? corridorId
                ? 'not staged'
                : 'no corridor yet'
              : null

          if (row.toggle) {
            const has = hasFeature[row.id] ?? true
            const off = row.toggle.some((t) => hidden.includes(t))
            const hint = !has ? 'not on the map' : dsNote ?? (off ? 'hidden' : row.sub)
            return (
              <Check
                key={row.id}
                checked={has && !off}
                disabled={!has}
                swatch={row.swatch}
                // Status on its own line, like the status rows below — a long
                // note beside the name squeezed it to "River Path (HydroRIVE…".
                label={
                  <>
                    <span className="block truncate">{row.label}</span>
                    <span className="block truncate text-[10px] text-[var(--faint)]">{hint}</span>
                  </>
                }
                onChange={() => {
                  // Dams carry two features (in/out of corridor) — flip as one.
                  const anyHidden = row.toggle!.some((t) => hidden.includes(t))
                  for (const t of row.toggle!) {
                    const isHidden = hidden.includes(t)
                    if (anyHidden ? isHidden : !isHidden) toggleLayer(t)
                  }
                }}
              />
            )
          }

          return (
            <div
              key={row.id}
              className="flex items-center gap-2 px-3 py-[5px] text-[12px]"
            >
              <span
                className="h-3 w-5 shrink-0 rounded-[2px] border border-[var(--line)]"
                style={{ background: row.swatch }}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate">{row.label}</span>
                <span className="block truncate text-[10px] text-[var(--faint)]">
                  {dsNote ?? row.sub}
                </span>
              </span>
              {row.staticNote ? (
                <span className="shrink-0 text-[10px] text-[var(--faint)]">{row.staticNote}</span>
              ) : ds ? (
                <Pill
                  tone={
                    ds.status === 'available' ? 'ok' : ds.status === 'fetching' ? 'accent' : ds.status === 'failed' ? 'bad' : 'warn'
                  }
                >
                  {ds.status}
                </Pill>
              ) : null}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
