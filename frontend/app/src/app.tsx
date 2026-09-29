import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Discover } from './screens/Discover'
import { Watch } from './screens/Watch'
import { Landing } from './screens/Landing'
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
import type { BuildSnapshot, RunSnapshot } from './lib/river-context'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
  },
})

type NavItem = {
  to: string
  label: string
  icon: string
  /** Which prerequisite this item waits on; absent = always available. */
  gate?: GateName
  /** Shown on the greyed-out item so the analyst knows what unlocks it. */
  hint?: string
}

const NAV: NavItem[] = [
  { to: '/watch', label: 'Watch', icon: 'globe' },
  { to: '/discover', label: 'Discover', icon: 'search' },
  {
    to: '/build',
    label: 'Build',
    icon: 'dam',
    gate: 'build',
    hint: 'Select a river and a dam in Discover',
  },
  { to: '/run', label: 'Run', icon: 'play', gate: 'run', hint: 'Configure a scenario in Build' },
  {
    to: '/results',
    label: 'Results',
    icon: 'chart',
    gate: 'results',
    hint: 'Start a simulation in Run',
  },
  {
    to: '/compare',
    label: 'Compare',
    icon: 'swap',
    gate: 'compare',
    hint: 'Publish a finished run from Run',
  },
  {
    to: '/player',
    label: 'Player',
    icon: 'camera',
    gate: 'compare',
    hint: 'Publish a finished run from Run',
  },
]

/** Nav highlight — corridor screens are Build sub-routes. */
function navActive(pathname: string, to: string) {
  if (to === '/build') return pathname.startsWith('/build') || pathname.startsWith('/corridor')
  if (to === '/run') return pathname.startsWith('/run')
  if (to === '/results') return pathname.startsWith('/results')
  if (to === '/player') return pathname.startsWith('/player')
  return pathname.startsWith(to)
}

function Logo() {
  return (
    <Link to="/" title="NIYANTA home" className="flex shrink-0 items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="var(--accent)" />
        <path
          d="M4 9c2.2 0 2.2 2.4 4.4 2.4S10.6 9 12.8 9s2.2 2.4 4.4 2.4S19.4 9 21.6 9M4 14c2.2 0 2.2 2.4 4.4 2.4S10.6 14 12.8 14s2.2 2.4 4.4 2.4S19.4 14 21.6 14"
          stroke="#fff"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-[0.14em]">NIYANTA</span>
        <span className="mt-[2px] text-[9px] tracking-[0.03em] text-[var(--faint)]">
          Dam Break Inundation Platform
        </span>
      </span>
    </Link>
  )
}

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
            <li>2D is the default map mode everywhere.</li>
            <li>The 2D/3D switch is shared — change it on any map and every map follows.</li>
            <li>Build, Run, Results, Compare and Player unlock in that order.</li>
            <li>Numbers are monospace and always carry a unit.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---- mission gates ------------------------------------------------------
   Discover → Build → Run → Results → Compare → Player. Every gate reads the
   *persisted* context, never local component state, so a refresh deep in the
   chain keeps the analyst where they were instead of throwing them back. The
   nav greys out the same items, so the two can never disagree. */

const DONE_STATES = ['SUCCEEDED', 'COMPLETED', 'DONE', 'PUBLISHED', 'VALIDATED']

/**
 * Build is complete once the dam carries a reservoir level, a crest and a
 * breach that can actually be cut. The study reach is deliberately not in here:
 * `effectiveReachKm` floors it at 5 km, so an untouched slider is still a real
 * domain rather than an unset one.
 */
const buildReady = (b: BuildSnapshot | null): boolean =>
  Boolean(b && b.damId && b.level_m > 0 && b.crest_m > 0 && b.width_m > 0 && b.depth_m > 0)

/** A run that is still going belongs on the Run screen, not Results. */
const runDone = (r: RunSnapshot | null): boolean => {
  if (!r?.runId) return false
  if (!r.state) return true
  return DONE_STATES.includes(r.state.toUpperCase())
}

type GateName = 'build' | 'run' | 'results' | 'compare'

function useGates(): Record<GateName, boolean> {
  const river = useRiverContext((s) => s.river)
  const build = useRiverContext((s) => s.build)
  const run = useRiverContext((s) => s.run)
  const outputs = useRiverContext((s) => s.outputs)
  const haveRiver = Boolean(river?.id && river.damId)
  const haveResults = runDone(run)
  return {
    build: haveRiver,
    run: haveRiver && buildReady(build),
    results: haveResults,
    compare: haveResults && Boolean(outputs?.runId),
  }
}

/** Hard route guard — the backstop behind the greyed-out nav item. */
function RouteGate({ when, to, children }: { when: boolean; to: string; children: ReactNode }) {
  return when ? <>{children}</> : <Navigate to={to} replace />
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
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-5 border-b border-[var(--line)] bg-white px-3">
        <Logo />

        <nav className="flex h-full items-stretch gap-1">
          {NAV.map((n) => {
            const active = navActive(pathname, n.to)
            const enabled = !n.gate || gates[n.gate]
            // Locked: still rendered so the hierarchy is visible, but it is not
            // a link and it says what it is waiting for.
            if (!enabled) {
              return (
                <span
                  key={n.to}
                  title={n.hint}
                  className="flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[12px] text-[var(--faint)] opacity-55"
                >
                  <Icon name={n.icon} size={13} />
                  {n.label}
                </span>
              )
            }
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-1.5 border-b-2 px-2.5 text-[12px] transition-colors ${
                  active
                    ? 'border-[var(--accent)] font-medium text-[var(--accent)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <Icon name={n.icon} size={13} />
                {n.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
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
          <Route path="/watch" element={<Watch />} />
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
          <Route path="*" element={<Watch />} />
        </Routes>
      </main>

      <StatusBar />
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
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
