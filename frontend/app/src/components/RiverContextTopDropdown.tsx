import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useRiverContext } from '../lib/river-context'
import { damRowToRiverPatch } from '../lib/mission'
import { num } from '../lib/format'
import { Icon, Pill } from './ui'

/** Animated river glyph — water that never sits still. */
function WaveGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path className="ct-flow" d="M2 8.5c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2.5-3 5-3" />
      <path
        className="ct-flow"
        style={{ animationDelay: '0.45s' }}
        d="M2 15.5c2.5 0 2.5 3 5 3s2.5-3 5-3 2.5 3 5 3 2.5-3 5-3"
      />
    </svg>
  )
}

export function RiverContextTopDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const activeRiver = useRiverContext((s) => s.river)
  const selectRiver = useRiverContext((s) => s.select)
  const selectDam = useRiverContext((s) => s.selectDam)
  const patchRiver = useRiverContext((s) => s.patch)
  const setBufferKm = useRiverContext((s) => s.setBufferKm)
  const clearRiver = useRiverContext((s) => s.clear)

  const riverId = activeRiver?.id ?? null
  const riverDetail = useApi(['river', riverId], () => api.river(riverId!), { enabled: Boolean(riverId) })

  const riverLength = riverDetail.data?.length_km ?? activeRiver?.lengthKm ?? null
  // Length still loading: the neutral 20 km the corridor endpoints default to
  // (`Query(20 …)` server-side, `: 20` on Discover) — never an invented river.
  const autoBuffer = riverLength != null ? Math.max(1, Math.min(50, Math.round(riverLength / 20))) : 20
  const bufferKm = activeRiver?.bufferKm ?? autoBuffer
  const isBufferOverridden = activeRiver?.bufferKm !== null

  const corridor = useApi(
    ['river-corridor', riverId, bufferKm],
    () => api.riverCorridor(riverId!, bufferKm),
    { enabled: Boolean(riverId), staleTime: 60_000 },
  )

  const dams = useApi(
    ['river-dams', riverId, bufferKm],
    () => api.riverDams(riverId!, bufferKm),
    { enabled: Boolean(riverId), staleTime: 60_000 },
  )

  const corridors = useApi(['corridors'], api.corridors, { enabled: Boolean(riverId) })
  const corridorRow = activeRiver
    ? corridors.data?.find((c) => c.river_id === activeRiver.id) ?? null
    : null

  const searchResults = useApi(
    ['search-rivers', searchQuery],
    () => api.searchRivers(searchQuery, 6),
    { enabled: searchQuery.trim().length >= 2 },
  )

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setIsSearching(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectRiver = (name: string, id?: string, len?: number | null) => {
    selectRiver({
      id: id || name.toLowerCase().replace(/\s+/g, '-'),
      name,
      lengthKm: len ?? null,
      query: name,
    })
    setIsSearching(false)
    setSearchQuery('')
  }

  const damsList = dams.data ?? []
  const damsInCount = damsList.filter((d) => d.in_corridor !== false).length

  // Live status dot: real query states, not decoration.
  const loading = corridor.pending || dams.pending
  const offline = corridor.offline || dams.offline
  const dotClass = offline
    ? 'bg-slate-300'
    : loading
      ? 'bg-amber-500 ct-blink'
      : 'bg-emerald-500 ct-ping'

  return (
    <div ref={dropdownRef} className="relative">
      {/* Top Header Pill / Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={activeRiver ? 'Inspect and configure the river corridor' : 'Select a river basin'}
        className={`group flex h-9 items-center gap-2 rounded-xl border px-2.5 text-[12px] font-medium transition-all duration-200 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.98] ${
          isOpen
            ? 'border-[var(--accent)] bg-white shadow-md'
            : 'border-[var(--line)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-white'
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-sm">
          <WaveGlyph />
        </span>
        {activeRiver ? (
          <>
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="max-w-[130px] truncate font-bold text-slate-900">{activeRiver.name}</span>
              {riverLength != null && (
                <span className="num text-[9px] font-normal text-[var(--faint)]">
                  {num(riverLength, 0)} km river
                </span>
              )}
            </span>
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} title={offline ? 'source offline' : loading ? 'loading' : 'live'} />
            <Pill tone={corridorRow?.status === 'ready' || !corridorRow ? 'ok' : 'accent'}>
              {corridorRow?.status ?? 'ready'}
            </Pill>
            <span className="num hidden text-[11px] text-[var(--muted)] sm:inline">
              ±{bufferKm}km · {damsInCount} dams
            </span>
          </>
        ) : (
          <span className="font-semibold text-slate-600">Select River Basin</span>
        )}
        <Icon
          name="chevronDown"
          size={13}
          className={`shrink-0 text-[var(--faint)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Floating Dropdown Mega Menu */}
      {isOpen && (
        <div className="ct-menu-in absolute right-0 top-11 z-50 w-[430px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
          {/* Header Row */}
          <div className="relative border-b border-[var(--line)] px-4 pt-3.5 pb-3">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-br from-sky-100/80 via-blue-50/40 to-transparent" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-md">
                  <WaveGlyph size={18} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {activeRiver ? activeRiver.name : 'River Basin Selection'}
                  </h3>
                  {riverLength != null ? (
                    <p className="num text-[10px] text-[var(--muted)]">
                      {num(riverLength, 0)} km · live from catalogue
                    </p>
                  ) : (
                    <p className="text-[10px] text-[var(--faint)]">pick a river to seed the mission</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {activeRiver && (
                  <button
                    onClick={() => setIsSearching(!isSearching)}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-sky-100"
                  >
                    {isSearching ? 'Close Search' : 'Switch River'}
                  </button>
                )}
                {activeRiver && (
                  <button
                    onClick={() => {
                      clearRiver()
                      setIsOpen(false)
                    }}
                    className="rounded-lg p-1.5 text-[var(--muted)] transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-90"
                    title="Clear selected river"
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="p-3.5 pt-3">
            {/* Quick River Search Bar (if searching or no river selected) */}
            {(isSearching || !activeRiver) && (
              <div className="ct-rise rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-2.5">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                    <Icon name="search" size={13} />
                  </span>
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search river (e.g., Ganga, Yamuna, Narmada)..."
                    className="h-8 w-full rounded-lg border border-[var(--line-strong)] bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition-all focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                  />
                  {searchResults.pending && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--accent)]">
                      <span className="ct-spin inline-flex">
                        <Icon name="spinner" size={13} />
                      </span>
                    </span>
                  )}
                </div>

                {/* Quick Picks / Search Results */}
                <div className="mt-1.5 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                  {searchResults.data?.map((r, i) => (
                    <button
                      key={`${r.id}-${i}`}
                      onClick={() => handleSelectRiver(r.name, r.id ?? undefined, r.length_km)}
                      style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
                      className="ct-rise flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all hover:translate-x-0.5 hover:bg-white hover:shadow-sm"
                    >
                      <span className="font-semibold text-slate-800">{r.name}</span>
                      <span className="num text-[10px] text-[var(--muted)]">
                        {r.length_km ? `${num(r.length_km, 0)} km` : r.source}
                      </span>
                    </button>
                  ))}
                  {!searchQuery && (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {['Ganga', 'Yamuna', 'Brahmaputra', 'Godavari', 'Narmada', 'Krishna'].map((name) => (
                        <button
                          key={name}
                          onClick={() => handleSelectRiver(name)}
                          className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-all hover:-translate-y-px hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-sm active:translate-y-0"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active River Details & Configuration */}
            {activeRiver && !isSearching && (
              <div className="space-y-2.5">
                {/* Corridor Buffer Slider */}
                <div
                  className="ct-rise rounded-xl border border-[var(--line)] bg-gradient-to-b from-white to-slate-50/60 p-3"
                  style={{ animationDelay: '30ms' }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">Corridor Buffer Width</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        key={bufferKm}
                        className="ct-pop num rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-bold text-[var(--accent)]"
                      >
                        {bufferKm} km
                      </span>
                      {isBufferOverridden ? (
                        <button
                          onClick={() => patchRiver({ bufferKm: null })}
                          className="rounded px-1 text-[9px] font-semibold text-[var(--accent)] hover:underline"
                          title="Reset to automatic calculation"
                        >
                          (auto)
                        </button>
                      ) : (
                        <span className="text-[9px] text-[var(--faint)]">(auto)</span>
                      )}
                    </div>
                  </div>

                  <input
                    type="range"
                    min={1}
                    max={50}
                    value={bufferKm}
                    onChange={(e) => setBufferKm(Number(e.target.value))}
                    className="mt-2 h-1.5 w-full cursor-pointer accent-[#0284c7]"
                  />

                  <div className="num mt-1 flex items-center justify-between text-[10px] text-[var(--muted)]">
                    <span>1 km</span>
                    <span>
                      Area: {corridor.data?.area_km2 ? `${num(corridor.data.area_km2, 0)} km²` : '—'}
                    </span>
                    <span>50 km</span>
                  </div>
                </div>

                {/* Dams in Corridor */}
                <div
                  className="ct-rise rounded-xl border border-[var(--line)] bg-gradient-to-b from-white to-slate-50/60 p-3"
                  style={{ animationDelay: '70ms' }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">Dams in Corridor</span>
                    <span className="num font-semibold text-slate-700">
                      {dams.pending ? (
                        <span className="ct-spin inline-flex text-[var(--accent)]">
                          <Icon name="spinner" size={11} />
                        </span>
                      ) : (
                        `${damsInCount} dams`
                      )}
                    </span>
                  </div>

                  <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {damsList.map((d) => {
                      const selected = activeRiver.damId === d.id
                      return (
                        <button
                          key={d.id}
                          onClick={() => selectDam(damRowToRiverPatch(d))}
                          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all hover:-translate-y-px active:translate-y-0 active:scale-95 ${
                            selected
                              ? 'border-transparent bg-gradient-to-br from-sky-600 to-blue-700 font-bold text-white shadow-md'
                              : 'border-[var(--line)] bg-white text-slate-700 hover:border-[var(--accent)] hover:shadow-sm'
                          }`}
                        >
                          {selected && (
                            <span key={`chk-${d.id}`} className="ct-pop">
                              <Icon name="check" size={10} />
                            </span>
                          )}
                          <Icon name="dam" size={11} />
                          <span>
                            {d.name} {d.height_m ? `(${d.height_m}m)` : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Data Staging Status */}
                <div
                  className="ct-rise flex items-center justify-between rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 text-[11px]"
                  style={{ animationDelay: '110ms' }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                    <span className="font-medium text-slate-700">Copernicus DEM & Mesh Bathymetry</span>
                  </div>
                  <span className="num text-[10px] font-semibold text-[var(--faint)]">
                    {damsList.length > 0 ? 'ONLINE' : '—'}
                  </span>
                </div>

                {/* Navigation Action Buttons */}
                <div className="ct-rise grid grid-cols-3 gap-2 pt-0.5" style={{ animationDelay: '150ms' }}>
                  <button
                    onClick={() => {
                      navigate('/discover')
                      setIsOpen(false)
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-white py-2 text-center text-[11px] font-semibold text-slate-700 transition-all hover:-translate-y-px hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-sm active:translate-y-0 active:scale-[0.98]"
                  >
                    <Icon name="search" size={12} />
                    Discover
                  </button>
                  <button
                    onClick={() => {
                      navigate('/build')
                      setIsOpen(false)
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-white py-2 text-center text-[11px] font-semibold text-slate-700 transition-all hover:-translate-y-px hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-sm active:translate-y-0 active:scale-[0.98]"
                  >
                    <Icon name="dam" size={12} />
                    Build
                  </button>
                  <button
                    onClick={() => {
                      navigate('/run')
                      setIsOpen(false)
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-600 to-blue-700 py-2 text-center text-[11px] font-semibold text-white shadow-md transition-all hover:-translate-y-px hover:shadow-lg hover:brightness-110 active:translate-y-0 active:scale-[0.98]"
                  >
                    <Icon name="play" size={12} />
                    Run
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
