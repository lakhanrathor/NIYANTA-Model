import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Discover } from './screens/Discover'
import { Watch } from './screens/Watch'
import { Landing } from './screens/Landing'
import { Start } from './screens/Start'
import { V2App } from './v2/App'
import { ScenarioLab } from './screens/ScenarioLab'
import { FloodLab } from './screens/FloodLab'
import { Run } from './screens/Run'
import { Results } from './screens/Results'
import { Compare } from './screens/Compare'
import { Player3D } from './screens/Player3D'
import { StatusBar } from './components/StatusBar'
import { JobsPanel } from './components/JobsPanel'
import { RiverContextTopDropdown } from './components/RiverContextTopDropdown'
import { Icon } from './components/ui'
import { wireMission } from './lib/mission'
import { useRiverContext } from './lib/river-context'
import { STEPS, TOOLS, stepIndex, unlocked, useGates } from './lib/flow'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
  },
})

function Help() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        title="Help"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-strong)] text-[12px] font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        ?
      </button>
      {open && (
        <div className="panel absolute right-0 z-50 mt-2 w-[300px] p-3 text-[11px] leading-relaxed shadow-[var(--shadow)]">
          <p className="mb-1.5 font-semibold">Evidence rule</p>
          <p className="text-[var(--muted)]">
            Every number on screen comes from <span className="num">GET /api/…</span>. If an
            endpoint 404s or errors, the panel shows <span className="num">—</span> or
            <span className="num"> Source offline</span> with a provenance line — never a
            placeholder value.
          </p>
          <p className="mt-2 mb-1.5 font-semibold">Legend</p>
          <ul className="text-[var(--muted)]">
            <li>Work through the numbered steps in the left menu, in order.</li>
            <li>Each step opens when the one before it is done; use the bar at the bottom to move on.</li>
            <li>2D is the default map mode everywhere.</li>
            <li>The 2D/3D switch is shared — change it on any map and every map follows.</li>
            <li>Numbers are monospace and always carry a unit.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

/** Hard route guard — the backstop behind the greyed-out nav item. */
function RouteGate({ when, to, children }: { when: boolean; to: string; children: ReactNode }) {
  return when ? <>{children}</> : <Navigate to={to} replace />
}

/**
 * Left sidebar: the study as a vertical checklist (open steps only — the
 * rest wait behind a count), then the side tools. Collapses to icons.
 */
function Sidebar({ pathname }: { pathname: string }) {
  const gates = useGates()
  const [slim, setSlim] = useState(() => {
    try {
      return localStorage.getItem('niyanta.sidebar.slim') === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setSlim((v) => {
      try {
        localStorage.setItem('niyanta.sidebar.slim', v ? '0' : '1')
      } catch {
        /* per-viewer convenience */
      }
      return !v
    })
  const cur = stepIndex(pathname)
  const open = STEPS.filter((s) => unlocked(s, gates))
  const hidden = STEPS.length - open.length
  const item = (active: boolean) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors ${
      active ? 'bg-white/10 font-semibold text-white' : 'text-[var(--nav-text)] hover:bg-white/5 hover:text-white'
    }`
  return (
    <aside
      className={`flex shrink-0 flex-col bg-[var(--nav)] text-[var(--nav-text)] transition-[width] ${slim ? 'w-[60px]' : 'w-[236px]'}`}
    >
      <div className="flex h-14 items-center gap-2 px-3.5">
        <Link to="/" title="NIYANTA home" className="flex min-w-0 items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
            <rect width="24" height="24" rx="6" fill="var(--accent)" />
            <path
              d="M4 9c2.2 0 2.2 2.4 4.4 2.4S10.6 9 12.8 9s2.2 2.4 4.4 2.4S19.4 9 21.6 9M4 14c2.2 0 2.2 2.4 4.4 2.4S10.6 14 12.8 14s2.2 2.4 4.4 2.4S19.4 14 21.6 14"
              stroke="#fff"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          {!slim && (
            <span className="flex flex-col leading-none">
              <span className="text-[14px] font-semibold tracking-[0.12em] text-white">NIYANTA</span>
              <span className="mt-1 text-[10px] text-[var(--nav-faint)]">Dam-break flood studies</span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        <Link to="/start" title="Start here" className={item(pathname === '/start')}>
          <Icon name="locate" size={15} />
          {!slim && 'Start here'}
        </Link>

        {!slim && (
          <div className="mt-4 mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--nav-faint)]">
            Your study
          </div>
        )}
        {slim && <div className="my-2 border-t border-white/10" />}
        <ol className="relative flex flex-col gap-0.5">
          {open.map((s, i) => {
            const active = i === cur
            const done = i < open.length - 1 && !active
            return (
              <li key={s.to}>
                <Link to={s.to} title={s.label} className={item(active)}>
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active
                        ? 'bg-[var(--accent)] text-white'
                        : done
                          ? 'bg-[var(--ok)] text-white'
                          : 'border border-white/30 text-white'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  {!slim && <span className="truncate">{s.label}</span>}
                </Link>
                {active && !slim && (
                  <p className="mb-1 ml-[42px] mr-2 text-[11px] leading-snug text-[var(--nav-faint)]">{s.what}</p>
                )}
              </li>
            )
          })}
        </ol>
        {hidden > 0 && !slim && (
          <p
            title={STEPS.slice(open.length)
              .map((s) => s.label)
              .join(' → ')}
            className="mx-2.5 mt-1.5 rounded-lg border border-dashed border-white/15 px-2.5 py-2 text-[11px] leading-snug text-[var(--nav-faint)]"
          >
            {hidden} more {hidden === 1 ? 'step opens' : 'steps open'} as you finish this one
          </p>
        )}

        {!slim && (
          <div className="mt-5 mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--nav-faint)]">
            Tools
          </div>
        )}
        {slim && <div className="my-2 border-t border-white/10" />}
        {TOOLS.map((t) => (
          <Link key={t.to} to={t.to} title={`${t.label} — ${t.what}`} className={item(pathname.startsWith(t.to))}>
            <Icon name={t.icon} size={15} />
            {!slim && t.label}
          </Link>
        ))}
      </nav>

      <button
        onClick={toggle}
        title={slim ? 'Expand menu' : 'Collapse menu'}
        className="flex h-10 items-center gap-2 border-t border-white/10 px-4 text-[11.5px] text-[var(--nav-faint)] hover:text-white"
      >
        <Icon name={slim ? 'chevronRight' : 'chevronLeft'} size={13} />
        {!slim && 'Collapse'}
      </button>
    </aside>
  )
}

/** Top bar title: where you are and what this page is for. */
function PageTitle({ pathname }: { pathname: string }) {
  const i = stepIndex(pathname)
  const tool = TOOLS.find((t) => pathname.startsWith(t.to))
  const [title, sub] =
    i >= 0
      ? [`Step ${i + 1} · ${STEPS[i].label}`, STEPS[i].what]
      : tool
        ? [tool.label, tool.what]
        : ['Start here', 'How a study works, and where to begin']
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px] font-semibold">{title}</div>
      <div className="truncate text-[11.5px] text-[var(--muted)]">{sub}</div>
    </div>
  )
}

/**
 * Bottom bar on every workflow page: where you are, what this step is for,
 * and Previous / Next. Next opens only when this step is done.
 */
function StepBar({ pathname }: { pathname: string }) {
  const gates = useGates()
  const navigate = useNavigate()
  const i = stepIndex(pathname)
  if (i < 0) return null
  const s = STEPS[i]
  const prev = STEPS[i - 1]
  const next = STEPS[i + 1]
  const nextOpen = next ? unlocked(next, gates) : false
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] bg-white px-3 py-2">
      <button
        disabled={!prev}
        onClick={() => prev && navigate(prev.to)}
        className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--line-strong)] px-3 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-35"
      >
        <Icon name="chevronLeft" size={12} /> Previous
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-[12.5px] font-semibold">
          Step {i + 1} of {STEPS.length} · {s.label}
        </div>
        <div className="truncate text-[11.5px] text-[var(--muted)]">
          {s.what}
          {next && !nextOpen && s.todo ? ` To continue, ${s.todo}.` : ''}
        </div>
      </div>
      {next ? (
        <button
          disabled={!nextOpen}
          onClick={() => navigate(next.to)}
          title={nextOpen ? undefined : `To continue, ${s.todo}`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white disabled:bg-[var(--line-strong)] disabled:text-[var(--muted)]"
        >
          Next: {next.label} <Icon name="chevronRight" size={12} />
        </button>
      ) : (
        <span className="shrink-0 text-[11.5px] font-medium text-[var(--ok)]">Last step — study complete</span>
      )}
    </div>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const setPage = useRiverContext((s) => s.setPage)
  const gates = useGates()
  // Connect Build ↔ Mission Context and rehydrate it from the DB once per page load,
  // so a refresh restores the selected river, dam, draft and run without re-clicking.
  useEffect(() => {
    wireMission()
  }, [])
  // The context knows which page is on screen — global chrome (map shell,
  // layer visibility, nav) reads it instead of sniffing the router itself.
  useEffect(() => {
    setPage(pathname)
  }, [pathname, setPage])
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-5 border-b border-[var(--line)] bg-white px-4">
        <PageTitle pathname={pathname} />

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <RiverContextTopDropdown />
          <JobsPanel />
          <Help />
          <span
            title="Signed in"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white"
          >
            AK
          </span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/start" element={<Start />} />
          <Route path="/watch" element={<Watch />} />
          <Route path="/scenario-lab" element={<ScenarioLab />} />
          <Route path="/flood-lab" element={<FloodLab />} />
          <Route path="/flood-lab/:runId" element={<FloodLab />} />
          <Route path="/discover" element={<Discover />} />
          {/* Build is Discover's second mode: same component, same map
              instance, different side panels — the camera survives the switch. */}
          <Route
            path="/build"
            element={
              <RouteGate when={gates.build} to="/discover">
                <Discover />
              </RouteGate>
            }
          />
          <Route
            path="/corridor/:riverId"
            element={
              <RouteGate when={gates.build} to="/discover">
                <Discover />
              </RouteGate>
            }
          />
          {/* An id in the URL is its own evidence: a deep link (or a refresh)
              into a run, a result set or a player stays exactly where it is. */}
          <Route path="/run/:runId" element={<Run />} />
          <Route
            path="/run"
            element={
              <RouteGate when={gates.run} to="/build">
                <Run />
              </RouteGate>
            }
          />
          <Route path="/results/:runId" element={<Results />} />
          <Route
            path="/results"
            element={
              <RouteGate when={gates.results} to="/run">
                <Results />
              </RouteGate>
            }
          />
          <Route
            path="/compare"
            element={
              <RouteGate when={gates.compare} to="/results">
                <Compare />
              </RouteGate>
            }
          />
          <Route path="/player/:runId" element={<Player3D />} />
          <Route
            path="/player"
            element={
              <RouteGate when={gates.compare} to="/results">
                <Player3D />
              </RouteGate>
            }
          />
          <Route path="*" element={<Start />} />
        </Routes>
      </main>

      <StepBar pathname={pathname} />

      <StatusBar />
      </div>
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Landing page: the portal front door, full-screen outside the shell. */}
          <Route path="/" element={<Landing />} />
          {/* the new guided frontend, side by side until it replaces the shell */}
          <Route path="/v2/*" element={<V2App />} />
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
