import { useState } from 'react'
import { MapShell } from '../../components/MapShell'
import type { LegendItem, MapFeature } from '../../components/MapShell'
import type { RampStop } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { RampLegend } from '../../components/RampLegend'

/**
 * The main 2D result map. What it paints (run/field/frame/max-view/flood
 * visibility) comes from the map scope — the same context the overlays panel
 * and the filmstrip read and write. Only the overlay *geometry* (built by the
 * orchestrator from context + API data) and the click handler arrive as
 * props. Layer switches live in the map's Layers panel (swatch + label +
 * toggle per row); the depth ramp opens only on click, so map room stays
 * map room.
 */
export function ResultsMapPane({
  scope,
  features,
  fit,
  legend,
  rampStops,
  maxDepth,
  onPick,
}: {
  scope: string
  features: MapFeature[]
  fit: number[] | null
  legend: LegendItem[]
  rampStops: RampStop[] | null
  maxDepth: number | null
  onPick: (lat: number, lon: number) => void
}) {
  const [rampOpen, setRampOpen] = useState(false)

  return (
    <div className="relative h-[70vh] min-h-[480px] shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-xs">
      <MapShell
        scope={scope}
        features={features}
        fit={fit}
        legend={legend}
        showSearch={false}
        onMapClick={onPick}
      />
      <div className="absolute bottom-12 left-3 z-40">
        {rampOpen ? (
          <div className="relative">
            <RampLegend
              title="Water depth (m)"
              note={`Max depth: ${maxDepth != null ? `${num(maxDepth, 1)} m` : EM_DASH} · ramp: frames.json`}
              stops={rampStops}
              width={210}
            />
            <button
              onClick={() => setRampOpen(false)}
              title="Hide depth ramp"
              className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line-strong)] bg-white text-[11px] leading-none text-[var(--muted)] shadow-[var(--shadow)] hover:text-[var(--accent)]"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setRampOpen(true)}
            title="Show water-depth ramp"
            className="rounded border border-[var(--line)] bg-white/95 px-2 py-1 text-[10px] font-semibold text-[var(--muted)] shadow-[var(--shadow)] backdrop-blur-sm hover:text-[var(--accent)]"
          >
            Depth
          </button>
        )}
      </div>
    </div>
  )
}
