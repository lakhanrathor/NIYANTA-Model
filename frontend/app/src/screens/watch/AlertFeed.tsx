import { useEffect, useState } from 'react'
import { api, type AlertRow } from '../../lib/api'
import type { AlertMessage } from '../../lib/ws'
import { subscribeAlerts } from '../../lib/ws'
import { useApi } from '../../lib/useApi'
import { useWatchContext } from '../../lib/watch-context'
import { EM_DASH, relativeTime } from '../../lib/format'
import { Empty, Panel, Pill } from '../../components/ui'
import { watchApi, type DispatchResult } from './watchApi'

const CATEGORY_COLOR: Record<string, string> = {
  glacier_change: 'var(--bad)',
  reservoir_anomaly: 'var(--warn)',
  blockage: 'var(--warn)',
  high_rainfall: 'var(--accent)',
  glacier_lake: 'var(--accent)',
}

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: 'var(--bad)',
  WARNING: 'var(--warn)',
  ERROR: 'var(--bad)',
  INFO: 'var(--accent)',
}

function alertDot(a: AlertRow) {
  const key = (a.category ?? '').toLowerCase()
  if (CATEGORY_COLOR[key]) return CATEGORY_COLOR[key]
  return LEVEL_COLOR[(a.level ?? '').toUpperCase()] ?? 'var(--muted)'
}

function dispatchSummary(r: DispatchResult): string {
  if (!r.recipients) return 'No official covers this alert yet — add one under Alert contacts.'
  const count = (st: string) => r.deliveries.filter((d) => d.status === st).length
  const parts = [`${count('sent')} delivered`]
  if (count('not_configured')) parts.push(`${count('not_configured')} channel(s) not set up on the server`)
  if (count('failed')) parts.push(`${count('failed')} failed`)
  return `Sent to ${r.recipients} official${r.recipients === 1 ? '' : 's'} · ${parts.join(' · ')}`
}

const STATUS_TONE: Record<string, string> = {
  sent: 'text-[var(--ok)]',
  failed: 'text-[var(--bad)]',
  not_configured: 'text-[var(--warn)]',
}

