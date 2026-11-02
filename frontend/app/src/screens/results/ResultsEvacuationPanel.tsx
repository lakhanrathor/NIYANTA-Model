import type { EvacClass, RunEvacuation } from '../../lib/api'
import type { MapFeature } from '../../lib/river-context'
import { EM_DASH, clock, num } from '../../lib/format'
import { Empty, Panel, Pill, Prov } from '../../components/ui'

export const EVAC_META: Record<EvacClass, { label: string; color: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: 'OK', color: '#16a34a', tone: 'ok' },
  leave_now: { label: 'LEAVE NOW', color: '#f59e0b', tone: 'warn' },
  impossible: { label: 'IMPOSSIBLE', color: '#dc2626', tone: 'bad' },
}
const CLOSED = '#94a3b8'

/**
 * Map layers: corridors coloured by class, greyed once the playhead passes
 * their latest safe departure (`tNow` null = max view → class colour only),
 * plus assembly points.
 */
export function evacFeatures(doc: RunEvacuation | undefined, tNow: number | null): MapFeature[] {
  if (!doc || !doc.corridors.length) return []
  return [
    {
      id: 'evac-corridors',
      label: 'Evacuation corridors',
      kind: 'line',
      color: EVAC_META.leave_now.color,
      width: 3.5,
      data: {
        type: 'FeatureCollection',
        features: doc.corridors.map((c) => ({
          type: 'Feature',
          properties: {
            _color:
              tNow != null && c.leave_by_s != null && tNow > c.leave_by_s ? CLOSED : EVAC_META[c.cls].color,
          },
          geometry: { type: 'LineString', coordinates: c.path },
        })),
      },
    },
    {
      id: 'evac-assembly',
      label: 'Assembly points',
      kind: 'circle',
      color: '#2563eb',
      radius: 6,
      textLabel: true,
      data: {
        type: 'FeatureCollection',
        features: doc.assembly.map((a, i) => ({
          type: 'Feature',
          properties: { label: `A${i + 1} · ${a.origins}` },
          geometry: { type: 'Point', coordinates: [a.x, a.y] },
        })),
      },
    },
  ]
}

/** Right rail: class counts, corridor table (worst margin first), CSV. */
export function ResultsEvacuationPanel({
  runId,
  doc,
  pending,
  offline,
  tNow,
}: {
  runId: string
  doc: RunEvacuation | undefined
  pending: boolean
  offline: boolean
  tNow: number | null
}) {
  const rows = doc
    ? doc.corridors
        .map((c, i) => ({ ...c, i }))
        .sort((a, b) => (a.worst_margin_h ?? -1e9) - (b.worst_margin_h ?? -1e9))
    : []
  const noRoute = doc ? doc.origins.filter((o) => o.corridor == null).length : 0

  return (
    <Panel
      title="Evacuation corridors"
      actions={
        doc && doc.origins.length ? (
          <a
            href={`/api/runs/${runId}/evacuation?format=csv`}
            className="text-[10.5px] font-semibold text-[var(--accent)]"
          >
            CSV
          </a>
        ) : null
      }
    >
      {!doc ? (
        <Empty>{pending ? 'Routing over the OSM road network…' : offline ? 'Source offline' : EM_DASH}</Empty>
      ) : !doc.origins.length ? (
        <Empty>No building, hospital or school is reached by the flood in this run — nothing to evacuate.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {(['impossible', 'leave_now', 'ok'] as const).map((k) => (
              <Pill key={k} tone={EVAC_META[k].tone}>
                {EVAC_META[k].label} {num(doc.stats[k], 0)}
              </Pill>
            ))}
          </div>
          <p className="px-3 pt-1.5 text-[10.5px] text-[var(--muted)]">
            {num(doc.stats.origins, 0)} flooded buildings / critical sites · {num(doc.corridors.length, 0)} routes ·{' '}
            {num(doc.assembly.length, 0)} assembly points
            {noRoute ? ` · ${num(noRoute, 0)} with no open road route` : ''}
          </p>
          <div className="max-h-[220px] overflow-y-auto px-3 py-1.5">
            <table className="w-full text-[10.5px]">
              <thead className="text-left text-[var(--muted)]">
                <tr>
                  <th className="font-medium">Route</th>
                  <th className="font-medium">Sites</th>
                  <th className="font-medium">Walk</th>
                  <th className="font-medium">Leave by</th>
                  <th className="font-medium">Margin</th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((c) => {
                  const closed = tNow != null && c.leave_by_s != null && tNow > c.leave_by_s
                  return (
                    <tr key={c.i} className={`border-t border-[var(--line)] ${closed ? 'opacity-50' : ''}`}>
                      <td>
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-sm"
                          style={{ background: closed ? CLOSED : EVAC_META[c.cls].color }}
                        />
                        R{c.i + 1}→A{c.assembly + 1}
                      </td>
                      <td>{c.origins}</td>
                      <td>{num(c.walk_km, 2)} km</td>
                      <td>{c.leave_by_s != null && c.leave_by_s >= 0 ? clock(c.leave_by_s) : 'too late'}</td>
                      <td>{c.worst_margin_h != null ? `${num(c.worst_margin_h * 60, 0)} min` : EM_DASH}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Prov>
            Assumptions: walk {doc.assumptions.walk_kmh} km/h · leave from {doc.assumptions.departure} · road cut
            &gt;{doc.assumptions.road_cut_m} m · LEAVE NOW if margin &lt; {doc.assumptions.leave_now_h} h · safe ={' '}
            {doc.assumptions.safe_node} · origins snapped ≤{doc.assumptions.snap_m} m to the road. Grey = latest
            departure already passed at the timeline frame.
          </Prov>
        </>
      )}
    </Panel>
  )
}
