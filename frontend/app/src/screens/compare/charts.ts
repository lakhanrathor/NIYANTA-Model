import type { EChartsOption } from 'echarts'
import { AXIS } from '../../components/Charts'
import type { BreachHydrograph, Longitudinal } from '../../lib/api'

/**
 * Pure ECharts option builders for the dual-run charts — no fetching, no
 * context. Each returns null when its endpoint returned no usable series, so
 * callers can fall back to an honest empty state.
 */

/** Water depth along the centreline: run A solid, run B dashed. */
export function longitudinalOption(
  lon: Longitudinal | undefined,
  shortA: string,
  shortB: string,
): EChartsOption | null {
  const series = lon?.series ?? []
  const first = series[0]
  const second = series[1]
  if (!first) return null
  const names = [`${shortA} (A)`, ...(second ? [`${shortB} (B)`] : [])]
  return {
    backgroundColor: 'transparent',
    grid: { left: 44, right: 12, top: 24, bottom: 30 },
    legend: {
      data: names,
      textStyle: { fontSize: 10, color: '#667085' },
      top: 0,
    },
    xAxis: {
      ...AXIS,
      type: 'value',
      name: 'Distance from Dam (km)',
      nameTextStyle: { fontSize: 10, color: '#667085' },
    },
    yAxis: {
      ...AXIS,
      type: 'value',
      name: 'Depth (m)',
      nameTextStyle: { fontSize: 10, color: '#667085' },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: names[0],
        type: 'line' as const,
        showSymbol: false,
        lineStyle: { color: '#0b6bcb', width: 2 },
        data: first.points.map((p) => [p.d, p.depth]),
      },
      ...(second
        ? [
            {
              name: names[1],
              type: 'line' as const,
              showSymbol: false,
              lineStyle: { color: '#b42318', width: 2, type: 'dashed' as const },
              data: second.points.map((p) => [p.d, p.depth]),
            },
          ]
        : []),
    ],
  }
}

/** Breach-outflow hydrographs of both runs on one axis (downsampled to ~600 points). */
export function hydroCompareOption(
  a: BreachHydrograph | undefined,
  b: BreachHydrograph | undefined,
  shortA: string,
  shortB: string,
): EChartsOption | null {
  if (!a?.time_s?.length && !b?.time_s?.length) return null
  const down = (t: number[], q: number[]) => {
    const step = Math.max(1, Math.ceil(t.length / 600))
    const out: [number, number][] = []
    for (let i = 0; i < t.length; i += step) out.push([t[i] / 3600, q[i]])
    return out
  }
  const mk = (name: string, color: string, dashed: boolean, pts: [number, number][]) => ({
    name,
    type: 'line' as const,
    showSymbol: false,
    lineStyle: dashed ? { color, width: 2, type: 'dashed' as const } : { color, width: 2 },
    data: pts,
  })
  const series = [
    ...(a?.time_s?.length ? [mk(`${shortA} (A)`, '#0b6bcb', false, down(a.time_s, a.q_cms))] : []),
    ...(b?.time_s?.length ? [mk(`${shortB} (B)`, '#b42318', true, down(b.time_s, b.q_cms))] : []),
  ]
  return {
    backgroundColor: 'transparent',
    grid: { left: 46, right: 12, top: 24, bottom: 26 },
    legend: {
      data: series.map((s) => s.name),
      textStyle: { fontSize: 10, color: '#667085' },
      top: 0,
    },
    xAxis: {
      ...AXIS,
      type: 'value',
      name: 'Time (hours)',
      nameTextStyle: { fontSize: 10, color: '#667085' },
    },
    yAxis: {
      ...AXIS,
      type: 'value',
      name: 'Discharge (m³/s)',
      nameTextStyle: { fontSize: 10, color: '#667085' },
    },
    tooltip: { trigger: 'axis' },
    series,
  }
}
