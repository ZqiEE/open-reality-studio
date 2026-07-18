const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeReleaseEvidence } = require('../../scripts/write-release-evidence.cjs');
const { assertSafeLifecycleRoot, validateLifecycleEvidence, writeLifecycleEvidence } = require('../../scripts/verify-windows-install-lifecycle.cjs');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('electron/main.ts');
const pack = read('scripts/pack-electron.cjs');
const lifecycleScript = read('scripts/verify-windows-install-lifecycle.cjs');
const designRunner = read('scripts/run-product-design-acceptance.cjs');
const startupRunner = read('scripts/run-startup-design-acceptance.cjs');
const startupShell = read('electron/startupShell.ts');
const rootLayout = read('app/layout.tsx');
const page = read('app/page.tsx');
const localRuntime = read('lib/runtime/LocalRuntime.ts');
const projectIpc = read('electron/ipc/project.ipc.ts');
const projectContract = read('lib/project/ProjectFileContract.ts');
const projectContractTests = read('tests/project-files/projectFileContract.test.ts');
const autosaveStore = read('lib/project/ProjectAutosaveStore.ts');
const packageJson = JSON.parse(read('package.json'));
const packageVerification = read('scripts/verify-electron-package.cjs');
const authenticode = read('scripts/windows-authenticode.cjs');
const accessibilityTests = read('lib/ui/runAccessibilityTests.js');
const readiness = read('docs/RELEASE_READINESS_V0.5.1.md');
const desktopDocs = read('docs/DESKTOP_APP.md');
const nextConfig = read('next.config.mjs');

assert(nextConfig.includes("allowedDevOrigins: ['127.0.0.1']"), 'Electron development must allow the exact loopback host so HMR and local font resources stay current during product review.');

