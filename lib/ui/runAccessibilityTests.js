const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const page = read('app/page.tsx');
const styles = read('app/globals.css');
const notice = read('components/OperatorNotice.tsx');
const actionComposer = read('components/ActionComposer.tsx');
const manualWizard = read('components/ManualImportWizard.tsx');
const marketplaceManager = read('components/MarketplaceManager.tsx');
const manualActionInstall = read('lib/manual-import/ManualActionInstall.ts');
const dialogBoundary = read('components/AccessibleDialogBoundary.tsx');
const appHeader = read('components/AppHeader.tsx');
const routeError = read('app/error.tsx');
const globalError = read('app/global-error.tsx');
const startupFailure = read('components/startup/StartupFailureView.tsx');
const startupDetails = read('components/startup/StartupDetails.tsx');
const launchShell = read('components/startup/LaunchShell.tsx');
const rootLoading = read('app/loading.tsx');
const stageError = read('components/StageErrorBoundary.tsx');
const semanticStage = read('components/SemanticDeviceStage.tsx');
const realHardwarePanel = read('components/RealHardwarePanel.tsx');
const keyboardNavigation = read('lib/ui/keyboardNavigation.ts');
const labConfigurator = read('components/LabConfigurator.tsx');
const evidenceSidebar = read('components/EvidenceSidebar.tsx');
const autosaveStore = read('lib/project/ProjectAutosaveStore.ts');
const operatorNoticeZIndex = notice.match(/top-12\s+(z-(?:\[\d+\]|\d+))/)?.[1];

assert(notice.includes("role={urgent ? 'alert' : 'status'}"), 'Operator notices must expose alert/status semantics by urgency.');
assert(notice.includes("aria-live={urgent ? 'assertive' : 'polite'}") && notice.includes('aria-atomic="true"'), 'Operator notices must announce complete messages with the correct live-region priority.');
assert(notice.includes('onDismiss') && notice.includes('Dismiss notification'), 'Operator notices must remain explicitly dismissible.');
assert.equal(operatorNoticeZIndex, 'z-40', 'Persistent notices must stay below File menus and modal dialogs so recovery messages cannot block navigation.');
assert(appHeader.includes('data-file-action={item.id}') && appHeader.includes("id: 'import-asset'"), 'File actions must expose stable acceptance hooks without changing menu semantics.');
assert(styles.includes('[data-accessible-dialog-boundary] > .fixed > div') && styles.includes('max-height: calc(100vh - 32px)'), 'Legacy asset import must retain a 16px viewport safety margin.');
assert(page.includes("operatorNotice.persistent || operatorNotice.severity === 'error'"), 'Error notices must remain visible until the operator dismisses or resolves them.');
assert(page.includes("operatorNotice.severity === 'warning' ? 8000 : 5000"), 'Non-error notices must provide readable display time.');
assert(page.includes("kind: 'discard_autosave'") && page.includes('discardProjectAutosave()'), 'Corrupted autosave recovery must be explicit and must not mutate the current workspace.');
const initialAutosaveRestore = page.slice(page.indexOf('if (!marketplaceRuntimeReady || autosaveReady || autosaveQuarantined) return;'), page.indexOf('// Debounced autosave:'));
assert(initialAutosaveRestore.includes('setAutosaveQuarantined(true)') && !initialAutosaveRestore.includes('discardProjectAutosave'), 'Startup must quarantine a corrupt autosave instead of silently deleting it.');
assert(initialAutosaveRestore.includes('marketplaceRuntimeReady'), 'Autosave restore must wait for current Marketplace trust revalidation before restoring digest-bound workspace references.');
assert(page.includes('if (!autosaveReady || autosaveQuarantined) return;') && page.includes('setAutosaveQuarantined(false)'), 'Autosave must wait for restore and pause while corrupt data awaits an explicit operator decision.');
assert(autosaveStore.includes('indexedDB.open') && autosaveStore.includes('legacy-localstorage'), 'Autosave must use durable IndexedDB storage and retain explicit legacy migration.');
assert(page.includes('serializeOpenRealityProjectFile(project)') && page.includes('saveProjectAutosave(serialized.value)'), 'Autosave must persist the complete validated v3 project, including imported assets and Marketplace identity references.');
for (const recovery of ['retry_autosave', 'retry_project_save', 'retry_project_save_as', 'retry_project_open', 'choose_project_file', 'retry_export_adapter', 'retry_export_report', 'retry_export_asset']) {
  assert(notice.includes(`'${recovery}'`) && page.includes(`action === '${recovery}'`), `File recovery action ${recovery} must be declared and handled.`);
}
assert(page.includes("kind: saveAs ? 'retry_project_save_as' : 'retry_project_save'"), 'Save and Save As failures must offer their matching retry operation.');
assert(page.includes('data-project-file-input') && page.includes("workspaceFileInputRef.current.value = ''"), 'Browser project open/recovery must use a real resettable file input so the same corrected file can be selected again.');
assert(page.includes('Project file downloaded.') && page.includes('Selected asset configuration exported.'), 'Browser save/export paths must announce successful completion.');
assert((page.match(/catch \(error\)/g) ?? []).length >= 7, 'Project and export operations must contain explicit failure handling.');

