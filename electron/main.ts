import { app, BrowserWindow, dialog } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { registerExportIpc } from './ipc/export.ipc';
import { registerFileIpc } from './ipc/file.ipc';
import { registerHardwareIpc } from './ipc/hardware.ipc';
import { registerMarketplaceIpc } from './ipc/marketplace.ipc';
import { registerProjectIpc } from './ipc/project.ipc';
import { registerSupportIpc } from './ipc/support.ipc';
import { createAppMenu } from './menus/appMenu';
import { startupShellHtml, type StartupLanguage, type StartupShellState } from './startupShell';
import { createSupportActions } from './support/supportActions';

const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(root, '..');
const appRoot = fs.existsSync(path.join(root, 'package.json')) ? root : sourceRoot;
const serverRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : appRoot;
const basePort = Number(process.env.ORS_DESKTOP_PORT || 3100);
const isDesignSmokeTest = process.argv.includes('--design-smoke-test');
const isStartupDesignSmokeTest = process.argv.includes('--startup-design-smoke-test');
const isJourneySmokeTest = process.argv.includes('--journey-smoke-test');
const isSmokeTest = process.argv.includes('--smoke-test') || isDesignSmokeTest || isStartupDesignSmokeTest || isJourneySmokeTest;

let nextProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let startupRetryInFlight = false;

function getServerLogPath() {
  const baseDir = app.isReady() ? app.getPath('userData') : path.join(sourceRoot, '.tmp');
  const logDir = path.join(baseDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'desktop-server.log');
}

const singleInstanceLock = isSmokeTest ? true : app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

if (isSmokeTest) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
}

function appendLog(message: string) {
  try {
    fs.appendFileSync(getServerLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Startup logging must not block the desktop shell.
  }
}

function startupLanguage(): StartupLanguage {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

async function loadStartupShell(window: BrowserWindow, state: StartupShellState, detail?: string) {
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupShellHtml({ language: startupLanguage(), state, detail }))}`);
}

async function loadStartupShellForAcceptance(window: BrowserWindow, language: StartupLanguage, state: StartupShellState, detail?: string) {
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupShellHtml({ language, state, detail }))}`);
}

