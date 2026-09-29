import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { EM_DASH, num } from '../lib/format'
import { useApi } from '../lib/useApi'
import { useRiverContext } from '../lib/river-context'
import { Icon, Pill } from './ui'

export type IntermediateTab = 'dem' | 'mesh' | 'breach' | 'water'

interface Props {
  activeTab: IntermediateTab
  onClose: () => void
  onSelectTab: (tab: IntermediateTab) => void
}

/**
 * 3D intermediate-output inspector.
 *
 * Reads everything from the mission context (river/run) plus the shared query
 * cache (same keys the Run tab already polls, so opening the modal costs no
 * extra network). Every badge, tag and status is an API value or the honest
 * EM_DASH — nothing is hardcoded here.
 */
export function IntermediateOutputs3DModal({ activeTab, onClose, onSelectTab }: Props) {
  const navigate = useNavigate()
  const river = useRiverContext((s) => s.river)
  const ctxRun = useRiverContext((s) => s.run)
  const runId = ctxRun?.runId ?? null

  const outputs = useApi(['run-outputs', runId], () => api.runOutputs(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const params = useApi(['run-params', runId], () => api.runParams(runId!), { enabled: Boolean(runId) })
  const metrics = useApi(['run-metrics', runId], () => api.runMetrics(runId!), {
    enabled: Boolean(runId),
    refetchInterval: 3000,
  })
  const summary = useApi(['run-summary', runId], () => api.summary(runId!), { enabled: Boolean(runId) })
  const resultDoc = useApi(['result', runId], () => api.result(runId!), { enabled: Boolean(runId) })

  const elevRange = outputs.data?.find((o) => o.key === 'dem')?.elevation ?? null
  const cellCount = metrics.data?.mesh_cells ?? null
  const peakCms = resultDoc.data?.metrics?.peak_discharge_cms ?? null
  const hMax = resultDoc.data?.metrics?.max_depth_m ?? null
  const inundArea = resultDoc.data?.metrics?.inundation_km2 ?? null
  const storageMcm = params.data?.storage_mcm ?? null
  const breachMethod = summary.data?.breach_method ?? null
  const breachW = summary.data?.breach_width ?? null
  const breachD = summary.data?.breach_depth ?? null
  const resolutionM = params.data?.target_resolution_m ?? null
  const dtS = params.data?.dt_s ?? null
  const meshMethod = params.data?.method ?? null

  const reachKm = ctxRun?.reachKm ?? river?.reachKm ?? null
  const damName = river?.damName ?? null
  const reachTxt = reachKm != null ? `${num(reachKm, 1)} km` : 'the study'
  const statusFor = (key: IntermediateTab) => outputs.data?.find((o) => o.key === key)?.status ?? null

  interface StageGuide {
    key: IntermediateTab
    title: string
    sub: string
    badge: string
    tag: string
    gradient: string
    icon: string
    /** One-line plain-language summary — also the thumbnail tooltip. */
    what: string
    /** How to read the image. */
    reads: string[]
    /** Labelled facts, API values or EM_DASH. */
    facts: { label: string; value: string }[]
    /** The one verification an analyst should do before trusting this output. */
    check: string
  }

  const stages: StageGuide[] = [
    {
      key: 'dem',
      title: 'Copernicus DEM-30m',
      sub: 'Elevation surface & dam profile',
      badge: 'DEM GLO-30',
      tag: elevRange ? `${num(elevRange[0], 0)}–${num(elevRange[1], 0)} m` : EM_DASH,
      gradient: 'from-[#0f172a] via-[#1e3a8a] to-[#0284c7]',
      icon: 'layers',
      what: `The ground everything else stands on: a clipped elevation surface for the ${reachTxt} reach below ${damName ?? 'the dam'}. Mesh, breach routing and flood depths all drape over this terrain, so an error here propagates into every later step.`,
      reads: [
        'The colour ramp runs low → high: valley floor and channel at one end, ridges at the other. Look for one continuous channel from the dam to the reach end.',
        'Hard rectangular edges or bright speckles are usually voids or tile seams in the source DEM, not real terrain.',
      ],
      facts: [
        { label: 'Elevation range', value: elevRange ? `${num(elevRange[0], 0)}–${num(elevRange[1], 0)} m` : EM_DASH },
        { label: 'Study reach', value: reachKm != null ? `${num(reachKm, 1)} km` : EM_DASH },
        { label: 'Source', value: 'DEM GLO-30' },
      ],
      check: 'Trace the river channel from the dam to the bottom of the frame — any break means the reach extraction clipped the wrong branch.',
    },
    {
      key: 'mesh',
      title: 'Hydrodynamic Mesh',
      sub: cellCount != null ? `${num(cellCount, 0)} cells · ${meshMethod ?? 'adaptive grid'}` : 'Mesh not built yet',
      badge: dtS != null ? `Δt ${num(dtS, 1)} s` : EM_DASH,
      tag: resolutionM != null ? `${num(resolutionM, 0)} m res` : EM_DASH,
      gradient: 'from-[#0f172a] via-[#042f2e] to-[#0d9488]',
      icon: 'grid',
      what: cellCount != null
        ? `The calculation grid: ${num(cellCount, 0)} cells at ${resolutionM != null ? `${num(resolutionM, 0)} m` : 'adaptive'} resolution. The solver computes water depth and velocity inside every cell, each ${dtS != null ? `${num(dtS, 1)} s` : 'time step'}.`
        : 'The calculation grid the solver will compute depth and velocity on. It is generated from the DEM before the breach run starts.',
      reads: [
        'Detail concentrates along the river channel and around structures — that is where depth changes fastest and needs the finest cells.',
        'If the mesh stops short of the reach end, villages in the tail have no results, however good the breach curve looks.',
      ],
      facts: [
        { label: 'Cells', value: cellCount != null ? num(cellCount, 0) : EM_DASH },
        { label: 'Resolution', value: resolutionM != null ? `${num(resolutionM, 0)} m` : EM_DASH },
        { label: 'Time step', value: dtS != null ? `${num(dtS, 1)} s` : EM_DASH },
        { label: 'Strategy', value: meshMethod ?? EM_DASH },
      ],
      check: 'Cell counts should barely move between reruns of the same case — a big jump means the domain or the resolution changed.',
    },
    {
      key: 'breach',
      title: 'Breach Hydrograph',
      sub: peakCms != null ? `Peak Q ${num(peakCms, 0)} m³/s` : 'Breach discharge not exported yet',
      badge: breachMethod ?? EM_DASH,
      tag: storageMcm != null ? `Vw = ${num(storageMcm, 1)} MCM` : EM_DASH,
      gradient: 'from-[#0f172a] via-[#311042] to-[#7c3aed]',
      icon: 'chart',
      what: `The dam-failure inflow: discharge rises to ${peakCms != null ? `a peak of ${num(peakCms, 0)} m³/s` : 'a peak'} then falls as the reservoir${storageMcm != null ? ` (${num(storageMcm, 1)} MCM)` : ''} drains through the breach${breachMethod ? ` (${breachMethod})` : ''}. This curve is the upstream boundary for everything downstream.`,
      reads: [
        'Time runs left → right, discharge bottom → top. The area under the curve equals the total released volume.',
        'A sharp narrow spike means a fast, violent breach; a broad flat top means a slow progressive failure.',
      ],
      facts: [
        { label: 'Method', value: breachMethod ?? EM_DASH },
        { label: 'Peak discharge', value: peakCms != null ? `${num(peakCms, 0)} m³/s` : EM_DASH },
        { label: 'Reservoir Vw', value: storageMcm != null ? `${num(storageMcm, 1)} MCM` : EM_DASH },
        {
          label: 'Breach W × D',
          value: breachW != null && breachD != null ? `${num(breachW, 1)} × ${num(breachD, 1)} m` : EM_DASH,
        },
      ],
      check: `Peak discharge should scale with breach size and stored volume — if it looks small next to ${storageMcm != null ? `${num(storageMcm, 1)} MCM of storage` : 'the stored volume'}, verify the breach dimensions in Build.`,
    },
    {
      key: 'water',
      title: 'Inundation Field',
      sub: 'Depth & velocity fields',
      badge: hMax != null ? `h_max ${num(hMax, 1)} m` : EM_DASH,
      tag: inundArea != null ? `${num(inundArea, 1)} km²` : EM_DASH,
      gradient: 'from-[#0f172a] via-[#082f49] to-[#0284c7]',
      icon: 'water',
      what: `Maximum water depth in every cell over the whole simulation — the union of all flooding, not a single moment. Darker blue means deeper water; the pale wash at the edges is shallow overbank spread across ${inundArea != null ? `${num(inundArea, 1)} km²` : 'the floodplain'}.`,
      reads: [
        'Compare the dark core against the channel: deep water far from any channel is usually embankment or tributary ponding, worth a second look.',
        `The footprint should reach toward the ${reachTxt} reach line — water stopping far short means the wave ran out of volume or simulated time.`,
      ],
      facts: [
        { label: 'Max depth', value: hMax != null ? `${num(hMax, 1)} m` : EM_DASH },
        { label: 'Wet area', value: inundArea != null ? `${num(inundArea, 1)} km²` : EM_DASH },
        { label: 'Reach', value: reachKm != null ? `${num(reachKm, 1)} km` : EM_DASH },
        { label: 'Status', value: outputs.data?.find((o) => o.key === 'water')?.status ?? EM_DASH },
      ],
      check: 'Before exporting, open 2D Results and confirm villages and road crossings sit inside the wet footprint where you expect them.',
    },
  ]

  const currentIndex = stages.findIndex((s) => s.key === activeTab)
  const currentStage = stages[currentIndex >= 0 ? currentIndex : 0]
  const currentOutput = outputs.data?.find((o) => o.key === activeTab)
  const currentThumb = currentOutput?.thumb
  const currentStatus = currentOutput?.status ?? null

  const handlePrev = () => {
    const prevIdx = (currentIndex - 1 + stages.length) % stages.length
    onSelectTab(stages[prevIdx].key)
  }

  const handleNext = () => {
    const nextIdx = (currentIndex + 1) % stages.length
    onSelectTab(stages[nextIdx].key)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-[90vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* ------------------------------------------------------------- MODAL HEADER */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-xs">
              <Icon name={currentStage.icon} size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-slate-900">{currentStage.title}</span>
                {currentStatus ? (
                  <Pill tone={currentStatus === 'ready' ? 'ok' : currentStatus === 'active' ? 'accent' : 'muted'}>
                    {currentStatus}
                  </Pill>
                ) : null}
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                  {currentStage.badge} · {currentStage.tag}
                </span>
              </div>
              <p className="text-[10.5px] text-slate-500">
                {river?.damName ?? EM_DASH} · {river?.name ?? EM_DASH} · {reachKm != null ? `${num(reachKm, 1)} km reach` : EM_DASH}
              </p>
            </div>
          </div>

          {/* Navigation Controls & Actions */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
              <button
                onClick={handlePrev}
                title="Previous Output"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-slate-50 transition-colors"
              >
                <Icon name="chevronLeft" size={14} />
              </button>
              <button
                onClick={handleNext}
                title="Next Output"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-slate-50 transition-colors"
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </div>

            {runId ? (
              <button
                onClick={() => {
                  onClose()
                  navigate(`/results/${runId}`)
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-medium text-slate-700 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all shadow-xs"
              >
                <Icon name="chart" size={13} />
                <span>2D Results</span>
              </button>
            ) : null}
            {runId ? (
              <button
                onClick={() => {
                  onClose()
                  navigate(`/player/${runId}`)
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 text-[11px] font-bold text-white shadow-sm hover:opacity-90 transition-all"
              >
                <Icon name="camera" size={13} />
                <span>Launch 3D Player</span>
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:border-slate-500 hover:text-black transition-colors"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* --------------------------------------- MAIN LARGE FULL VIEW ----------
            About rail on the left, the render big on the right. */}
        <div className="flex min-h-0 flex-1 items-stretch gap-4 overflow-hidden bg-slate-100 p-6">
          <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
                <Icon name="image" size={13} />
              </span>
              About this output
            </p>
            <section>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <Icon name="image" size={13} />
                What am I looking at?
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-700">{currentStage.what}</p>
            </section>
            <section>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <Icon name="search" size={13} />
                How to read it
              </p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {currentStage.reads.map((r) => (
                  <li key={r.slice(0, 24)} className="flex gap-1.5 text-[12px] leading-relaxed text-slate-700">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <Icon name="ruler" size={13} />
                Key numbers
              </p>
              <dl className="mt-1.5 overflow-hidden rounded-lg border border-slate-100">
                {currentStage.facts.map((f) => (
                  <div key={f.label} className="flex items-center justify-between gap-2 bg-slate-50/60 px-2.5 py-1.5 odd:bg-white">
                    <dt className="text-[11px] text-slate-500">{f.label}</dt>
                    <dd className="font-mono text-[11px] font-semibold text-slate-800">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                <Icon name="check" size={13} />
                Analyst check
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-emerald-900">{currentStage.check}</p>
            </section>
          </aside>

          <div className="relative flex h-full w-full min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {currentThumb ? (
              <img
                src={currentThumb}
                alt={currentStage.title}
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div
                className={`flex h-full w-full flex-col items-center justify-center bg-gradient-to-tr ${currentStage.gradient} p-8 text-white`}
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-white shadow-lg mb-4">
                  <Icon name={currentStage.icon} size={32} />
                </div>
                <h3 className="text-xl font-bold">{currentStage.title}</h3>
                <p className="mt-1 text-sm text-slate-200">{currentStage.sub}</p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="rounded-lg bg-black/50 px-3 py-1 font-mono text-xs font-semibold text-cyan-300">
                    {currentStage.badge}
                  </span>
                  <span className="rounded-lg bg-black/50 px-3 py-1 font-mono text-xs font-semibold text-white">
                    {currentStage.tag}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- BOTTOM THUMBNAIL SELECTOR STRIP */}
        <div className="flex h-20 shrink-0 items-center justify-center gap-3 border-t border-slate-200 bg-white px-5">
          {stages.map((s) => {
            const isActive = s.key === activeTab
            const outItem = outputs.data?.find((o) => o.key === s.key)
            const thumbImg = outItem?.thumb
            const tabStatus = statusFor(s.key)
            return (
              <button
                key={s.key}
                onClick={() => onSelectTab(s.key)}
                title={s.what}
                className={`flex h-14 w-56 items-center gap-3 rounded-xl border-2 p-1.5 text-left transition-all overflow-hidden ${
                  isActive
                    ? 'border-[var(--accent)] bg-blue-50/70 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div
                  className={`relative flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr ${s.gradient} text-white shadow-xs overflow-hidden`}
                >
                  {thumbImg ? (
                    <img src={thumbImg} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name={s.icon} size={15} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[11px] font-bold text-slate-900">{s.title}</span>
                    {tabStatus ? <span className="text-[8px] font-mono text-slate-400">{tabStatus}</span> : null}
                  </div>
                  <span className="block truncate text-[10px] text-slate-500 font-mono">{s.badge} · {s.tag}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