assert(dialogBoundary.includes('role="dialog"') && dialogBoundary.includes('aria-modal="true"'), 'Legacy dialog content must receive dialog semantics.');
assert(dialogBoundary.includes("event.key === 'Escape'") && dialogBoundary.includes("event.key !== 'Tab'"), 'Legacy dialog content must support Escape and keyboard focus containment.');
assert(appHeader.includes('data-file-menu-trigger'), 'The visible File menu control must expose a stable focus-return target.');
assert(appHeader.includes("role=\"group\"") && appHeader.includes("aria-pressed={props.workspaceMode === 'real'}") && appHeader.includes("aria-pressed={props.workspaceMode === 'simulation'}"), 'REAL and Simulation Lab modes must expose one keyboard-operable pressed-state group.');
assert((page.match(/\[data-file-menu-trigger\]/g) ?? []).length === 2, 'Both import dialogs must return focus to the visible File menu control.');
assert(page.includes('onClose={closeManualImport}') && page.includes('onClose={closeAssetImport}'), 'Import dialogs must receive stable close callbacks.');
assert(appHeader.includes('data-marketplace-trigger') && page.includes('onClose={closeMarketplace}') && page.includes("'[data-marketplace-trigger]'") , 'Marketplace dialog must trap focus and restore its visible trigger on every close path.');
assert(marketplaceManager.includes('role="alert"') && marketplaceManager.includes('Marketplace state blocked') && marketplaceManager.includes('Reset to empty state'), 'Marketplace corruption and explicit recovery controls must be announced and visible.');
assert(marketplaceManager.includes("confirmed[`enable:${record.packageId}`]") && marketplaceManager.includes("confirmed[`uninstall:${record.packageId}`]"), 'Marketplace enable and uninstall must retain distinct visible confirmations.');
assert(marketplaceManager.includes("role={workspaceBindings[record.packageId]?.ok === false ? 'alert' : undefined}") && marketplaceManager.includes('Virtual Lab binding is not ready; no fallback is used.'), 'Marketplace binding refusals must be visibly announced and never silently downgraded.');

assert(actionComposer.includes("event.key === 'Escape'") && actionComposer.includes("event.key !== 'Tab'"), 'Action Composer must support Escape and keyboard focus containment.');
assert(appHeader.includes('data-action-composer-trigger'), 'The Action Composer opener must expose a stable focus-return target.');
assert(page.includes("document.querySelector<HTMLElement>('[data-action-composer-trigger]')?.focus()") && page.includes('onClose={closeActionComposer}'), 'The parent surface must restore trigger focus after modal background suppression is removed.');
assert(actionComposer.includes('aria-labelledby="action-composer-title"') && actionComposer.includes('aria-describedby="action-composer-description"'), 'Action Composer must expose a labelled dialog contract.');
assert(actionComposer.includes("role={feedback.ok ? 'status' : 'alert'}"), 'Action Composer feedback must announce success and errors with distinct semantics.');
assert(actionComposer.includes('installReviewedManualActions') && actionComposer.includes('manualInstallConfirmed'), 'Action Composer must require the authoritative manual-action install boundary and a separate confirmation.');
assert(actionComposer.includes('SIMULATION ONLY') && actionComposer.includes('never auto-installs, enables real hardware, or links an adapter'), 'Manual action review must preserve a prominent simulation-only and no-adapter boundary.');
assert(manualActionInstall.includes('validateStoredManualImport') && manualActionInstall.includes('validateActionManifest'), 'Manual action installation must revalidate both provenance and every manifest at the commit point.');
assert(manualActionInstall.includes('existing actions are never overwritten') && manualActionInstall.includes('duplicate selected action ids are rejected'), 'Manual action installation must reject conflicts and duplicate selections rather than overwrite or narrow them.');
assert(manualWizard.includes('Review actions in Action Composer') && manualWizard.includes('parent owns the modal-to-modal transition'), 'Enabled manual assets must expose an explicit, focus-safe path into Action Composer review.');
assert(page.includes('manualActionRecord={selectedManualActionRecord}') && page.includes('setManualImportOpen(false)') && page.includes('setActionComposerOpen(true)'), 'The parent must bind review to the selected enabled manual asset and own the modal transition.');
assert(styles.includes('.modal-surface-active > :not([data-app-modal])') && page.includes('data-app-modal'), 'Every app modal must suppress underlying Three.js overlays and background accessibility targets.');
assert(semanticStage.includes('const worldLabelZIndexRange: [number, number] = [10, 0]') && (semanticStage.match(/zIndexRange=\{worldLabelZIndexRange\}/g) ?? []).length === 8, 'Every Three.js world label, including the REAL mirror, must stay below CommandDock and workspace controls.');
assert(realHardwarePanel.includes("aria-label={zh ? '固件' : 'Firmware'}") && realHardwarePanel.includes('accept="application/json,.json"'), 'Governed firmware controls must expose a named section and a JSON-only write-order picker.');
assert(realHardwarePanel.includes('role="alert"') && realHardwarePanel.includes('checked={firmwareConfirmed}'), 'Firmware refusals must be announced and flashing must retain an explicit checkbox state.');
assert(realHardwarePanel.includes('aria-label={zh ? \'真实硬件任务\' : \'Real-hardware tasks\'}') && realHardwarePanel.includes('handleRovingTabKey(event, index, hardwareTools.length') && realHardwarePanel.includes('aria-controls={`real-hardware-panel-${tool}`}'), 'REAL command, teach, and firmware tasks must form one labelled keyboard-roving tab interface.');

