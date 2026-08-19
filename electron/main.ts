import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from 'electron'
import path from 'path'
import { TabManager } from './tabs/TabManager'
import { DownloadManager } from './downloads'
import {
  createTabFromShortcut,
  dispatchTabAction,
  flushPinnedSitesSave,
  getCurrentSide,
  isContextMenuOpen,
  isShellCollapsed,
  openUrlInNewTab,
  registerIpc,
  setContextMenuOpen,
  setCurrentSide,
  toggleCollapsedFromShortcut,
} from './ipc'
import { DEFAULT_PANE_WIDTH, DEFAULT_SIDE, RIBBON_WIDTH } from '../shared/types'
import { placeRibbonPane } from './windowPlacement'
import { loadShellPlacementState, saveShellPlacementState } from './shellState'

const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged

let ribbonWindow: BrowserWindow | null = null
let paneWindow: BrowserWindow | null = null
let playerWindow: BrowserWindow | null = null
let playerTargetTabId: number | null = null
let playerHideTimer: NodeJS.Timeout | null = null
let playerAnchorBounds: Electron.Rectangle | null = null
let edgePeekWindow: BrowserWindow | null = null
let downloadsWindow: BrowserWindow | null = null
let tray: Tray | null = null
const downloadManager = new DownloadManager()
let isQuitting = false
let shellHidden = false
let shellPinned = loadShellPlacementState().pinned
let autoHideTimer: NodeJS.Timeout | null = null
let lastCursorInsideMs = Date.now()
let isDraggingPlacement = false
const AUTOHIDE_GRACE_MS = 450
const PLAYER_WINDOW_WIDTH = 260
const PLAYER_WINDOW_HEIGHT = 336
const PLAYER_WINDOW_MIN_HEIGHT = 120
const PLAYER_RIBBON_GAP = 8
const PLAYER_TOP_LEVEL = 'pop-up-menu'
const DOWNLOADS_WINDOW_WIDTH = 320
const DOWNLOADS_WINDOW_HEIGHT = 380
const DOWNLOADS_REOPEN_GRACE_MS = 250
let downloadsHiddenAtMs = 0

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

function pointInBounds(point: { x: number; y: number }, bounds: Electron.Rectangle) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

