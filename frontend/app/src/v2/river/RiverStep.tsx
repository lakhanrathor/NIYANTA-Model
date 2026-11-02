import { useEffect, useMemo, useState } from 'react'
import { MapShell } from '../../components/MapShell'
import type { LegendItem, MapFeature } from '../../components/MapShell'
import { Icon } from '../../components/ui'
import { api } from '../../lib/api'
import type { DamRow, RiverSearchItem } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { useRiverContext } from '../../lib/river-context'
import { useApi } from '../../lib/useApi'
import { useBuildConfig } from '../../screens/build/config'
import { DataAvailability } from '../../screens/discover/DataAvailability'
import { DataDownloads } from '../../screens/discover/DataDownloads'
import { NextSteps } from '../../screens/discover/NextSteps'
import { Wizard } from '../Shell'
import { Badge, Button, Card, EmptyState, Tabs, TextInput } from '../ui'

type DamHit = DamRow & { distance_km?: number | null; in_corridor?: boolean | null }

/**
 * Step 1 — choose a river, then the dam. Same data path as Discover: search
 * (local, then online on request), the selection published to the river
 * context, corridor + dams for the chosen buffer, and the dam seeding Build.
 */
export function RiverStep() {
  const active = useRiverContext((s) => s.river)
  const selectRiver = useRiverContext((s) => s.select)
  const patchRiver = useRiverContext((s) => s.patch)
  const clearRiver = useRiverContext((s) => s.clear)
  const setBufferKm = useRiverContext((s) => s.setBufferKm)
  const selectDamStore = useRiverContext((s) => s.selectDam)
  const seedDam = useBuildConfig((st) => st.seedDam)

  const [q, setQ] = useState(() => active?.query ?? '')
  const [submitted, setSubmitted] = useState('')
  const [limit, setLimit] = useState(12)
  const [worldFor, setWorldFor] = useState('')
  const [picked, setPicked] = useState<RiverSearchItem | null>(null)
  const [showBoxes, setShowBoxes] = useState(false)
  const [tab, setTab] = useState<'map' | 'data'>('map')
  const [hoverDamId, setHoverDamId] = useState<string | null>(null)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  const results = useApi(['rivers', 'search', submitted, limit], () => api.searchRivers(submitted, limit), {
    enabled: submitted.trim().length > 0,
  })
  const world = useApi(['rivers', 'world', worldFor, limit], () => api.searchWorldRivers(worldFor, limit), {
    enabled: worldFor.length > 0 && worldFor === submitted,
    staleTime: 60_000,
  })
  const boxes = useApi(['boxes'], api.watchBoxes)

  // local rows first, then online rows the catalogue did not already have
  const list = useMemo(() => {
    const local = results.data ?? []
    if (!worldFor || worldFor !== submitted || world.pending) return local
    const ids = new Set(local.flatMap((r) => (r.id ? [r.id] : [])))
    const names = new Set(local.filter((r) => !r.id).map((r) => r.name.toLowerCase()))
    const out = [...local]
    for (const r of world.data ?? []) {
      const name = r.name.toLowerCase()
      if (r.source === 'name' || (r.id && ids.has(r.id)) || names.has(name)) continue
      if (r.id) ids.add(r.id)
      names.add(name)
      out.push(r)
    }
    return out
  }, [results.data, world.data, world.pending, worldFor, submitted])

  const riverId = picked ? picked.id : (active?.id ?? null)
  const detail = useApi(['river', riverId], () => api.river(riverId!), { enabled: Boolean(riverId) })
  const selected: RiverSearchItem | null = useMemo(() => {
    if (picked) return picked
    if (!active) return null
    return {
      id: active.id,
      name: active.name,
      length_km: detail.data?.length_km ?? active.lengthKm,
      basin: detail.data?.basin ?? null,
      states: detail.data?.states ?? null,
      major_dam_count: detail.data?.major_dam_count ?? null,
      source: detail.data?.source ?? 'catalogue',
      kind: detail.data?.kind ?? 'catalogue',
      path: detail.data?.path ?? null,
      bbox: detail.data?.bbox ?? null,
    }
  }, [picked, active, detail.data])

  // choosing a row (not searching) is what moves the shared context
  const query = submitted || active?.query || ''
  useEffect(() => {
    if (!selected?.id) return
    if (active?.id === selected.id && active.name === selected.name && active.query === query) return
    selectRiver({ id: selected.id, name: selected.name, lengthKm: selected.length_km ?? null, query })
  }, [selected?.id, selected?.name, selected?.length_km, active, query, selectRiver])

  const owned = active && selected?.id && active.id === selected.id ? active : null
  const defaultBuffer = useMemo(() => {
    const km = selected?.length_km ?? detail.data?.length_km ?? null
    return km ? Math.min(50, Math.max(5, Math.round(km * 0.01))) : 20
  }, [selected?.length_km, detail.data?.length_km])
  const bufferKm = owned?.bufferKm ?? defaultBuffer

  const dams = useApi(['river-dams', riverId, bufferKm], () => api.riverDams(riverId!, bufferKm), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
    keepPrevious: true,
  })
  const corridor = useApi(['river-corridor', riverId, bufferKm], () => api.riverCorridor(riverId!, bufferKm), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
    keepPrevious: true,
  })

  const damId = active?.damId ?? null
  const damDetail = useApi(['dam', damId], () => api.dam(damId!), { enabled: Boolean(damId), staleTime: 60_000 })
  useEffect(() => {
    if (damDetail.data) seedDam(damDetail.data)
  }, [damDetail.data, seedDam])
  const damRows = (dams.data ?? []) as DamHit[]
  const selectedDam: DamHit | null = useMemo(() => {
    if (!damId) return null
    const row = damRows.find((d) => d.id === damId) ?? null
    const reg = damDetail.data?.id === damId ? damDetail.data : null
    if (row || reg) return { ...(row ?? {}), ...(reg ?? {}) } as DamHit
    return active?.damName ? ({ id: damId, name: active.damName, lat: active.damLat, lon: active.damLon } as DamHit) : null
  }, [damId, damRows, damDetail.data, active])

  const pickDam = (d: DamHit) => {
    if (!selected?.id) return
    if (active?.id !== selected.id)
      selectRiver({ id: selected.id, name: selected.name, lengthKm: selected.length_km ?? null, query })
    selectDamStore({
      id: d.id,
      name: d.name,
      damName: d.name,
      damAlongKm: d.distance_km,
      damLat: d.lat,
      damLon: d.lon,
      damHeight: d.height_m,
      damCrest: d.crest_m,
      damFsl: d.fsl_m,
      damType: d.dam_type,
      damCrestLength: d.crest_length_m,
      damHeadingDeg: d.heading_deg,
      damStorageMcm: d.storage_mcm,
      damState: d.state,
    })
    seedDam(d)
  }

  const submit = () => {
    const v = q.trim()
    setSubmitted(v)
    setPicked(null)
    setWorldFor('')
  }

  const chooseRiver = (r: RiverSearchItem) => {
    setPicked(r)
    if (!r.id) clearRiver()
  }

  const upload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { name?: string; coordinates?: unknown }
      if (!parsed.coordinates) {
        setUploadNote('File has no GeoJSON coordinates — nothing sent.')
        return
      }
      const created = await api.createRiver({ name: parsed.name ?? file.name.replace(/\.[^.]+$/, ''), geometry: parsed })
      setUploadNote(`Added ${created.name ?? 'river'} — search for it by name.`)
    } catch {
      setUploadNote('Upload rejected — expected a GeoJSON LineString.')
    }
  }

  /* ------------------------------------------------------------------ map */
  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []
    if (corridor.data?.geometry)
      out.push({
        id: 'river-corridor',
        label: `Study corridor (${bufferKm} km)`,
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: corridor.data.geometry }] },
        kind: 'fill',
        color: '#4a9bd8',
        fillOpacity: 0.08,
        dasharray: [5, 4],
      })
    if (selected?.path)
      out.push({
        id: 'river-path',
        label: 'River',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: selected.path }] },
        kind: 'line',
        color: '#2563eb',
        width: 3,
      })
    const pts = (rows: DamHit[]) => ({
      type: 'FeatureCollection' as const,
      features: rows
        .filter((d) => typeof d.lon === 'number' && typeof d.lat === 'number')
        .map((d) => ({
          type: 'Feature' as const,
          properties: { id: d.id, name: d.name, status: d.status },
          geometry: { type: 'Point' as const, coordinates: [d.lon as number, d.lat as number] },
        })),
    })
    const inside = damRows.filter((d) => d.in_corridor !== false)
    const outside = damRows.filter((d) => d.in_corridor === false)
    if (inside.length) out.push({ id: 'river-dams-inside', label: 'Dams in corridor', data: pts(inside), kind: 'circle', color: '#b42318', radius: 6 })
    if (outside.length) out.push({ id: 'river-dams-outside', label: 'Dams outside corridor', data: pts(outside), kind: 'circle', color: '#98a2b3', radius: 5 })
    if (selectedDam && typeof selectedDam.lon === 'number' && typeof selectedDam.lat === 'number')
      out.push({ id: 'selected-dam', label: `Selected: ${selectedDam.name}`, data: pts([selectedDam]), kind: 'circle', color: '#7a0b06', radius: 10 })
    if (showBoxes && boxes.data?.length)
      out.push({
        id: 'watch-boxes',
        label: 'Watch areas',
        data: {
          type: 'FeatureCollection',
          features: boxes.data
            .filter((b) => b.bbox_geojson)
            .map((b) => ({ type: 'Feature', properties: { name: b.name }, geometry: b.bbox_geojson! })),
        },
        kind: 'fill',
        color: '#d81b9b',
        fillOpacity: 0.1,
        dasharray: [3, 2],
      })
    return out
  }, [corridor.data, bufferKm, selected?.path, damRows, selectedDam, showBoxes, boxes.data])

  const legend: LegendItem[] = features.map((f) => ({ id: f.id, label: f.label, color: f.color, dashed: Boolean(f.dasharray) }))
  const fit = useMemo(() => {
    if (selected?.bbox?.length === 4) return selected.bbox
    const c = selected?.path?.coordinates
    if (!c?.length) return null
    const xs = c.map((p) => p[0])
    const ys = c.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }, [selected])
  const hover = useMemo(() => {
    const d = hoverDamId ? damRows.find((x) => x.id === hoverDamId) : null
    return d && typeof d.lon === 'number' && typeof d.lat === 'number'
      ? { lon: d.lon, lat: d.lat, title: d.name, subtitle: d.distance_km != null ? `${num(d.distance_km, 1)} km along river` : '' }
      : null
  }, [hoverDamId, damRows])

  const sortedDams = [...damRows].sort(
    (a, b) => Number(b.in_corridor !== false) - Number(a.in_corridor !== false) || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9),
  )

  return (
    <Wizard
      step={0}
      fill
      aside={
        selectedDam ? (
          <Badge tone="ok">
            <Icon name="check" size={11} /> {selected?.name} · {selectedDam.name}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 gap-5">
        {/* ---------------------------------------------------- left column */}
        <div className="flex w-[420px] shrink-0 flex-col gap-4 overflow-y-auto pb-2">
          <Card title="1 · Find the river" subtitle="Type a river name and press Enter.">
            <div className="flex gap-2">
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="e.g. Alaknanda, Krishna, Teesta"
                aria-label="River name"
              />
              <Button variant="primary" onClick={submit} aria-label="Search">
                <Icon name="search" size={14} />
              </Button>
            </div>
            {submitted && (
              <div className="mt-3 flex flex-col gap-1.5">
                {results.pending && <p className="text-[12px] text-[var(--muted)]">Searching…</p>}
                {!results.pending && !list.length && (
                  <EmptyState title={`No river called “${submitted}” in the catalogue`}>
                    Try another spelling, or search online below.
                  </EmptyState>
                )}
                {list.map((r, i) => {
                  const isSel = selected && (r.id ? r.id === selected.id : r === selected)
                  return (
                    <button
                      key={(r.id ?? r.name) + i}
                      onClick={() => chooseRiver(r)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition ${
                        isSel ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--accent)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{r.name}</span>
                        {r.cached !== undefined && <Badge tone="neutral">found online</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">
                        {[
                          r.length_km != null ? `${num(r.length_km, 0)} km long` : null,
                          r.basin ? `${r.basin} basin` : null,
                          r.states?.length ? r.states.join(', ') : r.state,
                          r.major_dam_count != null ? `${r.major_dam_count} major dams` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || EM_DASH}
                      </div>
                    </button>
                  )
                })}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {list.length > 0 && list.length === (results.data?.length ?? 0) && (
                    <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 24)}>
                      Show more
                    </Button>
                  )}
                  {!(worldFor === submitted) && (
                    <Button size="sm" variant="ghost" onClick={() => setWorldFor(submitted)}>
                      <Icon name="globe" size={12} /> Search online too
                    </Button>
                  )}
                  {world.pending && worldFor && <span className="text-[11.5px] text-[var(--muted)]">Searching online…</span>}
                </div>
              </div>
            )}
            <label className="mt-3 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--muted)] hover:text-[var(--accent)]">
              <Icon name="file" size={12} /> Or upload your own river (GeoJSON line)
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
            {uploadNote && <p className="mt-1 text-[11.5px] text-[var(--muted)]">{uploadNote}</p>}
          </Card>

          <Card
            title="2 · Pick the dam"
            subtitle={selected?.id ? `Dams along ${selected.name}. Red dots on the map are inside the study corridor.` : 'Choose a river first.'}
            className={selected?.id ? '' : 'opacity-60'}
          >
            {selected?.id && (
              <>
                <label className="block text-[12px] font-medium text-[var(--muted)]">
                  Study corridor width: <span className="num font-semibold text-[var(--text)]">{bufferKm} km</span>
                  {owned?.bufferKm != null && (
                    <button className="ml-2 text-[11.5px] font-semibold text-[var(--accent)]" onClick={() => patchRiver({ bufferKm: null })}>
                      reset
                    </button>
                  )}
                </label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={Math.min(100, bufferKm)}
                  onChange={(e) => setBufferKm(Number(e.target.value))}
                  className="mt-1 w-full accent-[var(--accent)]"
                  aria-label="Corridor width (km)"
                />
                <div className="mt-3 flex max-h-[340px] flex-col gap-1.5 overflow-y-auto">
                  {dams.pending && !damRows.length && <p className="text-[12px] text-[var(--muted)]">Finding dams…</p>}
                  {!dams.pending && !damRows.length && (
                    <EmptyState title="No dams found near this river">Widen the corridor, or choose another river.</EmptyState>
                  )}
                  {sortedDams.map((d) => {
                    const isSel = d.id === damId
                    return (
                      <button
                        key={d.id}
                        onClick={() => pickDam(d)}
                        onMouseEnter={() => setHoverDamId(d.id)}
                        onMouseLeave={() => setHoverDamId(null)}
                        className={`rounded-lg border px-3 py-2.5 text-left transition ${
                          isSel ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--accent)]'
                        } ${d.in_corridor === false ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{d.name}</span>
                          {isSel && <Badge tone="accent">selected</Badge>}
                          {d.in_corridor === false && <Badge>outside corridor</Badge>}
                        </div>
                        <div className="num mt-0.5 text-[11.5px] text-[var(--muted)]">
                          {[
                            d.height_m != null ? `${num(d.height_m, 0)} m high` : null,
                            d.storage_mcm != null ? `${num(d.storage_mcm, 0)} MCM` : null,
                            d.distance_km != null ? `${num(d.distance_km, 1)} km along` : null,
                            d.state,
                          ]
                            .filter(Boolean)
                            .join(' · ') || EM_DASH}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* -------------------------------------------------- map / data area */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Tabs
              tabs={[
                { value: 'map', label: 'Map' },
                { value: 'data', label: 'River data' },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'map' && (
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Show watch areas
              </label>
            )}
          </div>
          {tab === 'map' ? (
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow)]">
              <MapShell
                features={features}
                fit={fit}
                legend={legend}
                showSearch={false}
                hover={hover}
                onFeatureHover={setHoverDamId}
                notice={!selected ? 'Search for a river to see it here.' : null}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {riverId ? (
                <div className="grid gap-3 xl:grid-cols-2">
                  <DataAvailability riverId={riverId} bufferKm={bufferKm} />
                  <DataDownloads riverId={riverId} />
                  <div className="xl:col-span-2">
                    <NextSteps
                      riverId={riverId}
                      riverName={selected?.name ?? null}
                      damId={damId}
                      damName={selectedDam?.name ?? null}
                      bufferKm={bufferKm}
                    />
                  </div>
                </div>
              ) : (
                <EmptyState title="No river chosen yet">Pick a river to see which data is ready for it.</EmptyState>
              )}
            </div>
          )}
        </div>
      </div>
    </Wizard>
  )
}