function request(url: string) {
  return new Promise<boolean>((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available simulator port found from ${startPort} to ${startPort + 19}.`);
}

async function waitForServer(url: string, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await request(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Simulator server did not start at ${url} within ${Math.round(timeoutMs / 1000)} seconds.`);
}

interface RendererSmokeSnapshot {
  ready: boolean;
  title: string;
  appHeader: boolean;
  deviceNavigator: boolean;
  commandDock: boolean;
  realDeviceWorkspace: boolean;
  realModeSelected: boolean;
  runControls: number;
  stopControls: number;
  simulationBoundary: boolean;
  realHardwareBoundary: boolean;
  realHardwarePrimary: boolean;
  preloadBridge: boolean;
  hardwareBridge: boolean;
  realHardwarePanelReady: boolean;
  marketplaceBridge: boolean;
  marketplaceTrigger: boolean;
  offlineDegradation: boolean;
}

async function waitForRendererSmoke(window: BrowserWindow, requireOfflineDegradation = false, timeoutMs = 60_000) {
  await waitForDomCondition(window, `document.querySelector('[data-component="RealDeviceWorkspace"]') && document.querySelector('button[title="REAL DEVICE"][aria-pressed="true"]')`, timeoutMs);
  if (requireOfflineDegradation) await setWorkspaceMode(window, 'simulation');
  const started = Date.now();
  let lastSnapshot: RendererSmokeSnapshot | null = null;
  while (Date.now() - started < timeoutMs) {
    lastSnapshot = await window.webContents.executeJavaScript(`(() => {
      const exactButtons = (label) => Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === label).length;
      const bodyText = document.body?.innerText ?? '';
      const allText = document.body?.textContent ?? '';
      const snapshot = {
        title: document.title,
        appHeader: Boolean(document.querySelector('[data-component="AppHeader"]')),
        deviceNavigator: Boolean(document.querySelector('[data-component="DeviceNavigator"]')),
        commandDock: Boolean(document.querySelector('[data-component="CommandDock"]')),
        realDeviceWorkspace: Boolean(document.querySelector('[data-component="RealDeviceWorkspace"]')),
        realModeSelected: Boolean(document.querySelector('button[title="REAL DEVICE"][aria-pressed="true"]')),
        runControls: exactButtons('Run'),
        stopControls: exactButtons('Stop'),
        simulationBoundary: bodyText.includes('SIMULATION ONLY') || bodyText.includes('Simulation Only'),
        realHardwareBoundary: Boolean(document.querySelector('[data-real-hardware-boundary]')) && bodyText.includes('REAL HARDWARE'),
        realHardwarePrimary: (() => {
          const boundary = document.querySelector('[data-real-hardware-primary="true"]');
          const sidebar = document.querySelector('[data-component="EvidenceSidebar"]');
          return boundary instanceof HTMLElement && sidebar instanceof HTMLElement && boundary.getBoundingClientRect().height >= sidebar.getBoundingClientRect().height * 0.5;
        })(),
        preloadBridge: typeof window.openReality === 'object',
        hardwareBridge: typeof window.openReality?.hardware === 'object',
        realHardwarePanelReady: Boolean(document.querySelector('[data-real-hardware-bridge-ready="true"]')),
        marketplaceBridge: typeof window.openReality?.marketplace === 'object',
        marketplaceTrigger: Boolean(document.querySelector('[data-marketplace-trigger]')),
        offlineDegradation: allText.includes('rule compiler (LLM offline)') || allText.includes('规则编译器（LLM 离线）')
      };
      const modeReady = ${requireOfflineDegradation ? 'snapshot.deviceNavigator && snapshot.commandDock && snapshot.runControls === 1 && snapshot.stopControls === 1 && snapshot.simulationBoundary' : 'snapshot.realDeviceWorkspace && snapshot.realModeSelected && snapshot.runControls === 0 && snapshot.stopControls === 0'};
      return { ...snapshot, ready: snapshot.title === 'RealityWarden' && snapshot.appHeader && modeReady && snapshot.realHardwareBoundary && (${requireOfflineDegradation ? 'true' : 'snapshot.realHardwarePrimary'}) && snapshot.preloadBridge && snapshot.hardwareBridge && snapshot.realHardwarePanelReady && snapshot.marketplaceBridge && snapshot.marketplaceTrigger && (${requireOfflineDegradation ? 'snapshot.offlineDegradation' : 'true'}) };
    })()`, true) as RendererSmokeSnapshot;
    if (lastSnapshot.ready) return lastSnapshot;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged renderer did not satisfy the first-run contract: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForCommandState(window: BrowserWindow, state: 'completed' | 'blocked', timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await window.webContents.executeJavaScript(`document.querySelector('[data-command-state]')?.getAttribute('data-command-state') ?? null`, true) as string | null;
    if (current === state) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Installed core journey timed out waiting for command state: ${state}`);
}

async function submitJourneyPrompt(window: BrowserWindow, prompt: string) {
  const submitted = await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-component="CommandDock"]');
    const textarea = dock?.querySelector('textarea');
    const run = Array.from(dock?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === 'Run');
    if (!(textarea instanceof HTMLTextAreaElement) || !(run instanceof HTMLButtonElement) || run.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    run.click();
    return true;
  })()`, true) as boolean;
  if (!submitted) throw new Error(`Installed core journey could not submit prompt: ${prompt}`);
}

async function runInstalledCoreJourney(window: BrowserWindow) {
  await setWorkspaceMode(window, 'simulation');
  await setDesignLanguage(window, 'en');
  // The isolated first launch intentionally demonstrates a blocked unsafe task.
  await waitForCommandState(window, 'blocked');
  await submitJourneyPrompt(window, 'Move the red cube to the back safe zone');
  await waitForCommandState(window, 'completed');
  const safeEvidence = await window.webContents.executeJavaScript(`(() => {
    const selectedTab = document.querySelector('[data-component="EvidenceSidebar"] [role="tab"][aria-selected="true"]');
    const sidebarText = document.querySelector('[data-component="EvidenceSidebar"]')?.textContent ?? '';
    return { auditSelected: selectedTab?.textContent?.includes('Audit & Governor') === true, hasExecutedEvidence: /Executed|Pass|completed/i.test(sidebarText) };
  })()`, true) as { auditSelected: boolean; hasExecutedEvidence: boolean };
  if (!safeEvidence.auditSelected || !safeEvidence.hasExecutedEvidence) throw new Error(`Installed safe journey did not expose one-step audit evidence: ${JSON.stringify(safeEvidence)}`);

  await submitJourneyPrompt(window, 'Throw the red cube off the table');
  await waitForCommandState(window, 'blocked');
  const blockedEvidence = await window.webContents.executeJavaScript(`(() => {
    const selectedTab = document.querySelector('[data-component="EvidenceSidebar"] [role="tab"][aria-selected="true"]');
    const sidebarText = document.querySelector('[data-component="EvidenceSidebar"]')?.textContent ?? '';
    return {
      auditSelected: selectedTab?.textContent?.includes('Audit & Governor') === true,
      hasBlockedEvidence: /Blocked|Safety Blocked/i.test(sidebarText),
      realHardwareBoundary: Boolean(document.querySelector('[data-real-hardware-boundary]'))
    };
  })()`, true) as { auditSelected: boolean; hasBlockedEvidence: boolean; realHardwareBoundary: boolean };
  if (!blockedEvidence.auditSelected || !blockedEvidence.hasBlockedEvidence || !blockedEvidence.realHardwareBoundary) throw new Error(`Installed blocked journey did not preserve evidence and hardware boundaries: ${JSON.stringify(blockedEvidence)}`);
  return { safe_execution: 'passed', blocked_zero_motion_path: 'passed', audit_evidence_one_step: 'passed', real_hardware_boundary: 'passed' };
}

function enforceOfflineSmokeBoundary(window: BrowserWindow, localOrigin: string) {
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    try {
      const requestUrl = new URL(details.url);
      const isNetworkRequest = requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
      callback({ cancel: isNetworkRequest && requestUrl.origin !== localOrigin });
    } catch {
      callback({ cancel: false });
    }
  });
}

