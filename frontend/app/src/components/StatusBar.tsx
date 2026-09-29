import { useState } from 'react'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { stamp } from '../lib/format'

const SOURCE_LABELS = [
  'Esri World Imagery',
  'Sentinel-2 (GEE)',
  'DEM (Copernicus 30m)',
  'HydroRIVERS',
  'GeoDAR/GRanD/CWC',
  'OSM / WorldPop',
]

/** Bottom status bar: data-source chips + live map telemetry. Every screen.
 *  Collapsed to a floating chip by default so it never steals map room —
 *  one tap opens the full bar, one tap hides it again. */
export function StatusBar() {
  const [open, setOpen] = useState(false)
  const system = useApi(['system'], api.system, { refetchInterval: 60_000 })
  const cursor = useApp((s) => s.cursor)
  const zoom = useApp((s) => s.zoom)

  const region = system.data?.region
  const epsg = system.data?.epsg ?? 'EPSG:4326'

  const dot = (state?: string) => {
    if (state === 'online' || state === 'local') return 'bg-[var(--ok)]'
    if (state === 'offline') return 'bg-[var(--warn)]'
    return 'border border-[var(--faint)] bg-transparent'
  }

  const stateWord = (state?: string) => {
    if (state === 'online') return 'Online'
    if (state === 'local') return 'Local'
    if (state === 'offline') return 'Offline'
    return null
  }

  const sources = system.data?.sources
  const allOk =
    sources?.length != null &&
    sources.length > 0 &&
    sources.every((s) => s.state === 'online' || s.state === 'local')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show data sources & map telemetry"
        className="fixed bottom-2 right-2 z-50 flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white/95 px-2.5 py-1 text-[10px] font-medium text-[var(--muted)] shadow-[var(--shadow)] backdrop-blur-sm hover:text-[var(--accent)]"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${allOk ? 'bg-[var(--ok)]' : 'bg-[var(--warn)]'}`} />
        Sources
      </button>
    )
  }

  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--line)] bg-white px-3 text-[11px] text-[var(--muted)]">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em]">
        Data Sources
      </span>

      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        {sources?.length
          ? sources.map((s) => (
              <span
                key={s.id}
                className="flex shrink-0 flex-col leading-tight"
                title={`${s.label} — ${stateWord(s.state) ?? 'unknown'}`}
              >
                <span className="text-[10px]">{s.label}</span>
                <span className="flex items-center gap-1 text-[9px] text-[var(--muted)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot(s.state)}`} />
                  {stateWord(s.state) ?? 'Unknown'}
                </span>
              </span>
            ))
          : SOURCE_LABELS.map((label) => (
              <span key={label} className="flex shrink-0 flex-col leading-tight">
                <span className="text-[10px]">{label}</span>
                <span className="flex items-center gap-1 text-[9px] text-[var(--muted)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot(undefined)}`} />
                  Unknown
                </span>
              </span>
            ))}
        {system.offline && (
          <span className="shrink-0 text-[10px] text-[var(--warn)]">
            Source offline — GET /api/system
          </span>
        )}
      </div>

      <div className="num ml-auto flex shrink-0 items-center gap-3 text-[10px]">
        <span>
          Map: {region ?? '—'} ({epsg})
        </span>
        <span>
          Cursor:{' '}
          {cursor ? `${cursor.lat.toFixed(4)}° N, ${cursor.lon.toFixed(4)}° E` : '—'}
        </span>
        <span>Zoom: {zoom === null ? '—' : zoom.toFixed(1)}</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
          Last Updated: {stamp(system.data?.updated_at)}
        </span>
        <button
          onClick={() => setOpen(false)}
          title="Hide data sources bar"
          className="rounded px-1 font-semibold hover:text-[var(--accent)]"
        >
          Hide
        </button>
      </div>
    </footer>
  )
}
