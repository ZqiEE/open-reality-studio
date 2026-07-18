import { contextBridge, ipcRenderer } from 'electron';

type MenuAction =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:saveAs'
  | 'export:labReport'
  | 'export:deploymentPackage'
  | 'run:preflight'
  | 'run:virtualLab'
  | 'run:stop'
  | 'run:replay'
  | 'view:toggleExplorer'
  | 'view:toggleInspector'
  | 'view:toggleConsole';

const api = {
  project: {
    new: () => ipcRenderer.invoke('project:new'),
    open: () => ipcRenderer.invoke('project:open'),
    save: (project: unknown, filePath?: string | null) => ipcRenderer.invoke('project:save', { project, filePath }),
    saveAs: (project: unknown) => ipcRenderer.invoke('project:saveAs', { project })
  },
  export: {
    labReport: (report: unknown) => ipcRenderer.invoke('export:labReport', { report }),
    deploymentPackage: (deploymentPackage: unknown) => ipcRenderer.invoke('export:deploymentPackage', { deploymentPackage })
  },
  file: {
    reveal: (filePath: string) => ipcRenderer.invoke('file:reveal', { filePath })
  },
  support: {
    openGuide: () => ipcRenderer.invoke('support:openGuide'),
    exportDiagnostics: () => ipcRenderer.invoke('support:exportDiagnostics'),
    showAbout: () => ipcRenderer.invoke('support:showAbout')
  },
  hardware: {
    listPorts: () => ipcRenderer.invoke('hardware:listPorts'),
    connect: (portPath: string) => ipcRenderer.invoke('hardware:connect', { portPath }),
    readDistance: () => ipcRenderer.invoke('hardware:readDistance'),
    disconnect: () => ipcRenderer.invoke('hardware:disconnect'),
    probe: (portPath: string) => ipcRenderer.invoke('hardware:probe', { portPath }),
    autoDetect: () => ipcRenderer.invoke('hardware:autoDetect'),
    executionStatus: () => ipcRenderer.invoke('hardware:executionStatus'),
    firmwarePlan: (portPath: string, request: unknown) => ipcRenderer.invoke('hardware:firmwarePlan', { portPath, request }),
    flashFirmware: (portPath: string, request: unknown, expectedSha256: string, authorizationId: string, confirm: boolean) =>
      ipcRenderer.invoke('hardware:flashFirmware', { portPath, request, expectedSha256, authorizationId, confirm }),
    execute: (portPath: string, angle: number, confirm: boolean) => ipcRenderer.invoke('hardware:execute', { portPath, angle, confirm }),
    executeManifest: (portPath: string, manifest: unknown, confirm: boolean) => ipcRenderer.invoke('hardware:execute', { portPath, manifest, confirm })
  },
  marketplace: {
    state: () => ipcRenderer.invoke('marketplace:state'),
    catalog: (useCache: boolean) => ipcRenderer.invoke('marketplace:catalog', { useCache }),
    reviewCatalogPackage: (packageId: string, packageVersion: string, catalogDigestSha256: string) =>
      ipcRenderer.invoke('marketplace:reviewCatalogPackage', { packageId, packageVersion, catalogDigestSha256 }),
    runtimeAssets: () => ipcRenderer.invoke('marketplace:runtimeAssets'),
    browsePackage: () => ipcRenderer.invoke('marketplace:browsePackage'),
    browseSubmissionAsset: () => ipcRenderer.invoke('marketplace:browseSubmissionAsset'),
    exportSubmissionDraft: (rawAsset: unknown, sourcePackageId: string | null, changeSummary: string, confirmed: boolean) =>
      ipcRenderer.invoke('marketplace:exportSubmissionDraft', { rawAsset, sourcePackageId, changeSummary, confirmed }),
    install: (rawPackage: unknown, confirmed: boolean) => ipcRenderer.invoke('marketplace:install', { rawPackage, confirmed }),
    enableSimulation: (packageId: string, confirmed: boolean) => ipcRenderer.invoke('marketplace:enableSimulation', { packageId, confirmed }),
    uninstall: (packageId: string, confirmed: boolean) => ipcRenderer.invoke('marketplace:uninstall', { packageId, confirmed }),
    browsePublisher: () => ipcRenderer.invoke('marketplace:browsePublisher'),
    trustPublisher: (rawPublisher: unknown, confirmed: boolean) => ipcRenderer.invoke('marketplace:trustPublisher', { rawPublisher, confirmed }),
    revokePublisher: (keyId: string, confirmed: boolean) => ipcRenderer.invoke('marketplace:revokePublisher', { keyId, confirmed }),
    resetState: (confirmed: boolean) => ipcRenderer.invoke('marketplace:resetState', { confirmed })
  },
  onMenuAction: (callback: (action: MenuAction) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: MenuAction) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  }
};

contextBridge.exposeInMainWorld('openReality', api);