async function waitForDomCondition(window: BrowserWindow, expression: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true) as boolean) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Design acceptance DOM condition timed out: ${expression}`);
}

async function setDesignLanguage(window: BrowserWindow, language: 'zh' | 'en', requireSimulationControls = true) {
  const changed = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[data-interface-language]');
    if (!(select instanceof HTMLSelectElement)) return false;
    select.value = '${language}';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`, true) as boolean;
  if (!changed) throw new Error('Design acceptance could not find the interface language control.');
  await waitForDomCondition(window, `document.querySelector('[data-interface-language]')?.value === ${JSON.stringify(language)}`);
  if (!requireSimulationControls) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return;
  }
  const runLabel = language === 'zh' ? '运行' : 'Run';
  const stopLabel = language === 'zh' ? '停止' : 'Stop';
  await waitForDomCondition(window, `document.querySelectorAll('button[data-run-control][aria-label=${JSON.stringify(runLabel)}]').length === 1 && document.querySelectorAll('button[data-stop-control][aria-label=${JSON.stringify(stopLabel)}]').length === 1`);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function setWorkspaceMode(window: BrowserWindow, mode: 'real' | 'simulation') {
  const label = mode === 'real' ? 'REAL DEVICE' : 'Simulation Lab';
  const changed = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button[title="${label}"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return true;
  })()`, true) as boolean;
  if (!changed) throw new Error(`Design acceptance could not select workspace mode: ${mode}`);
  const selector = mode === 'real' ? '[data-component="RealDeviceWorkspace"]' : '[data-component="DeviceNavigator"]';
  await waitForDomCondition(window, `document.querySelector(${JSON.stringify(selector)})`);
}

async function captureRealWorkspaceLayout(window: BrowserWindow, width: number, height: number, language: 'zh' | 'en') {
  window.setContentSize(width, height);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForDomCondition(window, `innerWidth === ${width} && innerHeight === ${height}`);
  await setWorkspaceMode(window, 'real');
  await setDesignLanguage(window, language, false);
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    };
    const header = rect('[data-component="AppHeader"]');
    const workspace = rect('[data-component="RealDeviceWorkspace"]');
    const sidebar = rect('[data-component="EvidenceSidebar"]');
    const hardware = rect('[data-real-hardware-primary="true"]');
    const violations = [];
    if (innerWidth !== ${width} || innerHeight !== ${height}) violations.push('viewport_mismatch');
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) violations.push('document_overflow');
    if (!header || header.scrollWidth > header.clientWidth + 1) violations.push('header_overflow');
    if (!workspace || workspace.width < 800) violations.push('real_workspace_min_width');
    if (!sidebar || !hardware || hardware.height < sidebar.height * 0.5) violations.push('real_hardware_not_primary');
    if (document.querySelector('[data-component="DeviceNavigator"]') || document.querySelector('[data-component="CommandDock"]')) violations.push('simulation_surface_visible');
    if (document.querySelectorAll('button[data-run-control], button[data-stop-control]').length !== 0) violations.push('simulation_controls_visible');
    return { mode: 'real', viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, language: '${language}', header, workspace, sidebar, hardware, violations };
  })()`, true) as { violations: string[]; [key: string]: unknown };
  if (snapshot.violations.length > 0) throw new Error(`REAL workspace layout failed at ${width}x${height}, ${language}: ${JSON.stringify(snapshot)}`);
  return snapshot;
}