for (const selector of ['AppHeader', 'RealDeviceWorkspace', 'data-real-hardware-boundary']) {
  assert(main.includes(selector), `Packaged renderer smoke must verify ${selector}.`);
}
assert(main.includes('snapshot.realDeviceWorkspace && snapshot.realModeSelected && snapshot.realDeviceControl') && main.includes('snapshot.runControls === 0 && snapshot.stopControls === 0'), 'Packaged first-run smoke must verify the REAL-first workspace without simulation Run/Stop controls.');
assert(main.includes('snapshot.realHardwarePrimary') && main.includes('captureRealWorkspaceLayout') && main.includes('real_workspace_layouts'), 'Packaged and bilingual design acceptance must prove that REAL HARDWARE owns at least half of the right rail in REAL mode.');
assert(main.includes('snapshot.realDeviceControl') && main.includes('snapshot.simulationToolbarActions === 0') && main.includes('snapshot.simulationFileActions === 0') && main.includes('!snapshot.marketplaceTrigger') && main.includes('real_hardware_focus_failed'), 'Packaged REAL acceptance must reject simulation-only toolbar and File-menu leakage and prove the device-control focus path.');
assert(main.includes('disconnected_real_workspace_mimics_simulation') && main.includes('canvasCount !== 0') && main.includes('disconnectedOnboarding'), 'Packaged REAL acceptance must reject a disconnected 3D canvas or twin stage that visually masquerades as simulation.');
assert(main.includes("setWorkspaceMode(window, 'simulation')") && main.includes("snapshot.runControls === 1 && snapshot.stopControls === 1"), 'Simulation journey smoke must explicitly enter Simulation Lab before requiring its sole Run/Stop pair.');
assert(main.includes("button[data-run-control]") && main.includes("button[data-stop-control]") && main.includes('aria-label'), 'Product-design acceptance must count the sole Run/Stop controls by stable localized semantics, not transient running text.');
assert(main.includes("simulationBoundary") && main.includes("realHardwareBoundary"), 'Packaged first-run smoke must verify distinct simulation and REAL HARDWARE boundaries.');
assert(main.includes("preloadBridge") && main.includes("typeof window.openReality === 'object'"), 'Packaged first-run smoke must verify the preload bridge.');
assert(main.includes("hardwareBridge") && main.includes("typeof window.openReality?.hardware === 'object'") && main.includes('snapshot.realHardwarePanelReady'), 'Packaged first-run smoke must verify that the hardware preload bridge is visible to the hydrated REAL panel.');
assert(
  main.includes('if (isSmokeTest) {')
    && main.includes('process.exitCode = 1;')
    && main.includes('shutdownServer();')
    && main.includes('app.exit(1);'),
  'A failed packaged smoke must exit non-zero without leaving an unattended error dialog.'
);
assert(main.includes("partition: isSmokeTest ? `realitywarden-smoke-${process.pid}`"), 'Packaged first-run smoke must use an isolated ephemeral session.');
assert(main.includes("process.argv.includes('--offline-smoke-test')") && main.includes('enforceOfflineSmokeBoundary'), 'Installed smoke must be able to force and verify offline degradation.');
assert(main.includes("process.argv.includes('--design-smoke-test')") && main.includes('runProductDesignAcceptance'), 'Packaged renderer must expose the reproducible product-design matrix.');
assert(main.includes('snapshot.marketplaceBridge') && main.includes('snapshot.simulationToolbarActions === 5') && main.includes('snapshot.simulationFileActions === 2') && main.includes('snapshot.marketplaceTrigger'), 'Packaged smoke must retain simulation tools only after entering Simulation Lab.');
assert(main.includes("auditDesignDialog(window, 'marketplace'") && main.includes("'[data-marketplace-modal] > section'"), 'Product-design acceptance must verify Marketplace modal bounds, focus containment, Escape close, and focus restoration.');
assert(pack.includes("process.argv.includes('--production-release')") && pack.includes("['--production-release']"), 'Production packaging must propagate an explicit production-release mode to post-build verification and evidence.');
assert(pack.includes('validateLegalReleaseInputs(root)') && pack.includes('--config.nsis.license='), 'Production packaging must revalidate owner legal inputs and pass the exact approved EULA to NSIS.');
assert(packageVerification.includes('writeAuthenticodeEvidence') && packageVerification.includes('production package verification requires'), 'Production package verification must require provisioned distribution and write Authenticode evidence after inspecting artifacts.');
assert(authenticode.includes("parsed.status !== 'Valid'") && authenticode.includes('timestamp is missing') && authenticode.includes('RealityWarden.exe') && authenticode.includes('Setup.exe'), 'Authenticode verification must require Valid timestamped signatures for both EXE and installer.');
assert(main.includes("process.argv.includes('--startup-design-smoke-test')") && main.includes('runStartupDesignAcceptance'), 'Packaged renderer must expose the reproducible startup-design matrix.');
assert(main.includes("backgroundColor: '#090A0C'") && main.includes('mainWindow = createDesktopWindow(false)') && main.includes("once('ready-to-show'"), 'Electron must paint the neutral dark background before showing the launch shell.');
assert(startupShell.includes("--background:#090A0C") && !startupShell.includes('#FFFFFF') && !startupShell.includes('#0066CC'), 'Launch states must not reintroduce white or default-blue startup styling.');
assert(startupShell.includes('Audit Evidence') && startupShell.includes('prefers-reduced-motion:reduce') && startupShell.includes('forced-colors:active'), 'Startup failure must preserve evidence uncertainty, reduced motion, and forced colors.');
assert(rootLayout.includes("backgroundColor: '#090A0C'") && rootLayout.includes('color-scheme'), 'Next root markup must paint the same dark token before hydration.');

const verifyIndex = pack.indexOf('verify-electron-package.cjs');
const smokeIndex = pack.indexOf("['--prod', '--smoke-test']");
const startupIndex = pack.indexOf("['--prod', '--startup-design-smoke-test']");
const designIndex = pack.indexOf("['--prod', '--design-smoke-test']");
const lifecycleIndex = pack.indexOf('verify-windows-install-lifecycle.cjs');
const evidenceIndex = pack.indexOf('write-release-evidence.cjs');
assert(verifyIndex >= 0 && verifyIndex < smokeIndex && smokeIndex < startupIndex && startupIndex < designIndex && designIndex < lifecycleIndex && lifecycleIndex < evidenceIndex, 'Packaging must verify contents, pass renderer/startup/product-design smoke, and installation lifecycle, then write evidence in that order.');
assert(lifecycleScript.includes('Refusing to alter an existing RealityWarden installation'), 'Lifecycle verification must fail closed when a prior installation exists.');
assert(lifecycleScript.includes("['--prod', '--smoke-test', '--offline-smoke-test'"), 'Lifecycle verification must exercise forced-offline installed startup.');
assert(lifecycleScript.includes("['--prod', '--journey-smoke-test'") && main.includes('runInstalledCoreJourney'), 'Lifecycle verification must execute the installed safe/blocked audit journey.');
assert(lifecycleScript.includes("user_data_policy: { reinstall_preserved: true, uninstall_preserved: true }"), 'Lifecycle evidence must state the user-data preservation policy.');
assert(designRunner.includes("'--design-smoke-test'") && designRunner.includes('Design-Acceptance.json'), 'The source design runner must emit a versioned evidence artifact.');
assert(startupRunner.includes("'--startup-design-smoke-test'") && startupRunner.includes('Startup-Acceptance.json'), 'The source startup runner must emit a versioned evidence artifact.');

