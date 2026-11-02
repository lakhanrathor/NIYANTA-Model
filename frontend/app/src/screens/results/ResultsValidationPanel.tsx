import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type ObsMetric, type Observation } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, num } from '../../lib/format'
import { Metric, Panel, Pill, Prov } from '../../components/ui'

const METRIC_LABEL: Record<ObsMetric, string> = {
  arrival_min: 'Arrival (min)',
  depth_m: 'Max depth (m)',
  velocity_ms: 'Max velocity (m/s)',
}
const REFERENCE_LABEL: Record<string, string> = {
  observed_points: 'Recorded point observations',
  observed_extent: 'Observed flood extent (satellite mask)',
}
const input =
  'h-7 w-full rounded border border-[var(--line-strong)] bg-white px-2 text-[11px] outline-none focus:border-[var(--accent)]'

/**
 * Spec §30 validation view: the stored grade and its reference, modelled vs
 * observed per recorded point, and a form to record a field observation at
 * the pinned map point (a source is required — evidence rule). Saving
 * re-scores the run.
 */
export function ResultsValidationPanel({
  runId,
  scenarioId,
  observed,
  pin,
}: {
  runId: string
  scenarioId: string | null
  observed: Observation[]
  pin: { lon: number; lat: number } | null
}) {
  const qc = useQueryClient()
  const val = useApi(['validate', runId], () => api.validation(runId), { enabled: Boolean(runId) })
  const [form, setForm] = useState({ name: '', metric: 'velocity_ms' as ObsMetric, value: '', source: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const v = val.data?.validation
  const d = v?.detail ?? null
  const ref = v?.benchmark ?? (d?.reference ? (REFERENCE_LABEL[d.reference] ?? d.reference) : 'Internal consistency only')

  const save = async (next: Observation[]) => {
    if (!scenarioId) return
    setBusy(true)
    setErr(null)
    try {
      await api.setObserved(scenarioId, next)
      await api.rescoreValidation(runId)
      await qc.invalidateQueries({ queryKey: ['validate', runId] })
      await qc.invalidateQueries({ queryKey: ['scenario', scenarioId] })
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const value = Number(form.value)
  const canAdd =
    Boolean(pin && scenarioId && form.name.trim() && form.source.trim().length >= 3) &&
    form.value !== '' &&
    Number.isFinite(value) &&
    value >= 0
  const add = async () => {
    if (!pin || !canAdd) return
    const ob: Observation = {
      name: form.name.trim(),
      lon: Number(pin.lon.toFixed(6)),
      lat: Number(pin.lat.toFixed(6)),
      source: form.source.trim(),
      [form.metric]: value,
    }
    if (await save([...observed, ob])) setForm((f) => ({ ...f, name: '', value: '' }))
  }

  return (
    <Panel
      title="Validation"
      actions={v?.grade ? <Pill tone={v.grade === 'A' ? 'ok' : v.grade === 'B' ? 'warn' : 'bad'}>Grade {v.grade}</Pill> : null}
    >
      <Metric label="Reference" value={v ? ref : val.pending ? '…' : EM_DASH} />
      {v?.error_peak_pct != null && <Metric label="Peak discharge error" value={`${num(v.error_peak_pct, 1)} %`} />}
      {v?.extent_iou != null && <Metric label="Extent IoU" value={num(v.extent_iou, 2)} />}
      {d?.observation_median_err_pct != null && (
        <Metric label="Median point error" value={`${num(d.observation_median_err_pct, 1)} %`} />
      )}
      <Metric
        label="Mass balance error"
        value={d?.mass_balance_error_pct != null ? `${num(d.mass_balance_error_pct, 3)} %` : EM_DASH}
      />

      {d?.observations?.length ? (
        <div className="px-3 py-1.5">
          <table className="w-full text-[10.5px]">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th className="font-medium">Point</th>
                <th className="font-medium">Quantity</th>
                <th className="font-medium">Obs.</th>
                <th className="font-medium">Model</th>
                <th className="font-medium">Err.</th>
              </tr>
            </thead>
            <tbody className="num">
              {d.observations.map((o, i) => (
                <tr key={i} className="border-t border-[var(--line)]" title={`Source: ${o.source}`}>
                  <td className="max-w-[80px] truncate">{o.name}</td>
                  <td>{METRIC_LABEL[o.metric]}</td>
                  <td>{num(o.observed, 2)}</td>
                  <td>{o.modelled != null ? num(o.modelled, 2) : EM_DASH}</td>
                  <td>{o.err_pct != null ? `${num(o.err_pct, 0)}%` : EM_DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-1.5 text-[10.5px] text-[var(--muted)]">
          {d?.note ?? 'No validation score yet.'} Record field observations below to compare the model with
          reality.
        </p>
      )}

      {observed.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1.5">
          {observed.map((o, i) => (
            <button
              key={i}
              disabled={busy}
              title={`Remove · ${o.source}`}
              onClick={() => save(observed.filter((_, j) => j !== i))}
              className="rounded border border-[var(--line-strong)] px-1.5 text-[10px] text-[var(--muted)] hover:border-[#dc2626] hover:text-[#dc2626]"
            >
              {o.name} ×
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5 border-t border-[var(--line)] px-3 py-2">
        <div className="text-[10.5px] font-semibold text-[var(--muted)]">
          Record observation {pin ? `at ${pin.lat.toFixed(4)}°, ${pin.lon.toFixed(4)}°` : '— click the map to pin a point'}
        </div>
        <div className="flex gap-1.5">
          <input
            className={input}
            placeholder="Place name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className={input}
            value={form.metric}
            onChange={(e) => setForm({ ...form, metric: e.target.value as ObsMetric })}
          >
            {(Object.keys(METRIC_LABEL) as ObsMetric[]).map((k) => (
              <option key={k} value={k}>
                {METRIC_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            className={`${input} w-20`}
            type="number"
            min={0}
            step="any"
            placeholder="Value"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
        </div>
        <input
          className={input}
          placeholder="Source (paper, report, gauge record…) — required"
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
        />
        <button
          disabled={!canAdd || busy}
          onClick={add}
          className="h-7 w-full rounded bg-[var(--accent)] text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Saving & re-scoring…' : 'Add & re-score'}
        </button>
        {err && <p className="text-[10.5px] text-[#b42318]">{err}</p>}
      </div>
      <Prov>
        Modelled = this run sampled at the same point (max depth, max velocity, first-wet arrival) ·{' '}
        <span className="num">GET /validate/{runId.slice(0, 8)}</span>
      </Prov>
    </Panel>
  )
}