async function captureDesignLayout(window: BrowserWindow, width: number, height: number, language: 'zh' | 'en', scale = 1) {
  window.setContentSize(width, height);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForDomCondition(window, `innerWidth === ${width} && innerHeight === ${height}`);
  await setWorkspaceMode(window, 'simulation');
  await setDesignLanguage(window, language);
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const project = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight };
    };
    const intersects = (left, right) => Boolean(left && right && Math.min(left.right, right.right) > Math.max(left.x, right.x) && Math.min(left.bottom, right.bottom) > Math.max(left.y, right.y));
    const header = project('[data-component="AppHeader"]');
    const navigator = project('[data-component="DeviceNavigator"]');
    const workspace = project('[data-component="WorkspaceViewport"]');
    const dock = project('[data-component="CommandDock"]');
    const sidebar = project('[data-component="EvidenceSidebar"]');
    const hardware = project('[data-real-hardware-boundary]');
    const violations = [];
    if (innerWidth !== ${width} || innerHeight !== ${height}) violations.push('viewport_mismatch');
    const expectedNavigatorWidth = innerWidth < 1280 ? 240 : 280;
    const expectedSidebarWidth = innerWidth < 1280 ? 320 : 360;
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) violations.push('document_overflow');
    if (!header || Math.abs(header.height - 48) > 1 || header.scrollWidth > header.clientWidth + 1) violations.push('header_contract');
    if (!navigator || Math.abs(navigator.width - expectedNavigatorWidth) > 1) violations.push('navigator_width');
    if (!sidebar || Math.abs(sidebar.width - expectedSidebarWidth) > 1) violations.push('sidebar_width');
    if (!workspace || workspace.width < 560) violations.push('workspace_min_width');
    if (!dock || dock.width < 520 || dock.x < (workspace?.x ?? 0) || dock.right > (workspace?.right ?? innerWidth)) violations.push('command_dock_bounds');
    if (!hardware || hardware.x < (sidebar?.x ?? innerWidth) || hardware.right > (sidebar?.right ?? 0) + 1) violations.push('real_hardware_bounds');
    if (intersects(dock, sidebar) || intersects(dock, navigator) || intersects(dock, hardware)) violations.push('critical_overlap');
    const clippedControls = Array.from(document.querySelectorAll('[data-component="AppHeader"] button, [data-component="AppHeader"] summary, [data-component="CommandDock"] button, [data-component="EvidenceSidebar"] [role="tab"]'))
      .filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({ text: (element.textContent ?? '').trim().slice(0, 80), tag: element.tagName, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (clippedControls.length > 0) violations.push('clipped_controls');
    const runControls = document.querySelectorAll('button[data-run-control]').length;
    const stopControls = document.querySelectorAll('button[data-stop-control]').length;
    if (runControls !== 1 || stopControls !== 1) violations.push('run_stop_count');
    return { viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, requestedScale: ${scale}, language: '${language}', header, navigator, workspace, dock, sidebar, hardware, clippedControls, runControls, stopControls, violations };
  })()`, true) as { violations: string[]; [key: string]: unknown };
  if (snapshot.violations.length > 0) throw new Error(`Design layout failed at ${width}x${height}, ${language}, scale ${scale}: ${JSON.stringify(snapshot)}`);
  return snapshot;
}

async function auditDesignDialog(
  window: BrowserWindow,
  id: string,
  open: () => Promise<void>,
  panelSelector: string,
  focusReturnSelector: string
) {
  await open();
  await waitForDomCondition(window, `document.querySelector(${JSON.stringify(panelSelector)})`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const measurement = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    if (!(panel instanceof HTMLElement)) return null;
    const rect = panel.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, activeInside: panel.contains(document.activeElement), withinViewport: rect.x >= 15 && rect.y >= 15 && rect.right <= innerWidth - 15 && rect.bottom <= innerHeight - 15, documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
  })()`, true) as { activeInside: boolean; withinViewport: boolean; documentOverflow: boolean; [key: string]: unknown } | null;
  if (!measurement || !measurement.activeInside || !measurement.withinViewport || measurement.documentOverflow) throw new Error(`Design dialog failed: ${id} ${JSON.stringify(measurement)}`);
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, true);
  await waitForDomCondition(window, `!document.querySelector(${JSON.stringify(panelSelector)})`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const focusRestored = await window.webContents.executeJavaScript(`document.activeElement?.matches(${JSON.stringify(focusReturnSelector)}) === true`, true) as boolean;
  if (!focusRestored) throw new Error(`Design dialog did not restore focus: ${id}`);
  return { id, status: 'passed', ...measurement, focusRestored };
}

