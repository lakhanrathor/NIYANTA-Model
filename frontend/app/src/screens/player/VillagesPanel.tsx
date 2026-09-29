import { EM_DASH, clock, m, num } from '../../lib/format'
import { Empty, Metric, Panel, Pill, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

function hazardTone(hazard: string): 'ok' | 'warn' | 'bad' | 'muted' {
  if (hazard === 'HIGH') return 'bad'
  if (hazard === 'MODERATE') return 'warn'
  if (hazard === 'LOW') return 'ok'
  return 'muted'
}

/**
 * Right rail — affected villages from hazard-villages (stage.impact product).
 * Rows select the 3D pin; pins select back. Empty when no village lies inside
 * the modelled extent — that is a real zero, not missing data.
 */
export function VillagesPanel() {
  const { runId, villagesDoc, villages, selectedVillage, setSelectedVillage, sceneRef } = usePlayer()

  const focus = (lon: number, lat: number) => sceneRef.current?.focusAt(lon, lat)

  return (
    <Panel
      title="Villages"
      actions={
        villages.length ? (
          <span className="num text-[10px] text-[var(--muted)]">{villages.length} in extent</span>
        ) : undefined
      }
    >
      {villagesDoc.pending && !villagesDoc.data && (
        <p className="px-3 py-2 text-[11px] text-[var(--faint)]">Loading villages…</p>
      )}
      {!villagesDoc.pending && !villages.length && (
        <Empty>
          {villagesDoc.offline ? (
            <>
              Village source offline — <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/hazard-villages</span>
            </>
          ) : (
            'No villages inside this run\u2019s modelled extent.'
          )}
        </Empty>
      )}
      {selectedVillage && (
        <div className="border-b border-[var(--line)] bg-[var(--bg)]">
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="truncate text-[12px] font-semibold">{selectedVillage.name}</span>
            <Pill tone={hazardTone(selectedVillage.hazard)}>{selectedVillage.hazard || '—'}</Pill>
          </div>
          <Metric label="Modelled depth" value={selectedVillage.depth_m != null ? m(selectedVillage.depth_m, 2) : EM_DASH} />
          <Metric
            label="Arrival"
            value={selectedVillage.arrival_hr != null ? clock(selectedVillage.arrival_hr * 3600) : EM_DASH}
          />
          <Metric
            label="Population"
            value={selectedVillage.population != null ? `${num(selectedVillage.population, 0)} people` : EM_DASH}
          />
        </div>
      )}
      {villages.length > 0 && (
        <ul className="py-1">
          {villages.map((v) => (
            <li key={`${v.name}-${v.lon.toFixed(4)}-${v.lat.toFixed(4)}`}>
              <button
                onClick={() => {
                  setSelectedVillage(v)
                  focus(v.lon, v.lat)
                }}
                className={`flex w-full items-center gap-2 px-3 py-[5px] text-left text-[12px] hover:bg-[var(--bg)] ${
                  selectedVillage?.name === v.name ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
                <Pill tone={hazardTone(v.hazard)}>{v.hazard || '—'}</Pill>
                <span className="num shrink-0 text-[11px] text-[var(--muted)]">
                  {v.depth_m != null ? m(v.depth_m, 1) : EM_DASH}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Prov>
        Pins + values from <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}/hazard-villages</span> ·
        click a row or a 3D pin
      </Prov>
    </Panel>
  )
}
