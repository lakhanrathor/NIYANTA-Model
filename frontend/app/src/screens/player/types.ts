import type { FrameWaterStatus } from '../PlayerScene'

/** Shared Player vocabulary — every panel imports from here, never from a sibling. */

export type CamPreset = 'dam' | 'valley' | 'top' | 'drone'

export type TimeFormat = 'hhmm' | 'minutes' | 'hours'

export type ExportFormat = 'geotiff' | 'shp' | 'kml'

export interface PickPoint {
  lon: number
  lat: number
}

export interface WaterState {
  status: FrameWaterStatus
  wet: number
  total: number
}

/**
 * 3D layer ids in the mission context (`view.hiddenLayers`, shared with every
 * screen and persisted). The `3d-` prefix keeps them clear of 2D feature ids.
 */
export const LAYER_IDS = {
  terrain: '3d-terrain',
  dam: '3d-dam',
  water: '3d-water',
  villages: '3d-villages',
  cascade: '3d-cascade',
  infra: '3d-infra',
} as const