async function runProductDesignAcceptance(window: BrowserWindow) {
  const realWorkspaceLayouts = [];
  realWorkspaceLayouts.push(await captureRealWorkspaceLayout(window, 1440, 900, 'zh'));
  realWorkspaceLayouts.push(await captureRealWorkspaceLayout(window, 1440, 900, 'en'));
  realWorkspaceLayouts.push(await captureRealWorkspaceLayout(window, 1180, 720, 'zh'));
  realWorkspaceLayouts.push(await captureRealWorkspaceLayout(window, 1180, 720, 'en'));
  const layouts = [];
  layouts.push(await captureDesignLayout(window, 1440, 900, 'zh'));
  layouts.push(await captureDesignLayout(window, 1440, 900, 'en'));
  layouts.push(await captureDesignLayout(window, 1180, 720, 'zh'));
  layouts.push(await captureDesignLayout(window, 1180, 720, 'en'));

  window.setContentSize(1180, 720);
  await setDesignLanguage(window, 'en');
  const dialogs = [];
  dialogs.push(await auditDesignDialog(window, 'action-composer', async () => {
    await window.webContents.executeJavaScript(`document.querySelector('[data-action-composer-trigger]')?.click()`, true);
  }, '[role="dialog"][aria-labelledby="action-composer-title"]', '[data-action-composer-trigger]'));
  dialogs.push(await auditDesignDialog(window, 'asset-import', async () => {
    await window.webContents.executeJavaScript(`document.querySelector('[data-file-menu-trigger]')?.click()`, true);
    await waitForDomCondition(window, `document.querySelector('[data-file-action="import-asset"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-file-action="import-asset"]')?.click()`, true);
  }, '[data-accessible-dialog-boundary] > .fixed > div', '[data-file-menu-trigger]'));
  dialogs.push(await auditDesignDialog(window, 'manual-import', async () => {
    await window.webContents.executeJavaScript(`document.querySelector('[data-file-menu-trigger]')?.click()`, true);
    await waitForDomCondition(window, `document.querySelector('[data-file-action="import-manual"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-file-action="import-manual"]')?.click()`, true);
  }, '[data-manual-import-modal] > section', '[data-file-menu-trigger]'));
  dialogs.push(await auditDesignDialog(window, 'marketplace', async () => {
    await window.webContents.executeJavaScript(`document.querySelector('[data-marketplace-trigger]')?.click()`, true);
  }, '[data-marketplace-modal] > section', '[data-marketplace-trigger]'));

  const debug = window.webContents.debugger;
  const attachedHere = !debug.isAttached();
  if (attachedHere) debug.attach('1.3');
  const scaling = [];
  let contrast: Record<string, unknown> | null = null;
  try {
    for (const scale of [1.25, 1.5]) {
      await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1180, height: 720, deviceScaleFactor: scale, mobile: false });
      scaling.push(await captureDesignLayout(window, 1180, 720, 'en', scale));
    }
    await debug.sendCommand('Emulation.clearDeviceMetricsOverride');
    await debug.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await window.webContents.executeJavaScript(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`, true);
    window.focus();
    window.webContents.focus();
    await debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    contrast = await window.webContents.executeJavaScript(`(() => {
      const boundary = document.querySelector('[data-real-hardware-boundary]');
      const focusTarget = document.activeElement;
      if (!(boundary instanceof HTMLElement) || !(focusTarget instanceof HTMLElement)) return null;
      const boundaryStyle = getComputedStyle(boundary);
      const focusStyle = getComputedStyle(focusTarget);
      return { forcedColors: matchMedia('(forced-colors: active)').matches, hardwareBorderStyle: boundaryStyle.borderTopStyle, hardwareBorderWidth: boundaryStyle.borderTopWidth, focusedTag: focusTarget.tagName, focusVisible: focusTarget.matches(':focus-visible'), focusOutlineStyle: focusStyle.outlineStyle, focusOutlineWidth: focusStyle.outlineWidth };
    })()`, true) as Record<string, unknown> | null;
    if (!contrast || contrast.forcedColors !== true || contrast.hardwareBorderStyle !== 'double' || contrast.focusOutlineStyle === 'none') throw new Error(`Forced-colors design contract failed: ${JSON.stringify(contrast)}`);
  } finally {
    try {
      await debug.sendCommand('Emulation.clearDeviceMetricsOverride');
      await debug.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    } finally {
      if (attachedHere && debug.isAttached()) debug.detach();
    }
  }

  const evidence = {
    schema: 'realitywarden.product-design-acceptance',
    schema_version: 1,
    product: 'RealityWarden',
    generated_at: new Date().toISOString(),
    gates: { responsive_layout: 'passed', bilingual_content: 'passed', windows_scaling: 'passed', dialog_boundaries: 'passed', keyboard_focus: 'passed', forced_colors: 'passed' },
    real_workspace_layouts: realWorkspaceLayouts,
    layouts,
    scaling,
    dialogs,
    contrast,
    not_claimed: { physical_hardware_acceptance: 'optional evidence; not assessed by this record', physical_outcome: 'not inferred from renderer layout acceptance' }
  };
  const evidencePath = process.env.ORS_DESIGN_EVIDENCE_PATH;
  if (evidencePath) {
    const resolved = path.resolve(evidencePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    fs.writeFileSync(resolved, serialized, 'utf8');
    const digest = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
    fs.writeFileSync(`${resolved}.sha256`, `${digest}  ${path.basename(resolved)}\n`, 'utf8');
  }
  return evidence;
}

async function captureStartupShell(window: BrowserWindow, width: number, height: number, language: StartupLanguage, state: StartupShellState) {
  window.setContentSize(width, height);
  const maliciousDetail = '<img src=x onerror="document.body.dataset.injected=1"> startup failure';
  await loadStartupShellForAcceptance(window, language, state, maliciousDetail);
  const measurement = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-component="LaunchShell"]');
    const rect = panel?.getBoundingClientRect();
    const bodyStyle = getComputedStyle(document.body);
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const visibleText = document.body.innerText;
    const controls = [...document.querySelectorAll('button')].map((button) => ({ text: button.textContent?.trim() || '', rect: button.getBoundingClientRect().toJSON() }));
    const forbiddenColors = ['rgb(255, 255, 255)', 'rgb(0, 0, 238)', 'rgb(0, 102, 204)'];
    const renderedColors = [...document.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element); return [style.color, style.backgroundColor, style.borderColor];
    });
    return {
      panel: rect?.toJSON() ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      bodyBackground: bodyStyle.backgroundColor,
      panelBackground: panelStyle?.backgroundColor ?? null,
      documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      role: document.querySelector('[role="alert"], [role="status"]')?.getAttribute('role') ?? null,
      activeTag: document.activeElement?.tagName ?? null,
      state: panel?.getAttribute('data-startup-state') ?? null,
      hasEvidenceBoundary: visibleText.includes('Audit Evidence'),
      escapedUntrustedDetail: !document.querySelector('img') && document.body.dataset.injected !== '1',
      controls,
      forbiddenColors: [...new Set(renderedColors.filter((color) => forbiddenColors.includes(color)))],
      allText: visibleText
    };
  })()`);
  const violations: string[] = [];
  if (!measurement.panel) violations.push('launch shell missing');
  if (measurement.bodyBackground !== 'rgb(9, 10, 12)' || measurement.panelBackground !== 'rgb(18, 20, 24)') violations.push('startup background token mismatch');
  if (measurement.documentOverflow) violations.push('document overflow');
  if (measurement.panel && (measurement.panel.x < 16 || measurement.panel.y < 16 || measurement.panel.right > width - 16 || measurement.panel.bottom > height - 16)) violations.push('panel outside 16px safe margin');
  if (measurement.forbiddenColors.length) violations.push(`forbidden launch colors: ${measurement.forbiddenColors.join(', ')}`);
  if (state.endsWith('error')) {
    if (measurement.role !== 'alert') violations.push('failure is not assertive alert');
    if (!measurement.hasEvidenceBoundary) violations.push('failure lacks Audit Evidence boundary');
    if (!measurement.escapedUntrustedDetail) violations.push('failure detail was not escaped');
    if (measurement.activeTag !== 'H1') violations.push('failure heading did not receive focus');
    if (measurement.controls.length < 4) violations.push('failure recovery controls missing');
  } else if (measurement.role !== 'status') violations.push('loading state is not polite status');
  if (violations.length) throw new Error(`Startup shell acceptance failed: ${JSON.stringify({ width, height, language, state, violations, measurement })}`);
  return { viewport: { width, height }, language, state, violations, measurement };
}

