import { useEffect, useState } from 'react'
import { Field, Head, Panel, Pill, Seg, Slider } from '../../components/ui'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useRiverContext } from '../../lib/river-context'
import { CASE_META, ENGINES, effectiveReachKm, sliceDownstreamRiverPath, useBuildConfig } from './config'
import type { DamType, Erodibility, Engine, FailureCase, ImpactSource } from './config'
import { BreachSection } from './BreachSection'
import { BuildLayers } from './BuildLayers'

const STEPS = [
  { id: 'area', title: 'Area & Data', blurb: 'DEM, imagery, river, dams' },
  { id: 'dam', title: 'Dam & Reservoir', blurb: 'select dam and configure' },
  { id: 'breach', title: 'Breach Parameters', blurb: 'define breach scenario' },
  { id: 'infra', title: 'Infrastructure & Population', blurb: 'OSM, WorldPop, key assets' },
  { id: 'review', title: 'Review & Prepare', blurb: 'check data and start pipeline' },
] as const

/** Left column of Build: a 5-step stepper over the same draft panels.
 *  Reads only the mission context — no props, no sibling components. */
export function BuildConfig() {
  const riverId = useRiverContext((st) => st.river?.id ?? null)
  const damId = useRiverContext((st) => st.river?.damId ?? null)
  // Same query keys Discover uses — one cache entry, no second request.
  const damDetail = useApi(['dam', damId], () => api.dam(damId!), {
    enabled: Boolean(damId),
    staleTime: 60_000,
  })
  const riverDetail = useApi(['river', riverId], () => api.river(riverId!), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
  })
  const dam = damDetail.data ?? null
  const riverPath = riverDetail.data?.path ?? null

  const s = useBuildConfig()
  const seedDam = useBuildConfig((st) => st.seedDam)
  const patchRiver = useRiverContext((st) => st.patch)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (dam) seedDam(dam)
  }, [dam, seedDam])

  const levelLo = Math.min(s.bed_m, s.crest_m, s.level_m)
  const levelHi = Math.max(s.crest_m, s.bed_m, s.level_m, levelLo + 1)
  const head = s.crest_m - s.level_m
  const caseMeta = CASE_META[s.case]

  const setReachKm = (v: number) => {
    s.patch({ reach_km: v })
    patchRiver({ reachKm: v })
  }

  // Live downstream river reach calculation based on actual river geometry
  const reachInfo = sliceDownstreamRiverPath(dam, riverPath, effectiveReachKm(s.reach_km))
  const maxReachSlider = Math.max(150, Math.min(600, Math.ceil(reachInfo.totalDownstreamKm)))

  const ready = [
    Boolean(riverId) && effectiveReachKm(s.reach_km) > 0,
    Boolean(damId) && s.level_m > 0 && s.crest_m > 0,
    s.width_m > 0 && s.depth_m > 0,
    s.impactSeeded,
    s.duration_hr > 0 && s.engine.length > 0,
  ]
  const readyCount = ready.filter(Boolean).length

  return (
    <>
      {/* ------------------------------------------------- stepper header */}
      <Panel
        title="Build Scenario"
        actions={<Pill tone={readyCount === 5 ? 'ok' : 'accent'}>{readyCount}/5 ready</Pill>}
      >
        <p className="px-3 pt-2 text-[10px] leading-snug text-[var(--muted)]">
          Configure inputs, select dam, set breach parameters and prepare data for simulation.
        </p>
        <ol className="p-2">
          {STEPS.map((st, i) => {
            const active = step === i
            const done = ready[i]
            return (
              <li key={st.id}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={`flex w-full items-center gap-2.5 rounded px-2 py-[7px] text-left transition-colors ${
                    active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg)]'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? 'bg-[var(--ok)] text-white'
                        : active
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--line-strong)] text-[var(--muted)]'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] font-semibold ${active ? 'text-[var(--accent)]' : ''}`}>
                      {st.title}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--faint)]">{st.blurb}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="px-3 pb-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--bg)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all"
              style={{ width: `${(readyCount / 5) * 100}%` }}
            />
          </div>
        </div>
      </Panel>

      {/* ------------------------------------------------- failure case */}
      <Panel title="Failure case">
        <div className="flex gap-1.5 p-2.5">
          {(['1', '2', '3'] as FailureCase[]).map((c) => {
            const meta = CASE_META[c]
            const active = s.case === c
            return (
              <button
                key={c}
                onClick={() => s.patch({ case: c })}
                className={`min-w-0 flex-1 rounded border px-2 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--line-strong)] bg-white hover:border-[var(--accent)]'
                }`}
              >
                <span className={`block text-[11px] font-bold ${active ? 'text-[var(--accent)]' : ''}`}>
                  Case {c}
                </span>
                <span className="block truncate text-[10px] text-[var(--muted)]">{meta.title}</span>
              </button>
            )
          })}
        </div>
        <p className="px-3 pb-2.5 text-[10px] leading-snug text-[var(--muted)]">
          {caseMeta.blurb}
          <span className="num mt-0.5 block text-[var(--faint)]">
            breach.mode={caseMeta.mode}
            {s.case === '3' ? ' · T+0' : ''}
          </span>
        </p>
      </Panel>

      {/* --------------------------------------------- step 1 · area & data */}
      {step === 0 && (
        <>
          <Panel title="Study domain">
            <Head right={`${reachInfo.actualKm} km active`}>Downstream River Reach (Simulation Domain)</Head>
            <Slider
              label="Study Reach Extent"
              value={Math.min(effectiveReachKm(s.reach_km), maxReachSlider)}
              min={5}
              max={maxReachSlider}
              step={5}
              onChange={(v) => setReachKm(v)}
              display={`${effectiveReachKm(s.reach_km)} km${s.reach_km > 0 ? '' : ' (minimum)'}`}
            />
            <div className="flex flex-wrap items-center justify-between gap-1 px-3 pb-1 text-[10px] text-[var(--muted)]">
              <span>Quick Reach Presets:</span>
              <div className="flex flex-wrap gap-1">
                {[15, 35, 75, 150].map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => setReachKm(km)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      s.reach_km === km ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-subtle)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'
                    }`}
                  >
                    {km} km
                  </button>
                ))}
                {reachInfo.totalDownstreamKm > 0 && (
                  <button
                    type="button"
                    onClick={() => setReachKm(Math.ceil(reachInfo.totalDownstreamKm))}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      s.reach_km >= Math.floor(reachInfo.totalDownstreamKm) ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-subtle)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'
                    }`}
                    title="Select complete downstream path down to river terminus / mouth"
                  >
                    Full River ({Math.round(reachInfo.totalDownstreamKm)} km)
                  </button>
                )}
              </div>
            </div>
            <div className="mx-3 my-1.5 rounded border border-[var(--line)] bg-[var(--bg-subtle)] p-2 text-[10px] leading-relaxed">
              <div className="flex justify-between font-medium">
                <span>Downstream Path Traced:</span>
                <span className="num text-[var(--accent)]">
                  {reachInfo.coords.length >= 2
                    ? `${reachInfo.actualKm} km / ${reachInfo.totalDownstreamKm} km`
                    : `${reachInfo.actualKm} km (AOI box — no river geometry)`}
                </span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>River Vertices in Reach:</span>
                <span className="num">{reachInfo.coords.length} polyline segments</span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>Domain DEM Grid:</span>
                <span className="num">~{reachInfo.tileCountEstimate} tiles</span>
              </div>
              <p className="mt-1 text-[9px] leading-snug text-[var(--faint)]">
                {reachInfo.coords.length >= 2
                  ? 'Extending reach routes the flood through downstream towns to the river bottom. The domain polygon, the DEM clip and the tile estimate all follow this channel at the corridor width.'
                  : 'This dam has no river geometry loaded, so the domain is a plain AOI square around it and no downstream path can be traced. Load a river corridor in Discover to trace the real channel.'}
              </p>
            </div>
          </Panel>
          <BuildLayers />
        </>
      )}

      {/* -------------------------------------------- step 2 · dam & water */}
      {step === 1 && (
        <Panel title="Dam & reservoir">
          <Head right={dam?.crest_m != null ? `record · ${dam.name}` : 'no dam record'}>Water levels</Head>
          {s.crest_m > s.bed_m ? (
            <Slider
              label="Initial water level"
              value={Math.min(Math.max(s.level_m, levelLo), levelHi)}
              min={levelLo}
              max={levelHi}
              step={0.5}
              onChange={(v) => s.patch({ level_m: v })}
              display={`${s.level_m.toFixed(1)} m`}
            />
          ) : (
            <Field
              label="Initial water level"
              value={String(s.level_m)}
              suffix="m"
              step={0.5}
              onChange={(v) => s.patch({ level_m: Number(v) || 0 })}
            />
          )}
          <div className="px-3 pb-1 text-[10px] text-[var(--muted)]">
            {head > 0 ? (
              <>
                <span className="num">{head.toFixed(1)} m</span> below crest — the reservoir fills
                before {caseMeta.mode === 'overtopping' ? 'overtopping' : 'the breach'} can run
              </>
            ) : head === 0 ? (
              <span className="text-[var(--warn)]">level is at crest — overtopping starts now</span>
            ) : (
              <span className="text-[var(--bad)]">level is above crest — fix the numbers</span>
            )}
          </div>
          <Field label="Crest level" value={String(s.crest_m)} suffix="m" step={0.5} onChange={(v) => s.patch({ crest_m: Number(v) || 0 })} />
          <Field label="Bed level" value={String(s.bed_m)} suffix="m" step={0.5} onChange={(v) => s.patch({ bed_m: Number(v) || 0 })} />
          <Field label="Dam height" value={String(s.height_m)} suffix="m" step={0.5} onChange={(v) => s.patch({ height_m: Number(v) || 0 })} />
          <Field label="Crest length" value={String(s.crest_length_m)} suffix="m" step={10} onChange={(v) => s.patch({ crest_length_m: Number(v) || 0 })} />
          <Slider
            label="Dam axis orientation"
            value={s.axis_heading_deg ?? s.heading_deg}
            min={0}
            max={360}
            step={5}
            onChange={(v) => s.patch({ axis_heading_deg: v, heading_deg: v })}
            display={`${(s.axis_heading_deg ?? s.heading_deg).toFixed(0)}°`}
          />
          <div className="flex items-center justify-between px-3 pb-1 text-[10px] text-[var(--muted)]">
            <span>Linear wall direction</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => s.patch({ axis_heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 45) % 360, heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 45) % 360 })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                +45°
              </button>
              <button
                type="button"
                onClick={() => s.patch({ axis_heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 90) % 360, heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 90) % 360 })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                +90°
              </button>
              <button
                type="button"
                onClick={() => s.patch({ axis_heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 180) % 360, heading_deg: ((s.axis_heading_deg ?? s.heading_deg) + 180) % 360 })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                Flip 180°
              </button>
            </div>
          </div>

          <Slider
            label="3D Dam model rotation"
            value={s.dam_heading_deg ?? s.heading_deg}
            min={0}
            max={360}
            step={5}
            onChange={(v) => s.patch({ dam_heading_deg: v })}
            display={`${(s.dam_heading_deg ?? s.heading_deg).toFixed(0)}°`}
          />
          <div className="flex items-center justify-between px-3 pb-2 text-[10px] text-[var(--muted)]">
            <span>Spillway face orientation</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => s.patch({ dam_heading_deg: s.axis_heading_deg ?? s.heading_deg })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                title="Align 3D model with axis wall angle"
              >
                Match Axis
              </button>
              <button
                type="button"
                onClick={() => s.patch({ dam_heading_deg: ((s.dam_heading_deg ?? s.heading_deg) + 90) % 360 })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                +90°
              </button>
              <button
                type="button"
                onClick={() => s.patch({ dam_heading_deg: ((s.dam_heading_deg ?? s.heading_deg) + 180) % 360 })}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                Flip 180°
              </button>
            </div>
          </div>

          <Head>Storage & footprint</Head>
          <Field label="Storage" value={String(s.storage_mcm)} suffix="MCM" step={1} onChange={(v) => s.patch({ storage_mcm: Number(v) || 0 })} />
          <Field label="Reservoir area" value={String(s.area_km2)} suffix="km²" step={0.1} onChange={(v) => s.patch({ area_km2: Number(v) || 0 })} />
          <div className="px-3 pb-2 text-[10px] text-[var(--muted)]">
            Area draws the reservoir footprint on the map and drives the fill-time estimate.
          </div>

          <Head>Structure</Head>
          <div className="flex items-center justify-between gap-2 px-3 py-[5px] text-[11px]">
            <span className="text-[var(--muted)]">Dam type</span>
            <Seg
              size="sm"
              value={s.damType}
              onChange={(v) => s.patch({ damType: v as DamType })}
              options={[
                { value: 'homogeneous', label: 'Homogeneous' },
                { value: 'corewall', label: 'Core wall' },
                { value: 'concrete_faced', label: 'CFRD' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-[5px] text-[11px]">
            <span className="text-[var(--muted)]">Erodibility</span>
            <Seg
              size="sm"
              value={s.erodibility}
              onChange={(v) => s.patch({ erodibility: v as Erodibility })}
              options={[
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </div>
          <Head>Inflow</Head>
          <Field label="Inflow" value={String(s.inflow_cms)} suffix="m³/s" step={10} onChange={(v) => s.patch({ inflow_cms: Number(v) || 0 })} />
          <div className="px-3 pb-2 text-[10px] text-[var(--muted)]">{caseMeta.hydro}</div>
        </Panel>
      )}

      {/* ------------------------------------------------- step 3 · breach */}
      {step === 2 && <BreachSection />}

      {/* -------------------------------------------- step 4 · population */}
      {step === 3 && (
        <Panel title="Impact (population)">
          <div className="flex items-center justify-between gap-2 px-3 py-[6px] text-[11px]">
            <span className="text-[var(--muted)]">Source</span>
            <Seg
              size="sm"
              value={s.impactSource}
              onChange={(v) => s.setImpactSource(v as ImpactSource)}
              options={[
                { value: 'worldpop', label: 'WorldPop grid' },
                { value: 'manual', label: 'Manual' },
              ]}
            />
          </div>
          {!s.impactSeeded && (
            <p className="px-3 pb-1 text-[10px] text-[var(--faint)]">
              auto: checking which population data this corridor has…
            </p>
          )}
          {s.impactSource === 'manual' ? (
            <>
              <Field
                label="Population exposed"
                value={s.population == null ? '' : String(s.population)}
                placeholder="—"
                onChange={(v) => s.patch({ population: v === '' ? null : Number(v) || 0 })}
              />
              <Field
                label="Buildings affected"
                value={s.houses == null ? '' : String(s.houses)}
                placeholder="—"
                onChange={(v) => s.patch({ houses: v === '' ? null : Number(v) || 0 })}
              />
              <Field
                label="Assets at risk"
                value={s.assets_million == null ? '' : String(s.assets_million)}
                placeholder="—"
                suffix="M"
                onChange={(v) => s.patch({ assets_million: v === '' ? null : Number(v) || 0 })}
              />
            </>
          ) : (
            <div className="px-3 py-2 text-[10px] text-[var(--muted)]">
              Zonal WorldPop calculated over the flooded extent automatically.
            </div>
          )}
        </Panel>
      )}

      {/* ------------------------------------------------- step 5 · review */}
      {step === 4 && (
        <>
          <Panel title="Horizon">
            <Field label="Duration" value={String(s.duration_hr)} suffix="hr" step={1} onChange={(v) => s.patch({ duration_hr: Number(v) || 1 })} />
            <Field label="Timestep" value={String(s.dt_s)} suffix="s" step={0.5} onChange={(v) => s.patch({ dt_s: Number(v) || 0.1 })} />
          </Panel>
          <Panel title="Solver & Compute">
            <div className="flex items-center justify-between gap-2 px-3 py-[6px] text-[11px]">
              <span className="text-[var(--muted)]">Engine</span>
              <Seg
                size="sm"
                value={s.engine}
                onChange={(v) => s.patch({ engine: v as Engine })}
                options={ENGINES.map((e) => ({ value: e, label: e }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-[6px] text-[11px]">
              <span className="text-[var(--muted)]">Device</span>
              <Seg
                size="sm"
                value={s.hardware ?? 'gpu'}
                onChange={(v) => s.patch({ hardware: v as 'gpu' | 'cpu' })}
                options={[
                  { value: 'gpu', label: 'GPU (CUDA)' },
                  { value: 'cpu', label: 'CPU (Threads)' },
                ]}
              />
            </div>
            <div className="px-3 pb-2 text-[10px] leading-relaxed text-[var(--muted)]">
              {s.hardware === 'gpu' ? (
                <span className="text-[var(--ok)]">⚡ GPU (NVIDIA CUDA) active — automatically falls back to multi-core CPU if CUDA device is busy or unavailable.</span>
              ) : (
                <span>CPU multi-threaded solver selected.</span>
              )}
            </div>
          </Panel>
          <Panel title="Next">
            <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
              Run <span className="font-semibold text-[var(--accent)]">Validate spec</span> in the
              Provenance panel on the right — then start the simulation below it.
            </p>
          </Panel>
        </>
      )}
    </>
  )
}
