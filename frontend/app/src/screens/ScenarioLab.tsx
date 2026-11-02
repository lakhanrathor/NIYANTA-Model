import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ScenarioLabItem, ScenarioLabel } from '../lib/api'
import { useApi } from '../lib/useApi'
import { EM_DASH, cms, km2, m, people, relativeTime } from '../lib/format'
import { LABEL_META, ScenarioBadge } from '../components/ScenarioBadge'

/**
 * SCENARIO LAB (spec §6–8, §21.1, §29) — the front door to simulation.
 * Pick a hazard, then replay any validated run instantly (Demo Mode = the
 * stored run, no recompute) or build a new one in Discover → Build.
 * Every number is the run's own stored result; missing → —.
 */

type Hazard = 'dam_break' | 'glof'

const HAZARDS: {
  id: Hazard | 'river_flood'
  title: string
  chain: string[]
  blurb: string
}[] = [
  {
    id: 'dam_break',
    title: 'Dam break',
    chain: ['High inflow / weakness', 'Overtopping or breach', 'Flood wave', 'Downstream inundation'],
    blurb: 'A dam fails by piping, overtopping or attack — cases 1, 2 and 3 in Build.',
  },
  {
    id: 'glof',
    title: 'GLOF / natural lake breach',
    chain: ['Glacier or slope change', 'Natural blockage', 'Lake rises', 'Sudden release'],
    blurb: 'A glacial or landslide-dammed lake bursts — scenarios proposed from Watch detections.',
  },
  {
    id: 'river_flood',
    title: 'River flood',
    chain: ['Extreme rainfall', 'Rising flow', 'Bank overflow'],
    blurb: 'Not modelled yet: extreme-flow floods without a breach need a time-varying inflow hydrograph (roadmap G9).',
  },
]

const PAGE = 12

