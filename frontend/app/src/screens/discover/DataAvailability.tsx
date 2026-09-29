import { EChart } from '../../components/Charts'
import { Empty, Panel, Prov } from '../../components/ui'
import { api } from '../../lib/api'
import { EM_DASH, num, pct, rampColor } from '../../lib/format'
import { useApi } from '../../lib/useApi'

const AVAIL_ROWS: { key: string; label: string; color: string; optional?: boolean }[] = [
  { key: 'dem', label: 'DEM (30m)', color: '#1f6fb2' },
  { key: 'worldpop', label: 'WorldPop (Population)', color: '#b25e09', optional: true },
  { key: 'dam_registry', label: 'Dam Registry', color: '#5b2a86' },
]

// The donut grades the corridor's own data. WorldPop is a multi-GB optional
// extra — letting its 0% drag the headline number to 33% misrepresents a
// corridor that is perfectly ready to simulate.
const REQUIRED_KEYS = AVAIL_ROWS.filter((r) => !r.optional).map((r) => r.key)

export function DataAvailability({ riverId, bufferKm }: { riverId: string | null; bufferKm: number }) {
  const avail = useApi(
    ['river-avail', riverId, bufferKm],
    () => api.riverAvailability(riverId!, bufferKm),
    { enabled: Boolean(riverId), staleTime: 60_000, keepPrevious: true },
  )
  const stale = avail.data?.stale ?? false
  // Backend coverage_pct spans every kind it recorded (incl. OSM/imagery we no
  // longer prepare) — the donut must average only the required kinds it shows.
  const coverage = avail.data
    ? Math.round(
        REQUIRED_KEYS.reduce((sum, k) => sum + (avail.data?.[k as 'dem']?.pct ?? 0), 0) /
          REQUIRED_KEYS.length,
      )
    : 0

  return (
    <Panel title="Data Availability (Along Corridor)">
      {avail.offline || !avail.data ? (
        <>
          <Empty>
            {!riverId
              ? 'Select a river first'
              : avail.offline
                ? 'Availability unavailable'
                : 'No corridor prepared yet — prepare it in Next Steps'}
          </Empty>
          <Prov offline={Boolean(riverId) && avail.offline}>Coverage of the selected corridor</Prov>
        </>
      ) : (
        <>
          <div className="relative mx-auto h-[150px] w-[220px]">
            <EChart
              height={150}
              option={{
                title: {
                  text: `${num(coverage, 0)}%`,
                  subtext: 'Coverage (DEM + Dams)',
                  left: 'center',
                  top: '38%',
                  textStyle: { fontSize: 22, fontFamily: 'monospace', color: '#1a2029' },
                  subtextStyle: { fontSize: 10, color: '#667085' },
                },
                series: [
                  {
                    type: 'pie',
                    radius: ['62%', '80%'],
                    label: { show: false },
                    data: [
                      { value: coverage, itemStyle: { color: rampColor(0.55) } },
                      {
                        value: Math.max(0, 100 - coverage),
                        itemStyle: { color: '#eef1f5' },
                      },
                    ],
                  },
                ],
              }}
            />
          </div>
          <div className="px-3 pb-2">
            {AVAIL_ROWS.map((row) => {
              const band = avail.data?.[row.key as 'dem']
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-2 border-b border-[var(--line)] py-1 text-[11px] last:border-b-0"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
                  <span className="flex-1">
                    {row.label}
                    {row.optional && (
                      <span className="ml-1 text-[9px] text-[var(--faint)]">optional</span>
                    )}
                  </span>
                  <span className="num text-[var(--muted)]">{band ? pct(band.pct) : EM_DASH}</span>
                </div>
              )
            })}
          </div>
          {stale && (
            <p className="px-3 pb-1 text-[10px] text-[var(--warn)]">
              Prepared for a {avail.data?.corridor_buffer_km ?? '—'} km corridor · slider at{' '}
              {avail.data?.buffer_km ?? bufferKm} km — re-prepare for exact numbers
            </p>
          )}
          <Prov>
            Per-dataset coverage inside the corridor
            {avail.data ? ` · measured at ${avail.data.buffer_km} km` : ''}
          </Prov>
        </>
      )}
    </Panel>
  )
}
