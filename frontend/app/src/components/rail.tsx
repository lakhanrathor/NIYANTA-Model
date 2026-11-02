import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Side rails fold their panels so a page opens calm: the first OPEN_FIRST
 * titled panels in a rail start expanded, the rest show only their header.
 * Whatever the analyst opens or closes is remembered per rail + title.
 */
const OPEN_FIRST = 2

interface Rail {
  id: string
  /** title → first-seen position; a Map keeps it stable across re-renders */
  order: Map<string, number>
}

const RailCtx = createContext<Rail | null>(null)

export function RailGroup({ id, children }: { id: string; children: ReactNode }) {
  const rail = useMemo<Rail>(() => ({ id, order: new Map() }), [id])
  return <RailCtx.Provider value={rail}>{children}</RailCtx.Provider>
}

const key = (rail: string, title: string) => `niyanta.rail.${rail}.${title}`

/** Fold state for a titled panel; outside a rail (or untitled) it never folds. */
export function useRailFold(title: unknown): { foldable: boolean; open: boolean; toggle: () => void } {
  const rail = useContext(RailCtx)
  const t = typeof title === 'string' ? title : null
  if (rail && t && !rail.order.has(t)) rail.order.set(t, rail.order.size)
  const initial = (): boolean => {
    if (!rail || !t) return true
    try {
      const saved = localStorage.getItem(key(rail.id, t))
      if (saved != null) return saved === '1'
    } catch {
      /* storage blocked — fall through to the default */
    }
    return (rail.order.get(t) ?? 0) < OPEN_FIRST
  }
  const [open, setOpen] = useState(initial)
  if (!rail || !t) return { foldable: false, open: true, toggle: () => {} }
  return {
    foldable: true,
    open,
    toggle: () =>
      setOpen((v) => {
        try {
          localStorage.setItem(key(rail.id, t), v ? '0' : '1')
        } catch {
          /* per-viewer convenience only */
        }
        return !v
      }),
  }
}
