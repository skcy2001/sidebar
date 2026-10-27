/**
 * Slides a shell window horizontally, the way the Windows taskbar retreats to
 * the screen edge and comes back.
 *
 * Electron has no window animation API, so this steps `setBounds` on a timer.
 * One slide runs at a time, and while it runs it owns that window's x: anything
 * that needs the real docked bounds back — placement, a layout sync, going
 * fullscreen — calls {@link settleSlide} first to land it and run its
 * completion now, rather than setting bounds against a live timer.
 */
import type { BrowserWindow } from 'electron'

/** Long enough to read as motion, short enough not to delay a reveal. */
export const SLIDE_DURATION_MS = 150
/** Roughly 60fps. */
const FRAME_MS = 16

interface Running {
  win: BrowserWindow
  toX: number
  y: number
  width: number
  height: number
  onDone?: () => void
  timer: NodeJS.Timeout
}

let running: Running | null = null

export function isSliding() {
  return running !== null
}

function clear() {
  if (!running) return
  clearInterval(running.timer)
  running = null
}

/** easeOutCubic: quick off the mark, gentle on arrival. */
function ease(t: number) {
  return 1 - (1 - t) ** 3
}

function land(r: Running) {
  if (!r.win.isDestroyed()) {
    r.win.setBounds({ x: r.toX, y: r.y, width: r.width, height: r.height })
  }
  r.onDone?.()
}

/**
 * Animates `win` to `toX`, then runs `onDone`.
 *
 * Replaces any slide already in flight *without* running that one's completion,
 * so a reveal interrupting a retreat reverses from wherever the window got to
 * instead of also hiding it. A zero-distance slide skips the timer and
 * completes synchronously, which keeps the already-docked case free.
 */
export function slideTo(win: BrowserWindow, toX: number, onDone?: () => void) {
  clear()
  if (win.isDestroyed()) return

  const { x: fromX, y, width, height } = win.getBounds()
  const distance = toX - fromX
  if (distance === 0) {
    onDone?.()
    return
  }

  const started = Date.now()
  const timer = setInterval(() => {
    const r = running
    if (!r) return
    if (r.win.isDestroyed()) {
      clear()
      return
    }
    const t = (Date.now() - started) / SLIDE_DURATION_MS
    if (t >= 1) {
      clear()
      land(r)
      return
    }
    r.win.setBounds({ x: Math.round(fromX + distance * ease(t)), y, width, height })
  }, FRAME_MS)

  running = { win, toX, y, width, height, onDone, timer }
}

/**
 * Lands the slide in flight at once: the window jumps to its target and its
 * completion runs now. No-op when nothing is sliding.
 */
export function settleSlide() {
  const r = running
  if (!r) return
  clear()
  land(r)
}
