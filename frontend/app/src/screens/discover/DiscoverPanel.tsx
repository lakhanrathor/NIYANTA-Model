import { useState } from 'react'
import { Icon, Panel, Seg } from '../../components/ui'
import { api } from '../../lib/api'
import type { RiverSearchItem } from '../../lib/api'
import type { ApiResult } from '../../lib/useApi'
import { RiverResults } from './RiverResults'
import type { WorldControl } from './RiverResults'
import { SearchFilters } from './SearchFilters'
import type { DiscoverFilters } from './SearchFilters'

const TABS = [
  { value: 'search', label: 'Search' },
  { value: 'upload', label: 'Upload' },
]

interface Props {
  q: string
  setQ: (v: string) => void
  onSearch: () => void
  tab: string
  setTab: (v: string) => void
  showFilters: boolean
  setShowFilters: (f: (v: boolean) => boolean) => void
  activeFilters: number
  filters: DiscoverFilters
  onFilterChange: (patch: Partial<DiscoverFilters>) => void
  onClearFilters: () => void
  results: ApiResult<RiverSearchItem[]>
  list: RiverSearchItem[]
  selectedIdx: number | null
  onSelect: (i: number) => void
  submitted: string
  typed: boolean
  hasMore: boolean
  onMore: () => void
  world: WorldControl
}

export function DiscoverPanel(props: Props) {
  const {
    q,
    setQ,
    onSearch,
    tab,
    setTab,
    showFilters,
    setShowFilters,
    activeFilters,
    filters,
    onFilterChange,
    onClearFilters,
    results,
    list,
    selectedIdx,
    onSelect,
    submitted,
    typed,
    hasMore,
    onMore,
    world,
  } = props
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  const upload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { name?: string; coordinates?: unknown }
      if (!parsed.coordinates) {
        setUploadNote('File has no GeoJSON coordinates — nothing sent.')
        return
      }
      const created = await api.createRiver({
        name: parsed.name ?? file.name.replace(/\.[^.]+$/, ''),
        geometry: parsed,
      })
      setUploadNote(`Created ${created.name ?? 'river'}`)
    } catch {
      setUploadNote('Upload rejected — expected a GeoJSON LineString.')
    }
  }

  return (
    <Panel className="max-h-[55vh]" title="Discover Rivers">
      <div className="border-b border-[var(--line)] px-2.5 py-1.5">
        <Seg size="sm" options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'search' ? (
        <>
          <div className="flex gap-1.5 px-2.5 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="River name…"
              className="h-7 min-w-0 flex-1 rounded border border-[var(--line-strong)] bg-white px-2 text-[12px] outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={onSearch}
              aria-label="Search"
              title="Search"
              className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[var(--accent)] text-white hover:opacity-90"
            >
              <Icon name="search" size={14} />
            </button>
            <button
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-label="Filters"
              title="Filters"
              className={`relative grid h-7 w-7 shrink-0 place-items-center rounded border ${
                showFilters || activeFilters
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--line-strong)] text-[var(--muted)]'
              } hover:border-[var(--accent)] hover:text-[var(--accent)]`}
            >
              <Icon name="layers" size={14} />
              {activeFilters > 0 && (
                <span className="num absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1 text-[9px] font-semibold leading-[13px] text-white">
                  {activeFilters}
                </span>
              )}
            </button>
          </div>

          {showFilters && (
            <SearchFilters filters={filters} onChange={onFilterChange} onClear={onClearFilters} />
          )}

          <RiverResults
            results={results}
            list={list}
            selectedIdx={selectedIdx}
            onSelect={onSelect}
            submitted={submitted}
            typed={typed}
            hasMore={hasMore}
            onMore={onMore}
            world={world}
          />
        </>
      ) : (
        <div className="p-2.5">
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded border border-dashed border-[var(--line-strong)] bg-[var(--bg)] px-3 py-5 text-center text-[11px] text-[var(--muted)] hover:border-[var(--accent)]">
            <Icon name="file" size={18} />
            Drop a GeoJSON LineString or click to upload
            <input
              type="file"
              accept=".json,.geojson"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
              }}
            />
          </label>
          {uploadNote && <p className="mt-2 text-[11px] text-[var(--muted)]">{uploadNote}</p>}
        </div>
      )}
    </Panel>
  )
}
