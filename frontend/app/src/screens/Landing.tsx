import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'

/**
 * Landing page — the portal front door. Full-screen, outside the app shell.
 * "Open the dashboard" enters the app at Watch; the demo buttons open the 3D
 * player on the newest validated run (SPH preferred) — a real run, never a
 * hard-coded id. No login: the portal is open.
 */

const NAVY = '#0d3b66'
const RUST = '#b5500b'
const SERIF = "'Noto Serif', Georgia, 'Times New Roman', serif"
const SANS = "'Noto Sans', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
const LAST_UPDATED = '26 September 2026'
const FONT_STEPS = [14, 16, 18] as const

/** Indian national flag to the official geometry: 3:2, three equal bands,
 *  navy Ashoka Chakra (24 spokes) with diameter ¾ of the white band. */
function IndianFlag({ width = 30 }: { width?: number }) {
  const spokes = Array.from({ length: 24 }, (_, i) => (i * 360) / 24)
  return (
    <svg width={width} height={(width * 2) / 3} viewBox="0 0 900 600" role="img" aria-label="Flag of India">
      <rect width="900" height="200" fill="#FF9933" />
      <rect y="200" width="900" height="200" fill="#FFFFFF" />
      <rect y="400" width="900" height="200" fill="#138808" />
      <g transform="translate(450 300)" fill="#000080" stroke="#000080">
        <circle r="75" fill="none" strokeWidth="6" />
        <circle r="13" stroke="none" />
        {spokes.map((a) => (
          <line key={a} x1="0" y1="0" x2="0" y2="-73" strokeWidth="3" transform={`rotate(${a})`} />
        ))}
        {spokes.map((a) => (
          <circle key={`d${a}`} cy="-71" r="3.2" stroke="none" transform={`rotate(${a + 7.5})`} />
        ))}
      </g>
    </svg>
  )
}

/** NIYANTA logo (team artwork: compass, shield, dam, river). */
function Emblem({ size = 44 }: { size?: number }) {
  return <img src="/niyanta-logo.png" width={size} height={size} alt="NIYANTA logo" className="shrink-0 select-none" draggable={false} />
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[0.8rem] font-medium text-slate-700 shadow-sm">
      {children}
    </span>
  )
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[1rem] font-semibold text-white">{title}</h3>
      <ul className="space-y-2 text-[0.88rem]">{children}</ul>
    </div>
  )
}

function FootLink({ to, children }: { to?: string; children: ReactNode }) {
  // Pages that don't exist yet stay plain text — no dead links.
  return (
    <li>
      {to ? (
        <Link to={to} className="text-sky-100 underline underline-offset-2 hover:text-white">
          {children}
        </Link>
      ) : (
        <span className="text-slate-300">{children}</span>
      )}
    </li>
  )
}