function rectFromNumbers(x: number, y: number, width: number, height: number): Electron.Rectangle | null {
  if (![x, y, width, height].every(Number.isFinite)) return null
  if (width <= 0 || height <= 0) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isCursorInsidePlayerOrAnchor() {
  const pt = screen.getCursorScreenPoint()
  if (playerAnchorBounds && pointInBounds(pt, playerAnchorBounds)) return true
  if (
    playerWindow &&
    !playerWindow.isDestroyed() &&
    playerWindow.isVisible() &&
    pointInBounds(pt, playerWindow.getBounds())
  ) {
    return true
  }
  return false
}

function isCursorInsideShell() {
  const pt = screen.getCursorScreenPoint()
  // Auto-hide is only for collapsed (ribbon-only) mode.
  const wins = isShellCollapsed()
    ? [ribbonWindow, playerWindow].filter((w): w is BrowserWindow => !!w && !w.isDestroyed() && w.isVisible())
    : []
  for (const w of wins) {
    if (pointInBounds(pt, w.getBounds())) return true
  }
  return false
}

function startAutoHideLoop() {
  if (autoHideTimer) return
  autoHideTimer = setInterval(() => {
    if (shellHidden) return
    if (shellPinned) return
    if (isDraggingPlacement) return
    if (isContextMenuOpen()) return
    if (!ribbonWindow || ribbonWindow.isDestroyed()) return
    if (!ribbonWindow.isVisible()) return
    if (!isShellCollapsed()) return

    const inside = isCursorInsideShell()
    if (inside) {
      lastCursorInsideMs = Date.now()
      return
    }

    const elapsed = Date.now() - lastCursorInsideMs
    if (elapsed >= AUTOHIDE_GRACE_MS) {
      hideShell()
    }
  }, 120)
}

function showShell() {
  shellHidden = false
  if (edgePeekWindow && !edgePeekWindow.isDestroyed()) edgePeekWindow.hide()
  if (ribbonWindow && !ribbonWindow.isDestroyed()) {
    ribbonWindow.show()
  }
  if (paneWindow && !paneWindow.isDestroyed()) {
    if (!isShellCollapsed()) paneWindow.show()
  }
  lastCursorInsideMs = Date.now()
  startAutoHideLoop()
  raisePlayerWindow()
}

function hideShell() {
  shellHidden = true
  if (paneWindow && !paneWindow.isDestroyed()) paneWindow.hide()
  if (ribbonWindow && !ribbonWindow.isDestroyed()) ribbonWindow.hide()
  hidePlayerNow()
  ensureEdgePeekWindow()
  if (edgePeekWindow && !edgePeekWindow.isDestroyed()) {
    updateEdgePeekBounds()
    edgePeekWindow.showInactive()
  }
}

function toggleShellVisibility() {
  if (!ribbonWindow || ribbonWindow.isDestroyed()) return
  const visible = ribbonWindow.isVisible()
  if (visible) hideShell()
  else showShell()
}

function cancelPlayerHide() {
  if (!playerHideTimer) return
  clearTimeout(playerHideTimer)
  playerHideTimer = null
}

function hidePlayerNow() {
  cancelPlayerHide()
  if (playerWindow && !playerWindow.isDestroyed()) playerWindow.hide()
  playerAnchorBounds = null
}

function hidePlayerSoon() {
  cancelPlayerHide()
  playerHideTimer = setTimeout(() => {
    playerHideTimer = null
    if (!isCursorInsidePlayerOrAnchor()) hidePlayerNow()
  }, 120)
}

function keepPlayerAndShellOpen() {
  cancelPlayerHide()
  showShell()
  lastCursorInsideMs = Date.now()
}

function raisePlayerWindow() {
  if (!playerWindow || playerWindow.isDestroyed() || !playerWindow.isVisible()) return
  playerWindow.setAlwaysOnTop(true, PLAYER_TOP_LEVEL)
  playerWindow.moveTop()
}

function resizePlayerWindowToContent(height: number) {
  if (!playerWindow || playerWindow.isDestroyed()) return
  const rawHeight = Math.ceil(Number(height))
  if (!Number.isFinite(rawHeight)) return

  const bounds = playerWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.floor(bounds.x + bounds.width / 2),
    y: Math.floor(bounds.y + bounds.height / 2),
  })
  const wa = display.workArea
  const nextHeight = clamp(rawHeight, PLAYER_WINDOW_MIN_HEIGHT, Math.max(PLAYER_WINDOW_MIN_HEIGHT, wa.height - 16))
  if (bounds.width === PLAYER_WINDOW_WIDTH && Math.abs(bounds.height - nextHeight) < 2) return

  const anchorCenterY = playerAnchorBounds
    ? playerAnchorBounds.y + playerAnchorBounds.height / 2
    : bounds.y + bounds.height / 2
  const nextY = clamp(Math.round(anchorCenterY - nextHeight / 2), wa.y, wa.y + wa.height - nextHeight)
  playerWindow.setBounds({ x: bounds.x, y: nextY, width: PLAYER_WINDOW_WIDTH, height: nextHeight }, false)
  raisePlayerWindow()
}

function refreshTrayMenu() {
  tray?.setContextMenu(buildShellMenu())
}

function toggleShellPinned() {
  shellPinned = !shellPinned
  saveShellPlacementState({ pinned: shellPinned })
  refreshTrayMenu()

  if (shellPinned) {
    showShell()
    return
  }

  lastCursorInsideMs = Date.now()
  startAutoHideLoop()
}

