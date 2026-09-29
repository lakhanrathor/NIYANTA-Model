import { api } from '../../lib/api'
import type { RampStop } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { Check, Panel, Prov, Seg } from '../../components/ui'
import { useRiverContext } from '../../lib/river-context'
import { usePlayer } from './PlayerProvider'
import { LAYER_IDS } from './types'
import type { WaterColorMode } from '../PlayerScene'

/** Left rail — 3D shells, water colouring + live legend. Visibility is mission
 *  state (`view.hiddenLayers`), shared with every screen and persisted. */
export function LayersPanel() {
  const {
    runId,
    damView, water, terrainDoc,
    colorMode, setColorMode, ramps, overlayStates, villages, villagesDoc,
    hiddenLayers, toggleLayer,
  } = usePlayer()
  const visible = (id: string) => !hiddenLayers.includes(id)
  // same query key as the Viewport — one request, shared cache
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId!), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })
  const cascadeCount = useRiverContext((s) =>
    s.cascade?.runId === runId
      ? s.cascade.dams.filter((d) => d.status === 'overtopped' || d.status === 'exposed').length
      : null,
  )

  const modeRamp = colorMode === 'depth' ? ramps.depth : colorMode === 'arrival' ? ramps.arrival : ramps.velocity
  const modeHint =
    colorMode === 'depth'
      ? water?.status === 'no-tiles'
        ? 'no depth tiles'
        : undefined
      : overlayStates[colorMode] === 'loading'
        ? 'loading overlay…'
        : overlayStates[colorMode] === 'no-tiles'
          ? `no ${colorMode} tiles`
          : overlayStates[colorMode] === 'no-ramp'
            ? `no ${colorMode} ramp`
            : undefined

  return (
    <Panel title="Layers 3D">
      <div className="py-1">
        <Check
          checked={visible(LAYER_IDS.terrain)}
          onChange={() => toggleLayer(LAYER_IDS.terrain)}
          label="Terrain & satellite"
          swatch="#9fb3a8"
          hint={terrainDoc.offline ? 'DEM offline' : terrainDoc.data?.detail === 'full' ? 'full-res DEM' : undefined}
        />
        <Check
          checked={visible(LAYER_IDS.dam)}
          onChange={() => toggleLayer(LAYER_IDS.dam)}
          label="Dam structure"
          swatch="#b42318"
          disabled={!damView}
          hint={!damView ? 'no dam position' : undefined}
        />
        <Check
          checked={visible(LAYER_IDS.water)}
          onChange={() => toggleLayer(LAYER_IDS.water)}
          label="Inundation water"
          swatch="#0284c7"
          hint={colorMode === 'depth' && water?.status === 'no-tiles' ? 'no depth tiles' : undefined}
        />
        <Check
          checked={visible(LAYER_IDS.villages)}
          onChange={() => toggleLayer(LAYER_IDS.villages)}
          label="Affected villages"
          swatch="#b42318"
          hint={
            villagesDoc.offline
              ? 'source offline'
              : villages.length
                ? `${villages.length} in extent`
                : 'none in extent'
          }
        />
        <Check
          checked={visible(LAYER_IDS.cascade)}
          onChange={() => toggleLayer(LAYER_IDS.cascade)}
          label="Cascade dams"
          swatch="#dd6b20"
          hint={cascadeCount == null ? 'not screened' : cascadeCount ? `${cascadeCount} wet` : 'none wet'}
        />
        <Check
          checked={visible(LAYER_IDS.infra)}
          onChange={() => toggleLayer(LAYER_IDS.infra)}
          label="Roads & buildings (OSM)"
          swatch="#c2410c"
          hint={
            infra.data
              ? `${infra.data.summary.buildings_flooded}/${infra.data.summary.buildings} flooded`
              : infra.offline ? 'not loaded' : '…'
          }
        />
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          Water colour
        </p>
        <Seg
          size="sm"
          options={[
            { value: 'depth', label: 'Depth' },
            { value: 'arrival', label: 'Arrival' },
            { value: 'velocity', label: 'Peak vel.' },
          ]}
          value={colorMode}
          onChange={(v) => setColorMode(v as WaterColorMode)}
        />
        {modeHint && <p className="num mt-1 text-[10px] text-[var(--warn)]">{modeHint}</p>}
        <RampLegend stops={modeRamp} unit={colorMode === 'depth' ? 'm' : colorMode === 'arrival' ? 'h' : 'm/s'} />
      </div>

      {damView?.height_m == null && damView && (
        <Prov>Dam pin marks the registry position — wall needs a recorded height.</Prov>
      )}
      {damView?.height_m != null && damView?.crest_length_m == null && (
        <Prov>Dam wall length is schematic — the registry has a height but no crest length.</Prov>
      )}
    </Panel>
  )
}

/** Gradient strip sampled from the server's own ramp stops. */
function RampLegend({ stops, unit }: { stops: RampStop[] | null; unit: string }) {
  if (!stops?.length) return <p className="num mt-1 text-[10px] text-[var(--faint)]">no ramp published</p>
  const sorted = [...stops].sort((a, b) => a.v - b.v)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return (
    <div className="mt-1.5">
      <div
        className="h-2 w-full rounded-sm border border-[var(--line)]"
        style={{ background: `linear-gradient(90deg, ${sorted.map((s) => s.color).join(',')})` }}
      />
      <div className="num mt-0.5 flex justify-between text-[9.5px] text-[var(--faint)]">
        <span>
          {first.label} {unit}
        </span>
        <span>
          {last.label} {unit}
        </span>
      </div>
    </div>
  )
}
