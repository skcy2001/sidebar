/**
 * Registers the ribbon as a Windows *application desktop toolbar* (appbar) — the
 * same mechanism the taskbar uses to reserve screen space. While registered,
 * maximized windows stop at the edge of the reserved strip instead of sliding
 * underneath the sidebar.
 *
 * Only the ribbon width is reserved; the pane floats over other windows so that
 * expanding or collapsing never reflows everything else on the desktop.
 *
 * Also hosts the DWM tweaks that keep these windows flush: suppressing the
 * shadow — Electron's `hasShadow: false` only drops the window-class shadow,
 * while DWM keeps drawing its own for frameless windows because they retain
 * WS_CAPTION — and opting out of Windows 11's rounded corners.
 *
 * Windows-only, and deliberately fail-soft: if the FFI layer or its native
 * binary is unavailable the app keeps working, just without space reservation.
 */
import { screen } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import type { Side } from '../shared/types'

const ABM_NEW = 0x00000000
const ABM_REMOVE = 0x00000001
const ABM_QUERYPOS = 0x00000002
const ABM_SETPOS = 0x00000003

const ABE_LEFT = 0
const ABE_RIGHT = 2

const DWMWA_NCRENDERING_POLICY = 2
const DWMNCRP_DISABLED = 1

const DWMWA_TRANSITIONS_FORCEDISABLED = 3

/** Appbar notifications arrive as this app-defined message. */
export const APPBAR_CALLBACK_MESSAGE = 0x0400 + 1 // WM_USER + 1
const ABN_POSCHANGED = 0x0000001

interface Win32Rect {
  left: number
  top: number
  right: number
  bottom: number
}

interface AppBarData {
  cbSize: number
  hWnd: unknown
  uCallbackMessage: number
  uEdge: number
  rc: Win32Rect
  lParam: number | bigint
}

type ShAppBarMessage = (message: number, data: AppBarData) => number | bigint

type DwmSetWindowAttribute = (hwnd: unknown, attr: number, value: Buffer, size: number) => number

type CreateRectRgn = (x1: number, y1: number, x2: number, y2: number) => unknown
type SetWindowRgn = (hwnd: unknown, hrgn: unknown, redraw: number) => number

interface Native {
  SHAppBarMessage: ShAppBarMessage
  DwmSetWindowAttribute: DwmSetWindowAttribute
  CreateRectRgn: CreateRectRgn
  SetWindowRgn: SetWindowRgn
  sizeofAppBarData: number
}

let native: Native | null = null
let nativeLoadFailed = false