function ensureTray() {
  if (tray) return
  // Windows tray is most reliable with PNG/ICO (not SVG).
  // Tiny built-in PNG icon (16x16).
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAm0lEQVQ4T+2SsQ2AMAwFf7QwQmQG0Qq0gSxgE9oB2oC6gK7wI3qZKQmVY2kVg0zq0wQYg7y2oYQJ9m1m9h1g9x2rQJQ3Jc0p9Gm0b5b5DgZKkq8p8a2oZ0cQm4o3r5Cqg3gQYwJgqv8r1w0o8gFvVwSgqY0m8QAAAABJRU5ErkJggg==',
  )
  tray = new Tray(icon)
  tray.setToolTip('Sidebar')
  refreshTrayMenu()
  tray.on('click', () => toggleShellVisibility())
}

function buildShellMenu() {
  return Menu.buildFromTemplate([
    {
      label: shellPinned ? 'Unpin' : 'Pin',
      click: () => toggleShellPinned(),
    },
    ...(IS_DEV
      ? ([
          { type: 'separator' as const },
          {
            label: 'Open DevTools',
            click: () => {
              if (ribbonWindow && !ribbonWindow.isDestroyed()) ribbonWindow.webContents.openDevTools({ mode: 'detach' })
              if (paneWindow && !paneWindow.isDestroyed()) paneWindow.webContents.openDevTools({ mode: 'detach' })
              if (playerWindow && !playerWindow.isDestroyed()) playerWindow.webContents.openDevTools({ mode: 'detach' })
            },
          },
        ] as const)
      : []),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

function shellWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    backgroundThrottling: false,
    sandbox: false,
  } as const
}

function loadRenderer(win: BrowserWindow, role: 'ribbon' | 'pane' | 'player' | 'edge' | 'downloads') {
  if (IS_DEV) {
    const q =
      role === 'ribbon'
        ? '?role=ribbon'
        : role === 'player'
        ? '?role=player'
        : role === 'edge'
        ? '?role=edge'
        : role === 'downloads'
        ? '?role=downloads'
        : '?role=pane'
    win.loadURL(`http://127.0.0.1:5173/${q}`).catch(error => console.error('[main] failed to load dev URL', error))
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { role } }).catch(error =>
      console.error('[main] failed to load file', error),
    )
  }
}

