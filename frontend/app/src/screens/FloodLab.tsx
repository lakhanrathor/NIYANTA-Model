import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { EM_DASH, clock, num } from '../lib/format'
import { Empty, Icon, Seg } from '../components/ui'
import { FloodLabScene, type LabLook, type LabStats } from './floodlab/FloodLabScene'

/**
 * Live Flood Lab — a game-style, real-time view of a dam break on the run's
 * real terrain. Water is simulated live on the GPU from the run's own breach
 * hydrograph, so it flows continuously; it is a LIVE PREVIEW, not the
 * validated result (that stays in Results / Player).
 */
export function FloodLab() {
  const { runId } = useParams<{ runId?: string }>()
  return runId ? <LabView key={runId} runId={runId} /> : <LabPicker />
}

function LabPicker() {
  const lab = useApi(['scenario-lab'], api.scenarioLab)
  const nav = useNavigate()
  const items = (lab.data?.scenarios ?? []).filter((s) => s.hazard !== 'other')
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-[20px] font-semibold">Live Flood Lab</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        Pick a modelled scenario. The lab rebuilds its valley in 3D and lets you break the dam and watch the water
        flow live.
      </p>
      {!items.length ? (
        <div className="mt-6">
          <Empty>{lab.pending ? 'Loading scenarios…' : 'No validated runs yet — run a scenario first.'}</Empty>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {items.map((s) => (
            <button
              key={s.scenario_id}
              onClick={() => nav(`/flood-lab/${s.latest.run_id}`)}
              className="rounded-lg border border-[var(--line)] bg-white p-3 text-left hover:border-[var(--accent)]"
            >
              <div className="truncate text-[13px] font-semibold">{s.name ?? s.scenario_id.slice(0, 8)}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                {s.hazard === 'glof' ? 'Glacial lake outburst' : 'Dam break'} ·{' '}
                {s.latest.peak_discharge_cms != null ? `${num(s.latest.peak_discharge_cms, 0)} m³/s peak` : EM_DASH}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SPEEDS = [
  { value: '30', label: '30×' },
  { value: '60', label: '1 min/s' },
  { value: '180', label: '3 min/s' },
  { value: '600', label: '10 min/s' },
]

function LabView({ runId }: { runId: string }) {
  const mount = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<FloodLabScene | null>(null)
  const [stats, setStats] = useState<LabStats | null>(null)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState('60')
  const [rain, setRain] = useState(0)
  const [look, setLook] = useState<LabLook>('stylised')
  const [trees, setTrees] = useState(true)
  const [follow, setFollow] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useApi(['run', runId], () => api.run(runId))
  const scenarioId = run.data?.run.scenario_id ?? null
  const scenario = useApi(['scenario', scenarioId], () => api.scenario(scenarioId!), { enabled: Boolean(scenarioId) })
  const spec = scenario.data?.scenario.spec ?? run.data?.run.spec ?? null
  const damId = (spec?.dam_id as string | undefined) ?? null
  const dam = useApi(['dam', damId], () => api.dam(damId!), { enabled: Boolean(damId) })
  const terrain = useApi(['terrain3d-full', runId], () => api.runTerrain(runId, 'full'))
  const hydro = useApi(['hydro', runId], () => api.breachHydrograph(runId))
  const summary = useApi(['run-summary', runId], () => api.summary(runId))
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId), { staleTime: 60_000 })

  useEffect(() => {
    if (!mount.current) return
    const s = new FloodLabScene(mount.current)
    s.onStats = setStats
    sceneRef.current = s
    return () => {
      sceneRef.current = null
      s.dispose()
    }
  }, [])

  // build once the essentials are in (infra/hydro are optional extras)
  const ready = Boolean(terrain.data && (dam.data || !damId) && !hydro.pending && !infra.pending && spec)
  useEffect(() => {
    const s = sceneRef.current
    if (!s || !ready || !terrain.data) return
    const res = (spec?.reservoir ?? {}) as { initial_level_m?: number; inflow_cms?: number; dam_height_m?: number }
    const breach = (spec?.breach ?? {}) as { width_m?: number }
    try {
      s.load({
        terrain: terrain.data,
        dam:
          dam.data?.lon != null && dam.data?.lat != null
            ? {
                name: dam.data.name ?? 'Dam',
                lon: dam.data.lon,
                lat: dam.data.lat,
                height_m: dam.data.height_m ?? res.dam_height_m ?? null,
                crest_length_m: dam.data.crest_length_m ?? null,
              }
            : null,
        hydro: hydro.data ?? null,
        inflowCms: res.inflow_cms ?? 0,
        levelM: res.initial_level_m && res.initial_level_m > 0 ? res.initial_level_m : null,
        breachWidthM: summary.data?.breach_width ?? breach.width_m ?? null,
        breachFormS: (summary.data?.breach_t_form_hr ?? 0) * 3600,
        infra: infra.data ?? null,
      })
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => sceneRef.current?.setRunning(running), [running])
  useEffect(() => sceneRef.current?.setSpeed(Number(speed)), [speed])
  useEffect(() => sceneRef.current?.setRain(rain), [rain])
  useEffect(() => sceneRef.current?.setLook(look), [look])
  useEffect(() => sceneRef.current?.setTrees(trees), [trees])
  useEffect(() => sceneRef.current?.setFollow(follow), [follow])

  const breached = stats?.sinceBreach != null
  const s = stats
  const btn =
    'flex h-8 items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-[12px] font-medium hover:border-[var(--accent)] disabled:opacity-40'

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] bg-slate-200">
        <div ref={mount} className="h-full w-full" />

        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
          <div className="rounded-md bg-slate-900/80 px-3 py-1.5 text-white shadow">
            <div className="text-[13px] font-semibold">{dam.data?.name ?? summary.data?.scenario_name ?? 'Flood Lab'}</div>
            <div className="text-[10.5px] text-amber-300">LIVE PREVIEW — simulated in your browser, not the validated result</div>
          </div>
          {s?.warming && (
            <div className="rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-medium shadow">Filling the river…</div>
          )}
        </div>

        {/* live readout */}
        <div className="pointer-events-none absolute right-3 top-3 w-[230px] rounded-lg bg-slate-900/80 p-3 text-[11px] text-slate-200 shadow">
          <Row k="Time since breach" v={s?.sinceBreach != null ? `T+${clock(s.sinceBreach)}` : 'not breached'} />
          <Row k="Water leaving the dam" v={s ? `${num(s.q, 0)} m³/s` : EM_DASH} hot={breached} />
          <Row k="Reservoir level" v={s?.lakeLevel != null ? `${num(s.lakeLevel, 1)} m` : EM_DASH} />
          <div className="my-1.5 border-t border-white/15" />
          <Row k="Flooded area" v={s ? `${num(s.areaKm2, 2)} km²` : EM_DASH} />
          <Row k="Flood front" v={s?.frontKm != null ? `${num(s.frontKm, 1)} km from dam` : EM_DASH} />
          <Row k="Deepest water" v={s ? `${num(s.maxDepth, 1)} m` : EM_DASH} />
          <Row k="Fastest water" v={s ? `${num(s.maxSpeed, 1)} m/s` : EM_DASH} />
          <div className="my-1.5 border-t border-white/15" />
          <Row k="Buildings under water" v={s ? `${num(s.buildingsWet, 0)} (ever ${num(s.buildingsEver, 0)})` : EM_DASH} hot={Boolean(s?.buildingsWet)} />
          <Row k="Roads cut" v={s ? `${num(s.roadKmCut, 1)} km` : EM_DASH} hot={Boolean(s?.roadKmCut)} />
          <Row k="Bridges under water" v={s ? num(s.bridgesWet, 0) : EM_DASH} hot={Boolean(s?.bridgesWet)} />
          <div className="mt-1.5 text-[9.5px] text-slate-400">
            Speed {s?.rate ? `${num(s.rate / 60, 1)} sim-min per second` : EM_DASH} · water in valley{' '}
            {s ? `${num(s.volumeM3 / 1e6, 2)} of ${num(s.injectedM3 / 1e6, 2)} million m³ released (rest left the map)` : EM_DASH}
          </div>
        </div>

        {err && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-6">
            <Empty>Flood Lab could not start on this GPU: {err}</Empty>
          </div>
        )}
        {!ready && !err && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <Empty>{terrain.offline ? 'This run has no terrain — it cannot be shown in the lab.' : 'Building the valley…'}</Empty>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2">
        <button
          onClick={() => sceneRef.current?.breach()}
          disabled={!ready || breached || s?.warming}
          className="flex h-8 items-center gap-1.5 rounded-md bg-[#b42318] px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
        >
          💥 Break the dam
        </button>
        <button onClick={() => setRunning((r) => !r)} disabled={!ready} className={btn}>
          <Icon name={running ? 'pause' : 'play'} size={12} />
          {running ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => {
            sceneRef.current?.resetSim()
            setRunning(false)
          }}
          disabled={!ready}
          className={btn}
        >
          <Icon name="skipBack" size={12} /> Reset
        </button>
        <span className="ml-2 text-[11px] text-[var(--muted)]">Speed</span>
        <Seg size="sm" options={SPEEDS} value={speed} onChange={setSpeed} />
        <span className="ml-2 text-[11px] text-[var(--muted)]">Rain</span>
        <Seg
          size="sm"
          options={[
            { value: '0', label: 'off' },
            { value: '20', label: '20 mm/h' },
            { value: '80', label: '80 mm/h' },
          ]}
          value={String(rain)}
          onChange={(v) => setRain(Number(v))}
        />
        <span className="ml-2 text-[11px] text-[var(--muted)]">Look</span>
        <Seg
          size="sm"
          options={[
            { value: 'stylised', label: 'Game' },
            { value: 'satellite', label: 'Satellite' },
          ]}
          value={look}
          onChange={(v) => setLook(v as LabLook)}
        />
        <label className="ml-1 flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={trees} onChange={(e) => setTrees(e.target.checked)} /> Trees
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the flood
        </label>
        <div className="ml-auto flex items-center gap-1">
          {(['overview', 'dam', 'downstream', 'top'] as const).map((v) => (
            <button key={v} onClick={() => sceneRef.current?.view(v)} className={`${btn} h-7 px-2 text-[11px] capitalize`}>
              {v}
            </button>
          ))}
          <Link to={`/player/${runId}`} className="ml-2 text-[11px] font-semibold text-[var(--accent)]">
            Validated result →
          </Link>
        </div>
      </div>
      <p className="shrink-0 px-1 text-[10px] text-[var(--faint)]">
        Live shallow-water model on the GPU, driven by this run&apos;s breach hydrograph and river inflow over its
        real terrain. Trees and terrain colours in “Game” look are illustrative scenery. Figures here are a preview
        — use Results for the record.
      </p>
    </div>
  )
}

function Row({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono ${hot ? 'text-amber-300' : 'text-white'}`}>{v}</span>
    </div>
  )
}
