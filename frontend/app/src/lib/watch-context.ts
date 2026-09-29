import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * WATCH CONTEXT — Track B, parallel to the mission (river) context.
 *
 * The always-on pre-flood track: fixed target areas are swept daily, change
 * detection feeds risk, risk feeds alerts, and an alert triggers a scenario
 * into Track A. Every Watch component publishes/subscribes here — never to
 * each other, never to props from Watch.tsx.
 *
 * Only selection + sweep status persist. Box/alert/change rows always refetch;
 * a stored row is how stale missions lie.
 */

export interface SweepState {
  running: boolean
  lastRun: string | null
  nextRun: string | null
  jobId: string | null
}

export interface WatchContext {
  selectedBoxId: string | null
  selectedAlertId: string | null
  sweep: SweepState | null

  /** Box picked in the list, on the map, or from an alert. */
  selectBox: (id: string | null) => void
  /** Alert picked in the feed. Selecting one also selects its box. */
  selectAlert: (id: string | null, boxId?: string | null) => void
  /** Sweep control → context (derived from jobs, kept for subscribers). */
  setSweep: (patch: Partial<SweepState>) => void
  /** Watch starts over. */
  clear: () => void
}

export const useWatchContext = create<WatchContext>()(
  persist(
    (set) => ({
      selectedBoxId: null,
      selectedAlertId: null,
      sweep: null,

      selectBox: (id) =>
        set((s) => (s.selectedBoxId === id ? s : { selectedBoxId: id })),
      selectAlert: (id, boxId) =>
        set((s) => {
          const next: Partial<WatchContext> = {}
          if (s.selectedAlertId !== id) next.selectedAlertId = id
          if (boxId !== undefined && s.selectedBoxId !== boxId) next.selectedBoxId = boxId
          return Object.keys(next).length ? next : s
        }),
      setSweep: (patch) =>
        set((s) => ({ sweep: { running: false, lastRun: null, nextRun: null, jobId: null, ...s.sweep, ...patch } })),
      clear: () => set({ selectedBoxId: null, selectedAlertId: null, sweep: null }),
    }),
    {
      name: 'niyanta.watch',
      version: 1,
      partialize: (s) => ({
        selectedBoxId: s.selectedBoxId,
        selectedAlertId: s.selectedAlertId,
      }),
    },
  ),
)
