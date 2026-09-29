import { useEffect, useMemo, useState } from 'react'
import { INFRA_COLORS, api, infraColorHex } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useRunId } from '../lib/useRun'
import { Panel } from '../components/ui'
import { StationsPanel } from '../components/flood/StationsPanel'
import { gaugeFeatures, gaugeLegend } from '../components/flood/gauges'
import type { LegendItem, MapFeature } from '../components/MapShell'
import { useRiverContext } from '../lib/river-context'
import { damRowToRiverPatch } from '../lib/mission'
import { damFit, displayReachKm, sliceDownstreamRiverPath, useBuildConfig } from './build/config'
import { ResultsScenarioPanel } from './results/ResultsScenarioPanel'
import { ResultsOverlaysPanel } from './results/ResultsOverlaysPanel'
import { ResultsExportsPanel } from './results/ResultsExportsPanel'
import { ResultsMapPane } from './results/ResultsMapPane'
import { WorkspaceLayout } from '../layouts'
import { ResultsTimelinePanel } from './results/ResultsTimelinePanel'
import { ResultsAnalyticsPanel } from './results/ResultsAnalyticsPanel'
import { ResultsProbePanel } from './results/ResultsProbePanel'
import { ResultsImpactPanel } from './results/ResultsImpactPanel'
import { ResultsCascadePanel } from './results/ResultsCascadePanel'

const DONE_STATES = ['SUCCEEDED', 'COMPLETED', 'DONE', 'PUBLISHED', 'VALIDATED']

/**
 * Single-run results. This screen is an orchestrator: it resolves the run,
 * fetches every dataset once, builds the shared map overlays, and composes
 * the panels in `screens/results/`. Nothing is fabricated — empty endpoints
 * render EM_DASH inside the panels.
 */
export function Results() {
  const runId = useRunId()
  if (!runId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-[12px] leading-relaxed text-[var(--faint)]">
        No runs with results yet. Configure a scenario on Build and execute it first.
      </div>
    )
  }
  // A new run remounts with fresh frame / probe / playback state.
  return <ResultsView key={runId} runId={runId} />
}