function attachWebContentsDiagnostics(win: BrowserWindow, label: string) {
  const wc = win.webContents
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    console.error(`[main] ${label} did-fail-load`, { errorCode, errorDescription, validatedURL })
  })
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[main] ${label} render-process-gone`, details)
  })
  wc.on('unresponsive', () => {
    console.error(`[main] ${label} renderer unresponsive`)
  })
  wc.on('responsive', () => {
    console.log(`[main] ${label} renderer responsive`)
  })
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    // level: 0=log,1=warn,2=error
    const tag = level === 2 ? 'error' : level === 1 ? 'warn' : 'log'
    console[tag](`[${label} console] ${message} (${sourceId}:${line})`)
  })
}

function usesPrimaryModifier(input: Electron.Input) {
  return process.platform === 'darwin'
    ? input.meta && !input.control
    : input.control && !input.meta
}

function handleShortcutInput(event: Electron.Event, input: Electron.Input) {
  if (input.type !== 'keyDown') return
  if (input.isAutoRepeat || input.isComposing) return
  if (!usesPrimaryModifier(input) || input.alt) return

  const key = input.key.toLowerCase()
  if (!input.shift && key === 't') {
    event.preventDefault()
    createTabFromShortcut()
    return
  }

  if (input.shift && key === 'e') {
    event.preventDefault()
    toggleCollapsedFromShortcut()
  }
}

function attachShellShortcuts(win: BrowserWindow) {
  win.webContents.on('before-input-event', handleShortcutInput)
}

function wireCloseTogether(ribbon: BrowserWindow, pane: BrowserWindow) {
  // With skipTaskbar enabled, default "close" UX is to hide to tray.
  ribbon.on('close', e => {
    if (isQuitting) return
    e.preventDefault()
    hideShell()
  })
  pane.on('close', e => {
    if (isQuitting) return
    e.preventDefault()
    hideShell()
  })
}

function createShell() {
  const persisted = loadShellPlacementState()
  const displays = screen.getAllDisplays()
  const display = persisted.displayId != null
    ? displays.find(d => d.id === persisted.displayId) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay()
  const { workArea } = display
  const height = workArea.height
  const y = workArea.y

  const ribbonWin = new BrowserWindow({
    width: RIBBON_WIDTH,
    height,
    x: persisted.side === 'right' ? workArea.x + workArea.width - RIBBON_WIDTH : workArea.x,
    y,
    frame: false,
    resizable: false,
    // Reposition only via renderer grip → `window:commitPlacement` on pointer release.
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: shellWebPreferences(),
  })

  const paneWin = new BrowserWindow({
    width: DEFAULT_PANE_WIDTH,
    height,
    x: workArea.x,
    y,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: shellWebPreferences(),
  })

  const tabManager = new TabManager(paneWin)
  tabManager.setBeforeInputHandler(handleShortcutInput)
  tabManager.setSessionHook(ses => downloadManager.attachSession(ses))
  tabManager.setNewTabRequestHandler((url, background) => {
    openUrlInNewTab(url, background)
    if (background) return
    // A link that opened a tab should be visible, even if we were hidden/collapsed.
    if (isShellCollapsed()) dispatchTabAction({ type: 'toggleCollapsed' })
    showShell()
  })
  const { syncLayout } = registerIpc(ribbonWin, paneWin, tabManager, downloadManager)

  setCurrentSide(persisted.side)
  shellPinned = persisted.pinned
  refreshTrayMenu()
  tabManager.setCollapsed(persisted.collapsed)
  placeRibbonPane(ribbonWin, paneWin, persisted.side, persisted.collapsed, DEFAULT_PANE_WIDTH, workArea)
  tabManager.createTab()

  paneWin.on('resize', () => {
    tabManager.relayout()
  })
  ribbonWin.on('show', raisePlayerWindow)
  paneWin.on('show', raisePlayerWindow)
  ribbonWin.on('focus', raisePlayerWindow)
  paneWin.on('focus', raisePlayerWindow)

  loadRenderer(ribbonWin, 'ribbon')
  loadRenderer(paneWin, 'pane')

  attachWebContentsDiagnostics(ribbonWin, 'ribbon')
  attachWebContentsDiagnostics(paneWin, 'pane')
  attachShellShortcuts(ribbonWin)
  attachShellShortcuts(paneWin)

  wireCloseTogether(ribbonWin, paneWin)

  const onMetrics = () => syncLayout()
  screen.on('display-metrics-changed', onMetrics)

  ribbonWin.on('closed', () => {
    screen.removeListener('display-metrics-changed', onMetrics)
    if (ribbonWindow === ribbonWin) ribbonWindow = null
  })
  paneWin.on('closed', () => {
    if (paneWindow === paneWin) paneWindow = null
  })

  return { ribbonWin, paneWin, syncLayout }
}

function ensureEdgePeekWindow() {
  if (edgePeekWindow && !edgePeekWindow.isDestroyed()) return edgePeekWindow
  const win = new BrowserWindow({
    width: 2,
    height: 200,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: shellWebPreferences(),
  })
  loadRenderer(win, 'edge')
  win.on('closed', () => {
    if (edgePeekWindow === win) edgePeekWindow = null
  })
  edgePeekWindow = win
  return win
}

function updateEdgePeekBounds() {
  if (!edgePeekWindow || edgePeekWindow.isDestroyed()) return
  const persisted = loadShellPlacementState()
  const displays = screen.getAllDisplays()
  const display = persisted.displayId != null
    ? displays.find(d => d.id === persisted.displayId) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay()
  const wa = display.workArea
  const width = 2
  const x = persisted.side === 'left' ? wa.x : wa.x + wa.width - width
  edgePeekWindow.setBounds({ x, y: wa.y, width, height: wa.height })
}

function ensureDownloadsWindow() {
  if (downloadsWindow && !downloadsWindow.isDestroyed()) return downloadsWindow
  const win = new BrowserWindow({
    width: DOWNLOADS_WINDOW_WIDTH,
    height: DOWNLOADS_WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: shellWebPreferences(),
  })
  win.setAlwaysOnTop(true, PLAYER_TOP_LEVEL)
  loadRenderer(win, 'downloads')
  // Dismiss like a menu: clicking anywhere else closes it.
  win.on('blur', () => {
    if (win.isDestroyed()) return
    downloadsHiddenAtMs = Date.now()
    win.hide()
  })
  win.on('closed', () => {
    if (downloadsWindow === win) downloadsWindow = null
  })
  downloadsWindow = win
  return win
}

/** Anchors the downloads popover beside the pane, below the toolbar button. */
function toggleDownloadsPanel(screenX: number, screenY: number) {
  // Clicking the toolbar button while the popover is open blurs it first, so by
  // the time this runs it is already hidden. Without this guard it would
  // immediately reopen and the button could never close it.
  if (Date.now() - downloadsHiddenAtMs < DOWNLOADS_REOPEN_GRACE_MS) return

  const win = ensureDownloadsWindow()
  if (win.isVisible()) {
    downloadsHiddenAtMs = Date.now()
    win.hide()
    return
  }

  const display = screen.getDisplayNearestPoint({ x: Math.round(screenX), y: Math.round(screenY) })
  const wa = display.workArea
  const side = getCurrentSide()
  // Grow inward from the sidebar so the popover never runs off-screen.
  const x = side === 'right'
    ? Math.max(wa.x, Math.round(screenX) - DOWNLOADS_WINDOW_WIDTH)
    : Math.min(Math.round(screenX), wa.x + wa.width - DOWNLOADS_WINDOW_WIDTH)
  const y = clamp(Math.round(screenY), wa.y, wa.y + wa.height - DOWNLOADS_WINDOW_HEIGHT)

  win.setBounds({ x, y, width: DOWNLOADS_WINDOW_WIDTH, height: DOWNLOADS_WINDOW_HEIGHT })
  win.setAlwaysOnTop(true, PLAYER_TOP_LEVEL)
  win.show()
  win.focus()
}

function ensurePlayerWindow() {
  if (playerWindow && !playerWindow.isDestroyed()) return playerWindow
  const win = new BrowserWindow({
    width: PLAYER_WINDOW_WIDTH,
    height: PLAYER_WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: shellWebPreferences(),
  })
  win.setAlwaysOnTop(true, PLAYER_TOP_LEVEL)
  loadRenderer(win, 'player')
  win.on('closed', () => {
    if (playerWindow === win) playerWindow = null
  })
  playerWindow = win
  return win
}

app.whenReady().then(() => {
  console.log('[main] app ready')
  ensureTray()
  ipcMain.on('shell:contextMenu', (e, clientX: number, clientY: number) => {
    const x = Math.round(Number(clientX))
    const y = Math.round(Number(clientY))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const win = BrowserWindow.fromWebContents(e.sender)
    setContextMenuOpen(true)
    buildShellMenu().popup({
      window: win ?? undefined,
      x,
      y,
      callback: () => setContextMenuOpen(false),
    })
  })
  ipcMain.on('shell:show', () => showShell())
  ipcMain.on('downloads:togglePanel', (_e, screenX: number, screenY: number) => {
    const x = Number(screenX)
    const y = Number(screenY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    toggleDownloadsPanel(x, y)
  })
  ipcMain.on('downloads:closePanel', () => {
    if (downloadsWindow && !downloadsWindow.isDestroyed()) downloadsWindow.hide()
  })
  ipcMain.on('window:setDragging', (_e, dragging: boolean) => {
    isDraggingPlacement = Boolean(dragging)
    if (isDraggingPlacement) {
      // While dragging, keep the shell visible (avoids disappearing mid-gesture).
      showShell()
    } else {
      // Restart grace period after mouse up.
      lastCursorInsideMs = Date.now()
    }
  })

  ipcMain.handle('player:getTarget', () => playerTargetTabId)
  ipcMain.on(
    'player:show',
    (
      _e,
      tabId: number,
      screenX: number,
      screenY: number,
      anchorX: number,
      anchorY: number,
      anchorWidth: number,
      anchorHeight: number,
    ) => {
    const id = Number(tabId)
    if (!Number.isFinite(id)) return
    playerTargetTabId = id
    playerAnchorBounds = rectFromNumbers(
      Number(anchorX),
      Number(anchorY),
      Number(anchorWidth),
      Number(anchorHeight),
    )
    cancelPlayerHide()
    const x = Math.round(Number(screenX))
    const y = Math.round(Number(screenY))
    const win = ensurePlayerWindow()
    const ribbonBounds = ribbonWindow && !ribbonWindow.isDestroyed()
      ? ribbonWindow.getBounds()
      : null
    const side = getCurrentSide()
    const display = ribbonBounds
      ? screen.getDisplayNearestPoint({
          x: Math.floor(ribbonBounds.x + ribbonBounds.width / 2),
          y: Math.floor(ribbonBounds.y + ribbonBounds.height / 2),
        })
      : screen.getDisplayNearestPoint({ x, y })
    const wa = display.workArea
    const [w, h] = win.getSize()
    const preferredX = ribbonBounds
      ? side === 'right'
        ? ribbonBounds.x - w - PLAYER_RIBBON_GAP
        : ribbonBounds.x + ribbonBounds.width + PLAYER_RIBBON_GAP
      : x + PLAYER_RIBBON_GAP
    const px = Math.min(Math.max(wa.x, preferredX), wa.x + wa.width - w)
    const py = Math.min(Math.max(wa.y, y - Math.floor(h / 2)), wa.y + wa.height - h)
    win.setPosition(px, py, false)
    win.setAlwaysOnTop(true, PLAYER_TOP_LEVEL)
    win.showInactive()
    raisePlayerWindow()
    win.webContents.send('player:target', playerTargetTabId)
    },
  )
  ipcMain.on('player:hide', () => {
    hidePlayerSoon()
  })
  ipcMain.on('player:keepOpen', () => {
    keepPlayerAndShellOpen()
  })
  ipcMain.on('player:resize', (e, height: number) => {
    if (playerWindow && !playerWindow.isDestroyed() && e.sender !== playerWindow.webContents) return
    resizePlayerWindowToContent(Number(height))
  })
  ipcMain.on('player:openTarget', () => {
    if (playerTargetTabId == null) return
    dispatchTabAction({ type: 'activate', id: playerTargetTabId })
    if (isShellCollapsed()) dispatchTabAction({ type: 'toggleCollapsed' })
    showShell()
    hidePlayerNow()
  })

  app.on('before-quit', () => {
    isQuitting = true
    flushPinnedSitesSave()
  })
  const { ribbonWin, paneWin } = createShell()
  ribbonWindow = ribbonWin
  paneWindow = paneWin

  // Keep the auto-hide loop running for the lifetime of the app so collapse-mode
  // always re-enables hiding correctly, even after window show/hide cycles.
  startAutoHideLoop()

  // If we start hidden (e.g. user hid last session), the edge window will restore it.
  if (shellHidden) hideShell()

  screen.on('display-metrics-changed', () => {
    if (shellHidden) updateEdgePeekBounds()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createShell()
      ribbonWindow = next.ribbonWin
      paneWindow = next.paneWin
    }
  })
})

process.on('uncaughtException', error => {
  console.error('[main] uncaught exception', error)
})

process.on('unhandledRejection', reason => {
  console.error('[main] unhandled rejection', reason)
})

app.on('window-all-closed', () => {
  // Stay resident in the system tray (skipTaskbar apps should not quit when
  // windows are closed/hidden).
  if (process.platform !== 'darwin') return
  app.quit()
})
