import { useEffect, useRef } from 'react'
import { init } from 'echarts'
import type { EChartsOption } from 'echarts'

/** Thin echarts host: one chart instance per mount, resized with its panel. */
export function EChart({
  option,
  height = 200,
  className = '',
}: {
  option: EChartsOption
  height?: number
  className?: string
}) {
  const el = useRef<HTMLDivElement | null>(null)
  const chart = useRef<ReturnType<typeof init> | null>(null)

  useEffect(() => {
    if (!el.current) return
    const instance = init(el.current)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(el.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  return <div ref={el} style={{ height }} className={className} />
}

/** Shared cartesian axes styling so every chart reads as one family. */
export const AXIS = {
  axisLine: { lineStyle: { color: '#e4e7ec' } },
  axisLabel: { color: '#667085', fontSize: 10 },
  splitLine: { lineStyle: { color: '#f0f2f5' } },
  axisTick: { show: false },
} as const
