import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Side } from '../shared/types'

export interface ShellPlacementState {
  displayId: number | null
  side: Side
  collapsed: boolean
  pinned: boolean
}

const DEFAULT_STATE: ShellPlacementState = { displayId: null, side: 'right', collapsed: false, pinned: false }

function statePath() {
  return path.join(app.getPath('userData'), 'shell-placement.json')
}

export function loadShellPlacementState(): ShellPlacementState {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ShellPlacementState> | null
    const side: Side = parsed?.side === 'left' || parsed?.side === 'right' ? parsed.side : DEFAULT_STATE.side
    const displayId = typeof parsed?.displayId === 'number' ? parsed.displayId : DEFAULT_STATE.displayId
    const collapsed = typeof parsed?.collapsed === 'boolean' ? parsed.collapsed : DEFAULT_STATE.collapsed
    const pinned = typeof parsed?.pinned === 'boolean' ? parsed.pinned : DEFAULT_STATE.pinned
    return { side, displayId, collapsed, pinned }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveShellPlacementState(next: Partial<ShellPlacementState>) {
  try {
    const current = loadShellPlacementState()
    const state: ShellPlacementState = { ...current, ...next }
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
  } catch {
    // Best-effort persistence.
  }
}
