import type { ReactNode } from 'react'

interface Props {
  /** The page fills the whole content area (3D player, full-bleed views). */
  center: ReactNode
  className?: string
}

/**
 * No drawers, no dock — the page owns every pixel under the top bar.
 * The Player shape.
 */
export function FullscreenLayout({ center, className = 'flex h-full flex-col p-2' }: Props) {
  return (
    <div className={className}>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{center}</div>
    </div>
  )
}
