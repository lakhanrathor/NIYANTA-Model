import { useMemo } from 'react'
import { api, infraDepthAt, nearestAsset } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, clock, m, num } from '../../lib/format'
import { Metric, Panel, Pill, Prov } from '../ui'

const KIND_LABEL: Record<string, string> = {
  building: 'Building',
  road: 'Road segment',
  bridge: 'Bridge',
  hospital: 'Hospital',
  school: 'School',
}

/**
 * Spec §18 asset inspection: the OSM asset nearest the clicked point, read
 * from the run's per-frame exposure (`/runs/{id}/infrastructure`). Status is
 * judged at `frame` against the asset's own wet threshold; `frame` null =
 * max-extent view, so only the whole-run outcome applies. Renders nothing
 * when the click is not on an asset (the depth probe still answers).
 */
export function AssetPanel({
  runId,
  pick,
  frame,
}: {
  runId: string | null
  pick: { lon: number; lat: number } | null
  frame: number | null
}) {
  // same key as the map/scene layers → one shared request
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId!), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })
  const asset = useMemo(
    () => (infra.data && pick ? nearestAsset(infra.data, pick.lon, pick.lat) : null),
    [infra.data, pick],
  )
  if (!pick || !infra.data || !asset) return null

  const t = infra.data.times_s
  const f = asset.f
  const isRoad = asset.kind === 'road'
  const now = frame == null ? null : infraDepthAt(f, frame)
  const status =
    f.f0 == null
      ? { tone: 'ok' as const, text: 'Never reached' }
      : frame == null
        ? { tone: 'bad' as const, text: isRoad ? 'Cut during the run' : 'Flooded during the run' }
        : now != null && now > asset.thr_m
          ? { tone: 'bad' as const, text: isRoad ? 'Cut — under water' : 'Under water' }
          : frame < f.f0
            ? { tone: 'accent' as const, text: 'Dry — water not here yet' }
            : { tone: 'warn' as const, text: 'Flooded earlier — water receded' }

  return (
    <Panel title="Selected asset" pinned>
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="truncate text-[12px] font-semibold">
          {KIND_LABEL[asset.kind] ?? asset.kind}
          {asset.name ? ` · ${asset.name}` : ''}
        </span>
        <Pill tone={status.tone}>{status.text}</Pill>
      </div>
      {frame != null && <Metric label="Depth now" value={now != null ? m(now, 1) : `below ${asset.thr_m} m`} />}
      <Metric label="Peak depth" value={f.d != null ? m(f.d, 1) : `below ${asset.thr_m} m`} />
      <Metric label="Water arrives" value={f.f0 != null && t[f.f0] != null ? clock(t[f.f0]) : 'never'} />
      <Metric
        label="Water leaves"
        value={
          f.f1 == null || t[f.f1] == null ? EM_DASH : f.f1 === t.length - 1 ? 'still wet at run end' : clock(t[f.f1])
        }
      />
      {isRoad && asset.km != null && <Metric label="Segment length" value={`${num(asset.km * 1000, 0)} m`} />}
      <Metric label="Distance from click" value={`${num(asset.dist_m, 0)} m`} />
      <Prov>
        OSM · wet above {asset.thr_m} m{isRoad ? ' (road cut)' : ''} ·{' '}
        <span className="num">GET /runs/{runId?.slice(0, 8)}/infrastructure</span>
      </Prov>
    </Panel>
  )
}