export function Landing() {
  const [fontStep, setFontStep] = useState(1)
  // Accessibility text size (−A / A / A+) scales the landing's rem units.
  useEffect(() => {
    const root = document.documentElement
    const before = root.style.fontSize
    root.style.fontSize = `${FONT_STEPS[fontStep]}px`
    return () => {
      root.style.fontSize = before
    }
  }, [fontStep])

  // Demo = newest validated run, SPH first (particles in the 3D player).
  const runs = useApi(['runs'], () => api.runs())
  const done = (runs.data ?? []).filter((r) => (r.state ?? '').toUpperCase() === 'VALIDATED')
  const byNewest = [...done].sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  const demoRun = byNewest.find((r) => r.engine === 'sph') ?? byNewest[0] ?? null
  const demoTo = demoRun ? `/player/${demoRun.id}` : '/watch'
  const resultsTo = demoRun ? `/results/${demoRun.id}` : '/watch'

  return (
    <div className="h-full overflow-y-auto bg-white" style={{ fontFamily: SANS }}>
      {/* ---- Government bar ---- */}
      <div className="bg-[#1e2433] text-white">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.25)]">
              <IndianFlag width={30} />
            </span>
            <span className="text-[1rem] font-semibold tracking-wide">Government of India</span>
          </div>
          <div className="flex items-center gap-1 text-[0.8rem]">
            {(['-A', 'A', 'A+'] as const).map((lbl, i) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setFontStep(i)}
                aria-pressed={fontStep === i}
                aria-label={['Smaller text', 'Default text size', 'Larger text'][i]}
                className={`rounded px-2 py-1 ${fontStep === i ? 'bg-white/15 font-bold' : 'text-slate-300 hover:text-white'}`}
              >
                {lbl}
              </button>
            ))}
            <span className="mx-2 h-5 w-px bg-white/25" />
            <label className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
              </svg>
              <span className="sr-only">Language</span>
              <select className="rounded-md border border-white/40 bg-transparent px-2 py-1 text-white outline-none" defaultValue="en">
                <option value="en" className="text-slate-900">English</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* ---- Site header ---- */}
      <header className="border-b border-slate-100 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-4 px-4 py-3.5 sm:px-8">
          <Emblem size={76} />
          <div className="leading-tight">
            <div className="flex items-baseline gap-3" style={{ color: NAVY }}>
              <span className="text-[2.1rem] font-bold" style={{ fontFamily: SERIF }}>NIYANTA</span>
              <span className="text-[1.6rem] font-semibold" style={{ fontFamily: "'Noto Serif Devanagari', serif" }}>नियंता</span>
            </div>
            <div className="mt-1 text-[1.05rem] text-slate-500">Dam-Break Flood Decision Support System</div>
          </div>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <main className="bg-gradient-to-b from-[#f4f8fc] via-white to-[#f7fafd]">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-16 pt-12 text-center sm:px-6">
          <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-[0_10px_40px_rgba(13,59,102,0.14)] ring-1 ring-slate-100">
            <Emblem size={128} />
          </div>
          <h1
            className="mt-7 text-[3.6rem] font-bold leading-none tracking-wide sm:text-[4.4rem]"
            style={{ fontFamily: SERIF, color: NAVY, textShadow: '0 6px 24px rgba(13,59,102,0.18)' }}
          >
            NIYANTA
          </h1>
          <p className="mt-4 text-[1.3rem] font-semibold" style={{ color: RUST }}>
            Dam-Break Flood Decision Support System
          </p>
          <p className="mt-3 text-[1.1rem] italic text-slate-800">“Intelligence that guides action.”</p>
          <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-slate-600">
            Predict where a dam-break or lake-burst flood will go, how deep and fast it will be, when it will
            arrive, and who is in its path — before it happens.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/watch"
              className="rounded-md px-6 py-3 text-[0.95rem] font-semibold text-white shadow-[0_6px_18px_rgba(13,59,102,0.28)] transition hover:brightness-110"
              style={{ background: NAVY }}
            >
              Open the dashboard →
            </Link>
            <Link
              to={demoTo}
              className="rounded-md border border-slate-300 bg-white px-6 py-3 text-[0.95rem] font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
            >
              ▶ Watch working demo
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Chip>Smart India Hackathon 2026</Chip>
            <Chip>SIH26161</Chip>
            <Chip>Theme: Disaster Management</Chip>
            <Chip>Category: Software</Chip>
          </div>
        </div>
      </main>

      {/* ---- Footer ---- */}
      <footer className="bg-[#4b5563] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr_1fr_1.3fr]">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white">
                <Emblem size={46} />
              </span>
              <span className="leading-tight">
                <span className="block text-[1.15rem] font-semibold italic underline" style={{ fontFamily: SERIF }}>NIYANTA</span>
                <span className="text-[0.8rem] text-slate-200">Intelligence that guides action</span>
              </span>
            </div>
            <Link
              to={demoTo}
              className="block rounded-full border border-[#e9c46a] px-5 py-2.5 text-center text-[0.82rem] font-semibold tracking-wide text-[#f3d27a] transition hover:bg-white/5"
            >
              WATCH OUR DEMO VIDEOS
            </Link>
            <div className="rounded-full bg-[#9c8f5e] px-5 py-2.5 text-[0.82rem] font-semibold">
              Last Updated: {LAST_UPDATED}
            </div>
          </div>
          <FooterCol title="About NIYANTA">
            <FootLink>About the project</FootLink>
            <FootLink>Our team</FootLink>
            <FootLink>Research paper</FootLink>
          </FooterCol>
          <FooterCol title="Useful Links">
            <FootLink to="/watch">Dashboard</FootLink>
            <FootLink to={resultsTo}>Validation</FootLink>
            <FootLink to={resultsTo}>Reports</FootLink>
            <FootLink to={demoTo}>Demo videos</FootLink>
          </FooterCol>
          <FooterCol title="Help &amp; Support">
            <FootLink>FAQ</FootLink>
            <FootLink>Accessibility</FootLink>
            <FootLink>Privacy Policy</FootLink>
          </FooterCol>
          <div>
            <h3 className="mb-3 text-[1rem] font-semibold">Contact Us</h3>
            <p className="text-[0.88rem] leading-relaxed text-slate-100">
              Team NIYANTA · Smart India Hackathon 2026
              <br />
              Problem Statement SIH26161 · Disaster Management
              <br />
              [Institute name and address]
            </p>
            <p className="mt-2 text-[0.88rem] text-slate-100">Email: [team email]</p>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap justify-between gap-2 border-t border-white/15 py-5 text-[0.78rem] text-slate-200">
            <span>Scenario analysis tool — outputs are not official predictions.</span>
            <span>Built with open data: Copernicus · Sentinel · India-WRIS · OSM</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
