import { shell } from 'electron'
import path from 'path'
import type { DownloadInfo, DownloadState } from '../shared/types'

export type DownloadsListener = (downloads: DownloadInfo[]) => void

interface TrackedDownload {
  info: DownloadInfo
  item: Electron.DownloadItem | null
}

/** How many finished downloads to keep in the popover before dropping the oldest. */
const MAX_HISTORY = 30

/**
 * Watches `will-download` across every session the app uses (the shared browser
 * partition plus one per isolated pinned site) and exposes a single merged list.
 */
export class DownloadManager {
  private downloads: TrackedDownload[] = []
  private listeners = new Set<DownloadsListener>()
  private attached = new WeakSet<Electron.Session>()
  private nextId = 1

  /** Safe to call repeatedly with the same session; only the first call binds. */
  attachSession(ses: Electron.Session) {
    if (this.attached.has(ses)) return
    this.attached.add(ses)
    ses.on('will-download', (_event, item) => this.track(item))
  }

  onChange(listener: DownloadsListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): DownloadInfo[] {
    return this.downloads.map(d => ({ ...d.info }))
  }

  private emit() {
    const state = this.getState()
    this.listeners.forEach(l => l(state))
  }

  private track(item: Electron.DownloadItem) {
    const id = this.nextId++
    const entry: TrackedDownload = {
      item,
      info: {
        id,
        filename: item.getFilename(),
        url: item.getURL(),
        savePath: item.getSavePath(),
        state: 'progressing',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now(),
      },
    }

    this.downloads.unshift(entry)
    this.trim()

    item.on('updated', (_e, state) => {
      entry.info.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      entry.info.receivedBytes = item.getReceivedBytes()
      entry.info.totalBytes = item.getTotalBytes()
      // savePath is only final once Chromium has resolved naming collisions.
      entry.info.savePath = item.getSavePath()
      entry.info.filename = path.basename(item.getSavePath()) || entry.info.filename
      this.emit()
    })

    item.once('done', (_e, state) => {
      entry.info.state = doneStateToInfo(state)
      entry.info.receivedBytes = item.getReceivedBytes()
      entry.info.totalBytes = item.getTotalBytes()
      entry.info.savePath = item.getSavePath()
      entry.info.filename = path.basename(item.getSavePath()) || entry.info.filename
      // The DownloadItem is dead after `done`; drop it so we never call into it.
      entry.item = null
      this.emit()
    })

    this.emit()
  }

  private trim() {
    if (this.downloads.length <= MAX_HISTORY) return
    // Keep anything still running regardless of age.
    const keep: TrackedDownload[] = []
    for (const d of this.downloads) {
      if (keep.length < MAX_HISTORY || d.info.state === 'progressing' || d.info.state === 'paused') {
        keep.push(d)
      }
    }
    this.downloads = keep
  }

  private find(id: number) {
    return this.downloads.find(d => d.info.id === id) ?? null
  }

  cancel(id: number) {
    const entry = this.find(id)
    entry?.item?.cancel()
  }

  /** Opens the downloaded file; no-ops unless the download completed. */
  async open(id: number) {
    const entry = this.find(id)
    if (!entry || entry.info.state !== 'completed' || !entry.info.savePath) return
    await shell.openPath(entry.info.savePath)
  }

  showInFolder(id: number) {
    const entry = this.find(id)
    if (!entry || !entry.info.savePath) return
    shell.showItemInFolder(entry.info.savePath)
  }

  /** Clears finished entries from the list; in-flight downloads keep running. */
  clearFinished() {
    this.downloads = this.downloads.filter(
      d => d.info.state === 'progressing' || d.info.state === 'paused',
    )
    this.emit()
  }
}

function doneStateToInfo(state: 'completed' | 'cancelled' | 'interrupted'): DownloadState {
  if (state === 'completed') return 'completed'
  if (state === 'cancelled') return 'cancelled'
  return 'interrupted'
}