export function ScenarioLab() {
  const lab = useApi(['scenario-lab'], () => api.scenarioLab(), { staleTime: 30_000 })
  const qc = useQueryClient()
  const [hazard, setHazard] = useState<Hazard>('dam_break')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const list = useMemo(
    () => (lab.data?.scenarios ?? []).filter((s) => s.hazard === hazard),
    [lab.data, hazard],
  )
  const shown = showAll ? list : list.slice(0, PAGE)

  const relabel = async (s: ScenarioLabItem, value: string) => {
    setBusy(s.scenario_id)
    try {
      // "default" clears the analyst's choice → shows as HYPOTHETICAL again
      await api.setScenarioLabel(s.scenario_id, value === 'default' ? null : (value as ScenarioLabel))
      await qc.invalidateQueries({ queryKey: ['scenario-lab'] })
      await qc.invalidateQueries({ queryKey: ['run-summary'] })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-[20px] font-semibold tracking-tight">Scenario Lab</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-[var(--muted)]">
            Pick a hazard and replay a simulated scenario instantly in 2D or 3D — the stored result opens
            straight away, nothing is recomputed. To model a new dam or lake, create a custom scenario.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
            {(Object.keys(LABEL_META) as ScenarioLabel[]).map((l) => (
              <span key={l} className="flex items-center gap-1.5">
                <ScenarioBadge label={l} />
                {LABEL_META[l].meaning}
              </span>
            ))}
          </div>
        </header>

        {/* ---- hazard cards ---- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HAZARDS.map((h) => {
            const supported = h.id !== 'river_flood'
            const count = supported ? (lab.data?.counts[h.id as Hazard] ?? null) : null
            const active = supported && hazard === h.id
            return (
              <button
                key={h.id}
                type="button"
                disabled={!supported}
                onClick={() => {
                  setHazard(h.id as Hazard)
                  setShowAll(false)
                }}
                className={`flex flex-col rounded-lg border bg-white p-4 text-left transition ${
                  active
                    ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]'
                    : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                } ${supported ? '' : 'cursor-not-allowed opacity-60'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold">{h.title}</span>
                  <span className="font-mono text-[11px] text-[var(--muted)]">
                    {supported ? (count == null ? EM_DASH : `${count} scenarios`) : 'not modelled'}
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted)]">
                  {h.chain.map((step, i) => (
                    <span key={step} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden="true">→</span>}
                      <span className="rounded bg-[var(--bg)] px-1.5 py-0.5">{step}</span>
                    </span>
                  ))}
                </span>
                <span className="mt-2 text-[11.5px] leading-snug text-[var(--muted)]">{h.blurb}</span>
              </button>
            )
          })}
          <Link
            to="/discover"
            className="flex flex-col justify-center rounded-lg border border-dashed border-[var(--line-strong)] bg-white p-4 text-left hover:border-[var(--accent)]"
          >
            <span className="text-[14px] font-semibold text-[var(--accent)]">+ Create custom scenario</span>
            <span className="mt-2 text-[11.5px] leading-snug text-[var(--muted)]">
              Pick any river and dam in Discover, configure the breach in Build, then run the simulation.
            </span>
          </Link>
        </div>

        {/* ---- replayable scenarios ---- */}
        <section className="mt-6 rounded-lg border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">
              {HAZARDS.find((h) => h.id === hazard)?.title} · replayable scenarios
            </h2>
            <span className="text-[11px] text-[var(--muted)]">newest run first · numbers from each run's stored result</span>
          </div>

          {lab.pending ? (
            <p className="px-4 py-6 text-[12px] text-[var(--muted)]">Loading scenarios…</p>
          ) : lab.offline ? (
            <p className="px-4 py-6 text-[12px] text-[var(--bad)]">Scenario catalogue unavailable — GET /api/scenario-lab failed.</p>
          ) : list.length === 0 ? (
            <p className="px-4 py-6 text-[12px] text-[var(--muted)]">
              No validated runs of this type yet. Create one from Discover → Build.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--bg)] text-left text-[10px] uppercase tracking-[0.05em] text-[var(--muted)]">
                    <th className="px-4 py-2 font-semibold">Scenario</th>
                    <th className="px-2 py-2 font-semibold">Engine</th>
                    <th className="px-2 py-2 text-right font-semibold">Peak flow</th>
                    <th className="px-2 py-2 text-right font-semibold">Max depth</th>
                    <th className="px-2 py-2 text-right font-semibold">Flooded</th>
                    <th className="px-2 py-2 text-right font-semibold">People exposed</th>
                    <th className="px-2 py-2 font-semibold">Label</th>
                    <th className="px-4 py-2 text-right font-semibold">Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.scenario_id} className="border-b border-[var(--line)] last:border-b-0">
                      <td className="max-w-[300px] px-4 py-2">
                        <div className="flex items-center gap-2">
                          <ScenarioBadge label={s.label} set={s.label_set} />
                          <span className="truncate font-medium" title={s.name ?? undefined}>
                            {s.name ?? EM_DASH}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                          case {s.case ?? EM_DASH} · {s.mode ?? EM_DASH} · run {relativeTime(s.latest.created)}
                          {s.runs > 1 ? ` · ${s.runs} runs` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[var(--muted)]">{s.latest.engine_label ?? EM_DASH}</td>
                      <td className="px-2 py-2 text-right font-mono">{cms(s.latest.peak_discharge_cms)}</td>
                      <td className="px-2 py-2 text-right font-mono">{m(s.latest.max_depth_m, 1)}</td>
                      <td className="px-2 py-2 text-right font-mono">{km2(s.latest.inundation_km2)}</td>
                      <td className="px-2 py-2 text-right font-mono">{people(s.latest.population_exposed)}</td>
                      <td className="px-2 py-2">
                        <select
                          aria-label={`Label for ${s.name ?? 'scenario'}`}
                          disabled={busy === s.scenario_id}
                          value={s.label_set ? s.label : 'default'}
                          onChange={(e) => void relabel(s, e.target.value)}
                          className="h-6 rounded border border-[var(--line-strong)] bg-white px-1 text-[10.5px] outline-none focus:border-[var(--accent)]"
                        >
                          <option value="default">Hypothetical (default)</option>
                          <option value="reconstruction">Reconstruction</option>
                          <option value="observed">Observed</option>
                          <option value="demo">Demo</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1.5">
                          <Link
                            to={`/player/${s.latest.run_id}`}
                            className="rounded bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                          >
                            ▶ 3D
                          </Link>
                          <Link
                            to={`/results/${s.latest.run_id}`}
                            className="rounded border border-[var(--line-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)]"
                          >
                            2D
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.length > PAGE && (
            <div className="border-t border-[var(--line)] px-4 py-2 text-right">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] font-medium text-[var(--accent)] hover:underline"
              >
                {showAll ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
