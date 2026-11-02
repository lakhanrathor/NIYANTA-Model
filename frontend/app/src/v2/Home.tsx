import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { unlocked, useGates } from '../lib/flow'
import { useRiverContext } from '../lib/river-context'
import { useBuildConfig } from '../screens/build/config'
import { V2_STEPS, V2_TOOLS } from './steps'
import { Badge, Button } from './ui'

/**
 * v2 home: what NIYANTA does and only the next thing to do — continue the
 * study where it stands, or start a new one. The steps themselves are never
 * listed; each appears when the one before it is complete.
 */
export function V2Home() {
  const gates = useGates()
  const navigate = useNavigate()
  const river = useRiverContext((s) => s.river)
  const clearStudy = useRiverContext((s) => s.clear)
  const resetBuild = useBuildConfig((s) => s.reset)
  const reached = V2_STEPS.filter((s) => unlocked(s, gates)).length
  const resume = V2_STEPS[reached - 1]
  const inProgress = Boolean(river?.id)

  const startNew = () => {
    // finished runs stay saved on the server; only the current selection resets
    clearStudy()
    resetBuild()
    navigate(V2_STEPS[0].to)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-12">
        <Badge tone="accent">SIH26161 · Dam-break decision support</Badge>
        <h1 className="mt-3 max-w-3xl text-[34px] font-bold leading-[1.15] tracking-tight">
          See where the water goes if a dam fails — before it happens.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
          Pick a river and its dam, describe the failure, and NIYANTA models the flood downstream: how deep, how fast,
          when it arrives and who is in its way. We guide you one step at a time.
        </p>

        {inProgress ? (
          <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6 shadow-[var(--shadow)]">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)]">Your study</div>
            <div className="mt-1.5 text-[18px] font-semibold">
              {river?.name}
              {river?.damName ? ` · ${river.damName}` : ''}
            </div>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              Next: <span className="font-semibold text-[var(--text)]">{resume.label}</span> — {resume.what}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => navigate(resume.to)}>
                Continue <Icon name="chevronRight" size={15} />
              </Button>
              <Button variant="secondary" size="lg" onClick={startNew}>
                Start a new study
              </Button>
            </div>
            <p className="mt-3 text-[11.5px] text-[var(--faint)]">
              Starting a new study clears this selection. Finished simulations stay saved.
            </p>
          </div>
        ) : (
          <div className="mt-8">
            <Button variant="primary" size="lg" onClick={() => navigate(V2_STEPS[0].to)}>
              Start a new study <Icon name="chevronRight" size={15} />
            </Button>
          </div>
        )}

        <h2 className="mt-14 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)]">
          Or jump straight in
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {V2_TOOLS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow)] hover:border-[var(--accent)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon name={t.icon} size={16} />
              </span>
              <div className="mt-3 text-[14px] font-semibold text-[var(--text)]">{t.label}</div>
              <div className="mt-1 text-[12.5px] leading-snug text-[var(--muted)]">{t.what}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
