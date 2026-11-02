import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { JobsPanel } from '../components/JobsPanel'
import { Icon } from '../components/ui'
import { unlocked, useGates } from '../lib/flow'
import { wireMission } from '../lib/mission'
import { useRiverContext } from '../lib/river-context'
import { V2_STEPS, V2_TOOLS } from './steps'
import { Button } from './ui'

/**
 * v2 app frame: logo + tools only — the study shows one step at a time,
 * never the list of steps; every page renders below it.
 */
export function V2Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const setPage = useRiverContext((s) => s.setPage)
  // the same mission rehydration + page signal the classic shell runs
  useEffect(() => {
    wireMission()
  }, [])
  useEffect(() => {
    setPage(pathname)
  }, [pathname, setPage])
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)]">
      <header className="flex h-16 shrink-0 items-center gap-6 border-b border-[var(--line)] bg-white px-6">
        <Link to="/v2" className="flex shrink-0 items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="var(--accent)" />
            <path
              d="M4 9c2.2 0 2.2 2.4 4.4 2.4S10.6 9 12.8 9s2.2 2.4 4.4 2.4S19.4 9 21.6 9M4 14c2.2 0 2.2 2.4 4.4 2.4S10.6 14 12.8 14s2.2 2.4 4.4 2.4S19.4 14 21.6 14"
              stroke="#fff"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-[0.12em]">NIYANTA</span>
            <span className="mt-1 text-[10.5px] text-[var(--faint)]">Dam-break flood studies</span>
          </span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <ToolsMenu />
          <JobsPanel />
          <Link to="/start" title="The previous interface" className="text-[11.5px] text-[var(--faint)] hover:text-[var(--accent)]">
            Classic view
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}

function ToolsMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="grid" size={13} /> Tools <Icon name="chevronDown" size={11} />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[290px] rounded-xl border border-[var(--line)] bg-white p-2 shadow-lg">
          {V2_TOOLS.map((t) => (
            <Link key={t.to} to={t.to} onClick={() => setOpen(false)} className="flex gap-3 rounded-lg p-2.5 hover:bg-slate-50">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon name={t.icon} size={15} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--text)]">{t.label}</span>
                <span className="block text-[11.5px] leading-snug text-[var(--muted)]">{t.what}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One wizard page: step heading + purpose, the work area, and a footer with
 * Back / Continue. Continue appears only once this step is complete.
 */
export function Wizard({
  step,
  aside,
  children,
  fill = false,
}: {
  step: number
  /** right side of the heading row (e.g. a status badge) */
  aside?: ReactNode
  children: ReactNode
  /** content fills the height (maps); otherwise it scrolls */
  fill?: boolean
}) {
  const gates = useGates()
  const navigate = useNavigate()
  const s = V2_STEPS[step]
  const prev = V2_STEPS[step - 1]
  const next = V2_STEPS[step + 1]
  const nextOpen = next ? unlocked(next, gates) : false
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-end gap-4 px-8 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--accent)]">
            Step {step + 1}
          </div>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">{s.label}</h1>
          <p className="mt-1 text-[13.5px] text-[var(--muted)]">{s.what}</p>
        </div>
        {aside}
      </div>
      <div className={`min-h-0 flex-1 px-8 pb-4 ${fill ? '' : 'overflow-y-auto'}`}>{children}</div>
      <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--line)] bg-white px-8 py-3">
        <Button variant="ghost" onClick={() => navigate(prev ? prev.to : '/v2')}>
          <Icon name="chevronLeft" size={13} /> {prev ? prev.label : 'Home'}
        </Button>
        <div className="min-w-0 flex-1 text-center text-[12.5px] text-[var(--muted)]">
          {next && !nextOpen && s.todo ? `To finish this step, ${s.todo}.` : next ? 'Step complete.' : 'This is the last step of the study.'}
        </div>
        {/* the next step does not exist on screen until this one is complete */}
        {next ? (
          nextOpen && (
            <Button variant="primary" size="lg" onClick={() => navigate(next.to)}>
              Continue: {next.label} <Icon name="chevronRight" size={14} />
            </Button>
          )
        ) : (
          <Button variant="secondary" onClick={() => navigate('/v2')}>
            Back to home
          </Button>
        )}
      </footer>
    </div>
  )
}
