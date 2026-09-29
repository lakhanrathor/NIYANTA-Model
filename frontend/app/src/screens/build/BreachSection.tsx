import { useEffect } from 'react'
import { Field, Head, Panel, Pill } from '../../components/ui'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { METHODS, caseMode, useBuildConfig } from './config'
import { BreachDiagram } from './BreachDiagram'

const METHOD_LABEL: Record<string, string> = {
  froehlich2008: 'Froehlich 2008',
  froehlich1995: 'Froehlich 1995',
  macdonald: 'MacDonald',
  vonthun: 'von Thun',
  xuzhang: 'Xu-Zhang',
  manual: 'Manual geometry',
}

/** Step 3 — breach equation, geometry and the live cross-section. */
export function BreachSection() {
  const s = useBuildConfig()
  const seedBreach = useBuildConfig((st) => st.seedBreach)
  const methods = useApi(['breach-methods'], api.breachMethods, { staleTime: Infinity })
  // The method's breach for THIS dam's height/storage/levels. The HEC-RAS
  // worked example is a different dam — seeding from it produced widths wider
  // than this crest (422 on Start). No height/storage → nothing is seeded.
  const q = {
    height_m: s.height_m,
    storage_mcm: s.storage_mcm,
    level_m: s.level_m,
    bed_m: s.bed_m,
    crest_length_m: s.crest_length_m,
    dam_type: s.damType,
    mode: caseMode(s.case),
  }
  const canEstimate = s.method !== 'manual' && q.height_m > 0 && q.storage_mcm > 0
  const fixture = useApi(
    ['breach-estimate', s.method, ...Object.values(q)],
    () => api.breachEstimate(s.method, q),
    { enabled: canEstimate, staleTime: Infinity },
  )

  // Seeds once per method; edits after that survive (seedBreach is idempotent).
  useEffect(() => {
    if (fixture.data) seedBreach(fixture.data)
  }, [fixture.data, seedBreach])

  // A width wider than the recorded crest can never pass validation (a draft
  // seeded before this fix carries one) — re-seed it from this dam's estimate.
  useEffect(() => {
    if (s.crest_length_m > 0 && s.width_m > s.crest_length_m && s.seededMethod)
      s.patch({ seededMethod: null })
  }, [s.crest_length_m, s.width_m, s.seededMethod]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Panel
      title="Breach"
      actions={s.case === '3' ? <Pill tone="warn">instant · T+0</Pill> : undefined}
    >
      <Head
        right={
          !canEstimate
            ? s.method === 'manual' ? 'manual' : 'needs dam height + storage'
            : fixture.data?.fixture ?? (fixture.pending ? 'estimating…' : undefined)
        }
      >
        Method
      </Head>
      <div className="flex items-center gap-2 px-3 py-[5px] text-[11px]">
        <span className="flex-1 text-[var(--muted)]">Equation</span>
        <select
          value={s.method}
          onChange={(e) => s.patch({ method: e.target.value, seededMethod: null })}
          className="h-6 rounded border border-[var(--line-strong)] bg-white px-1.5 text-[11px] outline-none focus:border-[var(--accent)]"
        >
          {(methods.data?.methods ?? [...METHODS]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <Field label="Breach width" value={String(Math.round(s.width_m * 10) / 10)} suffix="m" step={1} onChange={(v) => s.patch({ width_m: Number(v) || 0 })} />
      <Field label="Breach depth" value={String(Math.round(s.depth_m * 10) / 10)} suffix="m" step={0.5} onChange={(v) => s.patch({ depth_m: Number(v) || 0 })} />
      <Field label="Formation time" value={String(Math.round(s.formation_hr * 10) / 10)} suffix="hr" step={0.5} onChange={(v) => s.patch({ formation_hr: Number(v) || 0 })} />
      <Field label="Side slope (H:V)" value={String(Math.round(s.side_slope * 10) / 10)} suffix=":1" step={0.1} onChange={(v) => s.patch({ side_slope: Number(v) || 0 })} />
      <Field label="Chainage" value={String(Math.round(s.chainage_m * 10) / 10)} suffix="m" step={10} onChange={(v) => s.patch({ chainage_m: Number(v) || 0 })} />
      <Head>Cross-section</Head>
      <BreachDiagram widthM={s.width_m} depthM={s.depth_m} sideSlope={s.side_slope} />
    </Panel>
  )
}
