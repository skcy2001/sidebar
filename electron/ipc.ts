import { ipcMain, BrowserWindow, Menu, screen } from 'electron'
import type { TabManager } from './tabs/TabManager'
import type { DownloadManager } from './downloads'
import {
  DEFAULT_PANE_WIDTH,
  USER_AGENT_PRESETS,
  type TabAction,
  type Side,
} from '../shared/types'
import { clampPaneWidth, placeRibbonPane } from './windowPlacement'
import { sideNearestToPoint } from './windowAnchoring'
import { loadShellPlacementState, saveShellPlacementState } from './shellState'

let currentSide: Side = loadShellPlacementState().side
let contextMenuOpen = false

export function getCurrentSide(): Side { return currentSide }

export function flushPinnedSitesSave() {
  shell?.tabs.flushPinnedSitesSave()
}

export function setCurrentSide(side: Side) {
  currentSide = side
}

export function isShellCollapsed(): boolean {
  return shell?.tabs.isCollapsed() ?? true
}

export function setContextMenuOpen(open: boolean) {
  contextMenuOpen = Boolean(open)
}

export function isContextMenuOpen(): boolean {
  return contextMenuOpen
}

type Shell = {
  ribbonWin: BrowserWindow
  paneWin: BrowserWindow
  tabs: TabManager
  downloads: DownloadManager
}

let shell: Shell | null = null
let detachTabState: (() => void) | undefined
let detachPinned: (() => void) | undefined
let detachDownloads: (() => void) | undefined
let ipcInstalled = false

function sendToShellWindows(ribbon: BrowserWindow, pane: BrowserWindow, channel: string, ...args: unknown[]) {
  const wcSend = (wc: Electron.WebContents) => {
    ;(wc.send as (ch: string, ...a: unknown[]) => void)(channel, ...args)
  }
  for (const win of [ribbon, pane]) {
    if (!win.isDestroyed()) wcSend(win.webContents)
  }
}

function applyPlacement(workArea?: Electron.Rectangle) {
  if (!shell) return
  placeRibbonPane(
    shell.ribbonWin,
    shell.paneWin,
    currentSide,
    shell.tabs.isCollapsed(),
    shell.tabs.getActiveExpandedWidth(),
    workArea,
  )
}

function syncLayout() {
  if (!shell) return
  applyPlacement()
  shell.tabs.relayout()
}

function restoreActiveExpandedWidth() {
  if (!shell || shell.tabs.isCollapsed()) return
  applyPlacement()
  shell.tabs.relayout()
}

function collapseToRibbonOnly() {
  if (!shell) return
  const { ribbonWin: rw, paneWin: pw, tabs: t } = shell
  if (t.isCollapsed()) return
  t.setCollapsed(true)
  syncLayout()
  sendToShellWindows(rw, pw, 'window:collapsed', true)
}

function toggleCollapsed() {
  if (!shell) return
  const { ribbonWin: rw, paneWin: pw, tabs: t } = shell
  const nextCollapsed = !t.isCollapsed()
  t.setCollapsed(nextCollapsed)
  syncLayout()
  sendToShellWindows(rw, pw, 'window:collapsed', nextCollapsed)
  const b = rw.getBounds()
  const disp = screen.getDisplayNearestPoint({
    x: Math.floor(b.x + b.width / 2),
    y: Math.floor(b.y + b.height / 2),
  })
  saveShellPlacementState({ displayId: disp.id, side: currentSide, collapsed: nextCollapsed })
}

export function requestAddressFocus() {
  if (!shell) return
  sendToShellWindows(shell.ribbonWin, shell.paneWin, 'tabs:focusAddress')
}

export function createTabFromShortcut() {
  if (!shell) return
  const wasCollapsed = shell.tabs.isCollapsed()
  dispatchTabAction({ type: 'create' })
  if (wasCollapsed) dispatchTabAction({ type: 'toggleCollapsed' })
  requestAddressFocus()
}

