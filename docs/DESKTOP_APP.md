# Desktop App

Open Reality Studio Desktop is the primary product direction. It is a desktop virtual lab for AI-controlled devices, not a website and not a browser presentation.

## Why Desktop

AI reality-device development needs local project files, workspace persistence, audit exports, simulator assets, menus, keyboard shortcuts, and a tool layout that behaves like engineering software. Electron lets the current Next.js, React, and TypeScript workbench become a cross-platform desktop Alpha quickly while preserving Web development mode.

## Electron Architecture

```text
Electron Main Process
-> starts local Next app
-> creates BrowserWindow
-> loads http://127.0.0.1:PORT
-> registers menus and IPC
-> uses preload to expose safe renderer APIs
```

Renderer code never receives direct Node.js or `fs` access.

## Main Process

`electron/main.ts` owns:

- single-instance desktop startup
- local Next server startup
- `BrowserWindow` creation
- application title: Open Reality Studio
- application menu creation
- IPC registration
- shutdown of the local simulator server

## Renderer

The renderer remains the Studio Workbench UI. In desktop mode it calls `window.openReality` for local files and exports. In Web mode the same UI keeps browser-based fallbacks.

## Preload

`electron/preload.ts` exposes only:

- `window.openReality.project.new()`
- `window.openReality.project.open()`
- `window.openReality.project.save(project, filePath?)`
- `window.openReality.project.saveAs(project)`
- `window.openReality.export.labReport(report)`
- `window.openReality.export.deploymentPackage(package)`
- `window.openReality.file.reveal(filePath)`
- `window.openReality.onMenuAction(callback)`

The preload does not expose `fs`, Node globals, or arbitrary IPC channels.

## IPC

IPC modules live in `electron/ipc/`:

- `project.ipc.ts`: New/Open/Save/Save As project files
- `file.ipc.ts`: limited local file reveal
- `export.ipc.ts`: Lab Report and Deployment Package exports

All local file reads and writes happen in the Main Process through these IPC handlers.

## Local Project Files

Project files use the extension:

```text
.openreality.json
```

Project schema:

```json
{
  "project": {},
  "devices": [],
  "scenarios": [],
  "profiles": [],
  "workspace": {},
  "lab_reports": [],
  "metadata": {}
}
```

The Main Process validates this top-level schema before saving or opening project files.

## Local Export

Desktop export uses native save dialogs:

- Export Lab Report
- Export Deployment Package

Web development mode keeps browser download fallbacks.

## Desktop Menu

The desktop menu includes:

- File: New Project, Open Project, Save Project, Save Project As, Export Lab Report, Export Deployment Package, Exit
- Run: Run Preflight, Run Virtual Lab, Stop, Replay
- View: Toggle Project Explorer, Toggle Inspector, Toggle Console, Reload
- Help: About Open Reality Studio

Menu actions are sent to the renderer through a safe `menu:action` channel.

## Security Boundary

Electron is configured with:

- `contextIsolation: true`
- `nodeIntegration: false`
- a limited preload bridge
- no renderer `fs` access
- no Real Device execution in the main UI

## Real Device Boundary

Real Device execution is not enabled by default. The current product path is Virtual Lab first.

Future Real Device execution must require:

- certified adapter
- verified DeviceTransport
- Safety Runtime approval before transport execution
- human supervision
- emergency stop handling

## Windows Packaging

Current desktop Alpha supports a unified launcher:

```bash
npm run desktop:start
```

The launcher prefers the production shell when `.next-build` exists and otherwise falls back to the development shell.

Explicit desktop development mode:

```bash
npm run desktop:dev
```

Current desktop Alpha supports Electron source build with:

```bash
npm run desktop:build
```

Non-interactive production smoke check:

```bash
npm run desktop:smoke
```

Packaging entry point:

```bash
npm run desktop:pack
```

`desktop:pack` is the Windows installer path. It uses `electron-builder` with an `nsis` target and writes artifacts to `release/`.

Installer artifact pattern:

```text
release/Open-Reality-Studio-<version>-Setup.exe
```

Current verified Public Alpha installer artifact:

```text
release/Open-Reality-Studio-0.1.1-Setup.exe
```

If `electron-builder` is missing, the command now fails explicitly instead of exiting successfully without producing an installer.
