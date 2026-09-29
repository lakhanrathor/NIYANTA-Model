/**
 * The raster fields a flood map can paint. Every kind here has real tiles for
 * a single run (`/tiles/{run}/{kind}/…`) and for a pair
 * (`/tiles/diff/{a}/{b}/{kind}/…`), so switching the field never lands on a
 * layer the server cannot paint. Pure data — no components (fast-refresh).
 */

export type CompareField = 'depth' | 'arrival' | 'extent' | 'velocity'

export const COMPARE_FIELDS: { value: CompareField; label: string; unit: string }[] = [
  { value: 'depth', label: 'Water depth', unit: 'm' },
  { value: 'arrival', label: 'Arrival time', unit: 'h' },
  { value: 'extent', label: 'Inundation extent', unit: 'class' },
  { value: 'velocity', label: 'Velocity', unit: 'm/s' },
]

export const fieldMeta = (f: string) =>
  COMPARE_FIELDS.find((x) => x.value === f) ?? COMPARE_FIELDS[0]

/** Per-frame tiles (`?frame=N`) exist only for these fields. */
export const FRAME_FIELDS = new Set<CompareField>(['depth', 'extent'])
