const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const projectIpc = read('electron/ipc/project.ipc.ts');
const projectContract = read('lib/project/ProjectFileContract.ts');
const autosaveStore = read('lib/project/ProjectAutosaveStore.ts');
const exportIpc = read('electron/ipc/export.ipc.ts');
const menu = read('electron/menus/appMenu.ts');
const supportIpc = read('electron/ipc/support.ipc.ts');
const supportActions = read('electron/support/supportActions.ts');
const diagnostics = read('electron/support/diagnostics.ts');
const supportGuide = read('docs/SUPPORT.md');
const thirdPartyNotices = read('docs/THIRD_PARTY_NOTICES.md');
const marketplaceIpc = read('electron/ipc/marketplace.ipc.ts');
const marketplaceManager = read('components/MarketplaceManager.tsx');
const marketplacePersistence = read('lib/marketplace/MarketplacePersistence.ts');
const docs = read('docs/DESKTOP_APP.md');
const readme = read('README.md');
const windowsTrialGuide = read('docs/WINDOWS_TRIAL_GUIDE.md');
const packScript = read('scripts/pack-electron.cjs');
const page = read('app/page.tsx');
const realDeviceWorkspace = read('components/RealDeviceWorkspace.tsx');
const i18n = read('lib/i18n.ts');
const labConfigurator = read('components/LabConfigurator.tsx');
const evidenceSidebar = read('components/EvidenceSidebar.tsx');
const appHeader = read('components/AppHeader.tsx');
const actionComposer = read('components/ActionComposer.tsx');
const manualImport = read('lib/manual-import/ManualProfileImport.ts');
const manualImportWizard = read('components/ManualImportWizard.tsx');
const actionLibrary = read('lib/action-manifest/ActionLibrary.ts');
const referenceRecipes = read('lib/action-manifest/ReferenceRecipes.ts');
const virtualDeviceStage = read('components/VirtualDeviceStage.tsx');
const semanticDeviceStage = read('components/SemanticDeviceStage.tsx');
const globalStyles = read('app/globals.css');
const tailwindConfig = read('tailwind.config.ts');
const commandDockSource = page.slice(page.indexOf('function CommandDock('), page.indexOf('function WorkspaceDeviceStrip('));
const commandDockDefault = commandDockSource.slice(commandDockSource.indexOf('return ('), commandDockSource.indexOf('<details'));
const commandDockDetails = commandDockSource.slice(commandDockSource.indexOf('<details'));

for (const file of [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/ipc/project.ipc.ts',
  'electron/ipc/file.ipc.ts',
  'electron/ipc/export.ipc.ts',
  'electron/ipc/support.ipc.ts',
  'electron/ipc/marketplace.ipc.ts',
  'electron/support/diagnostics.ts',
  'electron/support/supportActions.ts',
  'electron/menus/appMenu.ts'
]) {
  assert(fs.existsSync(path.join(root, file)), `${file} must exist.`);
}

assert(main.includes("title: 'RealityWarden'"), 'Desktop window title must be RealityWarden.');
assert(main.includes('contextIsolation: true'), 'Electron must enable contextIsolation.');
assert(main.includes('nodeIntegration: false'), 'Electron must disable nodeIntegration.');
assert(main.includes('preload:'), 'Electron window must load a preload script.');

