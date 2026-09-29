import { useNavigate } from 'react-router-dom'
import { Icon, Panel } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Left rail — 2D Results vs 3D Player switch. */
export function ViewModePanel() {
  const { runId } = usePlayer()
  const navigate = useNavigate()
  return (
    <Panel title="View mode">
      <div className="grid grid-cols-2 gap-1.5 p-2.5">
        <button
          onClick={() => runId && navigate(`/results/${runId}`)}
          disabled={!runId}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-white px-2 py-2 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          <Icon name="chart" size={13} />
          2D Results
        </button>
        <button className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-2 text-[11px] font-semibold text-[var(--accent)]">
          <Icon name="camera" size={13} />
          3D Player
        </button>
      </div>
    </Panel>
  )
}
