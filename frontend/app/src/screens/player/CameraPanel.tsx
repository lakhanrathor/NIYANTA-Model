import { Icon, Panel } from '../../components/ui'
import { usePlayer } from './PlayerProvider'
import type { CamPreset } from './types'

/** Spec §17 presets. Downstream / Infrastructure / Impact aim at the run's own
 *  data (flood front, flooded OSM features, what is under water now). */
const PRESETS: { id: CamPreset; label: string; icon: string; title: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'globe', title: 'The whole valley' },
  { id: 'breach', label: 'Breach', icon: 'dam', title: 'The dam and the start of the flood wave' },
  { id: 'downstream', label: 'Downstream', icon: 'river', title: 'The flood front at this frame' },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'grid', title: 'Roads, buildings and bridges this run floods' },
  { id: 'impact', label: 'Impact', icon: 'pin', title: 'What is under water right now' },
  { id: 'top', label: 'Top-down', icon: 'layers', title: 'Straight down over the domain' },
]

/** Left rail — camera presets. Positions only; nothing renders data. */
export function CameraPanel() {
  const { cameraPreset, applyCamera, cameraNote } = usePlayer()
  return (
    <Panel title="Camera">
      <div className="grid grid-cols-2 gap-1.5 p-2.5">
        {PRESETS.map((c) => (
          <button
            key={c.id}
            title={c.title}
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
      {cameraNote && <p className="px-2.5 pb-2.5 text-[10.5px] leading-snug text-[var(--warn)]">{cameraNote}</p>}
    </Panel>
  )
}