assert(preload.includes("contextBridge.exposeInMainWorld('openReality'"), 'preload must expose window.openReality.');
assert(!preload.includes('fs'), 'preload must not expose fs.');
assert(preload.includes('ipcRenderer.invoke'), 'preload must use IPC invocation.');
assert(preload.includes("ipcRenderer.invoke('hardware:connect'"), 'preload must expose the hardware bridge.');
assert(main.includes('registerMarketplaceIpc()'), 'desktop main process must register the bounded Marketplace IPC service.');
assert(main.includes('snapshot.marketplaceBridge') && main.includes("auditDesignDialog(window, 'marketplace'"), 'packaged smoke and design acceptance must exercise the real Marketplace bridge and modal.');
assert(preload.includes("ipcRenderer.invoke('marketplace:browsePackage'") && preload.includes("ipcRenderer.invoke('marketplace:enableSimulation'") && preload.includes("ipcRenderer.invoke('marketplace:revokePublisher'") && preload.includes("ipcRenderer.invoke('marketplace:runtimeAssets'"), 'preload must expose bounded Marketplace lifecycle and read-only runtime asset calls.');
assert(preload.includes("ipcRenderer.invoke('marketplace:catalog', { useCache })") && preload.includes("ipcRenderer.invoke('marketplace:reviewCatalogPackage'") && !preload.includes('catalogUrl:'), 'preload must expose fixed-distribution catalog calls without accepting an arbitrary URL.');
assert(preload.includes("ipcRenderer.invoke('marketplace:browseSubmissionAsset'") && preload.includes("ipcRenderer.invoke('marketplace:exportSubmissionDraft'") && !preload.includes('uploadSubmission'), 'preload must expose local submission-draft review/export without an upload channel.');
assert(marketplaceIpc.includes("'dist-electron-runtime', 'lib', 'marketplace'") && !marketplaceIpc.includes("from '../../lib/"), 'Electron Marketplace policy must load the compiled shared authority, never import lib directly.');
assert(marketplaceIpc.includes("fs.openSync(tempPath, 'wx')") && marketplaceIpc.includes('fs.fsyncSync(handle)') && marketplaceIpc.includes('fs.renameSync(tempPath, filePath)'), 'Marketplace state persistence must use exclusive, flushed, atomic replacement.');
assert(marketplaceIpc.includes('.corrupt-') && marketplaceIpc.includes('explicit reset is required') && marketplaceIpc.includes('confirmed !== true'), 'corrupt Marketplace state must be quarantined and remain blocked until explicit reset.');
assert(marketplaceIpc.includes("ipcMain.handle('marketplace:runtimeAssets'") && marketplaceIpc.includes('ready.runtime.marketplaceRuntimeAsset(record, this.trustStore)') && marketplaceIpc.includes('executionAuthorityGranted: false') && marketplaceIpc.includes('realAdapterEnabled: false'), 'Marketplace runtime asset IPC must reverify through compiled policy and grant literal zero hardware authority.');
assert(marketplacePersistence.includes('restoreMarketplaceState') && marketplacePersistence.includes('metadata does not match its signed package'), 'desktop restore must revalidate stored package signatures and metadata through the shared authority.');
assert(marketplaceManager.includes('INSTALLS DISABLED · SIMULATION ONLY · REAL AUTHORITY FALSE') && marketplaceManager.includes('Second-confirm simulation'), 'Marketplace UI must visibly preserve disabled-by-default and second-gate simulation semantics.');
assert(marketplaceManager.includes('Official / Verified') && marketplaceManager.includes('Community') && marketplaceManager.includes('revokePublisher'), 'Marketplace UI must display trust tiers and support explicit community-key revocation.');
assert(marketplaceManager.includes('Virtual Lab binding is not ready; no fallback is used.') && marketplaceManager.includes('workspaceBindings[record.packageId]'), 'Marketplace UI must expose binding success or refusal without silent fallback.');
assert(marketplaceIpc.includes("redirect: 'error'") && marketplaceIpc.includes('15_000') && marketplaceIpc.includes('MAX_CATALOG_BYTES') && marketplaceIpc.includes('No fallback or retry was used.'), 'Marketplace network acquisition must reject redirects, time out, cap bytes, and never silently retry or fall back.');
assert(marketplaceManager.includes('Refresh signed catalog from network') && marketplaceManager.includes('Explicitly use verified cache') && marketplaceManager.includes('reviewCatalogPackage(entry.package_id') && marketplaceManager.includes('review never installs automatically'), 'Marketplace catalog browsing must use explicit network/cache choices and retain the separate reviewed-install confirmation.');
assert(marketplaceIpc.includes("ipcMain.handle('marketplace:exportSubmissionDraft'") && marketplaceIpc.includes("fs.openSync(result.filePath, 'wx')") && marketplaceIpc.includes('failed without upload or retry'), 'Marketplace publish-back must exclusively export a local file and provide no silent upload/retry path.');
assert(marketplaceManager.includes('LOCAL DRAFT · NOT SUBMITTED') && marketplaceManager.includes('UNSIGNED · UNTRUSTED · NO UPLOAD · REAL AUTHORITY FALSE · hardwareSignalSent FALSE'), 'Marketplace publish-back UI must truthfully label unsigned local-only authority and signal state.');
const hardwareIpc = read('electron/ipc/hardware.ipc.ts');
const governedFirmwareImage = read('lib/device-onboarding/GovernedFirmwareImage.ts');
const esptoolFlasher = read('electron/hardware/esptoolFlasher.ts');
assert(!hardwareIpc.includes("cmd: 'move_to_angle'"), 'hardware IPC must never hand-roll an actuation frame; actuation only via the compiled gate chain.');
assert(hardwareIpc.includes('real_execution_locked'), 'UI real execution must stay locked until acceptance evidence exists.');
assert(hardwareIpc.includes('HardwareExecutionGate'), 'UI real execution must route through the HardwareExecutionGate.');
assert(hardwareIpc.includes('DistanceSensorPollingService') && hardwareIpc.includes('HardwareActionSequenceRunner'), 'UI real execution must consume polled sensor generations through the sequence runner.');
assert(!hardwareIpc.includes('buildConservativeMedianReading(readings)'), 'hardware IPC must not return to a pull-once evidence assembly path.');
assert(hardwareIpc.includes('confirmation_required'), 'UI real execution must demand an explicit operator confirmation.');
assert(hardwareIpc.includes('latestSentOutcome?.result.signalState ?? outcome.result.signalState') && hardwareIpc.includes('latestSentOutcome?.result.executionEvidence ?? outcome.result.executionEvidence'), 'hardware IPC must preserve precise delivery and execution evidence, including partial sequence delivery.');
assert(hardwareIpc.includes("'hardware:readDistance'"), 'hardware IPC must expose read-only distance.');
assert((hardwareIpc.match(/ipcMain\.handle\('hardware:execute'/g) || []).length === 1, 'jog-teach and replay must share the single existing hardware:execute IPC channel.');
assert(hardwareIpc.includes("'action-manifest', 'ActionManifest'") && hardwareIpc.includes('validateActionManifest') && hardwareIpc.includes('expandManifestToTaskDsl'), 'REAL teach replay must consume the compiled authoritative manifest validator and expander.');
assert(hardwareIpc.includes('hardwareCommandsFromTeachTaskDsl'), 'REAL teach replay must map expanded primitives for HardwareActionSequenceRunner.');
assert(preload.includes("executeManifest: (portPath: string, manifest: unknown, confirm: boolean) => ipcRenderer.invoke('hardware:execute'"), 'preload teach replay must reuse hardware:execute rather than add an execution channel.');
assert(hardwareIpc.includes("'hardware:firmwarePlan'") && hardwareIpc.includes("'hardware:flashFirmware'"), 'desktop must expose bounded firmware preview and flash IPC.');
assert(preload.includes("ipcRenderer.invoke('hardware:firmwarePlan'") && preload.includes("ipcRenderer.invoke('hardware:flashFirmware'"), 'preload must expose only the governed firmware request shape.');
assert(governedFirmwareImage.includes("request.imageFile !== DEFAULT_IMAGE.file") && governedFirmwareImage.includes("'unpaired_image_path'"), 'firmware IPC authority must reject non-registered image paths rather than accept arbitrary BIN files.');
assert(governedFirmwareImage.includes('validateFirmwareWriteOrder') && governedFirmwareImage.includes('three_way_sha256_mismatch') && governedFirmwareImage.includes("`${absolute}.sha256`"), 'built-in flash must enforce image/companion/write-order digest agreement through the authoritative validator.');
assert(hardwareIpc.includes("'device-onboarding', 'GovernedFirmwareImage'") && !hardwareIpc.includes("from '../../lib/"), 'Electron must consume the compiled firmware authority instead of importing or copying lib source.');
assert(esptoolFlasher.includes('new esptool.Transport') && esptoolFlasher.includes('new esptool.ESPLoader') && esptoolFlasher.includes('loader.writeFlash'), 'Electron flashing must delegate protocol and writes to esptool-js.');
assert(hardwareIpc.includes('flash failed without retry') && hardwareIpc.includes('diagnose did not verify firmware'), 'flashing must never retry silently and must verify the reported firmware version after reconnect.');
const realHardwarePanel = read('components/RealHardwarePanel.tsx');
assert(realHardwarePanel.includes('REAL HARDWARE'), 'panel must carry the explicit REAL HARDWARE identity.');
assert(page.includes("useState<'real' | 'simulation'>('real')") && page.includes("workspaceMode === 'simulation' && <LabConfigurator") && appHeader.includes('REAL DEVICE') && appHeader.includes('Simulation Lab'), 'The desktop shell must default to a REAL-device workspace and expose simulation only as an explicit secondary mode.');
assert(realDeviceWorkspace.includes("telemetry.connected ? (") && realDeviceWorkspace.includes('data-real-twin-stage') && realDeviceWorkspace.includes('data-real-device-onboarding') && realDeviceWorkspace.includes('NO 3D STAGE · NO STALE DATA'), 'The disconnected REAL workspace must render a flat onboarding surface; the 3D twin stage may mount only after a current hardware connection.');
assert(realHardwarePanel.includes("setAvailable(bridge() !== null)") && realHardwarePanel.includes('data-real-hardware-bridge-ready'), 'REAL HARDWARE panel must re-detect the Electron bridge after hydration instead of remaining in SSR web mode.');
assert(page.includes("primary={workspaceMode === 'real'}") && realHardwarePanel.includes('const panelExpanded = primary || expanded') && realHardwarePanel.includes("primary ? 'min-h-0 flex-1'"), 'REAL mode must keep the hardware boundary expanded and give its task content the primary available height.');
assert(!realHardwarePanel.includes('AI Command Terminal runs simulation by default') && realHardwarePanel.includes('Simulation Lab is a separate zero-signal mode'), 'REAL HARDWARE copy must not describe simulation as the default product path.');
assert(realHardwarePanel.includes("type RealHardwareTool = 'command' | 'teach' | 'firmware'") && realHardwarePanel.includes('activeTool !== \'firmware\'') && realHardwarePanel.includes("activeTool === 'teach'"), 'Connected REAL tools must be separated into command, teach, and firmware tasks instead of one undifferentiated control stack.');
assert(realHardwarePanel.includes('Teach mode (REAL jog)') && realHardwarePanel.includes('Record waypoint') && realHardwarePanel.includes('Save as action') && realHardwarePanel.includes('Replay via gate'), 'REAL HARDWARE panel must expose governed jog-teach controls.');
assert(realHardwarePanel.includes('!execConfirmed') && realHardwarePanel.includes('waypointAfterJog'), 'jog-teach must preserve visible confirmation and only record acknowledged commands.');
assert(realHardwarePanel.includes('parseRealNaturalCommand') && realHardwarePanel.includes('never guessed'), 'REAL natural-language box must use the deterministic parser and state its no-guessing contract.');
assert(realHardwarePanel.includes('Reference-servo preflight (no signal)') && realHardwarePanel.includes('it has no mapping to SIM LAB'), 'REAL command preview must be named as a hardware-local reference-servo preflight and deny any Simulation Lab mapping.');
assert(realHardwarePanel.includes("buildTeachManifest('real_nl_command'") && realHardwarePanel.includes('replayTeachAction(checked.manifest)'), 'REAL natural-language execution must reuse the validated manifest replay path, not a new execution channel.');
assert(realHardwarePanel.includes('!execConfirmed || !nlParse'), 'REAL natural-language execution must preserve operator confirmation gating.');
assert(realHardwarePanel.includes("visibleRealHardwareTelemetry(status === 'connected', distanceCm, lastCommandAngle)"), 'REAL mirror telemetry must pass through the stale-data clearing authority.');
assert(semanticDeviceStage.includes('function RealServoTwin') && semanticDeviceStage.includes("if (!telemetry?.connected) return null"), '3D REAL mirror must disappear when hardware is disconnected.');
assert(semanticDeviceStage.includes('Last command angle (open-loop, not measured)') && semanticDeviceStage.includes('Live distance'), '3D REAL mirror must label command angle honestly and show live distance.');
assert(semanticDeviceStage.includes('border-status-warning-edge') && semanticDeviceStage.includes('text-status-warning') && semanticDeviceStage.includes('<span>REAL</span>'), '3D REAL mirror must use warning tokens plus an explicit REAL label.');
const realTwinSource = semanticDeviceStage.slice(semanticDeviceStage.indexOf('function RealServoTwin'), semanticDeviceStage.indexOf('function CommandOutcomeGhost'));
assert(realTwinSource.length > 0 && !realTwinSource.includes('onPointer') && !realTwinSource.includes('onClick') && !realTwinSource.includes('onStartDrag'), 'Stage 1 REAL mirror must expose no drag, click, or pointer command interaction.');
assert(virtualDeviceStage.includes('SIMULATION · REAL MIRROR SEPARATE') && virtualDeviceStage.includes('SIMULATION · NO HARDWARE SIGNAL') && virtualDeviceStage.includes('READ-ONLY DIGITAL TWIN') && virtualDeviceStage.includes('border-status-warning-edge'), '1180px workspace must retain no-signal simulation semantics and a prominent black/yellow REAL mirror boundary.');
assert(realHardwarePanel.includes('command_acknowledged_open_loop') && realHardwarePanel.includes('attempted_unconfirmed'), 'panel must distinguish open-loop acknowledgement from unconfirmed delivery.');
assert(realHardwarePanel.includes('evidence lock') && realHardwarePanel.includes('operator confirmation'), 'panel must preserve the independent evidence-locked real-hardware boundary.');
assert(realHardwarePanel.includes('Reviewed images only') && realHardwarePanel.includes('Load write-order JSON') && !realHardwarePanel.includes('accept=".bin'), 'firmware UI must accept governed prebuilt/order inputs only, never an arbitrary BIN picker.');
assert(realHardwarePanel.includes('target port') && realHardwarePanel.includes('image version/interface') && realHardwarePanel.includes('sha256') && realHardwarePanel.includes('firmwareConfirmed'), 'firmware UI must show the governed plan and require explicit confirmation.');
assert(realHardwarePanel.includes('No reviewed image is available for this configuration') && realHardwarePanel.includes('no live-compile fallback'), 'serial_ttl must report its missing reviewed image without compiling onsite.');

assert(projectIpc.includes('showOpenDialog'), 'Project IPC must open local project files.');
assert(projectIpc.includes('showSaveDialog'), 'Project IPC must save local project files.');
assert(projectIpc.includes('ProjectFileContract.js'), 'Project IPC must load the compiled shared project contract.');
assert(projectIpc.includes('parseOpenRealityProjectText') && projectIpc.includes('serializeOpenRealityProjectFile'), 'Project open and save must use the same strict contract.');
assert(projectIpc.includes('MAX_PROJECT_FILE_BYTES') && projectIpc.includes('fs.stat'), 'Project IPC must reject oversized files before reading them.');
assert(!projectIpc.includes('function isProjectFile'), 'Project IPC must not regress to a shallow local schema check.');
assert(projectContract.includes("version: 3, imported_assets: importedAssets, marketplace_assets: marketplaceAssets") && projectContract.includes('workspace.version must be 1, 2, or 3') && projectContract.includes('cannot embed a Marketplace-derived asset'), 'Project contract must migrate v1/v2 to v3, persist digest-bound Marketplace references, and forbid embedded Marketplace-derived assets.');
assert(projectContract.includes('supported_adapters must be simulator-only') && projectContract.includes('real_device_enabled must remain false'), 'Persisted imported assets must not grant real-device authority.');
assert(autosaveStore.includes('indexedDB.open') && autosaveStore.includes('createProjectAutosaveService'), 'Complete project autosave must use the durable, behavior-testable IndexedDB store.');

assert(exportIpc.includes('export:labReport'), 'Export IPC must support Lab Report export.');
assert(exportIpc.includes('export:deploymentPackage'), 'Export IPC must support Deployment Package export.');
assert(preload.includes("ipcRenderer.invoke('support:openGuide'") && preload.includes("ipcRenderer.invoke('support:exportDiagnostics'") && preload.includes("ipcRenderer.invoke('support:showAbout'"), 'preload must expose only the bounded support actions.');
assert(supportIpc.includes("ipcMain.handle('support:exportDiagnostics'") && supportIpc.includes("ipcMain.handle('support:openGuide'"), 'Support IPC must register guide and diagnostic actions.');
assert(diagnostics.includes("schema: 'realitywarden.desktop-diagnostics'") && diagnostics.includes('local_only: true') && diagnostics.includes('uploaded: false'), 'Diagnostic bundle must declare its local-only schema and upload boundary.');
assert(diagnostics.includes('filter(isSupportLogLine)') && diagnostics.includes('MAX_LOG_BYTES') && diagnostics.includes('MAX_LOG_LINES'), 'Diagnostic logs must be allowlisted and bounded.');
assert(supportActions.includes("path.join(process.resourcesPath, 'support', 'SUPPORT.html')"), 'Installed support must resolve the packaged in-app guide.');
assert(supportActions.includes("path.join(process.resourcesPath, 'support', 'THIRD_PARTY_NOTICES.html')") && supportActions.includes('openThirdPartyNotices'), 'Installed support must resolve third-party notices in a separate offline window.');
assert(supportActions.includes('new BrowserWindow') && supportActions.includes('nodeIntegration: false') && supportActions.includes('sandbox: true'), 'Offline support must open in an isolated in-app window.');
assert(!supportActions.includes('openExternal'), 'Support and About must not depend on an external website.');
assert(supportGuide.includes('does not upload it') && supportGuide.includes('REAL HARDWARE'), 'Packaged support guide must state privacy and hardware boundaries.');

for (const script of ['desktop:start', 'desktop:dev', 'desktop:build', 'desktop:pack', 'desktop:smoke', 'test:desktop']) {
  assert(packageJson.scripts[script], `package.json missing ${script}.`);
}
assert(packageJson.scripts['desktop:prod'], 'package.json missing desktop:prod.');

assert.equal(packageJson.main, 'dist-electron/main.js', 'package.json main must point at the compiled Electron entry.');
assert(packageJson.build, 'package.json must declare electron-builder config.');
assert.equal(packageJson.build.productName, 'RealityWarden', 'electron-builder productName must be RealityWarden.');
assert.equal(packageJson.build.appId, 'com.realitywarden.desktop', 'electron-builder appId must be declared.');
assert.equal(packageJson.build.icon, 'assets/branding/realitywarden.ico', 'electron-builder must declare a branded desktop icon.');
assert(Array.isArray(packageJson.build.files) && packageJson.build.files.includes('.next-build/**/*'), 'electron-builder must package the Next production build output.');
assert(packageJson.build.files.includes('dist-electron-runtime/**/*'), 'electron-builder must package the compiled shared hardware safety runtime.');
assert(packageJson.build.files.includes('assets/branding/**/*'), 'electron-builder must package branding assets used by the desktop window.');
assert(packageJson.build.asarUnpack.includes('node_modules/**/*'), 'electron-builder must unpack the Next runtime and serialport native binding to a real filesystem path.');
assert(packageJson.build.npmRebuild === false, 'electron-builder must preserve serialport 13 Node-API prebuilds instead of requiring an unsafe environment-specific node-gyp rebuild.');
assert(packageJson.build.asarUnpack.includes('.next-build/**/*'), 'electron-builder must unpack the Next production build for the local server process.');
assert(packageJson.build.extraResources.some((entry) => entry.from === 'firmware/prebuilt' && entry.to === 'firmware/prebuilt'), 'electron-builder must package the prebuilt firmware resources.');
assert(packageJson.build.extraResources.some((entry) => entry.from === 'next.config.mjs' && entry.to === 'app.asar.unpacked/next.config.mjs'), 'electron-builder must place the Next config in the real server working directory.');
assert(packageJson.build.extraResources.some((entry) => entry.from === 'docs' && entry.to === 'support' && entry.filter.includes('SUPPORT.md') && entry.filter.includes('SUPPORT.html') && entry.filter.includes('THIRD_PARTY_NOTICES.md') && entry.filter.includes('THIRD_PARTY_NOTICES.html')), 'electron-builder must package the offline support guide and third-party notices.');
assert(thirdPartyNotices.includes('Lockfile SHA-256') && thirdPartyNotices.includes('UR5e derived GLB') && thirdPartyNotices.includes('TurtleBot3 Burger derived GLB'), 'offline notices must bind the npm inventory and cover redistributed model assets.');
assert.equal(packageJson.build.afterPack, 'scripts/after-pack.cjs', 'electron-builder must apply the branded icon and metadata after packaging.');
assert.equal(packageJson.build.win.executableName, 'RealityWarden', 'electron-builder must produce a branded executable name.');
assert.equal(packageJson.build.nsis.installerIcon, packageJson.build.win.icon, 'NSIS installer must use the branded icon.');
assert.equal(packageJson.build.nsis.uninstallerIcon, packageJson.build.win.icon, 'NSIS uninstaller must use the branded icon.');
assert(packScript.includes('process.exit(1)'), 'desktop pack script must fail explicitly when electron-builder is missing.');
assert(packScript.includes("'--win', 'nsis'"), 'desktop pack script must target a Windows installer.');
assert(packScript.includes('verify-electron-package.cjs'), 'desktop pack script must verify the built installer contents.');
assert(main.includes("ELECTRON_RUN_AS_NODE: '1'"), 'packaged Electron must launch the bundled Next CLI in Node mode.');
assert(main.includes("path.join(process.resourcesPath, 'app.asar.unpacked')"), 'packaged Electron must run the Next server from a real unpacked working directory.');
assert(readme.includes('npm run desktop:dev'), 'README must expose explicit desktop development startup.');
assert(readme.includes('npm run desktop:prod'), 'README must expose explicit desktop production startup.');
assert(readme.includes('desktop:start') && readme.includes('convenience script'), 'README must describe desktop:start as a local convenience path instead of the main trial command.');
assert(windowsTrialGuide.includes('npm run desktop:prod'), 'Windows trial guide must direct source-based evaluators to desktop:prod.');
assert(windowsTrialGuide.includes('npm run desktop:dev'), 'Windows trial guide must keep desktop:dev as the explicit development path.');
assert(main.includes("realitywarden.ico"), 'Electron window must use the branded desktop icon.');
assert(main.includes("--smoke-test"), 'Electron main must support desktop smoke-test mode.');
assert(fs.existsSync(path.join(root, 'assets/branding/realitywarden.ico')), 'Branded desktop icon .ico must exist.');
assert(fs.existsSync(path.join(root, 'assets/branding/realitywarden.png')), 'Branded desktop icon .png must exist.');
assert(page.includes("const publicAlphaRunnableDeviceTypes: DeviceType[] = ['robot_arm', 'smart_light', 'camera_sensor'];"), 'Desktop UI must keep the public alpha runnable device list limited to robot_arm, smart_light, and camera_sensor.');
assert(page.includes('if (!running && runTargetRunnable) onRun();'), 'AI command submit must only auto-run when the selected target is runnable.');
assert(page.includes('disabled={running || !runTargetRunnable}'), 'The single Run entry (AI terminal) must stay disabled for unrunnable devices.');
assert(i18n.includes('select_runnable_target_hint'), 'UI copy must include the runnable-target guidance hint.');
assert(i18n.includes('To run a task, switch to Robot Arm, Smart Light, or Camera Sensor.'), 'English runnable-target guidance must stay explicit.');
assert(i18n.includes('asset_only_runtime_title') && i18n.includes('jump_to_runnable_path'), 'UI copy must include asset-only recovery guidance.');
assert(page.includes("!runTargetRunnable && (") && page.includes("onQuickStart(path)"), 'AI command terminal must expose a direct jump back to runnable paths when the current device is asset-only.');
assert(page.includes('quickStartPaths={quickStartPaths}') && page.includes('onQuickStart={handleQuickStart}'), 'First-run guide must receive the same quick-start actions as the command terminal.');
assert(page.includes("key={`guide-${path.id}`}") && page.includes("t(language, 'quick_start_try_now')"), 'First-run guide must expose clickable quick-start cards.');
assert(i18n.includes('quick_start_expected'), 'Quick Start UI copy must describe expected outcomes.');
assert(page.includes('expected:') && page.includes("t(language, 'quick_start_expected')"), 'Quick Start paths must declare and render expected outcomes.');
assert(i18n.includes('quick_start_proof'), 'Quick Start UI copy must describe where evaluators should look for evidence.');
assert(page.includes('proof:') && page.includes("t(language, 'quick_start_proof')"), 'Quick Start paths must declare and render proof/evidence guidance.');
assert(i18n.includes('quick_start_validates'), 'Quick Start UI copy must describe what each runnable path validates.');
assert(page.includes('validates:') && page.includes("t(language, 'quick_start_validates')"), 'Quick Start paths must declare and render validation guidance.');
assert(i18n.includes('guided_evaluation') && i18n.includes('current_path'), 'Quick Start flow must include guided evaluation copy.');
assert(page.includes('activeQuickStart') && page.includes("t(language, 'guided_evaluation')"), 'AI command terminal must keep the active quick-start evaluation path visible after selection.');
assert(i18n.includes('next_path') && i18n.includes('try_next'), 'Guided evaluation copy must include the next-path hint.');
assert(page.includes('nextQuickStart') && page.includes("t(language, 'next_path')") && page.includes("t(language, 'try_next')"), 'Guided evaluation must suggest the next quick-start path.');
assert(i18n.includes('app_quick_start'), 'Toolbar copy must include a Quick Start entry.');
assert(page.includes('const reopenFirstRunGuide = useCallback(() => {') && page.includes('setShowFirstRunGuide(true);'), 'Desktop shell must provide a manual way to reopen the first-run guide.');
assert(labConfigurator.includes("asset_library_note"), 'Asset library must explain that adding a device does not make it runnable.');
assert(labConfigurator.includes("asset_runtime_supported") && labConfigurator.includes("asset_runtime_asset_only"), 'Asset cards must distinguish runnable paths from asset-only protocol scaffolds.');
assert(page.includes('<EvidenceSidebar') && page.includes('view="evidence"') && page.includes('view="inspector"'), 'Right sidebar must separate audit evidence from device inspection with explicit views.');
assert(evidenceSidebar.includes("'Run Decision'") && evidenceSidebar.includes("'Simulation Details'"), 'Evidence sidebar must name the two product-level outcomes in user language.');
assert(evidenceSidebar.indexOf('{hardware}') > evidenceSidebar.indexOf('role="tabpanel"'), 'REAL HARDWARE must remain structurally outside the evidence/inspector tab panels.');
assert(evidenceSidebar.includes("data-real-hardware-primary={workspaceMode === 'real' ? 'true' : 'false'}") && evidenceSidebar.includes("'order-1 flex min-h-0 flex-1 flex-col'"), 'REAL mode must visually promote the independent hardware boundary above auxiliary status and safety-contract tabs.');
assert(evidenceSidebar.includes('w-[320px]') && evidenceSidebar.includes('xl:w-[360px]') && main.includes('const expectedSidebarWidth = innerWidth < 1280 ? 320 : 360'), 'The right rail and Electron design acceptance must share the 1180/1440 responsive width contract.');
assert(evidenceSidebar.includes("useState<EvidenceTab>('evidence')") && evidenceSidebar.includes('onClick={() => setActiveTab(tab)}'), 'Evidence sidebar must default to run evidence while keeping simulation details explicitly selectable.');
assert(!evidenceSidebar.includes('previousSelection'), 'Workspace hydration or model selection must not replace the primary run-decision view without an explicit tab choice.');
for (const token of ['background', 'surface', 'surface-raised', 'border', 'text-primary', 'text-secondary', 'accent', 'success', 'warning', 'danger', 'simulation', 'real-hardware']) {
  assert(globalStyles.includes(`--color-${token}:`), `Global design system missing --color-${token}.`);
}
assert(globalStyles.includes('--focus-ring:') && globalStyles.includes('.industrial-workbench button:focus-visible'), 'Desktop controls must share a visible keyboard focus ring.');
assert(globalStyles.includes('.rw-floating-panel') && globalStyles.includes('--color-surface-overlay: rgba(18, 20, 24, 0.96);'), 'Floating panels must share one opacity, blur, and shadow contract.');
assert(tailwindConfig.includes("'real-hardware': 'var(--color-real-hardware)'"), 'Tailwind must expose the independent REAL HARDWARE semantic color.');
assert(commandDockSource.includes('data-component="CommandDock"'), 'AI command entry must be organized as the product-level CommandDock.');
assert(commandDockDefault.includes('<textarea') && commandDockDefault.includes('data-run-control') && commandDockDefault.includes('data-stop-control') && commandDockDefault.includes('onClick={submit}') && commandDockDefault.includes('onClick={onStop}'), 'CommandDock default surface must retain input plus its single stable semantic Run/Stop controls.');
assert(commandDockDefault.includes('aria-live="polite"') && commandDockDefault.includes("t(language, 'active_workspace_device')"), 'CommandDock default surface must expose exactly one primary status and the current target.');
assert(!commandDockDefault.includes('{llmChipText}') && !commandDockDefault.includes("t(language, 'starter_commands')") && !commandDockDefault.includes('{activeQuickStart'), 'Compiler, starters, and Quick Start details must not crowd the default CommandDock surface.');
assert(commandDockDetails.includes('{llmChipText}') && commandDockDetails.includes("t(language, 'starter_commands')") && commandDockDetails.includes('{activeQuickStart &&'), 'CommandDock secondary details must preserve compiler, starter command, and Quick Start capabilities.');
assert(!commandDockSource.includes('onClick={onRun}'), 'CommandDock must not duplicate its Run control inside guidance content.');
assert(!globalStyles.includes('.industrial-workbench button,\n  .industrial-workbench select'), 'Global workbench styles must not override semantic Run/Stop button colors.');
assert(labConfigurator.includes('data-component="DeviceNavigator"') && labConfigurator.includes('data-component="AssetLibrary"'), 'Left rail must expose separate DeviceNavigator and AssetLibrary regions.');
assert(labConfigurator.includes("useState<'devices' | 'assets'>('devices')") && labConfigurator.includes('role="tablist"'), 'Device and asset concerns must be navigated through explicit tabs.');
assert(labConfigurator.includes("activeSection === 'devices'") && labConfigurator.includes("activeSection === 'assets'"), 'Each left-navigation tab must own an independent content panel.');
assert(labConfigurator.includes('w-[240px]') && labConfigurator.includes('xl:w-[280px]'), 'Left navigation must use the 1180/1440 responsive width contract.');
assert(!labConfigurator.includes('onLanguageChange') && appHeader.includes('Interface language'), 'Application language belongs in the global header, not device navigation.');
assert(page.includes('<AppHeader') && appHeader.includes('data-component="AppHeader"') && appHeader.includes('export function FileMenu'), 'Desktop toolbar must be implemented as AppHeader with a dedicated FileMenu.');
assert(appHeader.includes('className="flex h-12') && appHeader.includes('<nav') && appHeader.includes('onExportReport') && appHeader.includes('onExportAdapter'), 'AppHeader must use the 48px grouped desktop layout and preserve both exports.');
assert(appHeader.includes("const realMode = props.workspaceMode === 'real'") && appHeader.includes('data-real-hardware-focus') && appHeader.includes('data-simulation-toolbar-action="marketplace"') && appHeader.includes('data-real-connection-state='), 'The toolbar must expose device controls and connection state in REAL mode while marking simulation-only actions for the explicit lab mode.');
assert(page.includes("document.querySelector<HTMLElement>('[data-real-hardware-panel]')") && realHardwarePanel.includes('tabIndex={-1}') && realHardwarePanel.includes('focus:ring-status-warning'), 'The REAL device-control action must move focus visibly into the governed hardware boundary.');
assert(!appHeader.includes('onRun') && !appHeader.includes('onStop'), 'Run/Stop must not be duplicated in AppHeader.');
assert(actionComposer.includes('Import JSON') && actionComposer.includes('Export library') && page.includes('onImport={(manifests)'), 'Action Composer must expose JSON library import/export and merge validated results into workspace state.');
assert(actionComposer.includes('importActionLibrary(') && actionLibrary.includes('validateActionManifest('), 'Every imported action must pass the same untrusted-manifest validator as authored actions.');
assert(actionLibrary.includes(".strict()") && actionLibrary.includes('import is atomic and never overwrites'), 'Action libraries must reject unknown envelope fields and never silently overwrite actions.');
assert(actionComposer.includes('getReferenceActionRecipe') && actionComposer.includes('validateActionManifest(raw, deviceMeta, BUILTIN_INTENT_IDS)'), 'Action Composer must revalidate a profile-matched reference recipe before loading it.');
assert(referenceRecipes.includes('robot_arm: robotArmRecipe') && referenceRecipes.includes('smart_light: smartLightRecipe') && referenceRecipes.includes('camera_sensor: cameraRecipe'), 'Reference recipes must cover all three runnable device families.');
assert(appHeader.includes('onImportManual') && manualImportWizard.includes('SIMULATION ONLY'), 'File menu must expose manual import behind a distinct simulation-only review boundary.');
assert(manualImport.includes("supported_adapters: ['simulator']") && manualImport.includes('validateStoredManualImport'), 'Saved manual proposals must revalidate as simulator-only records on project load.');
assert(manualImportWizard.includes('<SemanticDeviceStage') && manualImportWizard.includes('Second gate: enable in Virtual Lab'), 'Manual proposal UI must expose semantic preview and a separate Virtual Lab enablement confirmation.');
assert(manualImportWizard.includes("event.key === 'Escape'") && manualImportWizard.includes("event.key !== 'Tab'") && page.includes('modal-surface-active') && page.includes('data-app-modal') && globalStyles.includes('.modal-surface-active > :not([data-app-modal])'), 'Manual review modal must trap keyboard focus, support Escape, and share the app-wide background/Three.js suppression contract.');
assert(manualImport.includes('enableManualImportForVirtualLab') && manualImport.includes('real_device_enabled: false') && page.includes('restoreEnabledManualSimulationAsset'), 'Enabled manual assets must remain simulator-only and revalidate during desktop project restore.');
assert(virtualDeviceStage.includes('Forbidden-zone visual editor') && virtualDeviceStage.includes('onForbiddenZonesChange'), '3D workspace must expose an explicit forbidden-zone editor.');
assert(semanticDeviceStage.includes('function ForbiddenZoneOverlay') && semanticDeviceStage.includes("forbidden ? '#F43F5E' : '#38BDF8'"), 'Forbidden zones must render as visually distinct 3D safety regions.');
assert(page.includes('onForbiddenZonesChange={(forbiddenZones)') && page.includes('updateWorkspaceDevice(selectedWorkspaceDevice.id'), '3D zone edits must use the existing workspace update/invalidation path.');

for (const label of ['New Project', 'Open Project', 'Save Project', 'Export Lab Report', 'Export Deployment Package', 'Run Virtual Lab', 'Replay']) {
  assert(menu.includes(label), `Desktop menu missing ${label}.`);
}
for (const label of ['Open Support Guide', 'Third-Party Notices', 'Export Local Diagnostic Bundle', 'About RealityWarden']) assert(menu.includes(label), `Desktop Help menu missing ${label}.`);
assert(appHeader.includes('data-file-action={item.id}') && appHeader.includes("id: 'diagnostics'") && appHeader.includes("id: 'support'"), 'Visible File menu must expose support and local diagnostics.');

assert(docs.includes('Electron Architecture'), 'DESKTOP_APP.md must document Electron architecture.');
assert(docs.includes('Real Device'), 'DESKTOP_APP.md must document real-device safety boundary.');
assert(docs.includes('nsis'), 'DESKTOP_APP.md must document the Windows installer target.');

console.log('Desktop tests passed.');
console.log('- Electron main/preload/IPC/menu files exist.');
console.log('- preload exposes window.openReality without fs access.');
console.log('- project schema and export IPC are covered.');
console.log('- desktop scripts, installer metadata, docs, and runnable-device UI gating are present.');
