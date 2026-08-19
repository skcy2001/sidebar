import { contextBridge, ipcRenderer } from 'electron'
import type { TabAction, TabInfo, Side, PinnedSiteInfo, MediaPlayerInfo, DownloadInfo } from '../shared/types'
import type { SidebarApi } from '../shared/api'

const api: SidebarApi = {
  shell: {
    commitPlacement: (screenX: number, screenY: number) =>
      ipcRenderer.send('window:commitPlacement', screenX, screenY),
    setDragging: (dragging: boolean) => ipcRenderer.send('window:setDragging', dragging),
    showContextMenu: (clientX: number, clientY: number) =>
      ipcRenderer.send('shell:contextMenu', clientX, clientY),
    showShell: () => ipcRenderer.send('shell:show'),
    showPlayer: (
      tabId: number,
      screenX: number,
      screenY: number,
      anchorX: number,
      anchorY: number,
      anchorWidth: number,
      anchorHeight: number,
    ) => ipcRenderer.send('player:show', tabId, screenX, screenY, anchorX, anchorY, anchorWidth, anchorHeight),
    hidePlayer: () => ipcRenderer.send('player:hide'),
    keepPlayerOpen: () => ipcRenderer.send('player:keepOpen'),
    resizePlayer: (height: number) => ipcRenderer.send('player:resize', height),
    openPlayerTarget: () => ipcRenderer.send('player:openTarget'),
    getPlayerTarget: (): Promise<number | null> => ipcRenderer.invoke('player:getTarget'),
    onPlayerTargetChange: (cb: (tabId: number | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tabId: number | null) => cb(tabId)
      ipcRenderer.on('player:target', handler)
      return () => ipcRenderer.removeListener('player:target', handler)
    },
  },
  tabs: {
    getState: (): Promise<TabInfo[]> => ipcRenderer.invoke('tabs:getState'),
    getPinnedSites: (): Promise<PinnedSiteInfo[]> => ipcRenderer.invoke('tabs:getPinnedSites'),
    onChange: (cb: (tabs: TabInfo[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tabs: TabInfo[]) => cb(tabs)
      ipcRenderer.on('tabs:state', handler)
      return () => ipcRenderer.removeListener('tabs:state', handler)
    },
    onPinnedSitesChange: (cb: (sites: PinnedSiteInfo[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sites: PinnedSiteInfo[]) => cb(sites)
      ipcRenderer.on('tabs:pinnedSites', handler)
      return () => ipcRenderer.removeListener('tabs:pinnedSites', handler)
    },
    onCollapsedChange: (cb: (collapsed: boolean) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, collapsed: boolean) => cb(collapsed)
      ipcRenderer.on('window:collapsed', handler)
      return () => ipcRenderer.removeListener('window:collapsed', handler)
    },
    onSideChange: (cb: (side: Side) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, side: Side) => cb(side)
      ipcRenderer.on('window:side', handler)
      return () => ipcRenderer.removeListener('window:side', handler)
    },
    onAddressFocusRequest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('tabs:focusAddress', handler)
      return () => ipcRenderer.removeListener('tabs:focusAddress', handler)
    },
    getCollapsed: (): Promise<boolean> => ipcRenderer.invoke('window:getCollapsed'),
    getSide: (): Promise<Side> => ipcRenderer.invoke('window:getSide'),
    dispatch: (action: TabAction) => ipcRenderer.send('tabs:action', action),
    showContextMenu: (tabId: number) => ipcRenderer.send('tabs:contextMenu', tabId),
    showPinnedContextMenu: (siteId: string) => ipcRenderer.send('tabs:pinnedContextMenu', siteId),
    launchPinnedSite: (siteId: string) => ipcRenderer.send('tabs:launchPinnedSite', siteId),
    setPaneWidth: (width: number) => ipcRenderer.send('window:setPaneWidth', width),
    capturePreview: (tabId: number) => ipcRenderer.invoke('tabs:capturePreview', tabId),
    getAudioInfo: (tabId: number): Promise<MediaPlayerInfo | null> => ipcRenderer.invoke('tabs:getAudioInfo', tabId),
    togglePlayPause: (tabId: number) => ipcRenderer.invoke('tabs:togglePlayPause', tabId),
    nextTrack: (tabId: number) => ipcRenderer.invoke('tabs:nextTrack', tabId),
    toggleMute: (tabId: number) => ipcRenderer.invoke('tabs:toggleMute', tabId),
    reorderPinned: (fromSiteId: string, toSiteId: string, before?: boolean) =>
      ipcRenderer.send('tabs:reorderPinned', fromSiteId, toSiteId, before ?? true),
  },
  downloads: {
    getState: (): Promise<DownloadInfo[]> => ipcRenderer.invoke('downloads:getState'),
    onChange: (cb: (downloads: DownloadInfo[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, downloads: DownloadInfo[]) => cb(downloads)
      ipcRenderer.on('downloads:state', handler)
      return () => ipcRenderer.removeListener('downloads:state', handler)
    },
    togglePanel: (screenX: number, screenY: number) =>
      ipcRenderer.send('downloads:togglePanel', screenX, screenY),
    closePanel: () => ipcRenderer.send('downloads:closePanel'),
    open: (id: number) => ipcRenderer.send('downloads:open', id),
    showInFolder: (id: number) => ipcRenderer.send('downloads:showInFolder', id),
    cancel: (id: number) => ipcRenderer.send('downloads:cancel', id),
    clearFinished: () => ipcRenderer.send('downloads:clear'),
  },
}

contextBridge.exposeInMainWorld('sidebarApi', api)
