import { create } from 'zustand'

export type ViewMode = '2d' | '3d'
export type CompareMode = 'swipe' | 'side' | 'diff'

interface LayerState {
  id: string
  label: string
  visible: boolean
}

interface AppState {
  viewMode: ViewMode
  compareMode: CompareMode
  layers: LayerState[]
  playback: { frame: number; count: number; playing: boolean; speed: number }
  /** Live map telemetry for the bottom status bar. `null` = no map has reported yet. */
  cursor: { lat: number; lon: number } | null
  zoom: number | null
  setViewMode: (m: ViewMode) => void
  setCompareMode: (m: CompareMode) => void
  toggleLayer: (id: string) => void
  setFrame: (frame: number) => void
  setCount: (count: number) => void
  setPlaying: (playing: boolean) => void
  setSpeed: (speed: number) => void
  setCursor: (cursor: { lat: number; lon: number } | null) => void
  setZoom: (zoom: number | null) => void
}

export const useApp = create<AppState>((set) => ({
  viewMode: '2d',
  compareMode: 'swipe',
  layers: [
    { id: 'depth', label: 'Water Depth (max)', visible: true },
    { id: 'arrival', label: 'Arrival Time (Isochrones)', visible: true },
    { id: 'extent', label: 'Inundation Extent', visible: true },
    { id: 'velocity', label: 'Velocity (vector)', visible: false },
    { id: 'water', label: 'Water Surface (time)', visible: false },
    { id: 'front', label: 'Inundation Front (animated)', visible: true },
    { id: 'affected', label: 'Affected Area (polygon)', visible: false },
  ],
  playback: { frame: 0, count: 1, playing: false, speed: 1 },
  cursor: null,
  zoom: null,
  setViewMode: (viewMode) => set({ viewMode }),
  setCompareMode: (compareMode) => set({ compareMode }),
  toggleLayer: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),
  setFrame: (frame) => set((s) => ({ playback: { ...s.playback, frame } })),
  setCount: (count) => set((s) => ({ playback: { ...s.playback, count } })),
  setPlaying: (playing) => set((s) => ({ playback: { ...s.playback, playing } })),
  setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
  setCursor: (cursor) => set({ cursor }),
  setZoom: (zoom) => set({ zoom }),
}))
