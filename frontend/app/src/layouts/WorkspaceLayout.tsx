import type { ReactNode } from 'react'
import { Dock } from './Dock'
import { Panel } from './Panel'
import { useLayoutPanels } from './useLayoutPanels'

interface Props {
  /** Persistence scope: 'run', 'results', … — sizes never leak across pages. */
  layoutId: string
  leftTitle?: string
  rightTitle?: string
  dockTitle?: string
  left?: ReactNode
  /** The map cell. */
  center: ReactNode
  right?: ReactNode
  /** Content docked below the map (logs, timeline, telemetry…). */
  dock?: ReactNode
  dockHeader?: ReactNode
  /** Styling for the map cell (rounded card by default). */
  centerClassName?: string
  className?: string
}

/**
 * Left drawer + map + right drawer + dock. The Run/Results shape: every area
 * is a slot, dragging/collapsing/persistence live here, not in the page.
 */
export function WorkspaceLayout({
  layoutId,
  leftTitle = 'Panel',
  rightTitle = 'Panel',
  dockTitle = 'Dock',
  left,
  center,
  right,
  dock,
  dockHeader,
  centerClassName = 'relative overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm',
  className = 'flex h-full flex-col gap-2 p-2',
}: Props) {
  const panels = useLayoutPanels(layoutId)
  return (
    <div className={className}>
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-hidden">
        {left ? (
          <Panel
            side="left"
            title={leftTitle}
            width={panels.left.width}
            open={panels.left.open}
            onWidth={panels.left.setWidth}
            onToggle={panels.left.toggle}
          >
            {left}
          </Panel>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {/* Fill is guaranteed here so a page can never collapse its map
              cell by forgetting a flex class in centerClassName. */}
          <div className={`min-h-0 min-w-0 flex-1 ${centerClassName}`}>{center}</div>
          {dock ? (
            <Dock title={dockTitle} open={panels.dock.open} onToggle={panels.dock.toggle} header={dockHeader}>
              {dock}
            </Dock>
          ) : null}
        </div>
        {right ? (
          <Panel
            side="right"
            title={rightTitle}
            width={panels.right.width}
            open={panels.right.open}
            onWidth={panels.right.setWidth}
            onToggle={panels.right.toggle}
          >
            {right}
          </Panel>
        ) : null}
      </div>
    </div>
  )
}
