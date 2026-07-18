# Desktop App

RealityWarden Desktop is the primary product. It is a REAL-device-first local
safety runtime with an explicit secondary Simulation Lab, not a website or a
browser presentation.

## Why Desktop

Governed physical-device work needs serial access, approved firmware flashing,
local project files, audit exports, simulator assets, menus, keyboard shortcuts,
and a tool layout that behaves like engineering software. Electron supplies the
trusted local boundary while preserving Web mode for non-hardware UI review.

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
- application title: RealityWarden
- application menu creation
- IPC registration
- shutdown of the local renderer server

## Renderer

The renderer remains the Studio Workbench UI. In desktop mode it calls `window.openReality` for local files and exports. In Web mode the same UI keeps browser-based fallbacks.

## Preload

`electron/preload.ts` exposes bounded API groups for:

- `window.openReality.project.new()`
- `window.openReality.project.open()`
- `window.openReality.project.save(project, filePath?)`
- `window.openReality.project.saveAs(project)`
- `window.openReality.export.labReport(report)`
- `window.openReality.export.deploymentPackage(package)`
- `window.openReality.file.reveal(filePath)`
- `window.openReality.support.openGuide()`
- `window.openReality.support.exportDiagnostics()`
- `window.openReality.support.showAbout()`
- `window.openReality.hardware.listPorts()/autoDetect()/probe()/connect()/readDistance()/disconnect()`
- `window.openReality.hardware.executionStatus()/execute()/executeManifest()`
- `window.openReality.hardware.firmwarePlan()/flashFirmware()`
- declarative Marketplace review/install/simulation-enable/uninstall and
  publisher-trust operations
- `window.openReality.onMenuAction(callback)`

The preload does not expose `fs`, Node globals, arbitrary IPC channels, raw
serial writes, or an actuation method outside the governed `hardware:execute`
route.

## IPC

IPC modules live in `electron/ipc/`:

- `project.ipc.ts`: New/Open/Save/Save As project files
- `file.ipc.ts`: limited local file reveal
- `export.ipc.ts`: Lab Report and Deployment Package exports
- `support.ipc.ts`: packaged support guide, local diagnostic export, and local About dialog
- `hardware.ipc.ts`: serial lifecycle, read-only diagnostics, governed firmware,
  and the compiled shared `HardwareExecutionGate` execution authority
- `marketplace.ipc.ts`: declarative package and publisher trust lifecycle

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

The current write format is project/workspace version 2. Version 2 stores every user-imported `DeviceAsset` inside `workspace.imported_assets`; GLB/GLTF bytes are embedded as data URLs so a project does not depend on a temporary blob URL or a path on the machine that created it. Version 1 remains readable and is explicitly normalized to version 2 with an empty imported-asset collection. A legacy file that referenced bytes it never contained cannot invent those bytes and is rejected if the referenced asset cannot be resolved.

The renderer and Main Process both use the same strict, versioned contract before saving or opening project files. Validation rejects unknown keys, unsupported device/config values, duplicate or dangling workspace references, divergent `devices` copies, unsafe `real_device_execution_enabled` metadata, non-finite values, excessive nesting, and prototype-pollution keys. Files larger than 25 MiB are rejected before the desktop process reads them; values are never clamped or silently repaired.

Browser workspace import uses the same contract. Complete validated v3 projects include embedded ordinary imported assets plus digest-bound Marketplace identity references; Marketplace-derived assets themselves are never embedded or detached from revalidation. Autosave uses IndexedDB instead of the small synchronous localStorage quota. Existing v1/v2 projects and localStorage v1 autosaves migrate without inventing Marketplace authority, and only after a durable write succeeds. A corrupt autosave is quarantined without changing the current workspace or overwriting/deleting the saved bytes; the operator must explicitly discard it before autosave resumes. Storage failures remain visible and retryable.

## Local Export

Desktop export uses native save dialogs:

- Export Simulation Lab Report
- Export Simulation Adapter Package

Web development mode keeps browser download fallbacks.

## Desktop Menu

The desktop menu includes:

- File: New Project, Open Project, Save Project, Save Project As, explicit
  simulation report/package exports, Exit
- Simulation: Run Simulation Preflight, Enter and Run Simulation Lab, Stop
  Simulation, Replay Simulation
- View: Toggle Project Explorer, Toggle Inspector, Toggle Console, Reload
- Help: Open Support Guide, Export Local Diagnostic Bundle, About RealityWarden

Menu actions are sent to the renderer through a safe `menu:action` channel.

The same support actions are discoverable in the visible File menu because the
Windows native menu bar is normally collapsed. Simulation asset/manual imports
appear there only after the operator explicitly enters SIM LAB. The installed guide is packaged
under `resources/support` and opens in an isolated in-app window without network
access. Diagnostic export is
user-initiated and local-only: it contains version/runtime metadata and a
bounded, allowlisted, redacted startup-log excerpt. It excludes project content,
prompts, audit/hardware results, serial ports, environment variables, and
credentials, and performs no upload.

## Security Boundary

