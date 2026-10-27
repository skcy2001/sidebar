# Sidebar

An Edge-style **docked sidebar browser** built with **Electron + Vite + React + TypeScript**.

## Requirements

- Node **20+** (see `package.json` engines)
- npm

## Run (development)

```bash
npm install
npm run dev:full
```

`dev:full` compiles the Electron TS (`tsconfig.electron.json`), starts the Vite dev server, waits for it to respond, then launches Electron.

## Build + run (production-like)

```bash
npm run build
npm start
```

## Package installers

```bash
npm run dist        # Windows, arm64
npm run dist:x64    # Windows, x64
npm run dist:mac    # macOS, arm64 + x64 (.dmg and .zip)
```

Artifacts land in `release/`. Each platform must be built on itself — electron-builder
cannot produce macOS bundles from Windows, or vice versa.

## Shortcuts

- `Ctrl+T`: open a new tab and focus the address bar
- `Ctrl+Shift+E`: collapse or expand the sidebar
- `F11`: fullscreen the active tab (`F11` or `Esc` to leave)

## Opening links in the sidebar

Sidebar runs as a single instance: launching it again hands the URL to the
window already running rather than starting a second sidebar.

The installer does not put Sidebar on PATH, so call it by full path:

```
"%LOCALAPPDATA%\Programs\Sidebar\Sidebar.exe" https://example.com
```

It also registers the `sidebar://` scheme, which needs no path at all. Use it
from the Run dialog (Win+R), a shortcut, or another browser — and from a
command prompt, hand it to `start`:

```
sidebar://example.com
sidebar://https://example.com/some/path

start sidebar://example.com
```

If the link's host matches a site pinned to the ribbon, it opens in that
pinned site's own tab instead of a new one.

## Pinning

While unpinned and collapsed the ribbon auto-hides: it slides off the screen
edge once the cursor leaves, leaving a 2px strip behind, and slides back when
you touch that strip — the same retreat the taskbar does. Moving back onto the
edge mid-retreat reverses the slide rather than waiting it out.

Right-click the ribbon (or the tray icon) and choose **Pin** to stop the sidebar
auto-hiding. While pinned on Windows the ribbon registers as an *appbar* — the
same mechanism the taskbar uses — so maximized windows stop at its edge instead
of sliding underneath. Only the 56px ribbon is reserved; the expanded pane floats
over other windows so toggling it never reflows the desktop.

## Project layout

- `electron/`: Electron main process code (window, tabs, IPC)
- `electron/preload.ts`: secure bridge via `contextBridge` (no `nodeIntegration`)
- `src/`: renderer UI (React)
- `shared/`: types + IPC API surface shared between main/renderer
- `scripts/`: dev helpers to start Vite + launch Electron reliably on Windows

## Status / roadmap

See `STATUS.md`.
