import { Empty, Icon, Metric, Panel, Prov } from '../../components/ui'
import type { RiverDetail, RiverSearchItem } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import type { ApiResult } from '../../lib/useApi'

interface Props {
  river: RiverSearchItem | null
  detail: ApiResult<RiverDetail>
  hasId: boolean
}

export function RiverInfo({ river, detail, hasId }: Props) {
  const info = detail.data
  return (
    <Panel title="River Information">
      {river ? (
        <>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-[var(--accent)]">
              <Icon name="river" size={20} />
            </span>
            <span className="truncate text-[17px] font-semibold">{river.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)]">
            <div className="bg-white">
              <Metric
                label="Total Length"
                value={river.length_km ? num(river.length_km, 1) : EM_DASH}
                unit="km"
              />
              <Metric label="Basin" value={info?.basin ?? river.basin ?? EM_DASH} />
              <Metric
                label="Major Dams"
                value={info?.major_dam_count ?? river.major_dam_count ?? EM_DASH}
              />
            </div>
            <div className="bg-white">
              <Metric
                label="States"
                value={
                  info?.states?.join(', ') ?? river.states?.join(', ') ?? river.state ?? EM_DASH
                }
              />
              <Metric label="Source" value={info?.source_name ?? EM_DASH} />
              <Metric label="Mouth" value={info?.mouth_name ?? EM_DASH} />
            </div>
          </div>
          <Prov offline={detail.offline || !hasId}>
            {!hasId
              ? 'Search result has no local id — details not loaded'
              : detail.offline
                ? 'River details unavailable'
                : 'Catalogue record for the selected river'}
          </Prov>
        </>
      ) : (
        <Empty>Select a river to see its information</Empty>
      )}
    </Panel>
  )
}
