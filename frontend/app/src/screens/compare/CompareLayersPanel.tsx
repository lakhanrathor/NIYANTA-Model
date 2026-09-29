import { COMPARE_FIELDS } from '../../components/flood/rasterFields'
import { Check, Panel } from '../../components/ui'
import { useRiverContext } from '../../lib/river-context'
import { useMapScopes } from '../../lib/useMapScope'
import { COMPARE_OVERLAYS } from './overlays'

/**
 * Replaces the old static checkbox list: the raster field and the flood-area
 * switch live in the map scopes (same truth both panes and the filmstrip
 * read — one write fans out to every scope passed in), and overlay visibility
 * toggles the global hidden-layer set so all maps on screen agree.
 */
export function CompareLayersPanel({ scopes }: { scopes: string[] }) {
  const hidden = useRiverContext((s) => s.view.hiddenLayers)
  const toggleLayer = useRiverContext((s) => s.toggleLayer)
  const { intent, publishAll } = useMapScopes(scopes)
  const field = intent?.field ?? 'depth'
  const floodOn = intent?.floodVisible ?? true

  return (
    <Panel title="Layers to Compare">
      <div className="px-3 py-2">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Raster field
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {COMPARE_FIELDS.map((f) => (
            <button
              key={f.value}
              onClick={() => publishAll({ field: f.value })}
              title={`Tiles: /tiles/{run}/${f.value}/… · unit ${f.unit}`}
              className={`rounded border px-1.5 py-1.5 text-left text-[11px] ${
                field === f.value
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'border-[var(--line-strong)] bg-white text-[var(--muted)] hover:border-[var(--accent)]'
              }`}
            >
              {f.label}
              <span className="ml-1 text-[9px] text-[var(--faint)]">{f.unit}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pb-1">
        <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Overlays
        </p>
        <Check
          checked={floodOn}
          onChange={() => publishAll({ floodVisible: !floodOn })}
          label="Flood affected area"
          hint="The raster layer itself"
        />
        {COMPARE_OVERLAYS.map((o) => (
          <Check
            key={o.id}
            checked={!hidden.includes(o.id)}
            onChange={() => toggleLayer(o.id)}
            label={o.label}
          />
        ))}
      </div>
    </Panel>
  )
}
