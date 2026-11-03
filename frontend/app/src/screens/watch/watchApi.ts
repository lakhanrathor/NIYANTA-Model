import { request, type AlertRow, type Scenario, type WatchChange } from '../../lib/api'

/**
 * Watch-track endpoints missing from the shared client. Same envelope:
 * `/api` prefix, JSON, ApiError on 404/500/timeout — callers render honest
 * empty states, never invented values.
 */

/** An official who receives alerts (GET/POST /api/alerts/recipients). */
export interface AlertRecipient {
  id: string
  name: string
  org?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
  webhook?: string | null
  states: string[] | string
  min_level: 'WARNING' | 'CRITICAL'
  active: boolean | number
}
export type RecipientInput = Omit<AlertRecipient, 'id' | 'states' | 'active'> & { states: string[]; active?: boolean }

/** One delivery attempt: status sent | failed | not_configured. */
export interface AlertDelivery {
  id: number
  alert_id: string
  recipient_id: string
  recipient_name?: string | null
  recipient_org?: string | null
  channel: 'email' | 'sms' | 'webhook'
  target?: string | null
  status: 'sent' | 'failed' | 'not_configured'
  detail?: string | null
  ts: string
}
export interface DispatchResult {
  alert_id: string
  recipients: number
  sent: number
  deliveries: AlertDelivery[]
}
export interface AlertMessagePreview {
  subject: string
  text: string
  state: string
  recipients: string[]
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) })

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
})

export interface BoxTimelinePoint extends WatchChange {}

export interface BoxTimeline {
  box_id: string
  changes: BoxTimelinePoint[]
  observations?: unknown
  latest_risk?: {
    id?: string | null
    level?: string | null
    score?: number | null
    summary?: string | null
    ts?: string | null
    created?: string | null
  } | null
}

export interface RiskEvent {
  id: string
  box_id?: string | null
  level?: string | null
  score?: number | null
  summary?: string | null
  ts?: string | null
  created?: string | null
  scenario_id?: string | null
}

export interface SweepJob {
  job_id?: string
  id?: string
  status?: string | null
}

export const watchApi = {
  /** Per-box change history + latest risk — drives BoxDetail charts. */
  boxTimeline: (boxId: string, days = 30) =>
    request<BoxTimeline>(`/watch/boxes/${boxId}/timeline?days=${days}`),

  /** Enqueue the daily GEE sweep. Returns the job to poll. */
  triggerSweep: (params?: Record<string, unknown>) =>
    request<SweepJob>(`/watch/run`, post({ params: params ?? {} })),

  /** Manual f₂ trigger for one box (same path the automation uses). */
  scoreBox: (boxId: string) =>
    request<RiskEvent | { risk?: RiskEvent }>(`/watch/score/${boxId}`, { method: 'POST' }),

  /** Alert lifecycle — ack, close (dispatch sends; see dispatchAlert). */
  alertAct: (alertId: string, action: 'ack' | 'dispatch' | 'close') =>
    request<AlertRow>(`/alerts/${alertId}/${action}`, { method: 'POST' }),

  /** Send an alert to every matching official now. */
  dispatchAlert: (alertId: string) => request<DispatchResult>(`/alerts/${alertId}/dispatch`, { method: 'POST' }),
  alertMessage: (alertId: string) => request<AlertMessagePreview>(`/alerts/${alertId}/message`),
  alertDeliveries: (alertId: string) => request<AlertDelivery[]>(`/alerts/${alertId}/deliveries`),

  /** Officials directory + which channels the server can send on. */
  recipients: () => request<AlertRecipient[]>('/alerts/recipients'),
  addRecipient: (r: RecipientInput) => request<AlertRecipient>('/alerts/recipients', post(r)),
  updateRecipient: (id: string, r: RecipientInput) => request<AlertRecipient>(`/alerts/recipients/${id}`, put(r)),
  removeRecipient: (id: string) => request<{ deleted: string }>(`/alerts/recipients/${id}`, { method: 'DELETE' }),
  testRecipient: (id: string) =>
    request<{ deliveries: AlertDelivery[] }>(`/alerts/recipients/${id}/test`, { method: 'POST' }),
  alertChannels: () => request<{ email: boolean; sms: boolean; webhook: boolean }>('/alerts/channels'),

  /** Risk history + scored events. */
  riskEvents: (limit = 20) => request<RiskEvent[]>(`/risk/events?limit=${limit}`),

  /** Score a reservoir (f₁) — ≥ MODERATE auto-builds a case-1 scenario. */
  scoreReservoir: (damId: string) =>
    request<RiskEvent | { risk?: RiskEvent }>(`/risk/reservoir`, post({ dam_id: damId })),

  /** THE TRIGGER — change → persisted case-2 scenario (never auto-executes). */
  fromEvent: (changeId: string) =>
    request<{ scenario: Scenario }>(`/scenarios/from-event/${changeId}`, { method: 'POST' }),

  /** THE TRIGGER — risk → persisted case-1 scenario (never auto-executes). */
  fromRisk: (riskId: string) =>
    request<{ scenario: Scenario }>(`/scenarios/from-risk/${riskId}`, { method: 'POST' }),
}