async function runStartupDesignAcceptance(window: BrowserWindow) {
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1180, height: 720 }]) {
    for (const language of ['zh', 'en'] as const) layouts.push(await captureStartupShell(window, viewport.width, viewport.height, language, 'cold_start'));
  }
  const failures = [
    await captureStartupShell(window, 1180, 720, 'zh', 'recoverable_error'),
    await captureStartupShell(window, 1180, 720, 'en', 'fatal_error')
  ];

  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
  const scaling = [];
  for (const factor of [1.25, 1.5]) {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1180, height: 720, deviceScaleFactor: factor, mobile: false });
    const result = await captureStartupShell(window, 1180, 720, 'en', 'initializing');
    const devicePixelRatio = await window.webContents.executeJavaScript('window.devicePixelRatio');
    scaling.push({ requested: factor, devicePixelRatio, result });
  }
  await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');

  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await loadStartupShellForAcceptance(window, 'en', 'initializing');
  const reducedMotion = await window.webContents.executeJavaScript(`(() => { const indicator=getComputedStyle(document.querySelector('.indicator'),'::after'); return { matches:matchMedia('(prefers-reduced-motion: reduce)').matches, animationName:indicator.animationName }; })()`);
  if (!reducedMotion.matches || reducedMotion.animationName !== 'none') throw new Error(`Startup reduced-motion acceptance failed: ${JSON.stringify(reducedMotion)}`);

  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await loadStartupShellForAcceptance(window, 'en', 'fatal_error', 'forced colors test');
  window.focus();
  window.webContents.focus();
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  const forcedColors = await window.webContents.executeJavaScript(`(() => { const panel=document.querySelector('[data-component="LaunchShell"]'); const focused=document.activeElement; const panelStyle=getComputedStyle(panel); const focusedStyle=getComputedStyle(focused); return { matches:matchMedia('(forced-colors: active)').matches, borderLeftStyle:panelStyle.borderLeftStyle, borderLeftWidth:panelStyle.borderLeftWidth, focusedTag:focused?.tagName ?? null, focusVisible:focused?.matches(':focus-visible') ?? false, outlineStyle:focusedStyle.outlineStyle, outlineWidth:focusedStyle.outlineWidth }; })()`);
  if (!forcedColors.matches || forcedColors.borderLeftStyle !== 'double' || !forcedColors.focusVisible || forcedColors.outlineStyle !== 'solid') throw new Error(`Startup forced-colors acceptance failed: ${JSON.stringify(forcedColors)}`);
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.webContents.debugger.detach();

  const evidence = {
    schema: 'realitywarden.startup-design-acceptance',
    schema_version: 1,
    product: 'RealityWarden',
    generated_at: new Date().toISOString(),
    gates: { no_flash_tokens: 'passed', responsive_layout: 'passed', bilingual_content: 'passed', windows_scaling: 'passed', failure_recovery: 'passed', reduced_motion: 'passed', forced_colors: 'passed' },
    layouts,
    failures,
    scaling,
    reduced_motion: reducedMotion,
    forced_colors: forcedColors,
    offline_degradation: 'verified separately by the installed forced-offline renderer smoke; LLM availability does not block workspace entry',
    not_claimed: { physical_hardware_acceptance: 'optional evidence; not assessed by this record', physical_outcome: 'not inferred from startup UI state' }
  };
  const evidencePath = process.env.ORS_STARTUP_DESIGN_EVIDENCE_PATH;
  if (evidencePath) {
    const resolved = path.resolve(evidencePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    fs.writeFileSync(resolved, serialized, 'utf8');
    const digest = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
    fs.writeFileSync(`${resolved}.sha256`, `${digest}  ${path.basename(resolved)}\n`, 'utf8');
  }
  return evidence;
}