for (const [name, source] of [['route', `${routeError}\n${startupFailure}`], ['global', `${globalError}\n${startupFailure}`], ['stage', stageError]]) {
  assert(source.includes('role="alert"') && source.includes('aria-live="assertive"'), `${name} recovery boundary must announce the contained failure.`);
  assert(source.includes('window.location.reload()'), `${name} recovery boundary must offer a full reload fallback.`);
  assert(!source.includes('Nothing was sent to real hardware') && !source.includes('No signals were sent to real hardware'), `${name} recovery boundary must not infer hardware delivery state from a UI failure.`);
}
assert(startupFailure.includes('does not prove prior hardware delivery state'), 'Route recovery must state hardware delivery uncertainty honestly.');
assert(startupFailure.includes('does not prove prior hardware delivery state'), 'Global recovery must state hardware delivery uncertainty honestly.');
assert(startupFailure.includes('does not prove prior hardware delivery state') && startupFailure.includes('Audit Evidence'), 'Global startup recovery must state hardware uncertainty and direct the operator to audit evidence.');
assert(startupFailure.includes('retryRef.current?.focus()') && startupDetails.includes('navigator.clipboard.writeText'), 'Startup failure must focus recovery and provide copyable, collapsed diagnostics.');
assert(rootLoading.includes('<LaunchShell') && launchShell.includes('role="status"') && launchShell.includes('aria-live="polite"'), 'Next hydration must use the neutral accessible launch shell.');
assert(stageError.includes('does not prove prior hardware delivery state'), '3D recovery must state hardware delivery uncertainty honestly.');
assert(stageError.includes('revision: state.revision + 1'), '3D recovery must remount the failed stage instead of only clearing the error flag.');

for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
  assert(keyboardNavigation.includes(`'${key}'`), `Roving tabs must implement ${key}.`);
}
assert(keyboardNavigation.includes("closest<HTMLElement>('[role=\"tablist\"]')") && keyboardNavigation.includes("querySelectorAll<HTMLElement>('[role=\"tab\"]')"), 'Roving tab navigation must move DOM focus as well as selected state.');
for (const [name, source] of [['device navigator', labConfigurator], ['evidence sidebar', evidenceSidebar], ['manual review', manualWizard]]) {
  assert(source.includes('handleRovingTabKey') && source.includes('tabIndex={'), `${name} tabs must use the shared roving-focus keyboard contract.`);
  assert(source.includes('aria-controls=') && source.includes('aria-labelledby='), `${name} tabs and panels must expose their relationship.`);
}
assert((evidenceSidebar.match(/id="evidence-sidebar-panel-/g) ?? []).length === 2, 'Both evidence panels must remain mounted so every tab relationship resolves.');
assert((manualWizard.match(/id="manual-review-panel-/g) ?? []).length === 3, 'All manual review panels must remain mounted so every tab relationship resolves.');
for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
  assert(appHeader.includes(`event.key === '${key}'`), `File menu must implement ${key}.`);
}
assert(appHeader.includes('aria-haspopup="menu"') && appHeader.includes('role="menu"') && appHeader.includes('role="menuitem"'), 'File actions must expose desktop menu semantics.');
assert(appHeader.includes('closeOnOutsidePointer') && appHeader.includes('triggerRef.current?.focus()'), 'File menu must close outside and restore trigger focus on Escape.');
assert(styles.includes('@media (prefers-contrast: more)') && styles.includes('@media (forced-colors: active)'), 'The workbench must provide increased-contrast and forced-color fallbacks.');
for (const focusTarget of ["[role='menuitem']:focus-visible", 'summary:focus-visible', 'a[href]:focus-visible']) {
  assert(styles.includes(focusTarget), `${focusTarget} must retain a visible keyboard focus indicator.`);
}
assert(styles.includes('[data-real-hardware-boundary]') && evidenceSidebar.includes('data-real-hardware-boundary'), 'REAL HARDWARE must retain a non-color boundary in forced-color mode.');

console.log('Accessibility and recovery tests passed.');
console.log('- Persistent, announced operator errors include explicit corrupted-autosave recovery.');
console.log('- Action Composer traps/restores focus and exposes labelled dialog semantics.');
console.log('- Import dialogs contain keyboard focus and restore the visible File menu control.');
console.log('- Project and JSON export failures remain visible with operation-specific retry actions.');
console.log('- Manual actions require exact-profile conflict review plus a third explicit simulation-only install confirmation.');
console.log('- UI/3D crash boundaries offer retry + reload without inventing hardware-delivery evidence.');
console.log('- Tabs, File menu, focus rings, and high-contrast modes follow one keyboard-access contract.');
