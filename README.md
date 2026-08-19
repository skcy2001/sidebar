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

## Shortcuts

- `Ctrl+T`: open a new tab and focus the address bar
- `Ctrl+Shift+E`: collapse or expand the sidebar

## Project layout

- `electron/`: Electron main process code (window, tabs, IPC)
- `electron/preload.ts`: secure bridge via `contextBridge` (no `nodeIntegration`)
- `src/`: renderer UI (React)
- `shared/`: types + IPC API surface shared between main/renderer
- `scripts/`: dev helpers to start Vite + launch Electron reliably on Windows

## Status / roadmap

See `STATUS.md`.
