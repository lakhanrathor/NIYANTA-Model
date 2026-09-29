import { Panel } from '../../components/ui'

const MODE_TILES = [
  { value: 'swipe', label: 'Swipe' },
  { value: 'side', label: 'Side by Side' },
  { value: 'diff', label: 'Difference' },
]

/** The on-screen comparison layout — Compare sends it to `GET /api/comparisons`. */
export function CompareModePanel({
  mode,
  onChange,
}: {
  mode: string
  onChange: (mode: string) => void
}) {
  return (
    <Panel title="Comparison Mode">
      <div className="grid grid-cols-3 gap-1.5 px-3 py-2">
        {MODE_TILES.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={`rounded border px-1 py-2 text-[11px] ${
              mode === t.value
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                : 'border-[var(--line-strong)] bg-white text-[var(--muted)] hover:border-[var(--accent)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </Panel>
  )
}