export function toggleCollapsedFromShortcut() {
  dispatchTabAction({ type: 'toggleCollapsed' })
}

/**
 * Opens a URL that page content asked for (window.open / target=_blank).
 * Background tabs load without stealing the pane.
 */
export function openUrlInNewTab(url: string, background: boolean) {
  if (!shell) return
  const { paneWin: pw, tabs: t } = shell
  const width = t.isCollapsed() ? t.getActiveExpandedWidth() : getCurrentPaneWidth(pw)
  t.createTab(url, width, undefined, !background)
  if (!background) restoreActiveExpandedWidth()
}

export function dispatchTabAction(action: TabAction) {
  if (!shell) return
  const { ribbonWin: rw, paneWin: pw, tabs: t } = shell

  switch (action.type) {
    case 'create':
      t.createTab(
        action.url,
        t.isCollapsed() ? t.getActiveExpandedWidth() : getCurrentPaneWidth(pw),
      )
      restoreActiveExpandedWidth()
      break
    case 'close':
      t.closeTab(action.id)
      if (t.getTabCount() === 0) collapseToRibbonOnly()
      else restoreActiveExpandedWidth()
      break
    case 'activate':
      t.activateTab(action.id)
      restoreActiveExpandedWidth()
      break
    case 'reorderTabs':
      t.reorderTabs(action.fromId, action.toId, action.before ?? true)
      break
    case 'navigate':
      t.navigate(action.url)
      break
    case 'back':
      t.back()
      break
    case 'forward':
      t.forward()
      break
    case 'reload':
      t.reload()
      break
    case 'toggleCollapsed':
      toggleCollapsed()
      break
    case 'toggleSide': {
      currentSide = currentSide === 'left' ? 'right' : 'left'
      t.setSide(currentSide)
      syncLayout()
      sendToShellWindows(rw, pw, 'window:side', currentSide)
      const b = rw.getBounds()
      const disp = screen.getDisplayNearestPoint({
        x: Math.floor(b.x + b.width / 2),
        y: Math.floor(b.y + b.height / 2),
      })
      saveShellPlacementState({ displayId: disp.id, side: currentSide, collapsed: t.isCollapsed() })
      break
    }
  }
}

function getCurrentPaneWidth(win: BrowserWindow): number {
  if (win.isDestroyed()) return DEFAULT_PANE_WIDTH
  const [w] = win.getSize()
  return clampPaneWidth(w)
}

/** Snap ribbon + pane to the work area / side implied by a screen point (pointer release). */
function commitShellPlacementAtScreenPoint(screenX: number, screenY: number) {
  if (!shell || shell.ribbonWin.isDestroyed()) return
  const { ribbonWin, paneWin, tabs } = shell
  const pt = { x: Math.round(screenX), y: Math.round(screenY) }
  const display = screen.getDisplayNearestPoint(pt)
  const wa = display.workArea
  const newSide = sideNearestToPoint(pt, wa)
  let sideChanged = false
  if (newSide !== currentSide) {
    currentSide = newSide
    tabs.setSide(currentSide)
    sideChanged = true
  }
  placeRibbonPane(ribbonWin, paneWin, currentSide, tabs.isCollapsed(), tabs.getActiveExpandedWidth(), wa)
  tabs.relayout()
  if (sideChanged) {
    sendToShellWindows(ribbonWin, paneWin, 'window:side', currentSide)
  }
  saveShellPlacementState({ displayId: display.id, side: currentSide, collapsed: tabs.isCollapsed() })
}

