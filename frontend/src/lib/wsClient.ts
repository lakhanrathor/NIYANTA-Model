// WebSocket clients for the NIYANTA backend (proxied via Vite in dev).

function wsBase(): string {
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (env) return env.replace(/^http/, 'ws')
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}//${window.location.host}`
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

/** Subscribe to a run's lifecycle; auto-reconnects until closed() or terminal. */
export function watchRun(
  runId: string,
  onMessage: (msg: RunMessage) => void,
  opts?: { closed?: () => boolean },
): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  let retry = 0

  const connect = () => {
    if (stopped || opts?.closed?.()) return
    ws = new WebSocket(`${wsBase()}/api/ws/runs/${runId}`)
    ws.onmessage = (ev) => {
      let msg: RunMessage
      try {
        msg = JSON.parse(ev.data) as RunMessage
      } catch {
        return
      }
      onMessage(msg)
      if (msg.kind === 'terminal' || msg.kind === 'error') {
        stopped = true
        ws?.close()
      }
    }
    ws.onclose = () => {
      ws = null
      if (stopped || opts?.closed?.()) return
      retry += 1
      if (retry > 30) return
      window.setTimeout(connect, Math.min(500 * retry, 5000))
    }
    ws.onerror = () => ws?.close()
  }

  connect()
  return () => {
    stopped = true
    ws?.close()
  }
}

/** Stream new alerts (fires once per alert row). */
export function watchAlerts(onAlert: (msg: AlertMessage) => void): () => void {
  let ws: WebSocket | null = null
  let stopped = false

  const connect = () => {
    if (stopped) return
    ws = new WebSocket(`${wsBase()}/api/ws/alerts`)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as AlertMessage
        if (msg.kind === 'alert') onAlert(msg)
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      ws = null
      if (!stopped) window.setTimeout(connect, 3000)
    }
    ws.onerror = () => ws?.close()
  }

  connect()
  return () => {
    stopped = true
    ws?.close()
  }
}
