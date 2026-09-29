import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useRiverContext } from '../../lib/river-context'
import { damRowToRiverPatch } from '../../lib/mission'
import { EM_DASH } from '../../lib/format'
import { watchApi } from './watchApi'

/** THE BRIDGE between Track B (watch) and Track A (river context).
 *
 *  change → `from-event` (case-2 lake breach) or risk → `from-risk` (case-1).
 *  The builder persists a scenario and NEVER auto-executes (decision D4).
 *  Then: dam-linked scenarios hand river+dam+scenario into the river context
 *  and continue in Build (the gate passes, hydration loads the spec);
 *  dam-less ones execute on explicit tap and open the Run.
 */
export function TriggerButton({
  changeId,
  riskId,
}: {
  changeId: string | null
  riskId: string | null
}) {
  const navigate = useNavigate()
  const selectRiver = useRiverContext((s) => s.select)
  const selectDam = useRiverContext((s) => s.selectDam)
  const publishRun = useRiverContext((s) => s.publishRun)

  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle')
  const busy = state === 'working'
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [scenarioName, setScenarioName] = useState<string | null>(null)
  const [damId, setDamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A fresh selection resets the trigger — a scenario belongs to its change.
  const key = `${changeId ?? ''}|${riskId ?? ''}`
  const [armedFor, setArmedFor] = useState(key)
  if (armedFor !== key) {
    setArmedFor(key)
    setState('idle')
    setScenarioId(null)
    setScenarioName(null)
    setDamId(null)
    setError(null)
  }

  const source = changeId ? { kind: 'change' as const, id: changeId } : riskId ? { kind: 'risk' as const, id: riskId } : null

  const generate = async () => {
    if (!source) return
    setState('working')
    setError(null)
    try {
      const out =
        source.kind === 'change'
          ? await watchApi.fromEvent(source.id)
          : await watchApi.fromRisk(source.id)
      setScenarioId(out.scenario.id)
      setScenarioName(out.scenario.name ?? null)
      setDamId(out.scenario.spec?.dam_id ?? null)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'scenario generation failed')
      setState('idle')
    }
  }

  const openInBuild = async () => {
    if (!scenarioId || !damId) return
    setState('working')
    setError(null)
    try {
      const dam = await api.dam(damId)
      if (dam.river_id) {
        const river = await api.river(dam.river_id)
        selectRiver({
          id: river.id,
          name: river.name,
          lengthKm: river.length_km ?? null,
          query: river.name,
        })
      }
      selectDam(damRowToRiverPatch(dam))
      publishRun({ scenarioId, runId: null, scenarioName: scenarioName ?? null })
      navigate('/build')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'handoff failed')
      setState('ready')
    }
  }

  const executeAndOpenRun = async () => {
    if (!scenarioId) return
    setState('working')
    setError(null)
    try {
      const out = await api.executeScenario(scenarioId)
      if (out.ok === false) {
        setError((out.errors ?? ['execute returned no errors — run not started']).join('; '))
        setState('ready')
        return
      }
      navigate(`/run/${out.run.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'execute failed')
      setState('ready')
    }
  }

  if (!source) {
    return (
      <p className="text-[11px] text-[var(--faint)]">
        Select a flagged change to arm the trigger{EM_DASH}
      </p>
    )
  }

  return (
    <div>
      {state === 'ready' && scenarioId ? (
        <>
          <div className="rounded-lg border border-[var(--ok)] bg-emerald-50/60 px-2.5 py-2">
            <p className="text-[11px] font-semibold text-[var(--ok)]">Scenario ready — not executed</p>
            <p className="num mt-0.5 truncate text-[10px] text-[var(--muted)]">
              {scenarioName ?? scenarioId}
            </p>
          </div>
          {damId ? (
            <button
              type="button"
              onClick={() => void openInBuild()}
              disabled={busy}
              className="mt-2 h-8 w-full rounded-lg bg-[var(--accent)] text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Handing off…' : 'Continue in Build →'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void executeAndOpenRun()}
              disabled={busy}
              className="mt-2 h-8 w-full rounded-lg bg-[var(--accent)] text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Execute & open Run →'}
            </button>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-[var(--faint)]">
            {damId
              ? 'Dam-linked: river, dam and scenario move into the mission context.'
              : 'No dam linked: the scenario executes directly into a run.'}
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="h-8 w-full rounded-lg border-2 border-dashed border-[var(--accent)] text-[12px] font-semibold text-[var(--accent)] transition-all hover:bg-[var(--accent-soft)] active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Generating…' : `⚡ Generate scenario from ${source.kind}`}
        </button>
      )}
      {error && <p className="mt-1.5 break-words text-[10px] text-[var(--bad)]">{error}</p>}
    </div>
  )
}