export function registerIpc(
  ribbonWin: BrowserWindow,
  paneWin: BrowserWindow,
  tabs: TabManager,
  downloads: DownloadManager,
) {
  shell = { ribbonWin, paneWin, tabs, downloads }

  detachTabState?.()
  detachPinned?.()
  detachDownloads?.()
  detachDownloads = downloads.onChange(state => {
    // Broadcast: the downloads popover is its own window, not part of `shell`.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('downloads:state', state)
    }
  })
  detachTabState = tabs.onStateChange(state => {
    if (!shell) return
    sendToShellWindows(shell.ribbonWin, shell.paneWin, 'tabs:state', state)
  })
  detachPinned = tabs.onPinnedSitesChange(sites => {
    if (!shell) return
    sendToShellWindows(shell.ribbonWin, shell.paneWin, 'tabs:pinnedSites', sites)
  })

  if (!ipcInstalled) {
    ipcInstalled = true

    ipcMain.handle('tabs:getState', () => shell?.tabs.getState() ?? [])
    ipcMain.handle('tabs:getPinnedSites', () => shell?.tabs.getPinnedSites() ?? [])
    ipcMain.handle('window:getSide', () => currentSide)
    ipcMain.handle('window:getCollapsed', () => shell?.tabs.isCollapsed() ?? true)
    ipcMain.handle('tabs:capturePreview', async (_e, tabId: number) => {
      const wc = shell?.tabs.getTabWebContentsById(Number(tabId))
      if (!wc || wc.isDestroyed()) return null
      try {
        const img = await wc.capturePage()
        return img.toDataURL()
      } catch {
        return null
      }
    })

    ipcMain.handle('tabs:getAudioInfo', (_e, tabId: number) => {
      return shell?.tabs.getAudioInfo(Number(tabId)) ?? null
    })

    ipcMain.handle('tabs:togglePlayPause', async (_e, tabId: number) => {
      const wc = shell?.tabs.getTabWebContentsById(Number(tabId))
      if (!wc || wc.isDestroyed()) return
      // Best-effort: toggle the first media element found.
      await wc.executeJavaScript(
        `(() => {
          const el = document.querySelector('video, audio');
          if (!el) return;
          if (el.paused) el.play?.();
          else el.pause?.();
        })();`,
        true,
      ).catch(() => {})
    })

    ipcMain.handle('tabs:nextTrack', async (_e, tabId: number) => {
      const wc = shell?.tabs.getTabWebContentsById(Number(tabId))
      if (!wc || wc.isDestroyed()) return false
      return await wc.executeJavaScript(
        `(() => {
          const controls = Array.from(document.querySelectorAll('button, [role="button"], a[aria-label], [title], [data-testid]'));
          const labelFor = el => [
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid'),
            el.id,
            typeof el.className === 'string' ? el.className : '',
            el.textContent,
          ].filter(Boolean).join(' ').toLowerCase();
          const isDisabled = el =>
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList?.contains('disabled');
          const next = controls.find(el => {
            if (isDisabled(el)) return false;
            const label = labelFor(el);
            if (/(previous|prev|back|rewind)/.test(label)) return false;
            return /(next|skip|forward)/.test(label);
          });
          if (next) {
            next.click();
            return true;
          }
          const media = Array.from(document.querySelectorAll('video, audio'))
            .find(el => !el.paused || el.currentTime > 0);
          if (media && Number.isFinite(media.duration) && media.duration > 0) {
            media.currentTime = media.duration;
            return true;
          }
          return false;
        })();`,
        true,
      ).catch(() => false)
    })

    ipcMain.handle('tabs:toggleMute', async (_e, tabId: number) => {
      const wc = shell?.tabs.getTabWebContentsById(Number(tabId))
      if (!wc || wc.isDestroyed()) return false
      const next = !wc.isAudioMuted()
      wc.setAudioMuted(next)
      return next
    })

    ipcMain.on('window:commitPlacement', (_e, screenX: number, screenY: number) => {
      const x = Number(screenX)
      const y = Number(screenY)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      commitShellPlacementAtScreenPoint(x, y)
    })

    ipcMain.on('window:setPaneWidth', (_e, width: number) => {
      if (!shell || shell.tabs.isCollapsed()) return
      const w = clampPaneWidth(width)
      shell.tabs.setActiveExpandedWidth(w)
      placeRibbonPane(shell.ribbonWin, shell.paneWin, currentSide, false, w)
      shell.tabs.relayout()
    })

    ipcMain.on('tabs:contextMenu', (_e, tabId: number) => {
      if (!shell) return
      const { ribbonWin: rw } = shell
      setContextMenuOpen(true)
      Menu.buildFromTemplate([
        {
          label: 'Pin to sidebar',
          click: () => shell!.tabs.pinTab(tabId),
        },
        { type: 'separator' },
        {
          label: 'Close tab',
          click: () => {
            shell!.tabs.closeTab(tabId)
            restoreActiveExpandedWidth()
          },
        },
      ]).popup({
        window: rw,
        callback: () => setContextMenuOpen(false),
      })
    })

    ipcMain.on('tabs:pinnedContextMenu', (_e, siteId: string) => {
      if (!shell) return
      const { ribbonWin: rw } = shell
      const openTabId = shell.tabs.getOpenTabIdForPinnedSite(siteId)
      const site = shell.tabs.getPinnedSite(siteId)
      const currentUa = site?.userAgent
      setContextMenuOpen(true)
      Menu.buildFromTemplate([
        {
          label: 'Unpin',
          click: () => shell!.tabs.unpinSite(siteId),
        },
        { type: 'separator' },
        {
          label: 'Isolated session',
          type: 'checkbox',
          checked: Boolean(site?.partition),
          toolTip:
            'Give this site its own cookies so it can be signed in to a different account. Closes its tabs and needs a fresh sign-in.',
          click: menuItem => {
            shell!.tabs.setPinnedSiteIsolated(siteId, menuItem.checked)
            if (shell!.tabs.getTabCount() === 0) collapseToRibbonOnly()
          },
        },
        {
          label: 'User agent',
          submenu: [
            {
              label: 'Default',
              type: 'radio',
              checked: !currentUa,
              click: () => shell!.tabs.setPinnedSiteUserAgent(siteId, undefined),
            },
            {
              label: 'Mobile',
              type: 'radio',
              checked: currentUa === USER_AGENT_PRESETS.mobile,
              click: () => shell!.tabs.setPinnedSiteUserAgent(siteId, USER_AGENT_PRESETS.mobile),
            },
            {
              label: 'Desktop',
              type: 'radio',
              checked: currentUa === USER_AGENT_PRESETS.desktop,
              click: () => shell!.tabs.setPinnedSiteUserAgent(siteId, USER_AGENT_PRESETS.desktop),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Close tab',
          enabled: openTabId !== null,
          click: () => {
            if (openTabId === null) return
            shell!.tabs.closeTab(openTabId)
            if (shell!.tabs.getTabCount() === 0) collapseToRibbonOnly()
            else restoreActiveExpandedWidth()
          },
        },
      ]).popup({
        window: rw,
        callback: () => setContextMenuOpen(false),
      })
    })

    ipcMain.handle('downloads:getState', () => shell?.downloads.getState() ?? [])
    ipcMain.on('downloads:cancel', (_e, id: number) => shell?.downloads.cancel(Number(id)))
    ipcMain.on('downloads:open', (_e, id: number) => {
      shell?.downloads.open(Number(id)).catch(() => {})
    })
    ipcMain.on('downloads:showInFolder', (_e, id: number) =>
      shell?.downloads.showInFolder(Number(id)),
    )
    ipcMain.on('downloads:clear', () => shell?.downloads.clearFinished())

    ipcMain.on('tabs:reorderPinned', (_e, fromSiteId: string, toSiteId: string, before: boolean) => {
      if (!shell) return
      shell.tabs.reorderPinnedSites(String(fromSiteId), String(toSiteId), Boolean(before))
    })

    ipcMain.on('tabs:launchPinnedSite', (_e, siteId: string) => {
      if (!shell) return
      shell.tabs.launchPinnedSite(siteId)
      restoreActiveExpandedWidth()
    })

    ipcMain.on('tabs:action', (_e, action: TabAction) => {
      dispatchTabAction(action)
    })
  }

  return { syncLayout }
}