Electron is configured with:

- `contextIsolation: true`
- `nodeIntegration: false`
- a limited preload bridge
- no renderer `fs` access
- real actuation only through the compiled shared hardware authority and private
  `HardwareExecutionGate` ticket path

## Real Device Boundary

The desktop opens in the REAL workspace, but actuation remains default-blocked.
The disconnected state has no simulation canvas. A user must select a reviewed
port, diagnose, connect, keep the explicit session confirmation visible, and
submit each command through the independent black/yellow boundary.

The reference-rig path requires:

- the documented ESP32-S3 + SG90 + HC-SR04 profile
- verified `RealDeviceTransport` behind `HardwareExecutionGate`
- fresh sensor evidence and device timestamp
- evidence lock plus explicit operator confirmation
- per-primitive validation and stop-on-first-block semantics
- an honest audit that distinguishes not sent, attempted/unconfirmed, and
  acknowledged open-loop delivery

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

`desktop:pack` is the internal Windows installer/acceptance path. It uses `electron-builder` with an `nsis` x64 target and writes artifacts to `release/`. It may be used without production Marketplace provisioning or a code-signing certificate, so its output must not be published as a production release.

The publishable entry point is:

```bash
npm run desktop:pack:production
```

That command fails before packaging unless `marketplace/distribution.json` passes the compiled authoritative production validator, binds a fixed HTTPS catalog to a bundled non-revoked Official Ed25519 public key, `WIN_CSC_LINK` or `CSC_LINK` supplies Windows code-signing input, and `release-inputs/legal/` contains the exact owner-approved release manifest, EULA, privacy notice, publisher identity, and sales jurisdictions for the package version. `marketplace/distribution.json` and the legal input files are release-specific and ignored by Git. Generate the Marketplace config from public material with `npm run marketplace:provision`; private Marketplace signing keys must never enter the application or repository. Have the owner/counsel prepare legal inputs using `release-inputs/legal/README.md`, then run `npm run release:legal:verify`. The software validates integrity and absence of placeholders, not legal adequacy. The exact Marketplace config is packaged as `resources/marketplace/distribution.json`; the approved EULA is passed directly to NSIS.

Both paths package the compiled shared hardware safety runtime, the Next production runtime, the SHA256-paired prebuilt firmware image, and rebuilt Windows `serialport` native bindings. Next runs from `app.asar.unpacked` because Windows child processes require a real working directory; Electron and the shared safety runtime remain loaded from the packaged application.

After electron-builder finishes, `scripts/verify-electron-package.cjs` fails the command unless all required asar/unpacked entries, native bindings, PDF/manual-import runtime, firmware checksums, branding metadata, and the versioned NSIS artifact are present. `desktop:pack` then runs a packaged first-run renderer smoke: a hidden, isolated Electron session starts the bundled Next server and must load the REAL-first workspace without simulation controls, the primary independent REAL HARDWARE boundary, the hardware/Marketplace preload bridges, and the flat disconnected state. A separate explicit SIM LAB smoke requires its navigator, command dock, sole Run/Stop pair, zero-signal boundary, and simulation-only tools. Any missing contract exits non-zero. The same smoke check can be repeated manually without installing:

```powershell
release\win-unpacked\RealityWarden.exe --prod --smoke-test
```

Installer artifact pattern:

```text
release/RealityWarden-<version>-Setup.exe
```

Only after package verification, startup/product-design acceptance, and the
isolated install lifecycle pass, packaging writes the release evidence artifacts:

```text
release/RealityWarden-<version>-Release-Evidence.json
release/RealityWarden-<version>-Release-Evidence.json.sha256
```

Production packaging additionally emits and verifies:

```text
release/RealityWarden-<version>-Authenticode-Evidence.json
release/RealityWarden-<version>-Authenticode-Evidence.json.sha256
```

The schema-v6 machine-readable manifest records the release mode, exact installer and packaged executable SHA256/size,
packaged executable size, Next BUILD_ID, source commit, clean/dirty worktree
state, startup and product-design evidence, and the clean install/offline/
reinstall/uninstall lifecycle evidence. The installed lifecycle includes a real
renderer journey that proves one safe task reaches `completed`, one unsafe task
reaches `blocked`, and Audit & Governor is selected with evidence after both.
For `desktop:pack:production`, a separate checksummed Authenticode evidence file must bind both exact binary digests to `Valid`, timestamped signatures before schema-v6 release evidence records `code_signing: passed`. The same evidence binds the current owner legal-input manifest, publisher, jurisdictions, EULA, and privacy notice digests. Internal `desktop:pack` evidence says both signing and legal inputs are `not_assessed`. If Git metadata is unavailable it says
so instead of guessing. The historical internal artifact below does not claim code-signing status,
historical cross-version migration, physical hardware acceptance, or a verified
physical outcome.

Current verified Public Alpha installer artifact:

```text
release/RealityWarden-0.5.0-Setup.exe
```

If `electron-builder` is missing, the command now fails explicitly instead of exiting successfully without producing an installer.
