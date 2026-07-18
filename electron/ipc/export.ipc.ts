import { dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';

async function saveJson(title: string, defaultPath: string, payload: unknown) {
  const result = await dialog.showSaveDialog({
    title,
    defaultPath,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
}

export function registerExportIpc() {
  ipcMain.handle('export:labReport', async (_event, payload: { report: unknown }) => {
    return saveJson('Export Simulation Lab Report', `lab-report-${Date.now()}.json`, payload.report);
  });

  ipcMain.handle('export:deploymentPackage', async (_event, payload: { deploymentPackage: unknown }) => {
    return saveJson('Export Simulation Adapter Package', `deployment-package-${Date.now()}.json`, payload.deploymentPackage);
  });
}
