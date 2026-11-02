import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { STEPS, TOOLS, useGates, unlocked } from '../lib/flow'
import { useRiverContext } from '../lib/river-context'

/**
 * First stop inside the app: what NIYANTA does and only the next thing to
 * do — continue the study, or start a new one (which clears it and opens
 * step 1). The steps are never listed here; each opens after the one before.
 */
export function Start() {
  const gates = useGates()
  const navigate = useNavigate()
  const river = useRiverContext((s) => s.river)
  const clearStudy = useRiverContext((s) => s.clear)
  const reached = STEPS.filter((s) => unlocked(s, gates)).length
  const resume = STEPS[reached - 1]
  const inProgress = Boolean(river?.id)

  const startNew = () => {
    // clears river, dam, draft and run (mission.ts resets the Build draft with
    // it); finished runs stay saved on the server
    clearStudy()
    navigate(STEPS[0].to)
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-subtle)]">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-[24px] font-semibold">Dam-break flood study</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-[var(--muted)]">
          NIYANTA models what happens downstream if a dam fails: where the water goes, how deep it gets, when it
          arrives and who is in its way. You are guided one step at a time — each step opens when the one before it is
          done.
        </p>

        {inProgress ? (
          <div className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow)]">
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)]">Your study</div>
            <div className="mt-1 text-[17px] font-semibold">
              {river?.name}
              {river?.damName ? ` · ${river.damName}` : ''}
            </div>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              Next: <span className="font-semibold text-[var(--text)]">{resume.label}</span> — {resume.what}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                to={resume.to}
                className="flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[13.5px] font-semibold text-white hover:opacity-90"
              >
                Continue <Icon name="chevronRight" size={14} />
              </Link>
              <button
                onClick={startNew}
                className="flex h-10 items-center rounded-lg border border-[var(--line-strong)] bg-white px-5 text-[13.5px] font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                Start a new study
              </button>
            </div>
            <p className="mt-2.5 text-[11.5px] text-[var(--faint)]">
              Starting a new study clears this selection. Finished simulations stay saved.
            </p>
          </div>
        ) : (
          <button
            onClick={() => navigate(STEPS[0].to)}
            className="mt-6 flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-6 text-[14px] font-semibold text-white hover:opacity-90"
          >
            Start a new study <Icon name="chevronRight" size={14} />
          </button>
        )}

        <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)]">
          Or jump straight in
        </h2>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {TOOLS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="rounded-lg border border-[var(--line)] bg-white p-3.5 hover:border-[var(--accent)]"
            >
              <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Icon name={t.icon} size={13} /> {t.label}
              </div>
              <div className="mt-1 text-[11.5px] leading-snug text-[var(--muted)]">{t.what}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
