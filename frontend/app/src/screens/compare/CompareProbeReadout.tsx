import type { Frame } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { useRiverContext } from '../../lib/river-context'

export type ProbeSide = { pending: boolean; depth: number | null }

/**
 * Live spatial comparison overlay: coordinates come from the shared map
 * cursor, depths from the raster-probe endpoint both runs, and the frame
 * label from the pane scope — the same context the panes and filmstrip read.
 * Delta only renders when both sides returned a real depth.
 */
export function CompareProbeReadout({
  scope,
  thumbs,
  cursor,
  shortA,
  shortB,
  a,
  b,
}: {
  scope: string
  thumbs: Frame[]
  cursor: { lat: number; lon: number } | null
  shortA: string
  shortB: string
  a: ProbeSide
  b: ProbeSide
}) {
  const frame = useRiverContext((s) => s.mapIntents[scope]?.frame ?? 0)
  const probed = useRiverContext((s) => s.mapIntents[scope]?.probe != null)
  const tLabel = thumbs[frame]?.t_label ?? EM_DASH
  const delta = a.depth != null && b.depth != null ? b.depth - a.depth : null
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-40 w-[240px] rounded-lg border border-[var(--line)] bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm text-[11px]">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-1 mb-1 font-semibold text-[var(--accent)]">
        <span>Live Spatial Comparison</span>
        <span className="font-mono text-[9px] text-[var(--muted)]">{tLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
        <span className="text-[var(--muted)]">Coordinate:</span>
        <span className="font-mono text-right font-medium text-[var(--foreground)]">
          {cursor ? `${cursor.lat.toFixed(4)}°N, ${cursor.lon.toFixed(4)}°E` : 'Hover map'}
        </span>
        <span className="text-[#0b6bcb] font-medium">{shortA} (A) Depth:</span>
        <span className="font-mono text-right font-semibold text-[#0b6bcb]">
          {!probed ? EM_DASH : a.pending ? '…' : a.depth != null ? `${num(a.depth, 2)} m` : EM_DASH}
        </span>
        <span className="text-[#b42318] font-medium">{shortB} (B) Depth:</span>
        <span className="font-mono text-right font-semibold text-[#b42318]">
          {!probed ? EM_DASH : b.pending ? '…' : b.depth != null ? `${num(b.depth, 2)} m` : EM_DASH}
        </span>
        <span className="text-[var(--muted)] font-medium">Delta (B − A):</span>
        <span className="font-mono text-right font-semibold text-[var(--ok)]">
          {delta != null ? `${delta >= 0 ? '+' : ''}${num(delta, 2)} m` : EM_DASH}
        </span>
        <span className="text-[var(--muted)] col-span-2 text-[9px]">
          {probed ? 'Click elsewhere to move the probe' : 'Click the map to inspect a cell'}
        </span>
      </div>
    </div>
  )
}
