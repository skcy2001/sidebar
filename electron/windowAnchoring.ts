import type { BrowserWindow, Rectangle } from 'electron'
import { screen } from 'electron'
import type { Side } from '../shared/types'

/** Left or right dock side: whichever vertical work-area edge is closer to `point` (DIP). */
export function sideNearestToPoint(point: { x: number; y: number }, workArea: Rectangle): Side {
  const leftDist = point.x - workArea.x
  const rightDist = workArea.x + workArea.width - point.x
  return leftDist <= rightDist ? 'left' : 'right'
}

/** Display whose bounds contain the window center (DIP coordinates). */
export function displayNearestWindowCenter(win: BrowserWindow): Electron.Display {
  const b = win.getBounds()
  return screen.getDisplayNearestPoint({
    x: Math.floor(b.x + b.width / 2),
    y: Math.floor(b.y + b.height / 2),
  })
}
