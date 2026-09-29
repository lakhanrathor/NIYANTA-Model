import type { ReactNode } from 'react'
import { Panel } from './Panel'
import { useLayoutPanels } from './useLayoutPanels'

interface Props {
  layoutId: string
  leftTitle?: string
  rightTitle?: string
  left?: ReactNode
  /** The page renders its own panes inside (A/B viewports, wipe slider…). */
  center: ReactNode
  right?: ReactNode
  className?: string
}

/**
 * Optional drawers + full content area. The Compare shape: the page owns
 * complex internals (dual maps, charts), the layout only manages the drawers.
 */
export function CompareLayout({
  layoutId,
  leftTitle = 'Panel',
  rightTitle = 'Panel',
  left,
  center,
  right,
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
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{center}</div>
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
