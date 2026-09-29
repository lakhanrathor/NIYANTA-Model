import { EM_DASH, cms, km, m, num } from '../../lib/format'
import { Metric, Panel, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Right rail — playhead-linked totals + hazard-class split from /series. */
export function LiveStatsPanel() {
  const { hydro, impact, series, clamped, frameCount } = usePlayer()
  const areaAtFrame = series.data?.area_km2?.total?.[clamped] ?? null
  const reachAtFrame = series.data?.reach_km?.[clamped] ?? null
  const bands = series.data?.bands_m ?? null
  const low = series.data?.area_km2?.low?.[clamped] ?? null
  const moderate = series.data?.area_km2?.moderate?.[clamped] ?? null
  const high = series.data?.area_km2?.high?.[clamped] ?? null

  return (
    <Panel title="Live statistics">
      <div className="grid grid-cols-2 gap-1.5 p-2.5">
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
          <span className="block text-[10px] text-[var(--muted)]">Peak discharge</span>
          <span className="num text-[13px] font-semibold text-[var(--accent)]">{cms(hydro.data?.peak_cms)}</span>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
          <span className="block text-[10px] text-[var(--muted)]">Max depth</span>
          <span className="num text-[13px] font-semibold text-[var(--accent)]">{m(impact.data?.peak_depth_m, 2)}</span>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
          <span className="block text-[10px] text-[var(--muted)]">Area @ frame {frameCount ? clamped + 1 : EM_DASH}</span>
          <span className="num text-[13px] font-semibold text-[var(--accent)]">
            {areaAtFrame != null ? `${num(areaAtFrame, 1)} km²` : EM_DASH}
          </span>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-2">
          <span className="block text-[10px] text-[var(--muted)]">Water released</span>
          <span className="num text-[13px] font-semibold text-[var(--accent)]">
            {hydro.data?.released_hm3 != null ? `${num(hydro.data.released_hm3, 1)} hm³` : EM_DASH}
          </span>
        </div>
      </div>
      <Metric label="Flood reach @ frame" value={reachAtFrame != null ? km(reachAtFrame, 1) : EM_DASH} />
      <Metric
        label={bands?.[0] != null ? `Low <${num(bands[0], 1)} m` : 'Low hazard @ frame'}
        value={low != null ? `${num(low, 1)} km²` : EM_DASH}
      />
      <Metric
        label={bands ? `Moderate ${num(bands[0], 1)}–${num(bands[1], 1)} m` : 'Moderate @ frame'}
        value={moderate != null ? `${num(moderate, 1)} km²` : EM_DASH}
      />
      <Metric
        label={bands?.[1] != null ? `High >${num(bands[1], 1)} m` : 'High hazard @ frame'}
        value={high != null ? `${num(high, 1)} km²` : EM_DASH}
      />
      <Prov>
        Peak + released from <span className="num">/hydrograph</span> · depth from <span className="num">/impact</span> · area + reach + classes from <span className="num">/series</span> at the playhead frame
      </Prov>
    </Panel>
  )
}
