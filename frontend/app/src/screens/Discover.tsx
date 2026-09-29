import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { MapShell } from '../components/MapShell'
import type { LegendItem, MapFeature } from '../components/MapShell'
import { DamCard } from '../components/dam/DamCard'
import { Panel } from '../components/ui'
import { WorkspaceLayout } from '../layouts'
import { api } from '../lib/api'
import type { DamRow, RiverSearchItem } from '../lib/api'
import { useRiverContext } from '../lib/river-context'
import { useApi } from '../lib/useApi'
import { num } from '../lib/format'
import { BuildConfig } from './build/BuildConfig'
import { BuildRun } from './build/BuildRun'
import { buildLegend, buildOverlays, damFit, useBuildConfig } from './build/config'
import { DamList } from './discover/DamList'
import { DataAvailability } from './discover/DataAvailability'
import { DataDownloads } from './discover/DataDownloads'
import { DiscoverPanel } from './discover/DiscoverPanel'
import { CorridorPanel } from './discover/CorridorPanel'
import { NextSteps } from './discover/NextSteps'
import { RiverInfo } from './discover/RiverInfo'
import { DEFAULT_FILTERS, countFilters } from './discover/SearchFilters'
import type { DiscoverFilters } from './discover/SearchFilters'

export function Discover() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const route = useParams()
  // One screen, two modes. /corridor/:id and /build render this same component,
  // so React keeps the instance — the map never remounts and the camera, zoom
  // and hover from Discover carry straight into Build.
  const buildMode = pathname.startsWith('/corridor') || pathname.startsWith('/build')
  const active = useRiverContext((s) => s.river)
  const selectRiver = useRiverContext((s) => s.select)
  const patchRiver = useRiverContext((s) => s.patch)
  const clearRiver = useRiverContext((s) => s.clear)

  // Search and selection are two separate acts. The box is prefilled from the
  // stored context, but the results query only runs when the user asks for it —
  // an unchanged query never re-fires just because the page was refreshed.
  const urlQuery = params.get('q')
  const [q, setQ] = useState(() => urlQuery ?? active?.query ?? '')
  const [submitted, setSubmitted] = useState(() => (active ? '' : (urlQuery ?? '')))
  const [tab, setTab] = useState('search')
  const [limit, setLimit] = useState(12)
  // Only an explicit click on a result row sets this — nothing is auto-picked.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  // The online tier runs only for the query the user triggered it from, and only
  // until a new search clears it — the local list never gains remote rows silently.
  const [worldFor, setWorldFor] = useState('')
  // One hover id shared by the dam table and the map: hovering either side
  // highlights the other, so the list and the markers read as the same data.
  const [hoverDamId, setHoverDamId] = useState<string | null>(null)

  const results = useApi(
    ['rivers', 'search', submitted, limit],
    () => api.searchRivers(submitted, limit),
    { enabled: submitted.trim().length > 0 },
  )
  const world = useApi(
    ['rivers', 'world', worldFor, limit],
    () => api.searchWorldRivers(worldFor, limit),
    { enabled: worldFor.length > 0 && worldFor === submitted, staleTime: 60_000 },
  )
  const boxes = useApi(['boxes'], api.watchBoxes)

  // Local results first, then whatever the explicit world search added that the
  // catalogue did not already have.
  const list = useMemo(() => {
    const local = results.data ?? []
    if (!worldFor || worldFor !== submitted || world.pending) return local
    const ids = new Set(local.flatMap((r) => (r.id ? [r.id] : [])))
    const names = new Set(local.filter((r) => !r.id).map((r) => r.name.toLowerCase()))
    const out = [...local]
    for (const r of world.data ?? []) {
      const name = r.name.toLowerCase()
      // A name-only echo of the query is not a river, and it carries no id to
      // build a context on — the empty-state message covers it instead.
      if (r.source === 'name') continue
      if ((r.id && ids.has(r.id)) || names.has(name)) continue
      if (r.id) ids.add(r.id)
      names.add(name)
      out.push(r)
    }
    return out
  }, [results.data, world.data, world.pending, worldFor, submitted])

  const clicked = selectedIdx === null ? null : (list[selectedIdx] ?? null)
  const riverId = clicked ? clicked.id : (active?.id ?? null)
  const detail = useApi(['river', riverId], () => api.river(riverId!), {
    enabled: Boolean(riverId),
  })

  // With no click on screen the context river is rebuilt from its catalogue
  // record: a refresh restores the map, corridor and dams without asking the
  // search endpoint for the same list again. Memoized — a fresh object every
  // render would defeat every downstream memo (features, fit) and the map
  // would re-draw + re-fit on each list hover.
  const storeRiver = useMemo<RiverSearchItem | null>(() => {
    if (clicked || !active) return null
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
  }, [clicked, active, detail.data])

  const selected: RiverSearchItem | null = clicked ?? storeRiver
  // The stored river only "owns" buffer + dam while it is the river on screen.
  const owned = active && selected?.id && active.id === selected.id ? active : null

  const ensureRiver = () => {
    if (!selected?.id) return false
    if (active?.id !== selected.id)
      selectRiver({
        id: selected.id,
        name: selected.name,
        lengthKm: selected.length_km ?? null,
        query: submitted || active?.query || '',
      })
    return true
  }

  // Selecting a row is what changes the shared context — searching alone never
  // does. This is what lets a refresh or another screen land on the same river.
  const query = submitted || active?.query || ''
  useEffect(() => {
    if (!selected?.id) return
    if (
      active?.id === selected.id &&
      active.name === selected.name &&
      active.query === query &&
      active.lengthKm === (selected.length_km ?? null)
    )
      return
    selectRiver({
      id: selected.id,
      name: selected.name,
      lengthKm: selected.length_km ?? null,
      query,
    })
  }, [selected?.id, selected?.name, selected?.length_km, active, query, selectRiver])

  // A /corridor/:riverId link (or a refresh on it) has to restore the river even
  // when the stored context is empty — the id in the URL is the authority there.
  const urlRiverId = route.riverId ?? null
  useEffect(() => {
    if (!urlRiverId || active?.id === urlRiverId) return
    let cancelled = false
    api
      .river(urlRiverId)
      .then((r) => {
        if (cancelled) return
        selectRiver({ id: r.id, name: r.name, lengthKm: r.length_km ?? null, query: r.name })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [urlRiverId, active?.id, selectRiver])

  // Corridor width is a human decision, not a constant: the default scales with
  // river size and the slider re-queries dams + polygon immediately.
  const defaultBuffer = useMemo(() => {
    const km = selected?.length_km ?? detail.data?.length_km ?? null
    return km ? Math.min(50, Math.max(5, Math.round(km * 0.01))) : 20
  }, [selected?.length_km, detail.data?.length_km])

  const bufferOverride = owned?.bufferKm ?? null
  const bufferKm = bufferOverride ?? defaultBuffer

  // Scoped to the river *and* the buffer position: one request per scope, kept
  // for a minute and reused when the slider comes back to that width. Sliding
  // the buffer must never blank the previous geometry, hence keepPrevious.
  const dams = useApi(['river-dams', riverId, bufferKm], () => api.riverDams(riverId!, bufferKm), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
    keepPrevious: true,
  })
  const corridor = useApi(
    ['river-corridor', riverId, bufferKm],
    () => api.riverCorridor(riverId!, bufferKm),
    { enabled: Boolean(riverId), staleTime: 60_000, keepPrevious: true },
  )
  const corridors = useApi(['corridors'], api.corridors, {
    enabled: Boolean(riverId || active?.id),
  })
  const corridorRow = active
    ? corridors.data?.find((c) => c.river_id === active.id) ?? null
    : null

  const selectDamStore = useRiverContext((s) => s.selectDam)
  const build = useBuildConfig()
  const seedDam = useBuildConfig((st) => st.seedDam)

  const selectedDamId = active?.damId ?? build.damId ?? null

  const damDetail = useApi(['dam', selectedDamId], () => api.dam(selectedDamId!), {
    enabled: Boolean(selectedDamId),
    staleTime: 60_000,
  })

  const selectedDam = useMemo<DamRow | null>(() => {
    if (!selectedDamId) return null
    const fromList = dams.data?.find((d) => d.id === selectedDamId) ?? null
    const detail =
      damDetail.data && damDetail.data.id === selectedDamId ? damDetail.data : null
    // The list row is thin by design — id/name/state/type/height/position for
    // the table and the map — while the registry record behind the same id
    // carries the rest (crest, crest length, storage). Merge both, never one.
    if (fromList || detail) return { ...(fromList ?? {}), ...(detail ?? {}) } as DamRow
    // Registry has not answered yet — the stored attributes are what we have.
    if (active?.damId === selectedDamId && active.damName) {
      return {
        id: selectedDamId,
        name: active.damName,
        lat: active.damLat,
        lon: active.damLon,
        height_m: active.damHeight,
        crest_m: active.damCrest,
        fsl_m: active.damFsl,
        dam_type: active.damType,
        crest_length_m: active.damCrestLength,
        storage_mcm: active.damStorageMcm,
        status: 'in_db',
      }
    }
    return null
  }, [selectedDamId, dams.data, damDetail.data, active])

  const pickDam = (id: string | null) => {
    if (!id) {
      patchRiver({ damId: null, damName: null, damLat: null, damLon: null })
      return
    }
    ensureRiver()
    const match: DamRow & { distance_km?: number | null } =
      dams.data?.find((d) => d.id === id) ?? ({ id, name: id } as unknown as DamRow)
    selectDamStore({
      id: match.id,
      name: match.name,
      damName: match.name,
      damAlongKm: match.distance_km,
      damLat: match.lat,
      damLon: match.lon,
      damHeight: match.height_m,
      damCrest: match.crest_m,
      damFsl: match.fsl_m,
      damType: match.dam_type,
      damCrestLength: match.crest_length_m,
      damHeadingDeg: match.heading_deg,
      damStorageMcm: match.storage_mcm,
      damState: match.state,
    })
    seedDam(match)
  }

  useEffect(() => {
    if (damDetail.data) seedDam(damDetail.data)
  }, [damDetail.data, seedDam])

  // Impact source decides itself from disk evidence, once per draft: WorldPop
  // on disk → worldpop, otherwise manual entry (the run still backs itself
  // with GHS-POP/OSM either way, so nothing here can block a simulation).
  const buildDatasets = useApi(
    ['corridor-datasets', corridorRow?.id],
    () => api.corridorDatasets(corridorRow!.id),
    { enabled: buildMode && Boolean(corridorRow), staleTime: 30_000 },
  )
  const seedImpact = useBuildConfig((st) => st.seedImpact)
  useEffect(() => {
    const rows = buildDatasets.data
    if (!rows) return
    seedImpact(rows.find((r) => r.kind === 'worldpop')?.status === 'available')
  }, [buildDatasets.data, seedImpact])

  // Map ← list hover: the same dam row rendered as a ring + popup on the map.
  const hoveredDam =
    hoverDamId && hoverDamId !== selectedDamId
      ? (dams.data?.find((d) => d.id === hoverDamId) ?? null)
      : null
  const hoverPoint = useMemo(
    () =>
      hoveredDam && typeof hoveredDam.lon === 'number' && typeof hoveredDam.lat === 'number'
        ? {
            lon: hoveredDam.lon,
            lat: hoveredDam.lat,
            title: hoveredDam.name,
            subtitle: [
              hoveredDam.status === 'in_db' ? 'In DB' : 'Missing',
              hoveredDam.distance_km != null
                ? `${num(hoveredDam.distance_km, 1)} km along river`
                : null,
              hoveredDam.in_corridor === false ? 'outside corridor' : null,
            ]
              .filter((x): x is string => x !== null)
              .join(' · '),
          }
        : null,
    [hoveredDam],
  )

  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []
    if (corridor.data?.geometry) {
      out.push({
        id: 'river-corridor',
        label: `River Corridor (${bufferKm} km)`,
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: corridor.data.geometry }],
        },
        kind: 'fill',
        color: '#4a9bd8',
        fillOpacity: 0.08,
        dasharray: [5, 4],
      })
    }
    if (selected?.path) {
      out.push({
        id: 'river-path',
        label: 'River Path (HydroRIVERS)',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: selected.path }] },
        kind: 'line',
        color: '#4a9bd8',
        width: 3,
      })
    }
    if (filters.showDams && dams.data?.length) {
      const inside = dams.data.filter((d) => d.in_corridor !== false)
      const outside = dams.data.filter((d) => d.in_corridor === false)
      const points = (rows: typeof inside) => ({
        type: 'FeatureCollection' as const,
        features: rows
          .filter((d) => typeof d.lon === 'number' && typeof d.lat === 'number')
          .map((d) => ({
            type: 'Feature' as const,
            properties: {
              id: d.id,
              name: d.name,
              status: d.status,
              state: d.state,
              distance_km: d.distance_km,
              in_corridor: d.in_corridor,
            },
            geometry: { type: 'Point' as const, coordinates: [d.lon as number, d.lat as number] },
          })),
      })
      // Two tones: the corridor is what the DEM and imagery cover, so it stays
      // red, and the curated dams beyond it read as context rather than hits.
      if (inside.length)
        out.push({
          id: 'river-dams-inside',
          label: `Dams (in corridor, ${inside.length})`,
          data: points(inside),
          kind: 'circle',
          color: '#b42318',
          radius: 6,
        })
      if (outside.length)
        out.push({
          id: 'river-dams-outside',
          label: `Dams (outside corridor, ${outside.length})`,
          data: points(outside),
          kind: 'circle',
          color: '#98a2b3',
          radius: 5,
        })
    }
    if (selectedDam && typeof selectedDam.lon === 'number' && typeof selectedDam.lat === 'number') {
      out.push({
        id: 'selected-dam',
        label: `Selected Dam (${selectedDam.name})`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { id: selectedDam.id, name: selectedDam.name, status: selectedDam.status },
              geometry: { type: 'Point', coordinates: [selectedDam.lon, selectedDam.lat] },
            },
          ],
        },
        kind: 'circle',
        color: '#7a0b06',
        radius: 9,
      })
    }
    if (filters.showBoxes && boxes.data?.length) {
      out.push({
        id: 'watch-boxes',
        label: 'Watch Boxes',
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
    }
    return out
  }, [selected, dams.data, boxes.data, corridor.data, bufferKm, selectedDam, filters.showDams, filters.showBoxes])

  // Build layers the config overlays (reservoir footprint, breach notch, downstream flood reach) onto
  // the same list — corridor, path and dam rows are untouched.
  // (The amber domain ring is global — every map shell draws it from context.)
  const mapFeatures: MapFeature[] =
    buildMode ? [...features, ...buildOverlays(build, selectedDam, selected?.path, bufferKm)] : features

  const riverFit = useMemo(() => {
    if (selected?.bbox && selected.bbox.length === 4) return selected.bbox
    const coords = selected?.path?.coordinates
    if (!coords?.length) return null
    let w = coords[0][0]
    let e = coords[0][0]
    let s = coords[0][1]
    let n = coords[0][1]
    for (const c of coords) {
      if (c[0] < w) w = c[0]
      if (c[0] > e) e = c[0]
      if (c[1] < s) s = c[1]
      if (c[1] > n) n = c[1]
    }
    return [w, s, e, n]
  }, [selected])

  // Entering Build centres the configured dam; leaving it fits the river again.
  const fit = useMemo(
    () => (buildMode ? (damFit(selectedDam) ?? riverFit) : riverFit),
    [buildMode, selectedDam, riverFit],
  )

  // Legend rows must not blink out while a query is in flight: an item that is
  // still loading stays in the list as a pending row, then swaps in its value.
  const damRows = dams.data ?? []
  const damsIn = damRows.filter((d) => d.in_corridor !== false)
  const damsOut = damRows.filter((d) => d.in_corridor === false)
  const legend: LegendItem[] = [
    ...(riverId && (corridor.pending || corridor.data)
      ? [
          corridor.data
            ? {
                id: 'river-corridor',
                label: `River Corridor (${bufferKm} km · ${corridor.data.area_km2.toLocaleString()} km²)`,
                color: '#4a9bd8',
                dashed: true,
              }
            : {
                id: 'river-corridor',
                label: `River Corridor (${bufferKm} km)`,
                color: '#4a9bd8',
                dashed: true,
                pending: true,
              },
        ]
      : []),
    ...(selected?.path
      ? [{ id: 'river-path', label: `River Path (${selected.name})`, color: '#4a9bd8' }]
      : riverId && detail.pending
        ? [
            {
              id: 'river-path',
              label: `River Path (${selected?.name ?? 'river'})`,
              color: '#4a9bd8',
              pending: true,
            },
          ]
        : []),
    ...(filters.showDams && (dams.pending || damRows.length)
      ? damRows.length
        ? [
            ...(damsIn.length
              ? [{ id: 'river-dams-inside', label: `Dams (in corridor, ${damsIn.length})`, color: '#b42318' }]
              : []),
            ...(damsOut.length
              ? [{ id: 'river-dams-outside', label: `Dams (outside corridor, ${damsOut.length})`, color: '#98a2b3' }]
              : []),
          ]
        : [{ id: 'river-dams-inside', label: 'Dams (along river)', color: '#b42318', pending: true }]
      : []),
    ...(selectedDam
      ? [{ id: 'selected-dam', label: `Selected Dam · ${selectedDam.name}`, color: '#7a0b06' }]
      : []),
    ...(filters.showBoxes && (boxes.pending || boxes.data?.length)
      ? [
          boxes.data?.length
            ? { id: 'watch-boxes', label: 'Watch Boxes', color: '#d81b9b', dashed: true }
            : { id: 'watch-boxes', label: 'Watch Boxes', color: '#d81b9b', dashed: true, pending: true },
        ]
      : []),
  ]

  const notices: string[] = []
  const mapLegend: LegendItem[] = buildMode ? [...legend, ...buildLegend(build)] : legend
  if (!selected && !active) notices.push('No river selected — pick one from the results')
  if (dams.offline && !dams.data?.length && !selectedDam) notices.push('Dams unavailable')
  if (corridor.offline && !corridor.data && !selected?.path) notices.push('Corridor unavailable')
  if (buildMode && !selectedDam) notices.push('No dam selected — pick one in Discover')

  const submit = (next?: string) => {
    const value = (next ?? q).trim()
    setSubmitted(value)
    // A new search drops the row highlight but never the context: listing
    // rivers is not the same as choosing one. It also drops the online tier —
    // remote rows belong to the query they were fetched for.
    setSelectedIdx(null)
    setWorldFor('')
    setParams(value ? { q: value } : {}, { replace: true })
  }

  // Selection is always explicit. A hit with no local id has nothing durable to
  // build a context on, so it is shown on the map but clears the context.
  const selectResult = (i: number) => {
    setSelectedIdx(i)
    if (!list[i]?.id) clearRiver()
  }

  const highlightIdx = selected
    ? selected.id
      ? list.findIndex((r) => r.id === selected.id)
      : list.indexOf(selected)
    : -1

  const patchFilters = (patch: Partial<DiscoverFilters>) => setFilters((f) => ({ ...f, ...patch }))

  return (
    <WorkspaceLayout
      layoutId={buildMode ? 'build' : 'discover'}
      leftTitle={buildMode ? 'Configure' : 'Explore'}
      rightTitle={buildMode ? 'Launch' : 'Details'}
      centerClassName="relative min-h-0 overflow-hidden rounded border border-[var(--line)] bg-white"
      left={
        <>
          {buildMode ? (
            <BuildConfig />
          ) : (
            <>
              <DiscoverPanel
                q={q}
                setQ={setQ}
                onSearch={() => submit()}
                tab={tab}
                setTab={setTab}
                showFilters={showFilters}
                setShowFilters={setShowFilters}
                activeFilters={countFilters(filters)}
                filters={filters}
                onFilterChange={patchFilters}
                onClearFilters={() => setFilters(DEFAULT_FILTERS)}
                results={results}
                list={list}
                selectedIdx={highlightIdx >= 0 ? highlightIdx : null}
                onSelect={selectResult}
                submitted={submitted}
                typed={q.trim().length > 0}
                hasMore={list.length > 0 && list.length === (results.data?.length ?? 0)}
                onMore={() => setLimit((n) => n + 24)}
                world={{
                  active: worldFor.length > 0 && worldFor === submitted,
                  pending: world.pending && worldFor.length > 0,
                  onSearch: () => setWorldFor(submitted),
                }}
              />

              <RiverInfo river={selected} detail={detail} hasId={Boolean(riverId)} />
              <CorridorPanel
                riverName={selected?.name ?? null}
                bufferKm={bufferKm}
                overridden={bufferOverride !== null}
                areaKm2={corridor.data?.area_km2 ?? null}
                pending={corridor.pending}
                damsIn={damsIn.length}
                damsTotal={damRows.length}
              />
              <DamList
                dams={dams}
                hasId={Boolean(riverId)}
                selectedId={selectedDamId}
                onSelect={pickDam}
                hoverId={hoverDamId}
                onHover={setHoverDamId}
              />
            </>
          )}
        </>
      }
      center={
        <MapShell
          features={mapFeatures}
          fit={fit}
          legend={mapLegend}
          notice={
            notices.length ? (
              <ul className="flex flex-col gap-0.5">
                {notices.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null
          }
          showSearch={false}
          hover={hoverPoint}
          onFeatureHover={setHoverDamId}
        />
      }
      right={
        <>
          {buildMode ? (
            <BuildRun />
          ) : (
            <>
              {selectedDamId && (
                <Panel title="Selected Dam">
                  <DamCard
                    variant="full"
                    action={
                      <Link
                        to={riverId ? `/corridor/${riverId}` : '/build'}
                        className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 text-[12px] font-semibold shadow-sm transition-all hover:brightness-110"
                      >
                        <span className="text-white">Continue to Build</span>
                      </Link>
                    }
                  />
                </Panel>
              )}
              <DataAvailability riverId={riverId} bufferKm={bufferKm} />
              <DataDownloads riverId={riverId} />
              <NextSteps
                riverId={riverId}
                riverName={selected?.name ?? null}
                damId={selectedDamId}
                damName={selectedDam?.name ?? null}
                bufferKm={bufferKm}
              />
            </>
          )}
        </>
      }
    />
  )
}

