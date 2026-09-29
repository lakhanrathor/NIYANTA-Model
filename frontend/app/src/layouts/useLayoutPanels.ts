import { useCallback, useState } from 'react'
import { AREA_DEFAULTS, loadOpen, loadWidth, saveOpen, saveWidth } from './types'

export interface PanelControl {
  width: number
  open: boolean
  setWidth: (width: number) => void
  setOpen: (open: boolean) => void
  toggle: () => void
}

export interface DockControl {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export interface LayoutPanels {
  left: PanelControl
  right: PanelControl
  dock: DockControl
}

/**
 * App-level panel state for one page layout. Widths and collapsed flags are
 * persisted per page (`niyanta.layout.<page>.<area>…`), so Run's drawer
 * widths never fight Discover's, and everything survives refresh + routing.
 */
export function useLayoutPanels(layoutId: string): LayoutPanels {
  const [leftW, setLeftW] = useState(() => loadWidth(layoutId, 'left'))
  const [rightW, setRightW] = useState(() => loadWidth(layoutId, 'right'))
  const [leftOpen, setLeftOpen] = useState(() => loadOpen(layoutId, 'left', true))
  const [rightOpen, setRightOpen] = useState(() => loadOpen(layoutId, 'right', true))
  const [dockOpen, setDockOpen] = useState(() => loadOpen(layoutId, 'dock', false))

  const setLeft = useCallback(
    (width: number) => {
      const v = Math.max(AREA_DEFAULTS.left.min, Math.min(AREA_DEFAULTS.left.max, width))
      setLeftW(v)
      saveWidth(layoutId, 'left', v)
    },
    [layoutId],
  )
  const setRight = useCallback(
    (width: number) => {
      const v = Math.max(AREA_DEFAULTS.right.min, Math.min(AREA_DEFAULTS.right.max, width))
      setRightW(v)
      saveWidth(layoutId, 'right', v)
    },
    [layoutId],
  )
  const setLeftO = useCallback(
    (open: boolean) => {
      setLeftOpen(open)
      saveOpen(layoutId, 'left', open)
    },
    [layoutId],
  )
  const setRightO = useCallback(
    (open: boolean) => {
      setRightOpen(open)
      saveOpen(layoutId, 'right', open)
    },
    [layoutId],
  )
  const setDockO = useCallback(
    (open: boolean) => {
      setDockOpen(open)
      saveOpen(layoutId, 'dock', open)
    },
    [layoutId],
  )

  return {
    left: {
      width: leftW,
      open: leftOpen,
      setWidth: setLeft,
      setOpen: setLeftO,
      toggle: () => setLeftO(!leftOpen),
    },
    right: {
      width: rightW,
      open: rightOpen,
      setWidth: setRight,
      setOpen: setRightO,
      toggle: () => setRightO(!rightOpen),
    },
    dock: {
      open: dockOpen,
      setOpen: setDockO,
      toggle: () => setDockO(!dockOpen),
    },
  }
}