function createDesktopWindow(show: boolean) {
  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(appRoot, 'assets', 'branding', 'realitywarden.ico');
  return new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    center: true,
    title: 'RealityWarden',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#090A0C',
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'default',
    show,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: isSmokeTest ? `realitywarden-smoke-${process.pid}` : undefined
    }
  });
}

async function startNextServer(port: number) {
  const prod = process.argv.includes('--prod');
  const url = `http://127.0.0.1:${port}`;
  if (await request(url)) return;

  const nextCli = path.join(serverRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = prod ? [nextCli, 'start', '-p', String(port)] : [nextCli, 'dev', '-p', String(port)];
  const nextDistDir = prod ? '.next-build' : `.next-desktop-${port}`;
  const logStream = fs.createWriteStream(getServerLogPath(), { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] Starting node ${args.join(' ')}\n`);

  const child = spawn(process.execPath, args, {
    cwd: serverRoot,
    env: {
      ...process.env,
      BROWSER: 'none',
      ELECTRON_RUN_AS_NODE: '1',
      ORS_NEXT_DIST_DIR: nextDistDir
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  nextProcess = child;
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.on('error', (error) => logStream.write(`[${new Date().toISOString()}] server error: ${error.message}\n`));
  child.on('exit', (code, signal) => {
    logStream.write(`[${new Date().toISOString()}] server exited code=${code} signal=${signal}\n`);
    logStream.end();
    nextProcess = null;
  });
}

async function bootDesktopWindow(window: BrowserWindow) {
  if (startupRetryInFlight || window.isDestroyed()) return;
  startupRetryInFlight = true;
  shutdownServer();
  let slowTimer: NodeJS.Timeout | null = null;
  let startupComplete = false;
  try {
    await loadStartupShell(window, 'cold_start');
    if (!window.isVisible()) window.show();
    slowTimer = setTimeout(() => {
      if (!startupComplete && !window.isDestroyed()) void loadStartupShell(window, 'initializing').catch((error) => appendLog(`Slow-start status update failed: ${String(error)}`));
    }, 2000);

    const port = await findAvailablePort(basePort);
    const url = `http://127.0.0.1:${port}`;
    appendLog(`Starting Next server at ${url}`);
    await startNextServer(port);
    await waitForServer(url);
    startupComplete = true;
    if (slowTimer) clearTimeout(slowTimer);
    await window.loadURL(url);
  } catch (error) {
    startupComplete = true;
    if (slowTimer) clearTimeout(slowTimer);
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`Recoverable startup failure: ${message}`);
    if (!window.isDestroyed()) await loadStartupShell(window, 'recoverable_error', message);
  } finally {
    startupRetryInFlight = false;
  }
}

