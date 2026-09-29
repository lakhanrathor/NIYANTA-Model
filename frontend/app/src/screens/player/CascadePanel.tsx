import { useNavigate } from 'react-router-dom'
import { num } from '../../lib/format'
import { Icon, Panel, Prov } from '../../components/ui'
import { CascadeRows } from '../../components/cascade/CascadeRows'
import { useCascade } from '../../components/cascade/useCascade'
import { useRiverContext } from '../../lib/river-context'
import { usePlayer } from './PlayerProvider'

/**
 * Right rail — cascade screening for this run's flood. The snapshot lives in
 * the mission context (shared `useCascade` hook — Results reads the same
 * one), so screening here serves every page with one request. Row clicks
 * swing the 3D camera; drafted counterparts hand off to Build; execution
 * always stays manual.
 */
export function CascadePanel() {
  const { runId, sceneRef } = usePlayer()
  const selectDam = useRiverContext((s) => s.selectDam)
  const navigate = useNavigate()
  const c = useCascade(runId)

  const focus = (dam: { dam_id: string; lon: number; lat: number }) => {
    c.setSelectedId(dam.dam_id)
    sceneRef.current?.focusAt(dam.lon, dam.lat)
  }

  return (
    <Panel
      title="Downstream cascade"
      actions={
        c.result?.sourceName ? (
          <span className="num text-[10px] text-[var(--muted)]">from {c.result.sourceName}</span>
        ) : undefined
      }
    >
      {c.error && <p className="px-3 py-2 text-[11px] text-[var(--bad)]">{c.error}</p>}
      {!c.result && !c.error && (
        <p className="px-3 py-2 text-[11px] text-[var(--faint)]">
          {c.busy === 'screen' ? 'Screening registry dams against this flood…' : 'Preparing…'}
        </p>
      )}
      {c.result && (
        <CascadeRows
          dams={c.dams}
          total={c.result.dams.length}
          filter={c.filter}
          setFilter={c.setFilter}
          selectedId={c.selectedId}
          onSelect={focus}
          onOpenBuild={(dam) => {
            selectDam({ id: dam.dam_id, damName: dam.name ?? undefined, damLon: dam.lon, damLat: dam.lat })
            navigate('/build')
          }}
        />
      )}
      <div className="flex flex-wrap gap-1.5 p-2.5">
        <button
          onClick={c.screen}
          disabled={!runId || c.busy != null}
          className="flex items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11px] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          <Icon name="layers" size={12} />
          {c.busy === 'screen' ? 'Screening…' : 'Re-screen'}
        </button>
        {c.wet.length > 0 && (
          <button
            onClick={c.draft}
            disabled={!runId || c.busy != null}
            className="flex items-center gap-1.5 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            <Icon name="file" size={12} />
            {c.busy === 'draft' ? 'Drafting…' : `Draft ${c.wet.length} counterpart${c.wet.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      <Prov>
        Samples this run&apos;s rasters at registry dams (wet beyond{' '}
        <span className="num">{c.result?.depthThresholdM != null ? num(c.result.depthThresholdM, 2) : '0.10'} m</span>). Overtopping
        needs a recorded crest — a flag, not a failure prediction. Counterparts draft
        Froehlich scenarios; execution stays manual on Build.
      </Prov>
    </Panel>
  )
}
