import { app, BrowserWindow, dialog } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { registerExportIpc } from './ipc/export.ipc';
import { registerFileIpc } from './ipc/file.ipc';
import { registerProjectIpc } from './ipc/project.ipc';
import { createAppMenu } from './menus/appMenu';

const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(root, '..');
const appRoot = fs.existsSync(path.join(root, 'package.json')) ? root : sourceRoot;
const serverLog = path.join(appRoot, 'electron', 'desktop-server.log');
const basePort = Number(process.env.ORS_DESKTOP_PORT || 3100);
const isWindows = process.platform === 'win32';

let nextProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

function appendLog(message: string) {
  try {
    fs.appendFileSync(serverLog, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Startup logging must not block the desktop shell.
  }
}

function loadingHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; height: 100%; background: #F5F5F7; color: #1D1D1F; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
      body { display: grid; place-items: center; }
      main { width: 380px; border: 1px solid #E5E5EA; background: #fff; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,.06); }
      .brand { color: #0066CC; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 8px 0; font-size: 18px; line-height: 1.25; }
      p { margin: 0; color: #86868B; font-size: 12px; line-height: 1.7; }
      .bar { height: 3px; margin-top: 18px; overflow: hidden; background: #E5E5EA; }
      .bar::before { content: ""; display: block; height: 100%; width: 42%; background: linear-gradient(90deg, #007AFF, #0066CC); animation: move 1.15s ease-in-out infinite; }
      @keyframes move { 0% { transform: translateX(-120%); } 100% { transform: translateX(260%); } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">Open Reality Studio Desktop</div>
      <h1>Starting Virtual Lab</h1>
      <p>The local simulator service is starting. Open Reality Studio will load automatically.</p>
      <div class="bar"></div>
    </main>
  </body>
</html>`;
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

async function startNextServer(port: number) {
  const prod = process.argv.includes('--prod');
  const url = `http://127.0.0.1:${port}`;
  if (await request(url)) return;

  const nextCli = path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = prod ? [nextCli, 'start', '-p', String(port)] : [nextCli, 'dev', '-p', String(port)];
  const nextDistDir = prod ? '.next-build' : `.next-desktop-${port}`;
  const logStream = fs.createWriteStream(serverLog, { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] Starting node ${args.join(' ')}\n`);

  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: { ...process.env, BROWSER: 'none', ORS_NEXT_DIST_DIR: nextDistDir },
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

async function createWindow() {
  const port = await findAvailablePort(basePort);
  const url = `http://127.0.0.1:${port}`;
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    center: true,
    title: 'Open Reality Studio',
    backgroundColor: '#18191B',
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'default',
    show: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml())}`);
  appendLog(`Starting Next server at ${url}`);
  await startNextServer(port);
  await waitForServer(url);
  await mainWindow.loadURL(url);
}

function shutdownServer() {
  if (!nextProcess) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(nextProcess.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    nextProcess.kill('SIGTERM');
  }
  nextProcess = null;
}

registerProjectIpc();
registerFileIpc();
registerExportIpc();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  createAppMenu(appRoot);
  try {
    await createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`Startup failed: ${message}`);
    dialog.showErrorBox('Open Reality Studio failed to start', message);
    shutdownServer();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  shutdownServer();
  app.quit();
});

app.on('before-quit', shutdownServer);
