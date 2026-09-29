import type { ReactNode } from 'react'
import { Panel } from './Panel'
import { useLayoutPanels } from './useLayoutPanels'

interface Props {
  layoutId: string
  leftTitle?: string
  left?: ReactNode
  /** The map cell. */
  center: ReactNode
  centerClassName?: string
  className?: string
}

/**
 * Left drawer + map. The Discover/Watch shape: search, filters and lists on
 * the left, the map taking the rest.
 */
export function ExplorerLayout({
  layoutId,
  leftTitle = 'Panel',
  left,
  center,
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
        <div className={`min-h-0 min-w-0 flex-1 ${centerClassName}`}>{center}</div>
      </div>
    </div>
  )
}