function loadNative(): Native | null {
  if (native) return native
  if (nativeLoadFailed || process.platform !== 'win32') return null

  try {
    // Required lazily: on non-Windows builds koffi may not even be installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const shell32 = koffi.load('shell32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')

    koffi.struct('SIDEBAR_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
    koffi.struct('SIDEBAR_APPBARDATA', {
      cbSize: 'uint32',
      hWnd: 'void *',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: 'SIDEBAR_RECT',
      lParam: 'int64',
    })

    native = {
      SHAppBarMessage: shell32.func(
        'uintptr_t __stdcall SHAppBarMessage(uint32 dwMessage, _Inout_ SIDEBAR_APPBARDATA *pData)',
      ) as ShAppBarMessage,
      DwmSetWindowAttribute: dwmapi.func(
        'int32 __stdcall DwmSetWindowAttribute(void *hwnd, uint32 attr, const void *value, uint32 size)',
      ) as DwmSetWindowAttribute,
      CreateRectRgn: gdi32.func(
        'void * __stdcall CreateRectRgn(int32 x1, int32 y1, int32 x2, int32 y2)',
      ) as CreateRectRgn,
      SetWindowRgn: user32.func(
        'int32 __stdcall SetWindowRgn(void *hWnd, void *hRgn, int32 bRedraw)',
      ) as SetWindowRgn,
      sizeofAppBarData: koffi.sizeof('SIDEBAR_APPBARDATA'),
    }
    return native
  } catch (error) {
    nativeLoadFailed = true
    console.warn('[appbar] native layer unavailable; screen space will not be reserved', error)
    return null
  }
}

/** The HWND as koffi expects it — a pointer-sized value read out of Electron's buffer. */
function hwndFromWindow(win: BrowserWindow): unknown {
  const handle = win.getNativeWindowHandle()
  return handle.length === 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
}

function makeData(hWnd: unknown, sizeofAppBarData: number): AppBarData {
  return {
    cbSize: sizeofAppBarData,
    hWnd,
    uCallbackMessage: APPBAR_CALLBACK_MESSAGE,
    uEdge: ABE_RIGHT,
    rc: { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0,
  }
}

let registeredWindow: BrowserWindow | null = null
let reservedDisplayId: number | null = null
let reservedSide: Side = 'right'
let reservedWidth = 0
/** The strip the shell granted us, in DIPs. Source of truth for placement. */
let reservedRect: Rectangle | null = null

export function isRegistered() {
  return registeredWindow !== null && !registeredWindow.isDestroyed()
}

/**
 * Adds our reserved strip back onto a work area.
 *
 * Windows shrinks `workArea` by the strip as soon as we register, so placing the
 * ribbon against the reported work area would park it *beside* its own
 * reservation instead of inside it. Only applies to the display we reserved on.
 */
export function expandForReservation(workArea: Rectangle, side: Side): Rectangle {
  if (!isRegistered() || !reservedRect || reservedDisplayId === null) return workArea
  if (side !== reservedSide) return workArea

  const display = screen.getDisplayNearestPoint({
    x: Math.floor(workArea.x + workArea.width / 2),
    y: Math.floor(workArea.y + workArea.height / 2),
  })
  if (display.id !== reservedDisplayId) return workArea

  // Union rather than addition: Windows may not have propagated the shrink yet,
  // and adding blindly in that window pushes the ribbon clean off the screen.
  // Unioning with the granted strip gives the same answer either way.
  const left = Math.min(workArea.x, reservedRect.x)
  const right = Math.max(workArea.x + workArea.width, reservedRect.x + reservedRect.width)
  return { x: left, y: workArea.y, width: right - left, height: workArea.height }
}

/**
 * Sets one 32-bit DWM window attribute.
 *
 * Every one of these is cosmetic and fail-soft, which is exactly how a rejected
 * attribute goes unnoticed until someone spots the window looking wrong — so a
 * non-zero HRESULT is logged rather than swallowed.
 */
function setDwmAttribute(
  win: BrowserWindow,
  attribute: number,
  value: number,
  label: string,
): boolean {
  const n = loadNative()
  if (!n || win.isDestroyed()) return false

  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value, 0)
  const hr = Number(n.DwmSetWindowAttribute(hwndFromWindow(win), attribute, buffer, 4))
  if (hr !== 0) console.warn(`[appbar] ${label} rejected: HRESULT 0x${(hr >>> 0).toString(16)}`)
  return hr === 0
}

/**
 * Suppresses the DWM drop shadow for a frameless window.
 *
 * `hasShadow: false` clears the window class's CS_DROPSHADOW, but Electron leaves
 * WS_CAPTION on frameless windows so DWM still composites a shadow of its own.
 * Disabling non-client rendering removes it; there is no visible non-client area
 * on these windows, so nothing else changes.
 */
export function disableWindowShadow(win: BrowserWindow): boolean {
  return setDwmAttribute(win, DWMWA_NCRENDERING_POLICY, DWMNCRP_DISABLED, 'shadow')
}


/**
 * Turns off the transitions Windows animates on show and hide.
 *
 * WS_CAPTION survives on these frameless windows, so `hide()` draws the
 * system's minimize-style sweep toward the taskbar — which, with the taskbar
 * along the bottom, looks like the sidebar dropping away just after it has slid
 * off the screen edge. The sidebar animates its own retreat, so the shell's
 * version is only ever in the way.
 */
/** Size of the region currently applied to each window, to avoid redundant work. */
const regionSizes = new WeakMap<BrowserWindow, { width: number; height: number }>()

/**
 * Clips the window to a hard rectangle the size of its own frame.
 *
 * Needed because the two DWM tweaks above pull against each other: disabling
 * non-client rendering is what suppresses the shadow, but it also leaves DWM
 * rounding the corners regardless of DWMWCP_DONOTROUND. A window region is
 * applied at a lower level than either, so the corners come out square with the
 * shadow still gone.
 *
 * Regions are in physical pixels relative to the window's own top-left, and
 * they do not follow a resize — callers re-apply on every size change. On
 * success the system owns the region and it must not be deleted.
 */
export function squareWindowRegion(win: BrowserWindow): boolean {
  const n = loadNative()
  if (!n || win.isDestroyed()) return false

  const { width, height } = screen.dipToScreenRect(win, win.getBounds())
  if (width <= 0 || height <= 0) return false

  // Re-entrancy guard. SetWindowRgn provokes a resize of its own, so a caller
  // re-applying from the resize event recurses until the stack gives out —
  // which crashes Electron outright. Skipping an unchanged size breaks the
  // cycle, and also makes the common case free.
  const applied = regionSizes.get(win)
  if (applied && applied.width === width && applied.height === height) return true
  regionSizes.set(win, { width, height })

  const region = n.CreateRectRgn(0, 0, width, height)
  if (!region) return false
  // bRedraw false for the same reason; the window repaints on its own anyway.
  return n.SetWindowRgn(hwndFromWindow(win), region, 0) !== 0
}

export function disableWindowTransitions(win: BrowserWindow): boolean {
  return setDwmAttribute(win, DWMWA_TRANSITIONS_FORCEDISABLED, 1, 'transitions')
}

/**
 * Reserves `width` logical pixels along `side` of the display the window is on.
 * Safe to call repeatedly; re-registering just updates the reservation.
 */
export function reserveEdge(win: BrowserWindow, side: Side, width: number): boolean {
  const n = loadNative()
  if (!n || win.isDestroyed()) return false

  const hWnd = hwndFromWindow(win)
  const data = makeData(hWnd, n.sizeofAppBarData)

  if (!isRegistered()) {
    if (!Number(n.SHAppBarMessage(ABM_NEW, data))) return false
    registeredWindow = win
  }

  reservedSide = side
  reservedWidth = width
  applyPosition(n, hWnd, win, side, width)
  reservedDisplayId = displayForWindow(win)?.id ?? null
  return true
}

function applyPosition(n: Native, hWnd: unknown, win: BrowserWindow, side: Side, width: number) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const target = displayForWindow(win) ?? display

  // Appbar rects are physical pixels; Electron bounds are DIPs.
  const desired = screen.dipToScreenRect(win, edgeStrip(target.bounds, side, width))

  const data = makeData(hWnd, n.sizeofAppBarData)
  data.uEdge = side === 'left' ? ABE_LEFT : ABE_RIGHT
  data.rc = toWin32Rect(desired)

  // The shell may push the rect aside to avoid other appbars (e.g. the taskbar);
  // it only adjusts the perpendicular edge, so re-pin our width afterwards.
  n.SHAppBarMessage(ABM_QUERYPOS, data)
  if (side === 'left') data.rc.right = data.rc.left + desired.width
  else data.rc.left = data.rc.right - desired.width

  n.SHAppBarMessage(ABM_SETPOS, data)

  reservedRect = screen.screenToDipRect(win, {
    x: data.rc.left,
    y: data.rc.top,
    width: data.rc.right - data.rc.left,
    height: data.rc.bottom - data.rc.top,
  })
}