/** The message officials receive for this alert, and every delivery attempt. */
function AlertDetail({ alertId, tick }: { alertId: string; tick: number }) {
  const msg = useApi(['alert-msg', alertId], () => watchApi.alertMessage(alertId))
  const log = useApi(['alert-deliveries', alertId, tick], () => watchApi.alertDeliveries(alertId))
  return (
    <div className="border-t border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[11px]">
      <div className="font-semibold text-[var(--muted)]">Message officials receive</div>
      {msg.data ? (
        <>
          <div className="mt-1 font-semibold">{msg.data.subject}</div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-snug text-[var(--text)]">
            {msg.data.text}
          </pre>
          <div className="mt-1 text-[10.5px] text-[var(--muted)]">
            Goes to:{' '}
            {msg.data.recipients.length ? msg.data.recipients.join(', ') : 'nobody yet — no matching official'}
          </div>
        </>
      ) : (
        <div className="mt-1 text-[var(--faint)]">{msg.pending ? 'Loading…' : EM_DASH}</div>
      )}
      <div className="mt-2 font-semibold text-[var(--muted)]">Delivery log</div>
      {log.data?.length ? (
        <ul className="mt-1 space-y-0.5">
          {log.data.map((d) => (
            <li key={d.id} className="flex gap-2">
              <span className={`w-[92px] shrink-0 font-semibold ${STATUS_TONE[d.status] ?? ''}`}>
                {d.status.replace('_', ' ')}
              </span>
              <span className="min-w-0 truncate" title={d.detail ?? ''}>
                {d.channel} → {d.recipient_name ?? EM_DASH} ({d.target}) · {relativeTime(d.ts)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-[var(--faint)]">Not sent yet — press DISPATCH to send it now.</div>
      )}
    </div>
  )
}

/** Live alert feed — GET for history, WS for the moment something breaks.
 *  Reads/writes only the watch context. Actions hit the API, then refetch. */
export function AlertFeed() {
  const selectedAlertId = useWatchContext((s) => s.selectedAlertId)
  const selectAlert = useWatchContext((s) => s.selectAlert)
  const [tick, setTick] = useState(0)
  const [acting, setActing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // outcome of the last DISPATCH per alert, in words
  const [sentNote, setSentNote] = useState<Record<string, string>>({})

  const alerts = useApi(['alerts', tick], () => api.alerts(50))

  // A pushed alert refetches the feed — the WS payload is a nudge, the GET is
  // the evidence. Never render the socket payload as a row on its own.
  const [liveIds, setLiveIds] = useState<string[]>([])
  useEffect(
    () =>
      subscribeAlerts((msg: AlertMessage) => {
        if (msg.kind === 'alert' && msg.alert?.id) {
          setLiveIds((ids) => (ids.includes(msg.alert.id) ? ids : [msg.alert.id, ...ids].slice(0, 5)))
        }
        setTick((t) => t + 1)
      }),
    [],
  )

  const act = async (a: AlertRow, action: 'ack' | 'dispatch' | 'close') => {
    setActing(`${a.id}:${action}`)
    setError(null)
    try {
      if (action === 'dispatch') {
        const res = await watchApi.dispatchAlert(a.id)
        setSentNote((n) => ({ ...n, [a.id]: dispatchSummary(res) }))
        selectAlert(a.id, a.box_id ?? null)
      } else {
        await watchApi.alertAct(a.id, action)
      }
      setTick((t) => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`)
    } finally {
      setActing(null)
    }
  }

  const rows = alerts.data ?? []

  return (
    <Panel
      title="Alert Feed"
      actions={
        <Pill tone={rows.some((a) => (a.state ?? 'NEW') === 'NEW') ? 'bad' : undefined}>
          {rows.filter((a) => (a.state ?? 'NEW') === 'NEW').length} new
        </Pill>
      }
    >
      {alerts.offline && rows.length === 0 ? (
        <Empty>Source offline — GET /api/alerts</Empty>
      ) : rows.length === 0 ? (
        <Empty>No alerts — the sweep hasn't flagged anything</Empty>
      ) : (
        <ul className="max-h-[300px] overflow-auto">
          {rows.map((a) => {
            const active = selectedAlertId === a.id
            const state = (a.state ?? 'NEW').toUpperCase()
            const fresh = liveIds.includes(a.id)
            return (
              <li
                key={a.id}
                className={`border-b border-[var(--line)] last:border-b-0 ${
                  active ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectAlert(a.id, a.box_id ?? null)}
                  className="flex w-full gap-2 px-3 py-2 text-left hover:bg-[var(--bg)]"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: alertDot(a) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold">{a.title}</span>
                      {fresh && (
                        <span className="ct-blink shrink-0 rounded bg-[var(--bad)] px-1 text-[8px] font-bold text-white">
                          LIVE
                        </span>
                      )}
                    </span>
                    <span className="num mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-[var(--faint)]">
                      <span className="truncate">{a.location ?? a.river_name ?? EM_DASH}</span>
                      <span className="shrink-0">{relativeTime(a.created_at ?? a.created)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1">
                      {(['ack', 'dispatch', 'close'] as const).map((action) => (
                        <span
                          key={action}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            void act(a, action)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation()
                              void act(a, action)
                            }
                          }}
                          className={`rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide transition-all active:scale-95 ${
                            acting === `${a.id}:${action}`
                              ? 'border-[var(--line)] text-[var(--faint)]'
                              : state !== 'NEW' && action === 'ack'
                                ? 'border-[var(--ok)] text-[var(--ok)]'
                                : 'border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                          }`}
                        >
                          {action}
                        </span>
                      ))}
                      <span className="num ml-auto text-[9px] uppercase text-[var(--faint)]">{state}</span>
                    </span>
                    {sentNote[a.id] && (
                      <span className="mt-1 block text-[10.5px] text-[var(--muted)]">{sentNote[a.id]}</span>
                    )}
                  </span>
                </button>
                {active && <AlertDetail alertId={a.id} tick={tick} />}
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--bad)]">{error}</p>}
      <p className="num border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--faint)]">
        GET /api/alerts · WS /ws/alerts · {rows.length} rows
      </p>
    </Panel>
  )
}
