import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import type { RunSeries } from '../../lib/api'
import { AXIS, EChart } from '../Charts'
import { num } from '../../lib/format'

const BANDS = [
  { key: 'low', label: 'low 0.05–0.5 m', color: '#ffd75e' },
  { key: 'moderate', label: 'moderate 0.5–2 m', color: '#ff8c1a' },
  { key: 'high', label: 'high > 2 m', color: '#e8322d' },
] as const

/** Area by hazard class (stacked) + flood-front advance, one shared time axis. */
export function useAreaReachOption(series: RunSeries | null | undefined): EChartsOption {
  return useMemo(() => {
    if (!series?.times_s?.length) return {}
    const hours = series.times_s.map((t) => Number((t / 3600).toFixed(4)))
    const area = series.area_km2
    const bandSeries: SeriesOption[] = BANDS.map((b) => ({
      name: b.label,
      type: 'line',
      stack: 'area',
      showSymbol: false,
      yAxisIndex: 0,
      data: hours.map((h, i) => [h, area?.[b.key][i] ?? 0] as [number, number]),
      lineStyle: { color: b.color, width: 0.6 },
      areaStyle: { color: b.color, opacity: 0.85 },
    }))
    const reach: SeriesOption = {
      name: 'farthest reach',
      type: 'line',
      showSymbol: false,
      yAxisIndex: 1,
      data: hours.map((h, i) => [h, series.reach_km[i] ?? 0] as [number, number]),
      lineStyle: { color: '#9467bd', width: 2 },
    }
    return {
      backgroundColor: 'transparent',
      grid: { left: 46, right: 46, top: 30, bottom: 26 },
      legend: {
        data: [...BANDS.map((b) => b.label), 'farthest reach'],
        textStyle: { fontSize: 9.5, color: '#667085' },
        top: 0,
        type: 'scroll',
        pageIconColor: '#667085',
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
          name: 'area (km²)',
          nameTextStyle: { fontSize: 10, color: '#667085' },
        },
        {
          type: 'value',
          name: 'reach (km)',
          nameTextStyle: { fontSize: 10, color: '#9467bd' },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#9467bd', fontSize: 10 },
        },
      ],
      series: [...bandSeries, reach],
    }
  }, [series])
}

export function AreaReachChart({
  series,
  height = 220,
}: {
  series: RunSeries | null | undefined
  height?: number
}) {
  const option = useAreaReachOption(series)
  if (!series?.times_s?.length) {
    return (
      <div className="flex h-[140px] items-center justify-center text-[11px] text-[var(--faint)]">
        No area/reach series for this run yet.
      </div>
    )
  }
  return <EChart option={option} height={height} />
}

export function seriesHeadline(series: RunSeries | null | undefined): string {
  if (!series?.times_s?.length) return ''
  const peak = Math.max(...(series.area_km2.total ?? [0]))
  const reach = Math.max(...series.reach_km)
  return `${num(peak, 2)} km² peak · ${num(reach, 2)} km farthest`
}
