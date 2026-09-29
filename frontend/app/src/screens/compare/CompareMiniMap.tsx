import { MapShell } from '../../components/MapShell'
import type { MapFeature } from '../../components/MapShell'

export type MiniRaster = { run: string; kind: string; vs?: string; frame?: number | null }

/**
 * Small secondary pane (extent / arrival) reusing the same shared overlays as
 * the main viewport. No search, never the primary map.
 */
export function CompareMiniMap({
  features,
  fit,
  raster,
  height = 168,
}: {
  features: MapFeature[]
  fit: number[] | null
  raster: MiniRaster | null
  height?: number
}) {
  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-0">
        <MapShell
          features={features}
          fit={fit}
          raster={raster}
          showSearch={false}
          primary={false}
          shared={false}
        />
      </div>
    </div>
  )
}
