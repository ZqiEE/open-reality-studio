const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const projectIpc = read('electron/ipc/project.ipc.ts');
const exportIpc = read('electron/ipc/export.ipc.ts');
const menu = read('electron/menus/appMenu.ts');
const docs = read('docs/DESKTOP_APP.md');
const readme = read('README.md');
const windowsTrialGuide = read('docs/WINDOWS_TRIAL_GUIDE.md');
const packScript = read('scripts/pack-electron.cjs');
const page = read('app/page.tsx');
const i18n = read('lib/i18n.ts');
const labConfigurator = read('components/LabConfigurator.tsx');

for (const file of [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/ipc/project.ipc.ts',
  'electron/ipc/file.ipc.ts',
  'electron/ipc/export.ipc.ts',
  'electron/menus/appMenu.ts'
]) {
  assert(fs.existsSync(path.join(root, file)), `${file} must exist.`);
}

assert(main.includes("title: 'Open Reality Studio'"), 'Desktop window title must be Open Reality Studio.');
assert(main.includes('contextIsolation: true'), 'Electron must enable contextIsolation.');
assert(main.includes('nodeIntegration: false'), 'Electron must disable nodeIntegration.');
assert(main.includes('preload:'), 'Electron window must load a preload script.');

assert(preload.includes("contextBridge.exposeInMainWorld('openReality'"), 'preload must expose window.openReality.');
assert(!preload.includes('fs'), 'preload must not expose fs.');
assert(preload.includes('ipcRenderer.invoke'), 'preload must use IPC invocation.');

assert(projectIpc.includes('showOpenDialog'), 'Project IPC must open local project files.');
assert(projectIpc.includes('showSaveDialog'), 'Project IPC must save local project files.');
assert(projectIpc.includes('isProjectFile'), 'Project IPC must validate project schema.');
assert(projectIpc.includes('project') && projectIpc.includes('devices') && projectIpc.includes('workspace') && projectIpc.includes('lab_reports'), 'Project schema must include required top-level sections.');

assert(exportIpc.includes('export:labReport'), 'Export IPC must support Lab Report export.');
assert(exportIpc.includes('export:deploymentPackage'), 'Export IPC must support Deployment Package export.');

for (const script of ['desktop:start', 'desktop:dev', 'desktop:build', 'desktop:pack', 'desktop:smoke', 'test:desktop']) {
  assert(packageJson.scripts[script], `package.json missing ${script}.`);
}
assert(packageJson.scripts['desktop:prod'], 'package.json missing desktop:prod.');

assert.equal(packageJson.main, 'dist-electron/main.js', 'package.json main must point at the compiled Electron entry.');
assert(packageJson.build, 'package.json must declare electron-builder config.');
assert.equal(packageJson.build.productName, 'Open Reality Studio', 'electron-builder productName must be Open Reality Studio.');
assert.equal(packageJson.build.appId, 'studio.openreality.desktop', 'electron-builder appId must be declared.');
assert.equal(packageJson.build.icon, 'assets/branding/open-reality-studio.ico', 'electron-builder must declare a branded desktop icon.');
assert(Array.isArray(packageJson.build.files) && packageJson.build.files.includes('.next-build/**/*'), 'electron-builder must package the Next production build output.');
assert(packScript.includes('process.exit(1)'), 'desktop pack script must fail explicitly when electron-builder is missing.');
assert(packScript.includes("'--win', 'nsis'"), 'desktop pack script must target a Windows installer.');
assert(readme.includes('npm run desktop:dev'), 'README must expose explicit desktop development startup.');
assert(readme.includes('npm run desktop:prod'), 'README must expose explicit desktop production startup.');
assert(readme.includes('desktop:start') && readme.includes('convenience script'), 'README must describe desktop:start as a local convenience path instead of the main trial command.');
assert(windowsTrialGuide.includes('npm run desktop:prod'), 'Windows trial guide must direct source-based evaluators to desktop:prod.');
assert(windowsTrialGuide.includes('npm run desktop:dev'), 'Windows trial guide must keep desktop:dev as the explicit development path.');
assert(main.includes("open-reality-studio.ico"), 'Electron window must use the branded desktop icon.');
assert(main.includes("--smoke-test"), 'Electron main must support desktop smoke-test mode.');
assert(fs.existsSync(path.join(root, 'assets/branding/open-reality-studio.ico')), 'Branded desktop icon .ico must exist.');
assert(fs.existsSync(path.join(root, 'assets/branding/open-reality-studio.png')), 'Branded desktop icon .png must exist.');
assert(page.includes("const publicAlphaRunnableDeviceTypes: DeviceType[] = ['robot_arm', 'smart_light', 'camera_sensor'];"), 'Desktop UI must keep the public alpha runnable device list limited to robot_arm, smart_light, and camera_sensor.');
assert(page.includes('if (!running && runTargetRunnable) onRun();'), 'AI command submit must only auto-run when the selected target is runnable.');
assert(page.includes('disabled={running || !currentRunTargetRunnable}'), 'Top-level Run button must stay disabled for unrunnable devices.');
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

for (const label of ['New Project', 'Open Project', 'Save Project', 'Export Lab Report', 'Export Deployment Package', 'Run Virtual Lab', 'Replay']) {
  assert(menu.includes(label), `Desktop menu missing ${label}.`);
}

assert(docs.includes('Electron Architecture'), 'DESKTOP_APP.md must document Electron architecture.');
assert(docs.includes('Real Device'), 'DESKTOP_APP.md must document real-device safety boundary.');
assert(docs.includes('nsis'), 'DESKTOP_APP.md must document the Windows installer target.');

console.log('Desktop tests passed.');
console.log('- Electron main/preload/IPC/menu files exist.');
console.log('- preload exposes window.openReality without fs access.');
console.log('- project schema and export IPC are covered.');
console.log('- desktop scripts, installer metadata, docs, and runnable-device UI gating are present.');
