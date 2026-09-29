import { Panel, Prov, Slider } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Left rail — display-only relief/water scaling. Readouts stay true metres. */
export function SceneControlsPanel() {
  const { terrainExag, setTerrainExag, waterExag, setWaterExag, waterOpacity, setWaterOpacity } = usePlayer()
  return (
    <Panel title="Scene controls">
      <Slider
        label="Terrain exaggeration"
        value={terrainExag}
        min={1}
        max={4}
        step={0.1}
        onChange={setTerrainExag}
        display={`${terrainExag.toFixed(1)}×`}
      />
      <Slider
        label="Water depth exaggeration"
        value={waterExag}
        min={1}
        max={50}
        step={1}
        onChange={setWaterExag}
        display={`${waterExag.toFixed(0)}× display`}
      />
      <Slider
        label="Water opacity"
        value={Math.round(waterOpacity * 100)}
        min={30}
        max={100}
        step={1}
        onChange={(v) => setWaterOpacity(v / 100)}
        display={`${Math.round(waterOpacity * 100)}%`}
      />
      <Prov>Exaggeration changes the display only — every readout stays in true metres.</Prov>
    </Panel>
  )
}
