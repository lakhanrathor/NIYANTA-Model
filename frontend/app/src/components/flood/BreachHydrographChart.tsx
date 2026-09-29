import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import type { BreachHydrograph } from '../../lib/api'
import { AXIS, EChart } from '../Charts'
import { EM_DASH, num } from '../../lib/format'

/** Trapezoidal cumulative volume in hm³. */
function cumulative(q: number[], dt: number): number[] {
  const out = [0]
  for (let i = 1; i < q.length; i++) out.push(out[i - 1] + ((q[i] + q[i - 1]) / 2) * dt / 1e6)
  return out
}

export function useBreachHydroOption(hydro: BreachHydrograph | null | undefined): EChartsOption {
  return useMemo(() => {
    if (!hydro?.time_s?.length) return {}
    const n = hydro.time_s.length
    // A 1 Hz, 6 h series is 21 600 points — sample to ≤600 for the chart.
    const step = Math.max(1, Math.ceil(n / 600))
    const idx: number[] = []
    for (let i = 0; i < n; i += step) idx.push(i)
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1)

    const dt = n > 1 ? hydro.time_s[1] - hydro.time_s[0] : 1
    const cum = cumulative(hydro.q_cms, dt)
    const qPts: [number, number][] = []
    const volPts: [number, number][] = []
    for (const i of idx) {
      const h = Number((hydro.time_s[i] / 3600).toFixed(4))
      qPts.push([h, hydro.q_cms[i] ?? 0])
      volPts.push([h, Number((cum[i] ?? 0).toFixed(3))])
    }

    const series: SeriesOption[] = [
      {
        name: 'Breach outflow Q',
        type: 'line',
        showSymbol: false,
        yAxisIndex: 0,
        data: qPts,
        lineStyle: { color: '#0b6bcb', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(11,107,203,0.28)' },
              { offset: 1, color: 'rgba(11,107,203,0.02)' },
            ],
          },
        },
        ...(hydro.peak_at_hr != null && hydro.peak_cms != null
          ? {
              markLine: {
                symbol: 'none' as const,
                label: {
                  formatter: `peak ${num(hydro.peak_cms, 0)} m³/s @ ${num(hydro.peak_at_hr * 60, 0)} min`,
                  fontSize: 9,
                  color: '#b42318',
                },
                lineStyle: { color: '#b42318', type: 'dashed' as const, width: 1 },
                data: [{ xAxis: hydro.peak_at_hr }],
              },
            }
          : {}),
      },
      {
        name: 'Released volume',
        type: 'line',
        showSymbol: false,
        yAxisIndex: 1,
        data: volPts,
        lineStyle: { color: '#9467bd', width: 1.6 },
      },
    ]

    return {
      backgroundColor: 'transparent',
      grid: { left: 48, right: 46, top: 28, bottom: 26 },
      legend: {
        data: ['Breach outflow Q', 'Released volume'],
        textStyle: { fontSize: 10, color: '#667085' },
        top: 0,
      },
      tooltip: { trigger: 'axis' },
      xAxis: {
        ...AXIS,
        type: 'value',
        name: 'time after breach (h)',
        nameTextStyle: { fontSize: 10, color: '#667085' },
      },
      yAxis: [
        {
          ...AXIS,
          type: 'value',
          name: 'Q (m³/s)',
          nameTextStyle: { fontSize: 10, color: '#667085' },
        },
        {
          type: 'value',
          name: 'hm³',
          nameTextStyle: { fontSize: 10, color: '#9467bd' },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#9467bd', fontSize: 10 },
        },
      ],
      series,
    }
  }, [hydro])
}

/** Q(t) + cumulative released volume — the "how much water escaped" chart. */
export function BreachHydrographChart({
  hydro,
  height = 200,
}: {
  hydro: BreachHydrograph | null | undefined
  height?: number
}) {
  const option = useBreachHydroOption(hydro)
  if (!hydro?.time_s?.length) {
    return (
      <div className="flex h-[120px] items-center justify-center text-[11px] text-[var(--faint)]">
        No breach hydrograph for this run yet.
      </div>
    )
  }
  return <EChart option={option} height={height} />
}

/** Panel-header summary: peak + released volume. */
export function hydroHeadline(hydro: BreachHydrograph | null | undefined): string {
  if (!hydro?.peak_cms) return EM_DASH
  const rel = hydro.released_hm3 != null ? ` · ${num(hydro.released_hm3, 2)} hm³` : ''
  return `Qp ${num(hydro.peak_cms, 0)} m³/s · ${num((hydro.peak_at_hr ?? 0) * 60, 0)} min${rel}`
}
