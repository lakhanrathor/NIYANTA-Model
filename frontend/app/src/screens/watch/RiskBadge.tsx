import { EM_DASH } from '../../lib/format'
import { Pill } from '../../components/ui'

/** One-line risk verdict. Unknown levels render muted — never upgraded. */
export function RiskBadge({
  level,
  score,
}: {
  level?: string | null
  score?: number | null
}) {
  const key = (level ?? '').toUpperCase()
  if (!key)
    return (
      <Pill tone="muted">{score != null ? `risk ${score}` : `risk ${EM_DASH}`}</Pill>
    )
  const tone =
    key === 'CRITICAL' || key === 'SEVERE' || key === 'HIGH'
      ? 'bad'
      : key === 'MODERATE' || key === 'WARNING' || key === 'ELEVATED'
        ? 'warn'
        : key === 'LOW' || key === 'MINOR' || key === 'INFO'
          ? 'ok'
          : 'muted'
  return (
    <Pill tone={tone}>
      {level}
      {score != null ? ` · ${score}` : ''}
    </Pill>
  )
}
