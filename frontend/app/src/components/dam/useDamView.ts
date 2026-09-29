import { useMemo } from 'react'
import { api } from '../../lib/api'
import type { DamRow } from '../../lib/api'
import { useRiverContext } from '../../lib/river-context'
import { useApi } from '../../lib/useApi'

/**
 * The dam, fully merged. Context first (identity + whatever the dam list
 * published), the registry record over it (crest, storage, purpose, …),
 * the photo URL alongside. Null id means no dam — never a placeholder dam.
 */
export interface DamView {
  id: string
  name: string | null
  state: string | null
  lat: number | null
  lon: number | null
  height_m: number | null
  crest_m: number | null
  fsl_m: number | null
  crest_length_m: number | null
  storage_mcm: number | null
  dam_type: string | null
  purpose: string | null
  alongKm: number | null
  status: string | null
  photoUrl: string | null
}

export interface DamViewResult {
  dam: DamView | null
  pending: boolean
  offline: boolean
  /** The photo resolves on its own request — the thumb needs its own state. */
  imagePending: boolean
}

/**
 * THE dam read. Every screen renders dam facts through this hook — context
 * for identity, `GET /api/dams/{id}` for the record, `…/image` for the
 * photo. Nothing dam-shaped travels through props anymore.
 */
export function useDamView(): DamViewResult {
  const river = useRiverContext((s) => s.river)
  const damId = river?.damId ?? null
  const detail = useApi(['dam', damId], () => api.dam(damId!), {
    enabled: Boolean(damId),
    staleTime: 60_000,
  })
  const image = useApi(['dam-image', damId], () => api.damImage(damId!), {
    enabled: Boolean(damId),
    staleTime: 300_000,
  })

  const dam = useMemo<DamView | null>(() => {
    if (!damId) return null
    const d: DamRow | null = detail.data ?? null
    return {
      id: damId,
      name: d?.name ?? river?.damName ?? null,
      state: d?.state ?? river?.damState ?? null,
      lat: d?.lat ?? river?.damLat ?? null,
      lon: d?.lon ?? river?.damLon ?? null,
      height_m: d?.height_m ?? river?.damHeight ?? null,
      crest_m: d?.crest_m ?? river?.damCrest ?? null,
      fsl_m: d?.fsl_m ?? river?.damFsl ?? null,
      crest_length_m: d?.crest_length_m ?? d?.length_m ?? river?.damCrestLength ?? null,
      storage_mcm: d?.storage_mcm ?? d?.capacity_mcm ?? river?.damStorageMcm ?? null,
      dam_type: d?.dam_type ?? river?.damType ?? null,
      purpose: d?.purpose ?? null,
      alongKm: river?.damAlongKm ?? null,
      status: d?.status ?? null,
      photoUrl: image.data?.url ?? null,
    }
  }, [damId, detail.data, image.data, river])

  return { dam, pending: detail.pending, offline: detail.offline, imagePending: image.pending }
}