assert(page.includes("llmChip.state === 'offline'") && page.includes('rule compiler (LLM offline)'), 'The UI must visibly label offline LLM degradation.');
assert(localRuntime.includes("audit.info('compiler', 'llm_compiler_fallback'"), 'Offline compiler degradation must remain audited, never silent.');
assert(projectIpc.includes('parseOpenRealityProjectText') && projectIpc.includes('serializeOpenRealityProjectFile'), 'Desktop project save/open must share the production contract.');
assert(projectContract.includes('real_device_execution_enabled !== false') && projectContract.includes('constructor') && projectContract.includes('MAX_PROJECT_FILE_BYTES'), 'Project validation must retain safety metadata, pollution, and size boundaries.');
assert(projectContractTests.includes('round-trip') && projectContractTests.includes('prototype-polluting'), 'Project contract must have behavioral round-trip and malicious-input regression coverage.');
assert(packageJson.scripts['test:launch-closure'].includes('test:project-files'), 'The full verify chain must execute project-file behavioral tests.');
assert(projectContractTests.includes('embedded model bytes') && projectContractTests.includes('v1 projects must migrate explicitly'), 'Project closure must prove portable asset round-trip and v1 migration behavior.');
assert(autosaveStore.includes('indexedDB.open') && projectContractTests.includes('legacy bytes are removed only after durable save succeeds'), 'Autosave closure must prove durable storage and safe legacy migration ordering.');
assert(accessibilityTests.includes('retry_project_save') && accessibilityTests.includes('retry_project_open') && accessibilityTests.includes('discard_autosave'), 'Launch closure must retain explicit save/open/autosave recovery coverage.');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realitywarden-release-evidence-'));
try {
  const fixtureRelease = path.join(fixtureRoot, 'release');
  const fixtureResources = path.join(fixtureRelease, 'win-unpacked', 'resources', 'app.asar.unpacked', '.next-build');
  fs.mkdirSync(fixtureResources, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  fs.writeFileSync(path.join(fixtureRelease, 'RealityWarden-9.8.7-Setup.exe'), 'installer-fixture');
  fs.writeFileSync(path.join(fixtureRelease, 'win-unpacked', 'RealityWarden.exe'), 'executable-fixture');
  fs.writeFileSync(path.join(fixtureResources, 'BUILD_ID'), 'build-fixture\n');
  const fixtureLifecycle = {
    schema: 'realitywarden.windows-install-lifecycle',
    schema_version: 2,
    product: 'RealityWarden',
    release_version: '9.8.7',
    generated_at: '2026-07-14T00:00:00.000Z',
    platform: { os: 'win32', arch: 'x64' },
    installer: { file: 'RealityWarden-9.8.7-Setup.exe', sha256: crypto.createHash('sha256').update('installer-fixture').digest('hex').toUpperCase() },
    installation: { scope: 'current-user', mode: 'silent-isolated-directory' },
    gates: { clean_install: 'passed', installed_first_run: 'passed', installed_core_journey: 'passed', offline_degradation: 'passed', in_place_reinstall: 'passed', uninstall: 'passed' },
    user_data_policy: { reinstall_preserved: true, uninstall_preserved: true },
    not_claimed: { previous_version_migration: 'not assessed', code_signing: 'not assessed', physical_hardware_acceptance: 'not assessed' }
  };
  writeLifecycleEvidence(fixtureRoot, validateLifecycleEvidence(fixtureLifecycle, '9.8.7', fixtureLifecycle.installer.sha256));
  const fixtureDesign = {
    schema: 'realitywarden.product-design-acceptance',
    schema_version: 1,
    product: 'RealityWarden',
    generated_at: '2026-07-14T00:00:00.000Z',
    gates: { responsive_layout: 'passed', bilingual_content: 'passed', windows_scaling: 'passed', dialog_boundaries: 'passed', keyboard_focus: 'passed', forced_colors: 'passed' },
    real_workspace_layouts: [
      { mode: 'real', viewport: { width: 1440, height: 900 }, language: 'zh', toolbar: { realDeviceControl: true, simulationToolbarActions: 0, simulationFileActions: 0, hardwareFocused: true }, workspaceState: { disconnectedOnboarding: true, realTwinStage: false, canvasCount: 0 }, violations: [] },
      { mode: 'real', viewport: { width: 1440, height: 900 }, language: 'en', toolbar: { realDeviceControl: true, simulationToolbarActions: 0, simulationFileActions: 0, hardwareFocused: true }, workspaceState: { disconnectedOnboarding: true, realTwinStage: false, canvasCount: 0 }, violations: [] },
      { mode: 'real', viewport: { width: 1180, height: 720 }, language: 'zh', toolbar: { realDeviceControl: true, simulationToolbarActions: 0, simulationFileActions: 0, hardwareFocused: true }, workspaceState: { disconnectedOnboarding: true, realTwinStage: false, canvasCount: 0 }, violations: [] },
      { mode: 'real', viewport: { width: 1180, height: 720 }, language: 'en', toolbar: { realDeviceControl: true, simulationToolbarActions: 0, simulationFileActions: 0, hardwareFocused: true }, workspaceState: { disconnectedOnboarding: true, realTwinStage: false, canvasCount: 0 }, violations: [] }
    ],
    layouts: [
      { viewport: { width: 1440, height: 900 }, language: 'zh', toolbar: { realDeviceControl: false, simulationToolbarActions: 5, simulationFileActions: 2 }, violations: [] },
      { viewport: { width: 1440, height: 900 }, language: 'en', toolbar: { realDeviceControl: false, simulationToolbarActions: 5, simulationFileActions: 2 }, violations: [] },
      { viewport: { width: 1180, height: 720 }, language: 'zh', toolbar: { realDeviceControl: false, simulationToolbarActions: 5, simulationFileActions: 2 }, violations: [] },
      { viewport: { width: 1180, height: 720 }, language: 'en', toolbar: { realDeviceControl: false, simulationToolbarActions: 5, simulationFileActions: 2 }, violations: [] }
    ],
    scaling: [{ requestedScale: 1.25 }, { requestedScale: 1.5 }],
    dialogs: ['action-composer', 'asset-import', 'manual-import', 'marketplace'].map((id) => ({ id, status: 'passed', focusRestored: true })),
    contrast: { forcedColors: true, hardwareBorderStyle: 'double' },
    not_claimed: { physical_hardware_acceptance: 'not assessed' }
  };
  const designName = 'RealityWarden-9.8.7-Design-Acceptance.json';
  const designBytes = `${JSON.stringify(fixtureDesign, null, 2)}\n`;
  fs.writeFileSync(path.join(fixtureRelease, designName), designBytes, 'utf8');
  fs.writeFileSync(path.join(fixtureRelease, `${designName}.sha256`), `${crypto.createHash('sha256').update(designBytes).digest('hex').toUpperCase()}  ${designName}\n`, 'utf8');
  const fixtureStartup = {
    schema: 'realitywarden.startup-design-acceptance',
    schema_version: 1,
    product: 'RealityWarden',
    generated_at: '2026-07-14T00:00:00.000Z',
    gates: { no_flash_tokens: 'passed', responsive_layout: 'passed', bilingual_content: 'passed', windows_scaling: 'passed', failure_recovery: 'passed', reduced_motion: 'passed', forced_colors: 'passed' },
    layouts: [
      { viewport: { width: 1440, height: 900 }, language: 'zh', violations: [] },
      { viewport: { width: 1440, height: 900 }, language: 'en', violations: [] },
      { viewport: { width: 1180, height: 720 }, language: 'zh', violations: [] },
      { viewport: { width: 1180, height: 720 }, language: 'en', violations: [] }
    ],
    scaling: [{ requested: 1.25 }, { requested: 1.5 }],
    reduced_motion: { matches: true, animationName: 'none' },
    forced_colors: { matches: true, borderLeftStyle: 'double', focusVisible: true }
  };
  const startupName = 'RealityWarden-9.8.7-Startup-Acceptance.json';
  const startupBytes = `${JSON.stringify(fixtureStartup, null, 2)}\n`;
  fs.writeFileSync(path.join(fixtureRelease, startupName), startupBytes, 'utf8');
  fs.writeFileSync(path.join(fixtureRelease, `${startupName}.sha256`), `${crypto.createHash('sha256').update(startupBytes).digest('hex').toUpperCase()}  ${startupName}\n`, 'utf8');

  const written = writeReleaseEvidence(fixtureRoot, '2026-07-14T00:00:00.000Z');
  const manifest = JSON.parse(fs.readFileSync(written.evidencePath, 'utf8'));
  const expectedInstallerHash = crypto.createHash('sha256').update('installer-fixture').digest('hex').toUpperCase();
  assert.equal(manifest.schema, 'realitywarden.release-evidence');
  assert.equal(manifest.schema_version, 6);
  assert.equal(manifest.release_mode, 'internal_acceptance');
  assert.equal(manifest.release_version, '9.8.7');
  assert.deepEqual(manifest.source, { commit: null, worktree: 'unavailable' }, 'Evidence must state when source revision cannot be established.');
  assert.equal(manifest.artifact.sha256, expectedInstallerHash, 'Release evidence must hash the exact installer bytes.');
  assert.equal(manifest.packaged_app.next_build_id, 'build-fixture');
  assert.deepEqual(manifest.gates.map((gate) => gate.status), ['passed', 'passed', 'passed', 'passed', 'passed', 'not_assessed', 'not_assessed']);
  assert.equal(manifest.code_signing.status, 'not_assessed');
  assert.equal(manifest.install_lifecycle.user_data_policy.uninstall_preserved, true);
  assert.equal(manifest.product_design_acceptance.gates.forced_colors, 'passed');
  assert.equal(manifest.startup_design_acceptance.gates.no_flash_tokens, 'passed');
  assert.match(manifest.not_claimed.physical_hardware_acceptance, /not assessed/, 'Release evidence must not invent physical acceptance.');
  const evidenceBytes = fs.readFileSync(written.evidencePath);
  const expectedManifestHash = crypto.createHash('sha256').update(evidenceBytes).digest('hex').toUpperCase();
  assert(fs.readFileSync(`${written.evidencePath}.sha256`, 'utf8').startsWith(expectedManifestHash), 'Evidence companion hash must match the written manifest bytes.');

  const signingName = 'RealityWarden-9.8.7-Authenticode-Evidence.json';
  const executableHash = crypto.createHash('sha256').update('executable-fixture').digest('hex').toUpperCase();
  const signingEvidence = {
    schema: 'realitywarden.windows-authenticode-evidence', schema_version: 1, product: 'RealityWarden', release_version: '9.8.7', generated_at: '2026-07-14T00:00:00.000Z',
    artifacts: [
      { file: 'win-unpacked/RealityWarden.exe', size_bytes: 18, sha256: executableHash, status: 'Valid', status_message: 'Signature verified.', signer: { subject: 'CN=Fixture Publisher', issuer: 'CN=Fixture CA', thumbprint: 'A'.repeat(40), not_before: '2026-01-01T00:00:00.000Z', not_after: '2027-01-01T00:00:00.000Z' }, timestamp: { subject: 'CN=Fixture TSA', thumbprint: 'B'.repeat(40) } },
      { file: 'RealityWarden-9.8.7-Setup.exe', size_bytes: 17, sha256: expectedInstallerHash, status: 'Valid', status_message: 'Signature verified.', signer: { subject: 'CN=Fixture Publisher', issuer: 'CN=Fixture CA', thumbprint: 'A'.repeat(40), not_before: '2026-01-01T00:00:00.000Z', not_after: '2027-01-01T00:00:00.000Z' }, timestamp: { subject: 'CN=Fixture TSA', thumbprint: 'B'.repeat(40) } }
    ]
  };
  const signingBytes = `${JSON.stringify(signingEvidence, null, 2)}\n`;
  fs.writeFileSync(path.join(fixtureRelease, signingName), signingBytes, 'utf8');
  fs.writeFileSync(path.join(fixtureRelease, `${signingName}.sha256`), `${crypto.createHash('sha256').update(signingBytes).digest('hex').toUpperCase()}  ${signingName}\n`, 'utf8');
  const invalidSigningEvidence = { ...signingEvidence, artifacts: signingEvidence.artifacts.map((artifact, index) => index === 0 ? { ...artifact, status: 'NotSigned' } : artifact) };
  const invalidSigningBytes = `${JSON.stringify(invalidSigningEvidence, null, 2)}\n`;
  fs.writeFileSync(path.join(fixtureRelease, signingName), invalidSigningBytes, 'utf8');
  fs.writeFileSync(path.join(fixtureRelease, `${signingName}.sha256`), `${crypto.createHash('sha256').update(invalidSigningBytes).digest('hex').toUpperCase()}  ${signingName}\n`, 'utf8');
  const legalFixture = () => ({
    manifest_sha256: 'c'.repeat(64), approved_at: '2026-07-14T00:00:00.000Z', approved_by: 'Fixture Owner', approval_reference: 'fixture-review',
    publisher: { legal_name: 'Fixture Robotics Ltd.', jurisdiction: 'England and Wales', support_email: 'support@fixture.invalid', privacy_email: 'privacy@fixture.invalid' },
    sales_jurisdictions: ['GB'], documents: {
      eula: { file: 'PRODUCT_EULA.txt', sha256: 'd'.repeat(64), size_bytes: 300 },
      privacy_notice: { file: 'PRIVACY_NOTICE.txt', sha256: 'e'.repeat(64), size_bytes: 320 }
    }
  });
  assert.throws(() => writeReleaseEvidence(fixtureRoot, '2026-07-14T00:00:00.000Z', { productionRelease: true, validateLegalInputs: legalFixture }), /not Valid/, 'production evidence must refuse a non-Valid artifact even when its evidence checksum matches');
  fs.writeFileSync(path.join(fixtureRelease, signingName), signingBytes, 'utf8');
  fs.writeFileSync(path.join(fixtureRelease, `${signingName}.sha256`), `${crypto.createHash('sha256').update(signingBytes).digest('hex').toUpperCase()}  ${signingName}\n`, 'utf8');
  const productionWritten = writeReleaseEvidence(fixtureRoot, '2026-07-14T00:00:00.000Z', { productionRelease: true, validateLegalInputs: legalFixture });
  const productionManifest = JSON.parse(fs.readFileSync(productionWritten.evidencePath, 'utf8'));
  assert.equal(productionManifest.release_mode, 'production');
  assert.equal(productionManifest.code_signing.status, 'passed');
  assert.equal(productionManifest.code_signing.artifacts.length, 2);
  assert.equal(productionManifest.gates.find((gate) => gate.id === 'windows-authenticode').status, 'passed');
  assert.equal(productionManifest.gates.find((gate) => gate.id === 'owner-legal-release-inputs').status, 'passed');
  assert.equal(productionManifest.legal_release.publisher.legal_name, 'Fixture Robotics Ltd.');
  assert.equal('code_signing' in productionManifest.not_claimed, false, 'production evidence must not simultaneously verify and disclaim code signing');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const safeFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'RealityWarden-install-lifecycle-'));
