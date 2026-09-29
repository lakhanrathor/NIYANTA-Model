import { Icon, Panel } from '../../components/ui'
import { usePlayer } from './PlayerProvider'
import type { CamPreset } from './types'

const PRESETS: { id: CamPreset; label: string; icon: string }[] = [
  { id: 'dam', label: 'Dam site', icon: 'dam' },
  { id: 'valley', label: 'Valley', icon: 'globe' },
  { id: 'top', label: 'Top-down', icon: 'grid' },
  { id: 'drone', label: 'Orbit', icon: 'camera' },
]

/** Left rail — camera presets. Positions only; nothing renders data. */
export function CameraPanel() {
  const { cameraPreset, applyCamera } = usePlayer()
  return (
    <Panel title="Camera">
      <div className="grid grid-cols-2 gap-1.5 p-2.5">
        {PRESETS.map((c) => (
          <button
            key={c.id}
            onClick={() => applyCamera(c.id)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium ${
              cameraPreset === c.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                : 'border-[var(--line-strong)] bg-white text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Icon name={c.icon} size={12} />
            {c.label}
          </button>
        ))}
      </div>
    </Panel>
  )
}
