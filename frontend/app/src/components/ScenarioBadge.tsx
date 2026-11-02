import type { ScenarioLabel } from '../lib/api'

/** Spec §29: what kind of scenario a result comes from. Same badge everywhere
 *  (Scenario Lab, Results, Player) so a viewer can't mistake a what-if for an
 *  observation. */
export const LABEL_META: Record<ScenarioLabel, { text: string; cls: string; meaning: string }> = {
  observed: {
    text: 'OBSERVED',
    cls: 'border-[#a6e0cb] bg-[#e7f6f0] text-[#12805c]',
    meaning: 'Actual observations from authoritative sources',
  },
  reconstruction: {
    text: 'RECONSTRUCTION',
    cls: 'border-[#b9d7f4] bg-[#e8f1fb] text-[#0b6bcb]',
    meaning: 'A past event modelled from reconstructed inputs',
  },
  hypothetical: {
    text: 'HYPOTHETICAL',
    cls: 'border-[#f0d2a8] bg-[#fdf3e6] text-[#b25e09]',
    meaning: 'A what-if scenario — not a forecast of a real event',
  },
  demo: {
    text: 'DEMO',
    cls: 'border-[#d9c8f5] bg-[#f4effd] text-[#6b3fc4]',
    meaning: 'A prepared dataset for demonstrating the software',
  },
}

export function ScenarioBadge({ label, set = true }: { label: ScenarioLabel | null | undefined; set?: boolean }) {
  const meta = LABEL_META[label ?? 'hypothetical']
  return (
    <span
      title={`${meta.meaning}${set ? '' : ' (default — no label chosen yet)'}`}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-[0.06em] ${meta.cls}`}
    >
      {meta.text}
    </span>
  )
}
