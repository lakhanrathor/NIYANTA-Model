import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, num } from '../../lib/format'
import { Icon, Pill, Panel, Prov } from '../../components/ui'
import { usePlayer } from './PlayerProvider'

/** Left rail — who this run belongs to: dam photo, state/engine pills, reach. */
export function RunIdentityPanel() {
  const { runId, damName, riverName, reachKm, summary, spec } = usePlayer()
  const damId = spec?.dam_id ?? null
  const photo = useApi(['dam-photo', damId], () => api.damImage(damId!), {
    enabled: Boolean(damId),
    staleTime: 300_000,
  })
  const stateLabel = summary.data?.status ?? null
  const engineLabel = summary.data?.engine_label ?? null
  const photoUrl = photo.data?.url ?? null

  return (
    <Panel title="Run">
      <div className="flex items-start gap-2.5 p-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)] text-white">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <Icon name="dam" size={20} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{damName ?? EM_DASH}</p>
          <p className="truncate text-[11px] text-[var(--muted)]">
            {[riverName, reachKm != null ? `${num(reachKm, 0)} km reach` : null].filter(Boolean).join(' · ') ||
              EM_DASH}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone={stateLabel === 'VALIDATED' || stateLabel === 'PUBLISHED' ? 'ok' : 'accent'}>
              {stateLabel ?? '—'}
            </Pill>
            {engineLabel && <Pill tone="muted">{engineLabel}</Pill>}
          </div>
        </div>
      </div>
      <Prov>
        Dam, river and reach from the mission context · run {runId ? runId.slice(0, 8) : EM_DASH} ·{' '}
        <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}</span>
      </Prov>
    </Panel>
  )
}
