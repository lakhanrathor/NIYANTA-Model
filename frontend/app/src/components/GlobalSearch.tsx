import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { num } from '../lib/format'
import { Icon } from './ui'

/** Header search: river hits route straight into Discover. */
export function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const results = useApi(
    ['search', q],
    () => api.searchRivers(q, 8),
    { enabled: q.trim().length >= 2 },
  )

  const select = (name: string) => {
    setOpen(false)
    setQ(name)
    navigate(`/discover?q=${encodeURIComponent(name)}`)
  }

  return (
    <div className="relative w-[300px]">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--faint)]">
        <Icon name="search" size={13} />
      </span>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search rivers, dams, places..."
        className="h-7 w-full rounded border border-[var(--line-strong)] bg-[var(--bg)] pl-7 pr-2.5 text-[12px] outline-none focus:border-[var(--accent)] focus:bg-white"
      />
      {open && q.trim().length >= 2 && (
        <div className="panel absolute z-50 mt-1 max-h-80 w-full overflow-auto py-1 shadow-[var(--shadow)]">
          {results.pending && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--faint)]">Searching…</div>
          )}
          {results.offline && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--warn)]">
              Source offline — GET /api/rivers/search
            </div>
          )}
          {results.data?.length === 0 && !results.pending && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--faint)]">
              No rivers matched “{q}”
            </div>
          )}
          {results.data?.map((r, i) => (
            <button
              key={`${r.id ?? 'null'}-${r.name}-${i}`}
              onMouseDown={() => select(r.name)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--accent-soft)]"
            >
              <span className="text-[var(--accent)]">
                <Icon name="river" size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{r.name}</span>
              <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                {r.length_km ? `${num(r.length_km, 1)} km` : r.source}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
