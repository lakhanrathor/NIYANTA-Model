import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useWatchContext } from '../../lib/watch-context'
import { EM_DASH, num, pct, relativeTime } from '../../lib/format'
import { EChart } from '../../components/Charts'
import { Empty, Head, Panel, Pill, Seg } from '../../components/ui'
import { RiskBadge } from './RiskBadge'
import { TriggerButton } from './TriggerButton'
import { watchApi } from './watchApi'

const KIND_COLOR: Record<string, string> = {
  lake_area: '#0b6bcb',
  water_mask: '#2e90fa',
  snow: '#7dd3fc',
  glacier: '#b42318',
  ice: '#f59e0b',
}

function metricNum(m: unknown, key: string): number | null {
  if (m && typeof m === 'object') {
    const v = (m as Record<string, unknown>)[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return null
}

/** Everything one target area is telling us: risk verdict, area trends per
 *  sensor kind, before/after, and the trigger into Track A. Context in,
 *  display out — no sibling calls. */
export function BoxDetail() {
  const selectedBoxId = useWatchContext((s) => s.selectedBoxId)
  const sweepRunning = useWatchContext((s) => s.sweep?.running ?? false)
  const [triggerChangeId, setTriggerChangeId] = useState<string | null>(null)
  // One inspector, three views — tabs kill the endless rail scroll. The trigger
  // stays pinned below, always visible.
  const [tab, setTab] = useState<'live' | 'trends' | 'log'>('live')
  // Which box the quicklook failed for — a new box gets a fresh attempt, so a
  // stale error never hides the next picture. No effect needed.
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const imgFailed = failedFor !== null && failedFor === selectedBoxId

  const boxes = useApi(['boxes'], api.watchBoxes)
  const box = boxes.data?.find((b) => b.id === selectedBoxId) ?? null

  // Refresh only while a sweep is in flight — idle polling would burn quota
  // and battery for numbers that change once a day.
  const timeline = useApi(
    ['box-timeline', selectedBoxId],
    () => watchApi.boxTimeline(selectedBoxId!),
    { enabled: Boolean(selectedBoxId), staleTime: 30_000, refetchInterval: sweepRunning ? 15000 : false },
  )
  const ba = useApi(
    ['beforeafter', selectedBoxId],
    () => api.beforeAfter(selectedBoxId!),
    { enabled: Boolean(selectedBoxId), staleTime: 60_000 },
  )

  const changes = useMemo(
    () => [...(timeline.data?.changes ?? [])].sort((a, b) => String(a.ts ?? '').localeCompare(String(b.ts ?? ''))),
    [timeline.data],
  )
  const kinds = useMemo(() => [...new Set(changes.map((c) => c.kind))], [changes])
  const flagged = useMemo(() => changes.filter((c) => c.flagged), [changes])
  const simulated = useMemo(
    () => changes.some((c) => (c.metrics as Record<string, unknown> | null)?.simulated === true),
    [changes],
  )

  /**
   * OUTLOOK — "what may happen", from data already on screen. Least-squares
   * rate per kind over the window: escalating (>+2%/day), watching (>+0.5%/day),
   * stable, or unknown (<3 points). A trend projection, never a forecast.
   */
  interface Outlook {
    kind: string
    n: number
    ratePctPerDay: number | null
    latest: number | null
    hot: boolean
    state: 'escalating' | 'watching' | 'stable' | 'unknown'
    proj7d: number | null
  }
  const outlook: Outlook[] = useMemo(
    () =>
      kinds.map((kind) => {
        const pts = changes
          .filter((c) => c.kind === kind && c.ts)
          .map((c) => ({
            t: Date.parse(String(c.ts).replace(' ', 'T')),
            v: metricNum(c.metrics, 'area_km2'),
          }))
          .filter((p) => Number.isFinite(p.t) && p.v !== null) as { t: number; v: number }[]
        const latest = pts.length ? pts[pts.length - 1].v : null
        const hot = changes.filter((c) => c.kind === kind).slice(-3).some((c) => c.flagged)
        if (pts.length < 3) {
          return { kind, n: pts.length, ratePctPerDay: null, latest, hot, state: 'unknown' as const, proj7d: null }
        }
        const t0 = pts[0].t
        const xs = pts.map((p) => (p.t - t0) / 86400000)
        const ys = pts.map((p) => p.v)
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length
        const my = ys.reduce((a, b) => a + b, 0) / ys.length
        const denom = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0)
        const slope = denom > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom : 0
        const rel = my > 0 ? (slope / my) * 100 : null
        const state: Outlook['state'] =
          rel === null ? 'unknown' : rel > 2 ? 'escalating' : rel > 0.5 ? 'watching' : 'stable'
        const proj7d = rel !== null && slope > 0 && latest !== null ? latest + slope * 7 : null
        return { kind, n: pts.length, ratePctPerDay: rel, latest, hot, state, proj7d }
      }),
    [changes, kinds],
  )

  // Default trigger target: the latest flagged change, else the latest change.
  const activeChangeId =
    triggerChangeId ?? flagged[flagged.length - 1]?.id ?? changes[changes.length - 1]?.id ?? null
  const risk = timeline.data?.latest_risk ?? null

  const option: EChartsOption = useMemo(() => {
    const series = kinds.map((kind) => {
      const pts = changes
        .filter((c) => c.kind === kind && c.ts && metricNum(c.metrics, 'area_km2') !== null)
        .map((c) => ({
          value: [c.ts as string, metricNum(c.metrics, 'area_km2') as number],
          flagged: c.flagged,
          id: c.id,
        }))
      return {
        name: kind.replace(/_/g, ' '),
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data: pts.map((p) => p.value),
        lineStyle: { width: 2, color: KIND_COLOR[kind] ?? '#0b6bcb' },
        itemStyle: { color: KIND_COLOR[kind] ?? '#0b6bcb' },
        markPoint: {
          symbol: 'pin',
          symbolSize: 26,
          itemStyle: { color: '#b42318' },
          data: pts.filter((p) => p.flagged).map((p) => ({ name: 'flagged', coord: p.value })),
        },
      }
    })
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 10 }, itemWidth: 14 },
      grid: { left: 44, right: 12, top: 12, bottom: 26 },
      xAxis: { type: 'time', axisLabel: { fontSize: 9, hideOverlap: true } },
      yAxis: {
        type: 'value',
        name: 'km²',
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9, formatter: (v: number) => num(v, 1) },
      },
      series,
    }
  }, [changes, kinds])

  if (!selectedBoxId || !box) {
    return (
      <Panel title="Box Detail">
        <Empty>Pick a watch box — pixels, trends and the trigger live here</Empty>
      </Panel>
    )
  }

  return (
    <Panel
      title={box.name}
      actions={<RiskBadge level={risk?.level} score={risk?.score} />}
    >
      <p className="num border-b border-[var(--line)] px-3 py-1 text-[10px] text-[var(--faint)]">
        {box.preset ?? box.kind ?? 'custom'}
        {box.created ? ` · since ${relativeTime(box.created)}` : ''}
        {simulated ? <span className="ml-1 text-[var(--warn)]">· replay/simulated observations</span> : ''}
      </p>

      {/* headline stats */}
      <div className="grid grid-cols-3 border-b border-[var(--line)] text-center">
        {[
          ['changes', changes.length ? num(changes.length) : EM_DASH],
          ['flagged', flagged.length ? num(flagged.length) : EM_DASH],
          ['kinds', kinds.length ? num(kinds.length) : EM_DASH],
        ].map(([label, value]) => (
          <div key={label} className="px-2 py-1.5">
            <p className="num text-[14px] font-semibold">{value}</p>
            <p className="text-[9px] uppercase tracking-[0.06em] text-[var(--muted)]">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-[var(--line)] px-2 py-1.5">
        <Seg
          size="sm"
          options={[
            { value: 'live', label: 'Live' },
            { value: 'trends', label: 'Trends' },
            { value: 'log', label: `Log · ${changes.length}` },
          ]}
          value={tab}
          onChange={(v) => setTab(v as 'live' | 'trends' | 'log')}
        />
      </div>

      {tab === 'live' && (
        <>
      {/* live view — latest quicklook, refreshing only mid-sweep */}
      <div className="relative border-b border-[var(--line)] bg-[var(--bg)]">
        {!imgFailed && selectedBoxId ? (
          <img
            src={`/api/watch/boxes/${selectedBoxId}/image`}
            alt=""
            onError={() => setFailedFor(selectedBoxId)}
            className="aspect-[16/9] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[16/9] w-full items-center justify-center px-3 text-center text-[11px] text-[var(--faint)]">
            Imagery unavailable — latest Sentinel-2 quicklook missing
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {sweepRunning ? (
            <span className="ct-blink rounded bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold text-white">
              SWEEP LIVE
            </span>
          ) : (
            <span className="rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              latest pass
            </span>
          )}
        </div>
      </div>
      {risk?.summary && (
        <p className="border-b border-[var(--line)] px-3 py-1.5 text-[11px] leading-snug text-[var(--muted)]">
          {risk.summary}
        </p>
      )}
      </>)}
      {tab === 'trends' && (
        <>

      {/* area trends */}
      <Head>Area trends by sensor</Head>
      {timeline.offline && changes.length === 0 ? (
        <Empty>Source offline — GET /api/watch/boxes/{'{id}'}/timeline</Empty>
      ) : changes.length === 0 ? (
        <Empty>{timeline.pending ? 'Loading timeline…' : 'No observations in window'}</Empty>
      ) : (
        <div className="px-1">
          <EChart option={option} height={190} />
        </div>
      )}
      {/* outlook — what may happen, projected from the trends above */}
      <Head>Outlook · trend projection</Head>
      {outlook.length === 0 ? (
        <p className="num px-3 pb-2 text-[10px] text-[var(--faint)]">not enough observations yet</p>
      ) : (
        <ul className="pb-1">
          {outlook.map((o) => {
            const tone =
              o.state === 'escalating'
                ? o.hot
                  ? 'bad'
                  : 'warn'
                : o.state === 'watching'
                  ? 'accent'
                  : o.state === 'stable'
                    ? 'ok'
                    : 'muted'
            return (
              <li
                key={o.kind}
                className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 last:border-b-0"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: KIND_COLOR[o.kind] ?? '#0b6bcb' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium">
                    {o.kind.replace(/_/g, ' ')}
                  </span>
                  <span className="num block truncate text-[10px] text-[var(--faint)]">
                    {o.n} obs
                    {o.ratePctPerDay !== null
                      ? ` · ${o.ratePctPerDay > 0 ? '+' : ''}${o.ratePctPerDay.toFixed(1)}%/day`
                      : ''}
                    {o.proj7d !== null ? ` · ≈${num(o.proj7d, 2)} km² in 7d` : ''}
                  </span>
                </span>
                <Pill tone={tone}>{o.state}</Pill>
              </li>
            )
          })}
        </ul>
      )}
      <p className="px-3 pb-2 text-[10px] leading-snug text-[var(--faint)]">
        Least-squares rate over this window — a projection, not a forecast.
      </p>

      {/* before / after */}
      <Head>Before / after</Head>
      {ba.data ? (
        <div className="grid grid-cols-3 gap-1.5 px-3 pb-2 text-center">
          <div className="rounded border border-[var(--line)] py-1.5">
            <p className="num text-[13px] font-semibold">
              {ba.data.before_km2 === null ? EM_DASH : num(ba.data.before_km2, 2)}
            </p>
            <p className="text-[9px] text-[var(--faint)]">before km²</p>
          </div>
          <div className="rounded border border-[var(--line)] py-1.5">
            <p className="num text-[13px] font-semibold">
              {ba.data.after_km2 === null ? EM_DASH : num(ba.data.after_km2, 2)}
            </p>
            <p className="text-[9px] text-[var(--faint)]">after km²</p>
          </div>
          <div className="rounded border border-[var(--line)] bg-[var(--bg)] py-1.5">
            <p className="num text-[13px] font-semibold text-[var(--ok)]">
              {ba.data.delta_pct === null ? EM_DASH : pct(ba.data.delta_pct)}
            </p>
            <p className="text-[9px] text-[var(--faint)]">delta</p>
          </div>
        </div>
      ) : (
        <p className="num px-3 pb-2 text-[10px] text-[var(--faint)]">
          {ba.offline ? 'before/after offline' : ba.pending ? 'loading…' : 'no pair yet'}
        </p>
      )}
      </>)}

      {tab === 'log' && (
        <>
      {/* change log → trigger target */}
      <Head right={`${changes.length} obs`}>Change log</Head>
      <ul>
        {changes.slice(-15).reverse().map((c) => {
          const delta = c.delta_pct ?? metricNum(c.metrics, 'delta_pct')
          const active = activeChangeId === c.id
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setTriggerChangeId(c.id)}
                className={`flex w-full items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-left last:border-b-0 ${
                  active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg)]'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: c.flagged ? 'var(--bad)' : 'var(--accent)' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium">{c.kind.replace(/_/g, ' ')}</span>
                  <span className="num block truncate text-[10px] text-[var(--faint)]">
                    {c.ts ? relativeTime(c.ts) : EM_DASH}
                    {metricNum(c.metrics, 'area_km2') !== null ? ` · ${num(metricNum(c.metrics, 'area_km2') as number, 2)} km²` : ''}
                  </span>
                </span>
                <span className="num shrink-0 text-[11px] text-[var(--muted)]">
                  {delta === null ? EM_DASH : pct(delta)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      </>)}

      {/* THE TRIGGER */}
      <div className="border-t border-[var(--line)] p-3">
        <TriggerButton changeId={activeChangeId} riskId={risk?.id ?? null} />
      </div>
    </Panel>
  )
}