function displayForWindow(win: BrowserWindow) {
  if (win.isDestroyed()) return null
  const b = win.getBounds()
  return screen.getDisplayNearestPoint({
    x: Math.floor(b.x + b.width / 2),
    y: Math.floor(b.y + b.height / 2),
  })
}

/** The full-height strip along one side of a display. */
function edgeStrip(bounds: Rectangle, side: Side, width: number): Rectangle {
  return {
    x: side === 'left' ? bounds.x : bounds.x + bounds.width - width,
    y: bounds.y,
    width,
    height: bounds.height,
  }
}

function toWin32Rect(r: Rectangle): Win32Rect {
  return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }
}

/**
 * Releases the reservation. Must run before quit: an appbar left registered can
 * keep the desktop work area shrunk after the app is gone.
 */
export function releaseEdge() {
  const n = loadNative()
  const win = registeredWindow
  registeredWindow = null
  reservedDisplayId = null
  reservedWidth = 0
  reservedRect = null
  if (!n || !win || win.isDestroyed()) return

  const data = makeData(hwndFromWindow(win), n.sizeofAppBarData)
  n.SHAppBarMessage(ABM_REMOVE, data)
}

/**
 * Handles an appbar callback. Windows sends ABN_POSCHANGED when the taskbar
 * moves or another appbar appears, and we have to re-assert our strip.
 */
export function handleCallback(
  notification: number,
  win: BrowserWindow,
  side: Side,
  width: number,
): boolean {
  if (notification !== ABN_POSCHANGED) return false
  if (!isRegistered()) return false
  const n = loadNative()
  if (!n || win.isDestroyed()) return false
  applyPosition(n, hwndFromWindow(win), win, side, width)
  return true
}