function ResultsView({ runId }: { runId: string }) {
  /** Left rail shows one panel at a time — the map gets the room instead. */
  const [leftTab, setLeftTab] = useState<'scenario' | 'overlays' | 'export'>('scenario')

  // River context & build settings — every value below subscribes to the
  // mission store; panels never keep private river state.
  const activeRiver = useRiverContext((s) => s.river)
  const build = useBuildConfig()

  const runDetail = useApi(['run', runId], () => api.run(runId), { enabled: Boolean(runId) })
  const run = runDetail.data?.run
  const scenarioId = run?.scenario_id ?? null
  const scenario = useApi(['scenario', scenarioId], () => api.scenario(scenarioId!), {
    enabled: Boolean(scenarioId),
  })
  const summary = useApi(['summary', runId], () => api.summary(runId), { enabled: Boolean(runId) })
  const frames = useApi(['frames', runId], () => api.frames(runId), { enabled: Boolean(runId) })
  const impact = useApi(['impact', runId], () => api.impact(runId), { enabled: Boolean(runId) })
  const resultDoc = useApi(['result', runId], () => api.result(runId), { enabled: Boolean(runId) })
  const stationDoc = useApi(['stations', runId], () => api.runStations(runId), { enabled: Boolean(runId) })
  const seriesDoc = useApi(['series', runId], () => api.runSeries(runId), { enabled: Boolean(runId) })
  const hydroDoc = useApi(['breach-hydro', runId], () => api.breachHydrograph(runId), {
    enabled: Boolean(runId),
  })
  // The pinned cell lives in the map scope — the pane writes it on click,
  // this query and the probe panel read it. Same context, no prop chains.
  const probe = useRiverContext((s) => s.mapIntents['results']?.probe ?? null)
  // OSM roads/buildings coloured by the flood at the timeline frame (or by
  // their peak in the Max view) — same data + colours as the 3D player.
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })
  const mapFrame = useRiverContext((s) => s.mapIntents['results']?.frame ?? 0)
  const mapShowMax = useRiverContext((s) => s.mapIntents['results']?.showMax ?? true)
  const infraFeatures = useMemo<MapFeature[]>(() => {
    const d = infra.data
    if (!d) return []
    const i = mapShowMax ? null : mapFrame
    const { building_m: bThr, road_cut_m: rThr } = d.thresholds
    return [
      {
        id: 'osm-roads',
        label: 'Roads (OSM)',
        kind: 'line',
        color: INFRA_COLORS.dryRoad,
        width: 2.2,
        data: {
          type: 'FeatureCollection',
          features: d.roads.map((r) => ({
            type: 'Feature',
            properties: { _color: infraColorHex(r, i, rThr, INFRA_COLORS.dryRoad) },
            geometry: { type: 'LineString', coordinates: [[r.p[0], r.p[1]], [r.p[2], r.p[3]]] },
          })),
        },
      },
      {
        id: 'osm-buildings',
        label: 'Buildings (OSM)',
        kind: 'circle',
        color: INFRA_COLORS.dryBuilding,
        radius: 3,
        data: {
          type: 'FeatureCollection',
          features: d.buildings.map((b) => ({
            type: 'Feature',
            properties: { _color: infraColorHex(b, i, bThr, INFRA_COLORS.dryBuilding) },
            geometry: { type: 'Point', coordinates: [b.x, b.y] },
          })),
        },
      },
    ]
  }, [infra.data, mapFrame, mapShowMax])
  const probeDoc = useApi(
    ['probe', runId, probe?.lat, probe?.lon],
    () => api.probe(runId, probe!.lon, probe!.lat),
    { enabled: Boolean(runId && probe) },
  )
  const boxes = useApi(['boxes'], api.watchBoxes)

  const spec = scenario.data?.scenario.spec ?? run?.spec ?? null
  const effectiveDamId = spec?.dam_id ?? activeRiver?.damId ?? build.damId ?? null
  const damDetail = useApi(['dam', effectiveDamId], () => api.dam(effectiveDamId!), { enabled: Boolean(effectiveDamId) })
  const effectiveRiverId = activeRiver?.id ?? (damDetail.data?.river_id as string | undefined) ?? null
  const riverDetail = useApi(['river', effectiveRiverId], () => api.river(effectiveRiverId!), { enabled: Boolean(effectiveRiverId) })

  // Results is a publisher too: a deep link lands here with an empty mission,
  // so the river and the dam this screen is rendering go back into the context
  // that the 3D globe and every other map subscribe from. Selecting a river we
  // are already on is a no-op, and so is adopting the first dam.
  const selectRiver = useRiverContext((s) => s.select)
  const selectDam = useRiverContext((s) => s.selectDam)
  const publishRun = useRiverContext((s) => s.publishRun)
  const publishOutputs = useRiverContext((s) => s.publishOutputs)
  useEffect(() => {
    if (activeRiver || !riverDetail.data) return
    selectRiver({
      id: riverDetail.data.id,
      name: riverDetail.data.name,
      lengthKm: riverDetail.data.length_km ?? null,
      query: riverDetail.data.name,
    })
  }, [activeRiver, riverDetail.data, selectRiver])
  useEffect(() => {
    if (damDetail.data) selectDam(damRowToRiverPatch(damDetail.data))
    // Re-runs once the river above has been adopted, so a deep link still ends
    // up with a dam in the context even though this fires first.
  }, [damDetail.data, selectDam, activeRiver?.id])

  const engine = run?.engine ?? spec?.engine ?? build.engine ?? null
  const stateLabel = run?.state ?? null
  const completed = stateLabel ? DONE_STATES.includes(stateLabel.toUpperCase()) : false
  const widthValue = summary.data?.breach_width ?? spec?.breach?.width_m ?? build.width_m ?? null
  const depthValue = summary.data?.breach_depth ?? spec?.breach?.depth_m ?? build.depth_m ?? null
  const levelValue = summary.data?.reservoir_level ?? spec?.reservoir?.initial_level_m ?? build.level_m ?? null
  const simHours = summary.data?.sim_hours ?? spec?.horizon?.duration_hr ?? build.duration_hr ?? null

  const effectiveReachKm = displayReachKm(spec, activeRiver?.reachKm ?? build.reach_km)
  const activeDamObj = damDetail.data ?? (spec?.dam_id ? { id: spec.dam_id, name: run?.scenario_name || 'Dam' } : null)

  const reachInfo = useMemo(() => {
    return sliceDownstreamRiverPath(
      activeDamObj,
      riverDetail.data?.path,
      effectiveReachKm,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDamObj, riverDetail.data?.path, effectiveReachKm])

  // …and the run it is showing: run identity + outputs go back into the
  // mission context (same shape the Run tab publishes) so Compare, Player and
  // every other subscriber learn them from the store, never from this page.
  // Partial data never wipes a fuller snapshot — absent sections are omitted.
  useEffect(() => {
    if (!run) return
    publishRun({
      runId: run.id,
      scenarioId: run.scenario_id ?? null,
      scenarioName:
        scenario.data?.scenario.name ?? run.scenario_name ?? summary.data?.scenario_name ?? null,
      state: run.state ?? null,
      engine: run.engine ?? null,
      engineLabel: summary.data?.engine_label ?? run.engine ?? null,
      breachMethod: summary.data?.breach_method ?? spec?.breach?.method ?? null,
      simHours: summary.data?.sim_hours ?? spec?.horizon?.duration_hr ?? build.duration_hr ?? null,
      finishedAt: run.finished_at ?? null,
      reachKm: effectiveReachKm > 0 ? effectiveReachKm : null,
    })
  }, [run, scenario.data, summary.data, spec, build.duration_hr, effectiveReachKm, publishRun])
  useEffect(() => {
    if (!runId || (!resultDoc.data && !stationDoc.data)) return
    publishOutputs({
      runId,
      ...(resultDoc.data?.metrics
        ? {
            metrics: resultDoc.data.metrics,
            peakCms: resultDoc.data.metrics.peak_discharge_cms ?? null,
            releasedHm3: resultDoc.data.metrics.volume_hm3 ?? null,
          }
        : {}),
      ...(stationDoc.data ? { stationCount: stationDoc.data.length } : {}),
      updatedAt: new Date().toISOString(),
    })
  }, [runId, resultDoc.data, stationDoc.data, publishOutputs])

  // Seed this run's map scope: panes, panels and filmstrip all read it from
  // here. A new run resets cursor state; analyst prefs (field, flood switch)
  // survive via the store merge.
  useEffect(() => {
    useRiverContext.getState().publishMapIntent('results', {
      runId,
      frame: 0,
      showMax: true,
      probe: null,
    })
  }, [runId])

  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = []

    if (riverDetail.data?.path) {
      out.push({
        id: 'river-path',
        label: `River Path (${riverDetail.data.name || activeRiver?.name || 'river'})`,
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { name: riverDetail.data.name }, geometry: riverDetail.data.path }],
        },
        kind: 'line',
        color: '#4a9bd8',
        width: 3.5,
      })
    }

    if (reachInfo.coords.length >= 2) {
      out.push({
        id: 'build-downstream-reach',
        label: `Active Flood Path (${reachInfo.actualKm} km reach)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Active Downstream Flood Path' },
              geometry: { type: 'LineString', coordinates: reachInfo.coords },
            },
          ],
        },
        kind: 'line',
        color: '#00e5ff',
        width: 4.5,
      })
    }

    if (reachInfo.endCoord) {
      out.push({
        id: 'build-reach-terminus',
        label: `Reach End (${reachInfo.actualKm} km downstream)`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                title: `Reach Terminus (${reachInfo.actualKm} km)`,
                subtitle: 'Downstream calculation boundary',
              },
              geometry: { type: 'Point', coordinates: reachInfo.endCoord },
            },
          ],
        },
        kind: 'circle',
        color: '#00e5ff',
        radius: 8,
      })
    }

    if (damDetail.data && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      out.push({
        id: 'selected-dam',
        label: `Dam · ${damDetail.data.name}`,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { id: damDetail.data.id, name: damDetail.data.name },
              geometry: { type: 'Point', coordinates: [damDetail.data.lon, damDetail.data.lat] },
            },
          ],
        },
        kind: 'circle',
        color: '#b42318',
        radius: 9,
      })
    }

    if (boxes.data?.length) {
      out.push({
        id: 'watch-boxes',
        label: 'Watch Boxes',
        data: {
          type: 'FeatureCollection',
          features: boxes.data
            .filter((b) => b.bbox_geojson)
            .map((b) => ({ type: 'Feature', properties: { name: b.name }, geometry: b.bbox_geojson! })),
        },
        kind: 'line',
        color: '#d81b9b',
        width: 1.2,
        dasharray: [3, 2],
      })
    }

    if (probe) {
      out.push({
        id: 'probe',
        label: 'Inspected Location',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { title: 'Inspected Point', lat: probe.lat, lon: probe.lon },
              geometry: { type: 'Point', coordinates: [probe.lon, probe.lat] },
            },
          ],
        },
        kind: 'circle',
        color: '#ef4444',
        radius: 8,
      })
    }

    // infrastructure under the gauges/probe so those markers stay on top
    out.push(...infraFeatures)

    // real gauge markers (CH0 at the breach, CH5/CH10 downstream) + breach dot
    out.push(...gaugeFeatures(stationDoc.data, damDetail.data))

    return out
  }, [riverDetail.data, activeRiver?.name, reachInfo, damDetail.data, boxes.data, probe, stationDoc.data, infraFeatures])

  // The legend mirrors the features above — one row per drawn layer, no more.
  // The flood row marks the raster layer itself (toggled from the same
  // context the panes read).
  const legend: LegendItem[] = [
    { id: 'flood-raster', label: 'Flood affected area', color: '#3b82f6' },
    ...(riverDetail.data?.path
      ? [{ id: 'river-path', label: `River Path (${riverDetail.data.name || 'river'})`, color: '#4a9bd8' }]
      : []),
    { id: 'build-downstream-reach', label: `Active Flood Path (${reachInfo.actualKm} km)`, color: '#00e5ff' },
    ...(reachInfo.endCoord
      ? [{ id: 'build-reach-terminus', label: `Reach End (${reachInfo.actualKm} km downstream)`, color: '#00e5ff' }]
      : []),
    ...(damDetail.data ? [{ id: 'selected-dam', label: `Dam · ${damDetail.data.name}`, color: '#b42318' }] : []),
    ...(boxes.data?.length
      ? [{ id: 'watch-boxes', label: 'Watch Boxes', color: '#d81b9b', dashed: true }]
      : []),
    ...(infra.data
      ? [
          { id: 'osm-flooded', label: 'Road / building under water', color: INFRA_COLORS.wetHi },
          { id: 'osm-was', label: 'Flooded earlier (water passed)', color: INFRA_COLORS.was },
          { id: 'osm-roads', label: 'Roads (OSM, dry)', color: INFRA_COLORS.dryRoad },
          { id: 'osm-buildings', label: 'Buildings (OSM, dry)', color: INFRA_COLORS.dryBuilding },
        ]
      : []),
    ...gaugeLegend(stationDoc.data, damDetail.data),
    ...(probe ? [{ id: 'probe', label: 'Inspected Point', color: '#ef4444' }] : []),
  ]

  const mapFit = useMemo(() => {
    if (spec?.aoi?.coords && spec.aoi.coords.length === 4) return spec.aoi.coords
    if (reachInfo.bbox && reachInfo.bbox.length === 4) return reachInfo.bbox
    if (damDetail.data && typeof damDetail.data.lon === 'number' && typeof damDetail.data.lat === 'number') {
      return damFit(damDetail.data)
    }
    if (riverDetail.data?.bbox && riverDetail.data.bbox.length === 4) return riverDetail.data.bbox
    return null
  }, [spec?.aoi?.coords, reachInfo.bbox, damDetail.data, riverDetail.data?.bbox])

  return (
    <WorkspaceLayout
      layoutId="results"
      leftTitle="Result"
      rightTitle="Inspect"
      className="flex h-full flex-col gap-2 p-2 bg-[var(--bg-subtle)]"
      centerClassName="flex min-h-0 flex-col gap-2 overflow-y-auto"
      left={
        <>
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--line)] bg-white px-2 py-1.5 shadow-xs">
            {(
              [
                { value: 'scenario', label: 'Scenario' },
                { value: 'overlays', label: 'Overlays' },
                { value: 'export', label: 'Export' },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                onClick={() => setLeftTab(t.value)}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                  leftTab === t.value
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {leftTab === 'scenario' && (
            <ResultsScenarioPanel
              completed={completed}
              stateLabel={stateLabel}
              caseLabel={`Case ${build.case}`}
              damType={spec?.dam_type ?? build.damType ?? null}
              reachKm={reachInfo.actualKm}
              breachWidth={widthValue}
              breachDepth={depthValue}
              reservoirLevel={levelValue}
              simHours={simHours}
              engine={engine}
              engineLabel={summary.data?.engine_label ?? null}
              metrics={resultDoc.data?.metrics}
              series={seriesDoc.data}
            />
          )}

          {leftTab === 'overlays' && <ResultsOverlaysPanel scope="results" />}

          {leftTab === 'export' && (
            <ResultsExportsPanel
              runId={runId}
              label={`${engine ? engine.toUpperCase() : 'RUN'} · ${runId.slice(0, 8)}`}
            />
          )}
        </>
      }
      center={
        <>
          <ResultsMapPane
            scope="results"
            features={features}
            fit={mapFit}
            legend={legend}
            rampStops={frames.data?.ramp ?? null}
            maxDepth={resultDoc.data?.metrics?.max_depth_m ?? null}
            onPick={(lat, lon) =>
              useRiverContext.getState().publishMapIntent('results', { probe: { lat, lon } })
            }
          />

          <ResultsTimelinePanel
            scope="results"
            thumbs={frames.data?.frames ?? []}
            simHours={simHours}
            reachKm={reachInfo.actualKm}
          />

          <ResultsAnalyticsPanel
            series={seriesDoc.data}
            hydro={hydroDoc.data}
            hydroPending={hydroDoc.pending}
            runId={runId}
          />
        </>
      }
      right={
        <>
          <ResultsProbePanel scope="results" pending={probeDoc.pending} data={probeDoc.data} />

          <ResultsImpactPanel metrics={resultDoc.data?.metrics} impact={impact.data} />

          <ResultsCascadePanel runId={runId} />

          <Panel title="Downstream Gauges & Arrivals">
            <StationsPanel stations={stationDoc.data} />
          </Panel>
        </>
      }
    />
  )
}
