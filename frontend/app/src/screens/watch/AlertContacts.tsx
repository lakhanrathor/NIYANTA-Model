import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '../../lib/useApi'
import { EM_DASH } from '../../lib/format'
import { Empty, Panel, Pill } from '../../components/ui'
import { watchApi, type AlertRecipient, type RecipientInput } from './watchApi'

const BLANK = { name: '', org: '', role: '', email: '', phone: '', webhook: '', states: '', min_level: 'CRITICAL' }
const input =
  'h-7 w-full rounded border border-[var(--line-strong)] bg-white px-2 text-[11.5px] outline-none focus:border-[var(--accent)]'

const statesOf = (r: AlertRecipient): string[] => {
  if (Array.isArray(r.states)) return r.states
  try {
    return JSON.parse(r.states || '[]') as string[]
  } catch {
    return []
  }
}

/**
 * Officials who receive alerts (ministry, NDMA, CWC, district). Each gets the
 * alerts at or above their level, for the states they cover, on every channel
 * they have. Channels the server is not set up for are shown honestly.
 */
export function AlertContacts() {
  const qc = useQueryClient()
  const list = useApi(['alert-recipients'], watchApi.recipients)
  const ch = useApi(['alert-channels'], watchApi.alertChannels)
  const [form, setForm] = useState(BLANK)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['alert-recipients'] })
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    setNote(null)
    try {
      await fn()
      if (ok) setNote(ok)
      await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const save = () => {
    const body: RecipientInput = {
      name: form.name,
      org: form.org || null,
      role: form.role || null,
      email: form.email || null,
      phone: form.phone || null,
      webhook: form.webhook || null,
      states: form.states
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      min_level: form.min_level as 'WARNING' | 'CRITICAL',
    }
    void run('add', async () => {
      await watchApi.addRecipient(body)
      setForm(BLANK)
      setAdding(false)
    }, `${form.name} added`)
  }

  const test = (r: AlertRecipient) =>
    void run(`test:${r.id}`, async () => {
      const res = await watchApi.testRecipient(r.id)
      const sum = res.deliveries.map((d) => `${d.channel}: ${d.status.replace('_', ' ')}`).join(' · ')
      setNote(`Test to ${r.name} — ${sum || 'no channel'}`)
    })

  const toggle = (r: AlertRecipient) =>
    void run(`tog:${r.id}`, () =>
      watchApi.updateRecipient(r.id, {
        name: r.name,
        org: r.org,
        role: r.role,
        email: r.email,
        phone: r.phone,
        webhook: r.webhook,
        states: statesOf(r),
        min_level: r.min_level,
        active: !r.active,
      }),
    )

  const rows = list.data ?? []
  const chan = (on: boolean | undefined, label: string) => (
    <Pill tone={on ? 'ok' : 'warn'}>
      {label} {on ? 'ready' : 'not set up'}
    </Pill>
  )

  return (
    <Panel
      title="Alert contacts"
      actions={
        <button onClick={() => setAdding((v) => !v)} className="text-[11px] font-semibold text-[var(--accent)]">
          {adding ? 'Cancel' : '+ Add official'}
        </button>
      }
    >
      <div className="flex flex-wrap gap-1 px-3 pt-2">
        {chan(ch.data?.email, 'Email')}
        {chan(ch.data?.sms, 'SMS')}
        {chan(ch.data?.webhook, 'Webhook')}
      </div>
      <p className="px-3 pt-1 text-[10.5px] leading-snug text-[var(--muted)]">
        CRITICAL alerts are sent automatically; press DISPATCH on any alert to send it now.
      </p>

      {adding && (
        <div className="m-3 grid grid-cols-2 gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5">
          <input className={input} placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={input} placeholder="Organisation (e.g. NDMA)" value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} />
          <input className={input} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={input} placeholder="Phone (+91…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input
            className={`${input} col-span-2`}
            placeholder="Webhook URL (Teams / Slack / SMS relay) — optional"
            value={form.webhook}
            onChange={(e) => setForm({ ...form, webhook: e.target.value })}
          />
          <input
            className={input}
            placeholder="States (comma separated, empty = all India)"
            value={form.states}
            onChange={(e) => setForm({ ...form, states: e.target.value })}
          />
          <select className={input} value={form.min_level} onChange={(e) => setForm({ ...form, min_level: e.target.value })}>
            <option value="CRITICAL">Only CRITICAL alerts</option>
            <option value="WARNING">WARNING and CRITICAL</option>
          </select>
          <button
            disabled={!form.name.trim() || busy === 'add'}
            onClick={save}
            className="col-span-2 h-7 rounded bg-[var(--accent)] text-[11.5px] font-semibold text-white disabled:opacity-40"
          >
            {busy === 'add' ? 'Saving…' : 'Save official'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>No officials yet — add the people who must hear about a dangerous dam.</Empty>
      ) : (
        <ul className="mt-1">
          {rows.map((r) => (
            <li key={r.id} className={`border-t border-[var(--line)] px-3 py-2 ${r.active ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                  {r.name}
                  {r.org ? <span className="font-normal text-[var(--muted)]"> · {r.org}</span> : null}
                </span>
                <Pill tone={r.min_level === 'WARNING' ? 'warn' : 'bad'}>{r.min_level}</Pill>
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-[var(--muted)]">
                {[r.email, r.phone, r.webhook ? 'webhook' : null].filter(Boolean).join(' · ') || EM_DASH} ·{' '}
                {statesOf(r).length ? statesOf(r).join(', ') : 'all states'}
              </div>
              <div className="mt-1 flex gap-3 text-[10.5px] font-semibold">
                <button className="text-[var(--accent)]" disabled={busy != null} onClick={() => test(r)}>
                  {busy === `test:${r.id}` ? 'Sending…' : 'Send test'}
                </button>
                <button className="text-[var(--muted)]" disabled={busy != null} onClick={() => toggle(r)}>
                  {r.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  className="text-[var(--bad)]"
                  disabled={busy != null}
                  onClick={() => void run(`del:${r.id}`, () => watchApi.removeRecipient(r.id), `${r.name} removed`)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="border-t border-[var(--line)] px-3 py-1.5 text-[10.5px] text-[var(--muted)]">{note}</p>}
    </Panel>
  )
}
