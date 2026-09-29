/** WebSocket clients for the NIYANTA backend (proxied via Vite in dev). */

function wsBase(): string {
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (env) return env.replace(/^http/, 'ws')
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
}

export interface LifecycleMessage {
  kind: 'lifecycle'
  state: string
  stage: string | null
  stage_status: string | null
  progress: number
  error: string | null
}

export interface JobsMessage {
  kind: 'jobs'
  jobs: { id: string; type: string; status: string; progress: number; error: string | null }[]
}

export interface TerminalMessage {
  kind: 'terminal'
  state: string
}

export interface ErrorMessage {
  kind: 'error'
  error: string
}

export type RunMessage = LifecycleMessage | JobsMessage | TerminalMessage | ErrorMessage

export interface AlertMessage {
  kind: 'alert'
  alert: {
    id: string
    level: string
    title: string
    body: string | null
    run_id: string | null
    state: string
    source: string | null
    created: string
  }
}

/** Subscribe to a run's lifecycle; auto-reconnects until terminal or closed. */
export function subscribeRun(
  runId: string,
  onMessage: (msg: RunMessage) => void,
): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let retry = 0

  const connect = () => {
    if (stopped) return
    socket = new WebSocket(`${wsBase()}/api/ws/runs/${runId}`)
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as RunMessage
      onMessage(msg)
      if (msg.kind === 'terminal') close()
    }
    socket.onerror = () => socket?.close()
    socket.onclose = () => {
      if (stopped) return
      if (retry < 20) {
        retry += 1
        setTimeout(connect, Math.min(500 * retry, 5000))
      }
    }
  }

  const close = () => {
    stopped = true
    socket?.close()
  }

  connect()
  return close
}

/** Live alert feed. */
export function subscribeAlerts(onMessage: (msg: AlertMessage) => void): () => void {
  const socket = new WebSocket(`${wsBase()}/api/ws/alerts`)
  socket.onmessage = (ev) => onMessage(JSON.parse(ev.data) as AlertMessage)
  return () => socket.close()
}
