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

If you already have `npm run dev` running in another terminal, `npm run dev:electron`
launches Electron against that server instead of starting its own.

## Build + run (production-like)

```bash
npm run build
npm start
```

`npm start` loads the built renderer from `dist/`; it never looks for a dev server.

## Package installers

```bash
npm run dist        # Windows, arm64
npm run dist:x64    # Windows, x64
npm run dist:mac    # macOS, arm64 + x64 (.dmg and .zip)
```

Artifacts land in `release/`. Each platform must be built on itself — electron-builder
cannot produce macOS bundles from Windows, or vice versa.

Pick the script that matches the machine's architecture (`echo %PROCESSOR_ARCHITECTURE%`
prints `AMD64` for x64, `ARM64` for arm64).

### Updating an installed copy

There are no published releases; an update is a fresh local build. Quit Sidebar
(tray icon → **Quit**), build the installer, and run it over the existing install —
settings and pinned sites are kept:

```bash
npm run dist:x64
release\Sidebar-Setup-0.1.0-x64.exe
```

Add `/S` to the installer for a silent install. Bump `version` in `package.json`
first if you want installed builds to be distinguishable.

### `Cannot find module @rollup/rollup-win32-…`

Rollup's native binary is per-architecture, and `node_modules` installed on an
arm64 machine (e.g. synced over OneDrive) only has the arm64 one. Install the one
for this machine, matching rollup's version:

```bash
npm install @rollup/rollup-win32-x64-msvc@<rollup version> --no-save
```

(`npm install` normally does this via the `postinstall` script.)

## Shortcuts

- `Ctrl+T`: open a new tab and focus the address bar
- `Ctrl+Shift+E`: collapse or expand the sidebar
- `F11`: fullscreen the active tab (`F11` or `Esc` to leave)

Besides back / forward / reload and the address bar, the toolbar has a
**Downloads** button and an **Open in default browser** button for the active tab.

## Pinned sites

Drag a tab across the divider at the top of the ribbon to pin it, or right-click
it and choose **Pin to sidebar**; drag it back across to unpin. Pinned sites can
be reordered by dragging. Right-click a pinned site for:

- **Isolated session**: give the site its own cookies and storage
- **User agent**: Default, Mobile, or Desktop
- **Unpin** / **Close tab**

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

## Pinning the ribbon

While unpinned and collapsed the ribbon auto-hides: it slides off the screen
edge once the cursor leaves, and slides back when you rest the cursor against
that edge for a moment (about 200ms, so just crossing the edge doesn't pull it
out) — the same retreat the taskbar does. Moving back onto the edge
mid-retreat reverses the slide rather than waiting it out.

Right-click the ribbon (or the tray icon) and choose **Pin** to stop the sidebar
auto-hiding. While pinned on Windows the ribbon registers as an *appbar* — the
same mechanism the taskbar uses — so maximized windows stop at its edge instead
of sliding underneath. Only the 56px ribbon is reserved; the expanded pane floats
over other windows so toggling it never reflows the desktop.

## Project layout

- `electron/`: Electron main process code (window, tabs, IPC)
  - `appbar.ts`: Windows appbar registration (reserves the ribbon's edge while pinned)
  - `slide.ts`: the auto-hide slide animation
  - `urlLaunch.ts`: command-line URLs and the `sidebar://` scheme
  - `tabs/`: tab and pinned-site management
- `electron/preload.ts`: secure bridge via `contextBridge` (no `nodeIntegration`)
- `src/`: renderer UI (React)
- `shared/`: types + IPC API surface shared between main/renderer
- `scripts/`: dev helpers to start Vite + launch Electron reliably on Windows

## Status / roadmap

See `STATUS.md`.
