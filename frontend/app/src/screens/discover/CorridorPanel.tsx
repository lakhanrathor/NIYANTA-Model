import { Empty, LinkBtn, Panel, Prov, Slider } from '../../components/ui'
import { EM_DASH, num } from '../../lib/format'
import { useRiverContext } from '../../lib/river-context'

interface CorridorPanelProps {
  riverName: string | null
  bufferKm: number
  overridden: boolean
  areaKm2: number | null
  pending: boolean
  damsIn: number
  damsTotal: number
}

/**
 * The corridor width the dams, the coverage and the downloads are all measured
 * against. Moving the slider publishes straight into the mission context, so
 * the dam list, the polygon and the coverage re-query by subscription — the
 * page passes nothing anywhere.
 */
export function CorridorPanel({
  riverName,
  bufferKm,
  overridden,
  areaKm2,
  pending,
  damsIn,
  damsTotal,
}: CorridorPanelProps) {
  const setBufferKm = useRiverContext((s) => s.setBufferKm)
  const patchRiver = useRiverContext((s) => s.patch)

  if (!riverName) {
    return (
      <Panel title="River Corridor">
        <Empty>Select a river to size its corridor</Empty>
        <Prov>The dashed band of land within ±N km of the river path</Prov>
      </Panel>
    )
  }

  return (
    <Panel
      title="River Corridor"
      actions={
        overridden ? (
          <LinkBtn onClick={() => patchRiver({ bufferKm: null })}>Auto</LinkBtn>
        ) : undefined
      }
    >
      <Slider
        label="Buffer width"
        value={Math.min(300, bufferKm)}
        min={1}
        max={300}
        step={1}
        onChange={(v) => setBufferKm(v)}
        display={`${num(bufferKm, 0)} km${overridden ? '' : ' · auto'}`}
      />
      <div className="grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)]">
        <div className="bg-white px-3 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">
            Area
          </p>
          <p className="num text-[12px] font-medium">
            {pending && areaKm2 === null
              ? '…'
              : areaKm2 !== null
                ? `${num(areaKm2, 0)} km²`
                : EM_DASH}
          </p>
        </div>
        <div className="bg-white px-3 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">
            Dams in corridor
          </p>
          <p className="num text-[12px] font-medium">
            {damsTotal ? `${num(damsIn)} of ${num(damsTotal)}` : EM_DASH}
          </p>
        </div>
      </div>
      <Prov>A dam counts as in-corridor only inside this band — it is what the DEM covers</Prov>
    </Panel>
  )
}