function installStartupNavigation(window: BrowserWindow) {
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('realitywarden-startup://')) return;
    event.preventDefault();
    const action = targetUrl.slice('realitywarden-startup://'.length).replace(/\/$/, '');
    if (action === 'exit') {
      app.quit();
      return;
    }
    if (action === 'retry' || action === 'reload') void bootDesktopWindow(window);
  });
}

async function createWindow() {
  if (isStartupDesignSmokeTest) {
    mainWindow = createDesktopWindow(false);
    const startupEvidence = await runStartupDesignAcceptance(mainWindow);
    appendLog(`Startup design acceptance passed: ${JSON.stringify(startupEvidence)}`);
    mainWindow.destroy();
    mainWindow = null;
    await app.quit();
    return;
  }
  if (isSmokeTest) {
    const port = await findAvailablePort(basePort);
    const url = `http://127.0.0.1:${port}`;
    appendLog(`Starting Next server at ${url}`);
    await startNextServer(port);
    await waitForServer(url);
    mainWindow = createDesktopWindow(false);
    const offlineSmoke = process.argv.includes('--offline-smoke-test');
    if (offlineSmoke) enforceOfflineSmokeBoundary(mainWindow, url);
    await mainWindow.loadURL(url);
    const snapshot = await waitForRendererSmoke(mainWindow, offlineSmoke);
    appendLog(`Packaged first-run renderer smoke passed at ${url}: ${JSON.stringify(snapshot)}`);
    if (isJourneySmokeTest) {
      const journey = await runInstalledCoreJourney(mainWindow);
      appendLog(`Installed core journey passed: ${JSON.stringify(journey)}`);
    }
    if (isDesignSmokeTest) {
      const designEvidence = await runProductDesignAcceptance(mainWindow);
      appendLog(`Product design acceptance passed: ${JSON.stringify(designEvidence)}`);
    }
    mainWindow.destroy();
    mainWindow = null;
    shutdownServer();
    await app.quit();
    return;
  }

  mainWindow = createDesktopWindow(false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  installStartupNavigation(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await bootDesktopWindow(mainWindow);
}

function shutdownServer() {
  if (!nextProcess) return;
  nextProcess.kill('SIGTERM');
  nextProcess = null;
}

registerProjectIpc();
registerFileIpc();
registerHardwareIpc();
registerMarketplaceIpc();
registerExportIpc();
const supportActions = createSupportActions(appRoot, getServerLogPath);
registerSupportIpc(supportActions);

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  createAppMenu(supportActions);
  try {
    await createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`Startup failed: ${message}`);
    if (isSmokeTest) {
      process.exitCode = 1;
      shutdownServer();
      app.exit(1);
      return;
    }
    dialog.showErrorBox('RealityWarden failed to start', message);
    shutdownServer();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  shutdownServer();
  app.quit();
});

app.on('before-quit', shutdownServer);