try {
  assert.equal(assertSafeLifecycleRoot(safeFixtureRoot), path.resolve(safeFixtureRoot));
  assert.throws(() => assertSafeLifecycleRoot(root), /temporary directory/, 'Lifecycle cleanup must reject workspace paths.');
  assert.throws(() => assertSafeLifecycleRoot(os.tmpdir()), /temporary directory|dedicated prefix/, 'Lifecycle cleanup must reject the temp root itself.');
} finally {
  fs.rmSync(safeFixtureRoot, { recursive: true, force: true });
}

for (const document of [readiness, desktopDocs]) {
  assert(document.includes('Release-Evidence.json'), 'Release documentation must describe the machine-readable evidence manifest.');
  assert(document.includes('first-run renderer smoke'), 'Release documentation must describe the packaged renderer smoke scope honestly.');
}

console.log('Launch closure tests passed.');
console.log('- Packaged smoke verifies the real renderer, preload bridge, sole Run/Stop pair, and both execution boundaries.');
console.log('- Failed smoke exits non-zero; evidence is emitted only after package and renderer verification.');
console.log('- Release evidence distinguishes internal acceptance from digest-bound production Authenticode proof.');
console.log('- Windows lifecycle orchestration is fail-closed around existing installs and cleanup path scope.');
console.log('- Product-design acceptance is versioned, checksummed, and ordered before final release evidence.');
console.log('- Startup-design acceptance prevents flash colors and verifies recovery, scaling, motion, and contrast.');
console.log('- Offline degradation, strict project round-trip, malicious-file rejection, and explicit recovery remain covered.');
console.log('- Installed lifecycle requires safe execution, unsafe blocking, one-step audit evidence, and the REAL HARDWARE boundary.');
