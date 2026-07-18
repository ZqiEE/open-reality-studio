import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDiagnosticBundle } from './diagnostics';

export interface SupportActions {
  openGuide: () => Promise<{ ok: boolean; error?: string }>;
  openThirdPartyNotices: () => Promise<{ ok: boolean; error?: string }>;
  exportDiagnostics: () => Promise<{ canceled: boolean; filePath?: string }>;
  showAbout: () => Promise<void>;
}

let supportWindow: BrowserWindow | null = null;
let noticesWindow: BrowserWindow | null = null;

export function createSupportActions(appRoot: string, getLogPath: () => string): SupportActions {
  const supportGuide = () => app.isPackaged
    ? path.join(process.resourcesPath, 'support', 'SUPPORT.html')
    : path.join(appRoot, 'docs', 'SUPPORT.html');
  const thirdPartyNotices = () => app.isPackaged
    ? path.join(process.resourcesPath, 'support', 'THIRD_PARTY_NOTICES.html')
    : path.join(appRoot, 'docs', 'THIRD_PARTY_NOTICES.html');

  return {
    openGuide: async () => {
      const guidePath = supportGuide();
      try {
        await fs.access(guidePath);
        if (supportWindow && !supportWindow.isDestroyed()) {
          if (supportWindow.isMinimized()) supportWindow.restore();
          supportWindow.focus();
          return { ok: true };
        }
        supportWindow = new BrowserWindow({
          title: 'RealityWarden Support',
          width: 860,
          height: 720,
          minWidth: 640,
          minHeight: 520,
          show: false,
          autoHideMenuBar: true,
          backgroundColor: '#090A0C',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        });
        supportWindow.once('ready-to-show', () => supportWindow?.show());
        supportWindow.once('closed', () => { supportWindow = null; });
        await supportWindow.loadFile(guidePath);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Support guide unavailable',
          message: 'RealityWarden could not open the packaged support guide.',
          detail: message
        });
        return { ok: false, error: message };
      }
    },
    openThirdPartyNotices: async () => {
      const noticesPath = thirdPartyNotices();
      try {
        await fs.access(noticesPath);
        if (noticesWindow && !noticesWindow.isDestroyed()) {
          if (noticesWindow.isMinimized()) noticesWindow.restore();
          noticesWindow.focus();
          return { ok: true };
        }
        noticesWindow = new BrowserWindow({
          title: 'RealityWarden Third-Party Notices',
          width: 940,
          height: 760,
          minWidth: 640,
          minHeight: 520,
          show: false,
          autoHideMenuBar: true,
          backgroundColor: '#090A0C',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        });
        noticesWindow.once('ready-to-show', () => noticesWindow?.show());
        noticesWindow.once('closed', () => { noticesWindow = null; });
        await noticesWindow.loadFile(noticesPath);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Third-party notices unavailable',
          message: 'RealityWarden could not open the packaged third-party notices.',
          detail: message
        });
        return { ok: false, error: message };
      }
    },
    exportDiagnostics: async () => {
      const result = await dialog.showSaveDialog({
        title: 'Export Local Diagnostic Bundle',
        defaultPath: `RealityWarden-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'RealityWarden diagnostics', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const bundle = await buildDiagnosticBundle({
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? 'unknown',
        chromeVersion: process.versions.chrome ?? 'unknown',
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        packaged: app.isPackaged,
        locale: app.getLocale(),
        logPath: getLogPath(),
        redactionRoots: [os.homedir(), os.tmpdir(), app.getPath('userData'), appRoot, process.resourcesPath]
      });
      await fs.writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      return { canceled: false, filePath: result.filePath };
    },
    showAbout: async () => {
      await dialog.showMessageBox({
        type: 'info',
        title: 'About RealityWarden',
        message: `RealityWarden ${app.getVersion()} · Public Alpha`,
        detail: [
          'REAL-device-first safety governance runtime.',
          'Current REAL scope: ESP32-S3 + SG90 + HC-SR04 reviewed reference rig.',
          'SIM LAB is an explicit, secondary, zero-signal test and review tool.',
          'No physical outcome is inferred from software acknowledgement.'
        ].join('\n')
      });
    }
  };
}
