import type { BrowserWindow, Rectangle } from 'electron'
import type { Side } from '../shared/types'
import { MAX_EXPANDED_WIDTH, MIN_EXPANDED_WIDTH, RIBBON_WIDTH } from '../shared/types'
import { displayNearestWindowCenter } from './windowAnchoring'
import { expandForReservation } from './appbar'

export function clampPaneWidth(width: number): number {
  return Math.max(MIN_EXPANDED_WIDTH, Math.min(MAX_EXPANDED_WIDTH, Math.round(width)))
}

/** Positions ribbon at the work-area edge and pane flush beside it. */
export function placeRibbonPane(
  ribbon: BrowserWindow,
  pane: BrowserWindow,
  side: Side,
  collapsed: boolean,
  paneWidth: number,
  /** When set (e.g. cursor display during drag), anchor both windows to this work area. */
  workArea?: Rectangle,
) {
  // Registering as an appbar shrinks the reported work area by our own strip;
  // add it back so the ribbon lands inside the reservation rather than beside it.
  const wa = expandForReservation(workArea ?? displayNearestWindowCenter(ribbon).workArea, side)
  const height = wa.height
  const y = wa.y

  const ribbonX = side === 'left'
    ? wa.x
    : wa.x + wa.width - RIBBON_WIDTH

  ribbon.setBounds({
    x: ribbonX,
    y,
    width: RIBBON_WIDTH,
    height,
  })

  if (collapsed) {
    pane.hide()
    return
  }

  const w = clampPaneWidth(paneWidth)
  const paneX = side === 'left' ? wa.x + RIBBON_WIDTH : ribbonX - w

  pane.setBounds({ x: paneX, y, width: w, height })
  if (!pane.isVisible()) pane.show()
}
