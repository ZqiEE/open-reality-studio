import { BrowserWindow, Menu } from 'electron';
import type { SupportActions } from '../support/supportActions';

type MenuAction =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:saveAs'
  | 'export:labReport'
  | 'export:deploymentPackage'
  | 'run:preflight'
  | 'run:gatedCommand'
  | 'run:stop'
  | 'run:replay'
  | 'view:toggleExplorer'
  | 'view:toggleInspector'
  | 'view:toggleConsole';

function send(action: MenuAction) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:action', action);
}

export function createAppMenu(support: SupportActions) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('project:new') },
        { label: 'Open Project', accelerator: 'CmdOrCtrl+O', click: () => send('project:open') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('project:save') },
        { label: 'Save Project As', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('project:saveAs') },
        { type: 'separator' },
        { label: 'Export Run Report', click: () => send('export:labReport') },
        { label: 'Export Adapter Package', click: () => send('export:deploymentPackage') },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'Simulation',
      submenu: [
        { label: 'Run Preflight Checks', accelerator: 'F6', click: () => send('run:preflight') },
        { label: 'Run Governed Command', accelerator: 'F5', click: () => send('run:gatedCommand') },
        { label: 'Stop Simulation', accelerator: 'Shift+F5', click: () => send('run:stop') },
        { label: 'Replay Last Run', accelerator: 'CmdOrCtrl+R', click: () => send('run:replay') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Project Explorer', click: () => send('view:toggleExplorer') },
        { label: 'Toggle Inspector', click: () => send('view:toggleInspector') },
        { label: 'Toggle Console', click: () => send('view:toggleConsole') },
        { type: 'separator' },
        { label: 'Reload', role: 'reload' },
        { label: 'Toggle Developer Tools', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open Support Guide', click: () => void support.openGuide() },
        { label: 'Third-Party Notices', click: () => void support.openThirdPartyNotices() },
        { label: 'Export Local Diagnostic Bundle…', click: () => void support.exportDiagnostics() },
        { type: 'separator' },
        { label: 'About RLSOK', click: () => void support.showAbout() }
      ]
    }
  ]));
}
