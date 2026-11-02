import { Link, Route, Routes } from 'react-router-dom'
import { STEPS } from '../lib/flow'
import { V2Home } from './Home'
import { V2Shell, Wizard } from './Shell'
import { RiverStep } from './river/RiverStep'
import { Card } from './ui'

/** /v2/* — the new guided frontend, built side by side with the classic one. */
export function V2App() {
  return (
    <V2Shell>
      <Routes>
        <Route index element={<V2Home />} />
        <Route path="river" element={<RiverStep />} />
        {[1, 2, 3, 4, 5].map((i) => (
          <Route key={i} path={`${['', 'scenario', 'run', 'results', 'replay', 'compare'][i]}/*`} element={<NotYet step={i} />} />
        ))}
        <Route path="*" element={<V2Home />} />
      </Routes>
    </V2Shell>
  )
}

/** Steps whose v2 screen is still being built hand over to the classic one. */
function NotYet({ step }: { step: number }) {
  return (
    <Wizard step={step}>
      <div className="mx-auto max-w-xl pt-6">
        <Card title="This step is being rebuilt" subtitle="Its new screen is coming in the next part of the redesign.">
          <p className="text-[13px] text-[var(--muted)]">
            You can do this step on the current screen now — your river, dam and settings carry over.
          </p>
          <Link
            to={STEPS[step].to}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
          >
            Open “{STEPS[step].label}” on the current screen
          </Link>
        </Card>
      </div>
    </Wizard>
  )
}
