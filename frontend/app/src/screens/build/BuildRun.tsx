import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, Metric, Panel, Pill } from '../../components/ui'
import { DamCard } from '../../components/dam/DamCard'
import type { DamRow, GeoJsonLineString } from '../../lib/api'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useRiverContext } from '../../lib/river-context'
import { DataAvailability } from '../discover/DataAvailability'
import { DataDownloads } from '../discover/DataDownloads'
import { BuildProvenance } from './BuildProvenance'
import { CASE_META, caseMode, effectiveReachKm, sliceDownstreamRiverPath, timeToFailure, toSpec, useBuildConfig } from './config'

/** Right column of Build: what was picked, what it means, then the run action.
 *  Reads only the mission context — no props, no sibling components. */
export function BuildRun() {
  const riverId = useRiverContext((st) => st.river?.id ?? null)
  const riverName = useRiverContext((st) => st.river?.name ?? null)
  const lengthKm = useRiverContext((st) => st.river?.lengthKm ?? null)
  const damId = useRiverContext((st) => st.river?.damId ?? null)
  const bufferOverride = useRiverContext((st) => st.river?.bufferKm ?? null)
  const ctx = useRiverContext((st) => st.river)

  // Same query keys Discover uses — one cache entry, no second request.
  const damDetail = useApi(['dam', damId], () => api.dam(damId!), {
    enabled: Boolean(damId),
    staleTime: 60_000,
  })
  const riverDetail = useApi(['river', riverId], () => api.river(riverId!), {
    enabled: Boolean(riverId),
    staleTime: 60_000,
  })

  // While the registry answers, the attributes Discover published into the
  // context stand in — real values from when the dam was picked, never guesses.
  const dam: DamRow | null =
    damId && ctx?.damName
      ? damDetail.data ?? {
          id: damId,
          name: ctx.damName,
          lat: ctx.damLat,
          lon: ctx.damLon,
          height_m: ctx.damHeight,
          crest_m: ctx.damCrest,
          fsl_m: ctx.damFsl,
          dam_type: ctx.damType,
          crest_length_m: ctx.damCrestLength,
          heading_deg: ctx.damHeadingDeg,
          capacity_mcm: ctx.damStorageMcm,
          status: 'in_db',
        }
      : (damDetail.data ?? null)
  const riverPath: GeoJsonLineString | null = riverDetail.data?.path ?? null
  // Corridor width scales with river size the same way Discover's slider defaults.
  const bufferKm =
    bufferOverride ?? (lengthKm ? Math.min(50, Math.max(5, Math.round(lengthKm * 0.01))) : 20)

  const s = useBuildConfig()
  const loadSpec = useBuildConfig((st) => st.loadSpec)
  const navigate = useNavigate()
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [configName, setConfigName] = useState('')
  const [note, setNote] = useState<string | null>(null)

  // One dam, many configurations: every saved scenario for this structure
  // (GET /scenarios?dam_id=…), so case 1/2/3 and engine variants sit side by side.
  const saved = useQuery({
    queryKey: ['scenarios', 'dam', dam?.id ?? null],
    queryFn: () => api.scenarios(undefined, dam!.id),
    enabled: Boolean(dam),
    staleTime: 10_000,
    retry: false,
  })

  const ttf = timeToFailure(s)
  const defaultName = `${riverName ?? 'river'} · ${dam?.name ?? 'dam'} · case ${s.case}`
  const reachInfo = sliceDownstreamRiverPath(dam, riverPath, effectiveReachKm(s.reach_km))

  const buildSpec = () =>
    toSpec(s, dam, configName.trim() || defaultName, riverPath, bufferKm)

  const start = async () => {
    if (!dam) return
    setState('saving')
    setErrors([])
    try {
      const scenario = await api.createScenario(buildSpec())
      const out = await api.executeScenario(scenario.id, s.engine)
      if (out.ok === false) {
        setErrors(out.errors ?? ['execute returned no errors — run not started'])
        setState('failed')
        return
      }
      navigate(`/run/${out.run.id}`)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'scenario failed to save'])
      setState('failed')
    }
  }

  const saveConfig = async () => {
    if (!dam) return
    setNote(null)
    setErrors([])
    try {
      const scenario = await api.createScenario(buildSpec())
      setNote(`saved “${scenario.name ?? defaultName}”`)
      setConfigName('')
      await saved.refetch()
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'save failed'])
    }
  }

  const runConfig = async (scenarioId: string) => {
    setNote(null)
    setErrors([])
    try {
      const out = await api.executeScenario(scenarioId, s.engine)
      if (out.ok === false) {
        setErrors(out.errors ?? ['execute returned no errors — run not started'])
        return
      }
      navigate(`/run/${out.run.id}`)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'run failed'])
    }
  }

  if (!dam)
    return (
      <Panel title="Selected dam">
        <Empty>
          No dam selected — pick one in Discover, then come back. The map keeps its position and
          the corridor when you switch.
        </Empty>
        <div className="border-t border-[var(--line)] p-3">
          <Link
            to="/discover"
            className="flex h-7 w-full items-center justify-center rounded border border-[var(--line-strong)] px-2 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Open Discover
          </Link>
        </div>
      </Panel>
    )

  return (
    <>
      {/* -------------------------------------------------- provenance */}
      <BuildProvenance />

      {/* ------------------------------------------------------- dam card */}
      <Panel title="Selected dam">
        <DamCard variant="inline" />
        <DamCard variant="metrics" />
      </Panel>

      {/* ---------------------------------------------------- run summary */}
      <Panel title="Run summary">
        <Metric label="Failure case" value={`Case ${s.case} · ${CASE_META[s.case].title}`} />
        <Metric label="Breach mode" value={caseMode(s.case)} />
        <Metric label="Method" value={s.method} />
        <Metric label="Breach geometry" value={`${s.width_m} × ${s.depth_m} m`} />
        <Metric label="Level → crest" value={(s.crest_m - s.level_m).toFixed(1)} unit="m" />
        <Metric label="Inflow" value={s.inflow_cms} unit="m³/s" />
        <Metric label="Study Reach" value={`${reachInfo.actualKm} km`} />
        <Metric label="Domain Grid" value={`~${reachInfo.tileCountEstimate} tiles`} />
        <Metric label="Horizon" value={`${s.duration_hr} hr @ ${s.dt_s}s`} />
        <Metric label="Engine" value={s.engine} />
        <Metric
          label="Est. time to failure"
          value={ttf.value}
          unit={ttf.unit}
          tone={ttf.value === '—' ? 'warn' : 'ok'}
        />
      </Panel>

      {/* ------------------------------------------- input data status */}
      <DataAvailability riverId={riverId} bufferKm={bufferKm} />

      {/* --------------------------------------------------- data (async) */}
      <DataDownloads riverId={riverId} />

      {/* ------------------------------------------------ saved configs */}
      <Panel
        title="Saved configurations"
        actions={
          <Pill tone={saved.data && saved.data.length > 0 ? 'ok' : undefined}>
            {saved.data ? `${saved.data.length}` : '—'}
          </Pill>
        }
      >
        {saved.data && saved.data.length > 0 ? (
          <ul>
            {saved.data.map((sc) => (
              <li
                key={sc.id}
                className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium">{sc.name || defaultName}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    {[
                      `case ${sc.case ?? s.case}`,
                      sc.spec?.engine ? `engine ${sc.spec.engine}` : `engine ${s.engine}`,
                      sc.created ? new Date(sc.created).toLocaleString() : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => {
                      if (!dam) return
                      loadSpec(sc.spec ?? {}, dam.id)
                      setNote(`loaded “${sc.name ?? defaultName}” into the draft`)
                    }}
                    className="h-6 rounded border border-[var(--line-strong)] px-2 text-[10px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => void runConfig(sc.id)}
                    className="h-6 rounded bg-[var(--accent)] px-2 text-[10px] font-medium text-white hover:opacity-90"
                  >
                    Run
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            No saved configuration for this dam yet — set up the case on the left, then save it
            below. Multiple configurations per dam (case 1/2/3, engine variants) live here.
          </Empty>
        )}
        <div className="border-t border-[var(--line)] p-3">
          <label className="mb-1 block text-[10px] text-[var(--muted)]">
            Configuration name (optional)
          </label>
          <input
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            placeholder={defaultName}
            className="h-7 w-full rounded border border-[var(--line-strong)] bg-transparent px-2 text-[11px] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => void saveConfig()}
            disabled={!dam || state === 'saving'}
            className="mt-2 h-7 w-full rounded border border-[var(--line-strong)] px-2 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            Save configuration
          </button>
          {note && <p className="mt-1.5 text-[10px] text-[var(--ok)]">{note}</p>}
          <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted)]">
            Saves without running — Load puts it back on the left, Run starts it with the solver engine picked.
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------- start */}
      <Panel title="Start simulation">
        <div className="p-3">
          <button
            onClick={() => void start()}
            disabled={state === 'saving'}
            className="h-8 w-full rounded bg-[var(--accent)] px-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {state === 'saving' ? 'Saving scenario…' : 'Start Simulation'}
          </button>
          {errors.map((e) => (
            <p key={e} className="mt-1.5 break-words text-[10px] text-[var(--bad)]">
              {e}
            </p>
          ))}
          <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
            Saves the scenario, initializes the {reachInfo.actualKm} km downstream DEM domain, and starts the simulation pipeline.
          </p>
        </div>
      </Panel>
    </>
  )
}
