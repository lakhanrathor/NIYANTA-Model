import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, Panel, Prov } from '../../components/ui'
import { REQUIRED_STAGING_KINDS, STAGING_KINDS, api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { PrepareStages } from './PrepareStages'

type StepState = 'done' | 'active' | 'pending'

interface StepRow {
  title: string
  state: StepState
  note: string
}

interface NextAction {
  label: string
  disabled: boolean
  onClick?: () => void
  to?: string
  /** Shown as a warning under the button — never a reason to disable it. */
  advisory: string | null
}

const STATUS_TEXT: Record<string, string> = {
  queued: 'Queued',
  running: 'Fetching',
  paused: 'Paused',
  done: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const TONE: Record<StepState, string> = {
  done: 'border-[var(--ok)] text-[var(--ok)]',
  active: 'border-[var(--accent)] bg-[var(--accent)] text-white',
  pending: 'border-[var(--line-strong)] text-[var(--faint)]',
}

const isLive = (status?: string | null) => status === 'queued' || status === 'running'

interface Props {
  riverId: string | null
  riverName: string | null
  damId: string | null
  damName: string | null
  bufferKm: number
}

/**
 * The hand-off panel: it derives each step from real rows (corridor status,
 * dataset rows, the picked dam, existing scenarios) instead of showing four
 * permanently-blue dots.
 */
export function NextSteps({ riverId, riverName, damId, damName, bufferKm }: Props) {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [queuedId, setQueuedId] = useState<string | null>(null)

  const corridors = useApi(['corridors'], api.corridors, { enabled: Boolean(riverId) })
  const corridor = riverId
    ? corridors.data?.find((c) => c.river_id === riverId) ?? null
    : null
  const datasets = useApi(
    ['corridor-datasets', corridor?.id],
    () => api.corridorDatasets(corridor!.id),
    { enabled: Boolean(corridor), refetchInterval: 2000 },
  )
  const jobs = useApi(['jobs'], () => api.jobs(), {
    enabled: Boolean(riverId),
    refetchInterval: 2000,
  })
  const scenarios = useApi(['scenarios'], () => api.scenarios(), { enabled: Boolean(damId) })

  // Only DEM / dams gate the workflow; WorldPop is optional (impact falls back
  // to GHS-POP/OSM or manual entry in Build), so a 1.8 GB population file can
  // never hold the next step hostage. Optional kinds still show as advisories.
  const rows = (datasets.data ?? []).filter((r) => STAGING_KINDS.has(r.kind))
  const required = rows.filter((r) => REQUIRED_STAGING_KINDS.has(r.kind))
  const optional = rows.filter((r) => !REQUIRED_STAGING_KINDS.has(r.kind))
  const missing = required.filter((r) => r.status === 'missing' || r.status === 'failed').length
  const fetching = required.some((r) => isLive(r.job?.status) || r.job?.status === 'paused')
  const optionalLive = optional.some((r) => isLive(r.job?.status) || r.job?.status === 'paused')
  const optionalMissing = optional.some((r) => r.status !== 'available')
  // Ready means the corridor's own data is on disk — population is reported
  // next to the button but never counts towards this gate.
  const datasetsReady =
    required.length > 0 &&
    required.every(
      (r) => r.status === 'available' && !isLive(r.job?.status) && r.job?.status !== 'paused',
    )
  const scenarioMade = Boolean(
    damId && scenarios.data?.some((s) => s.spec?.dam_id === damId),
  )

  const prepareJob =
    (jobs.data ?? []).find(
      (j) => j.type === 'corridor.prepare' && `${j.params?.river_id ?? ''}` === riverId,
    ) ??
    (queuedId
      ? { id: queuedId, status: 'queued', progress: 0, error: null as string | null }
      : null)
  const preparing = prepareJob
    ? isLive(prepareJob.status) || prepareJob.status === 'paused'
    : false
  const preparePaused = prepareJob?.status === 'paused'

  const steps: StepRow[] = [
    {
      title: 'Prepare River Corridor',
      state: !riverId
        ? 'pending'
        : preparing || corridor?.status === 'preparing'
          ? 'active'
          : corridor
            ? 'done'
            : 'pending',
      note: !riverId
        ? 'no river'
        : preparing || corridor?.status === 'preparing'
          ? 'running'
          : corridor
            ? 'corridor ready'
            : 'not run yet',
    },
    {
      title: 'Fetch Missing Data',
      state: !corridor
        ? 'pending'
        : fetching || !datasetsReady
          ? 'active'
          : 'done',
      note: !corridor
        ? 'awaits corridor'
        : fetching
          ? 'downloading'
          : rows.length === 0
            ? 'no dataset rows'
            : datasetsReady
              ? `${required.length} on disk${
                  optionalLive ? ' · pop downloading' : optionalMissing ? ' · pop optional' : ''
                }`
              : `${missing} missing`,
    },
    {
      title: 'Review & Select Dams',
      state: !riverId ? 'pending' : damId ? 'done' : 'active',
      note: damId ? (damName ?? 'dam selected') : 'pick one in the list',
    },
    {
      title: 'Create Scenario',
      state: scenarioMade ? 'done' : damId ? 'active' : 'pending',
      note: scenarioMade ? 'scenario exists' : damId ? 'ready to configure' : 'needs a dam',
    },
  ]

  const prepare = async () => {
    if (!riverId) return
    setBusy(true)
    setNote(null)
    try {
      // Re-prepare passes the slider's width: it is what narrows the dam set
      // the job fetches and what clears the corridor's `stale` flag.
      const res = await api.prepareRiver(riverId, bufferKm)
      setQueuedId(res.job_id)
    } catch (err) {
      setQueuedId(null)
      setNote(err instanceof Error ? err.message : 'Prepare failed')
    } finally {
      setBusy(false)
    }
  }

  const action = (): NextAction => {
    if (!riverId)
      return { label: 'Select a river first', disabled: true, onClick: undefined, to: undefined, advisory: null }
    if (!corridor && !preparing)
      return {
        label: `Prepare Corridor for ${riverName ?? '—'}`,
        disabled: busy,
        onClick: prepare,
        to: undefined,
        advisory: null,
      }
    if (preparing || corridor?.status === 'preparing')
      return {
        label: preparePaused
          ? 'Prepare paused — resume to continue'
          : `Preparing ${riverName ?? '—'}…`,
        disabled: true,
        onClick: undefined,
        to: undefined,
        advisory: null,
      }
    if (!damId)
      return {
        label: 'Select a dam to continue',
        disabled: true,
        onClick: undefined,
        to: undefined,
        advisory: null,
      }
    // Data is advisory, never a gate: DEM + dam registry decide readiness, and
    // population downloads (if at all) keep running while you configure.
    return {
      label: scenarioMade ? 'Open Build' : 'Continue to Build',
      disabled: false,
      onClick: undefined,
      to: `/corridor/${riverId}`,
      advisory:
        !datasetsReady && rows.length > 0
          ? fetching
            ? `${missing} required dataset${missing === 1 ? '' : 's'} still downloading — they continue in the background`
            : `${missing} required dataset${missing === 1 ? '' : 's'} missing — Download data from Build while you configure`
          : optionalLive
            ? 'population (WorldPop) still downloading — optional; impact can use manual entry instead'
            : optionalMissing
              ? 'population (WorldPop) not on disk — optional; Build defaults impact to manual entry'
              : null,
    }
  }

  const next = action()
  // Re-offer prepare whenever a corridor exists and nothing is running: that
  // is how a slider move (2 km → 1 km) turns into narrower fetch work.
  const canReprepare = Boolean(riverId && corridor && !preparing && !busy)

  return (
    <Panel title="Next Steps">
      <ol className="flex flex-col gap-1.5 p-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-center gap-2">
            <span
              className={`num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${TONE[s.state]}`}
            >
              {s.state === 'done' ? <Icon name="check" size={10} /> : i + 1}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[12px] ${
                s.state === 'pending' ? 'text-[var(--muted)]' : ''
              }`}
            >
              {s.title}
            </span>
            <span
              className={`num shrink-0 text-[10px] ${
                s.state === 'done'
                  ? 'text-[var(--ok)]'
                  : s.state === 'active'
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--faint)]'
              }`}
            >
              {s.note}
            </span>
          </li>
        ))}
      </ol>

      <div className="border-t border-[var(--line)] p-3">
        {next.to ? (
          <Link
            to={next.to}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 text-[12px] font-semibold text-white shadow-sm hover:brightness-110 transition-all"
          >
            {next.label}
          </Link>
        ) : (
          <button
            onClick={next.onClick}
            disabled={next.disabled}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 text-[12px] font-semibold text-white shadow-sm disabled:opacity-40 hover:brightness-110 transition-all"
          >
            {next.label}
          </button>
        )}

        {next.advisory && (
          <p className="mt-1.5 text-[10px] leading-snug text-[var(--warn)]">{next.advisory}</p>
        )}

        {canReprepare && (
          <button
            onClick={() => void prepare()}
            className="mt-1.5 h-6 w-full rounded border border-[var(--line-strong)] px-2 text-[10px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Re-prepare at {bufferKm} km
          </button>
        )}

        {prepareJob &&
          (isLive(prepareJob.status) ||
            preparePaused ||
            prepareJob.status === 'failed') && (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--line)]">
                <div
                  className={`h-full rounded transition-[width] duration-500 ${
                    preparePaused ? 'bg-[var(--warn)]' : 'bg-[var(--accent)]'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, prepareJob.progress))}%` }}
                />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <p
                  className={`num min-w-0 flex-1 truncate text-[10px] ${
                    prepareJob.status === 'failed' ? 'text-[var(--bad)]' : 'text-[var(--muted)]'
                  }`}
                >
                  {STATUS_TEXT[prepareJob.status] ?? prepareJob.status}
                  {isLive(prepareJob.status) || preparePaused
                    ? ` ${prepareJob.progress}%`
                    : ''}{' '}
                  · job {prepareJob.id.slice(0, 8)}
                </p>
                {isLive(prepareJob.status) && prepareJob.id !== queuedId && (
                  <button
                    onClick={() => void api.pauseJob(prepareJob.id)}
                    className="shrink-0 rounded border border-[var(--line-strong)] px-1.5 py-px text-[10px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Pause
                  </button>
                )}
                {preparePaused && (
                  <button
                    onClick={() => void api.resumeJob(prepareJob.id)}
                    className="shrink-0 rounded border border-[var(--line-strong)] px-1.5 py-px text-[10px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Resume
                  </button>
                )}
              </div>
              {prepareJob.status === 'failed' && prepareJob.error && (
                <p className="mt-0.5 break-words text-[10px] text-[var(--bad)]">{prepareJob.error}</p>
              )}
              <div className="mt-1.5 border-t border-[var(--line)]">
                <PrepareStages progress={prepareJob.progress ?? 0} />
              </div>
            </div>
          )}

        {!prepareJob && jobs.offline && (
          <p className="mt-1.5 text-[10px] text-[var(--warn)]">Job list unavailable</p>
        )}
        {!prepareJob && note && <p className="mt-1.5 text-[10px] text-[var(--bad)]">{note}</p>}

        <Prov>
          {riverId
            ? preparing
              ? 'corridor.prepare — fetching DEM tiles and population'
              : corridor
                ? `corridor row present · ${missing} of ${required.length} required datasets missing`
                : 'Queues corridor.prepare — runs in the background'
            : 'Select a river first'}
        </Prov>
      </div>
    </Panel>
  )
}
