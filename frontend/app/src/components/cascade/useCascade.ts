import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { CascadeDam } from '../../lib/api'
import { useRiverContext } from '../../lib/river-context'

/**
 * Shared cascade screening (Results + Player consume the same snapshot).
 * The screening result and the picked dam live in the mission context —
 * scoped by runId like `outputs` — so screening once on either page serves
 * both, with zero duplicate requests and zero mirror state. Only the filter
 * text and the in-flight flags stay local: they are keystrokes, not evidence.
 */
export function useCascade(runId: string | null) {
  const cascade = useRiverContext((s) => s.cascade)
  const publishCascade = useRiverContext((s) => s.publishCascade)
  const selectCascadeDam = useRiverContext((s) => s.selectCascadeDam)
  const [busy, setBusy] = useState<'screen' | 'draft' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const autoRan = useRef<string | null>(null)

  // A snapshot for another run is no snapshot at all.
  const result = cascade?.runId === runId ? cascade : null

  const call = async (mode: 'screen' | 'draft') => {
    if (!runId || busy) return
    setBusy(mode)
    setError(null)
    try {
      const res = await api.cascade(runId, mode === 'draft' ? { create_scenarios: true } : {})
      publishCascade({
        runId,
        sourceName: res.source_dam?.name ?? null,
        depthThresholdM: res.depth_threshold_m ?? null,
        dams: res.dams,
        selectedDamId: cascade?.runId === runId ? (cascade?.selectedDamId ?? null) : null,
        updatedAt: new Date().toISOString(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cascade screening failed')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!runId || autoRan.current === runId) return
    autoRan.current = runId
    setError(null)
    setFilter('')
    if (cascade?.runId !== runId) void call('screen')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const q = filter.trim().toLowerCase()
  const dams = (result?.dams ?? []).filter((d) => !q || (d.name ?? '').toLowerCase().includes(q))
  const wet = (result?.dams ?? []).filter(
    (d) => d.status === 'overtopped' || d.status === 'exposed',
  )

  return {
    result,
    busy,
    error,
    filter,
    setFilter,
    selectedId: result?.selectedDamId ?? null,
    setSelectedId: selectCascadeDam,
    dams,
    wet,
    screen: () => void call('screen'),
    draft: () => void call('draft'),
  }
}

export type CascadeTone = 'ok' | 'warn' | 'bad' | 'muted'

export function cascadeTone(s: CascadeDam['status']): CascadeTone {
  if (s === 'overtopped') return 'bad'
  if (s === 'exposed' || s === 'exposed-unknown-geometry') return 'warn'
  return 'muted'
}

export function cascadeLabel(s: CascadeDam['status']): string {
  if (s === 'overtopped') return 'Overtopped'
  if (s === 'exposed') return 'Exposed — held'
  if (s === 'exposed-unknown-geometry') return 'Exposed — geometry unknown'
  if (s === 'dry') return 'Dry'
  return 'Outside domain'
}
