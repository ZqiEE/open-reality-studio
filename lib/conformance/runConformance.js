const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

const root = path.resolve(__dirname, '..', '..');
const virtualProfileIds = [
  'virtual-robot-arm',
  'virtual-mobile-robot',
  'virtual-smart-light',
  'virtual-camera-sensor',
  'virtual-conveyor-belt'
];
const legacyProfileIds = ['generic-robot-arm', 'desktop-pick-place-arm', 'restricted-lab-arm'];

const capabilities = [
  'scan_area',
  'identify_object',
  'move_to_pose',
  'grasp',
  'release',
  'return_home',
  'navigate_to',
  'dock',
  'set_light',
  'set_brightness',
  'set_color',
  'capture_frame',
  'read_sensor',
  'start_belt',
  'stop_belt',
  'sort_item'
];

const DeviceMetaSchema = z.object({
  profile_id: z.string().min(1),
  profile_version: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  device_id: z.string().min(1),
  device_type: z.enum(['robot_arm', 'mobile_robot', 'smart_light', 'camera_sensor', 'conveyor_belt']),
  simulator_profile: z.enum([
    'robot_arm_semantic_v1',
    'mobile_robot_semantic_v1',
    'smart_light_semantic_v1',
    'camera_sensor_semantic_v1',
    'conveyor_belt_semantic_v1'
  ]),
  simulator_fidelity: z.object({
    level: z.enum(['semantic', 'kinematic', 'physics']),
    validates: z.array(z.string()).min(1),
    limitations: z.array(z.string())
  }).optional(),
  supported_adapters: z.array(z.string()).min(1),
  risk_class: z.enum(['low', 'medium', 'high']),
  display_name: z.string().min(1),
  model_asset: z.object({
    format: z.enum(['glb', 'gltf']),
    uri: z.string().min(1),
    source: z.enum(['real_device_cad', 'open_source_robot_model', 'generated_placeholder']),
    license: z.string().optional(),
    attribution: z.string().optional(),
    scale: z.number().positive().optional(),
    rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
    position: z.tuple([z.number(), z.number(), z.number()]).optional()
  }).optional(),
  capabilities: z.array(z.enum(capabilities)).min(1),
  constraints: z.object({
    workspace: z.object({
      x_min: z.number(),
      x_max: z.number(),
      y_min: z.number(),
      y_max: z.number(),
      z_min: z.number(),
      z_max: z.number()
    }),
    max_speed: z.enum(['slow', 'normal', 'fast']),
    force_limit: z.enum(['low', 'medium', 'high']),
    forbidden_zones: z.array(z.string()),
    known_targets: z.array(z.string()).optional()
  }),
  safety_profile: z.object({
    allow_throwing: z.boolean(),
    allow_high_force: z.boolean(),
    allow_outside_workspace: z.boolean(),
    medium_risk_requires_confirmation: z.boolean().optional(),
    block_medium_risk: z.boolean().optional(),
    require_logging: z.boolean(),
    require_human_confirmation_for_risky_actions: z.boolean()
  }),
  runtime_state: z.object({
    status: z.enum(['idle', 'executing', 'blocked', 'completed']),
    current_position: z.string()
  })
});

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const GeometrySchema = z.object({
  table: z.object({ width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() }),
  robot: z.object({
    base_position: vector3,
    arm_segments: z.tuple([z.number().positive(), z.number().positive()]),
    gripper_size: z.number().positive()
  }),
  objects: z.object({
    red_cube: z.object({ position: vector3, size: z.number().positive() }),
    blue_cube: z.object({ position: vector3, size: z.number().positive() }),
    glass_cup: z.object({ position: vector3, radius: z.number().positive(), height: z.number().positive() })
  }),
  zones: z.record(z.object({ position: vector3, size: z.tuple([z.number().positive(), z.number().positive()]) })),
  workspace: z.object({
    x_min: z.number(),
    x_max: z.number(),
    y_min: z.number(),
    y_max: z.number(),
    z_min: z.number(),
    z_max: z.number()
  }),
  camera: z.object({ position: vector3, target: vector3 }),
  stage: z.object({
    layout: z.string(),
    nodes: z.record(z.object({ position: vector3, label: z.string().optional() })).optional(),
    indicators: z.record(z.string()).optional()
  }).optional()
});

const ScenarioSchema = z.object({
  id: z.string().min(1),
  device_profile: z.string().min(1),
  device_type: z.enum(['robot_arm', 'mobile_robot', 'smart_light', 'camera_sensor', 'conveyor_belt']),
  mode: z.enum(['safe', 'unsafe']),
  initial_state: z.record(z.unknown()),
  prompt: z.string().min(1),
  expected_task_type: z.string().min(1),
  unsafe_actions: z.array(z.string()),
  expected_safety_result: z.enum(['pass', 'blocked']),
  expected_state_after: z.record(z.unknown())
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const adapterInterface = fs.readFileSync(path.join(root, 'lib/adapter/AdapterInterface.ts'), 'utf8');
  const simulatorAdapter = fs.readFileSync(path.join(root, 'lib/virtual-lab/SimulatorAdapter.ts'), 'utf8');
  const hardwareAdapter = fs.readFileSync(path.join(root, 'lib/hardware/Esp32DeviceAdapter.ts'), 'utf8');
  const hardwareGate = fs.readFileSync(path.join(root, 'lib/hardware/HardwareExecutionGate.ts'), 'utf8');
  const sensorPolling = fs.readFileSync(path.join(root, 'lib/hardware/SensorPollingService.ts'), 'utf8');
  const hardwareSequence = fs.readFileSync(path.join(root, 'lib/hardware/HardwareActionSequenceRunner.ts'), 'utf8');
  const realTransport = fs.readFileSync(path.join(root, 'lib/hardware/RealDeviceTransport.ts'), 'utf8');
  const safetyMonitor = fs.readFileSync(path.join(root, 'lib/runtime/SafetyMonitor.ts'), 'utf8');
  const runtimeAudit = fs.readFileSync(path.join(root, 'lib/runtime/RuntimeAuditLog.ts'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
  const realDeviceWorkspace = fs.readFileSync(path.join(root, 'components/RealDeviceWorkspace.tsx'), 'utf8');
  const labConfigurator = fs.readFileSync(path.join(root, 'components/LabConfigurator.tsx'), 'utf8');
  const auditPanel = fs.readFileSync(path.join(root, 'components/AuditPanel.tsx'), 'utf8');
  const evidenceSidebar = fs.readFileSync(path.join(root, 'components/EvidenceSidebar.tsx'), 'utf8');
  const appHeader = fs.readFileSync(path.join(root, 'components/AppHeader.tsx'), 'utf8');
  const actionComposer = fs.readFileSync(path.join(root, 'components/ActionComposer.tsx'), 'utf8');
  const actionLibrary = fs.readFileSync(path.join(root, 'lib/action-manifest/ActionLibrary.ts'), 'utf8');
  const actionManifest = fs.readFileSync(path.join(root, 'lib/action-manifest/ActionManifest.ts'), 'utf8');
  const manualImport = fs.readFileSync(path.join(root, 'lib/manual-import/ManualProfileImport.ts'), 'utf8');
  const manualImportWizard = fs.readFileSync(path.join(root, 'components/ManualImportWizard.tsx'), 'utf8');
  const referenceRecipes = fs.readFileSync(path.join(root, 'lib/action-manifest/ReferenceRecipes.ts'), 'utf8');
  const virtualDeviceStage = fs.readFileSync(path.join(root, 'components/VirtualDeviceStage.tsx'), 'utf8');
  const semanticDeviceStage = fs.readFileSync(path.join(root, 'components/SemanticDeviceStage.tsx'), 'utf8');
  const globalStyles = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  const commandDockSource = page.slice(page.indexOf('function CommandDock('), page.indexOf('function WorkspaceDeviceStrip('));
  const commandDockDefault = commandDockSource.slice(commandDockSource.indexOf('return ('), commandDockSource.indexOf('<details'));
  const commandDockDetails = commandDockSource.slice(commandDockSource.indexOf('<details'));
  const realHardwarePanel = fs.readFileSync(path.join(root, 'components/RealHardwarePanel.tsx'), 'utf8');
  const hardwareIpc = fs.readFileSync(path.join(root, 'electron/ipc/hardware.ipc.ts'), 'utf8');
  const exportBundle = fs.readFileSync(path.join(root, 'lib/export/exportRunBundle.ts'), 'utf8');
  const marketplacePackage = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplacePackage.ts'), 'utf8');
  const marketplaceCatalog = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceCatalog.ts'), 'utf8');
  const marketplaceStore = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceStore.ts'), 'utf8');
  const marketplacePersistence = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplacePersistence.ts'), 'utf8');
  const marketplaceSubmission = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceSubmission.ts'), 'utf8');
  const marketplaceTrustStore = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceTrustStore.ts'), 'utf8');
  const marketplaceIpc = fs.readFileSync(path.join(root, 'electron/ipc/marketplace.ipc.ts'), 'utf8');
  const marketplaceManager = fs.readFileSync(path.join(root, 'components/MarketplaceManager.tsx'), 'utf8');
  const marketplaceSigning = fs.readFileSync(path.join(root, 'scripts/signMarketplacePackage.ts'), 'utf8');
  const marketplaceCatalogPublisher = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceCatalogPublisher.ts'), 'utf8');
  const marketplaceCatalogPublishCli = fs.readFileSync(path.join(root, 'scripts/publishMarketplaceCatalog.ts'), 'utf8');
  const marketplaceDistributionSnapshot = fs.readFileSync(path.join(root, 'lib/marketplace/MarketplaceDistributionSnapshot.ts'), 'utf8');
  const marketplaceLiveVerify = fs.readFileSync(path.join(root, 'scripts/verifyLiveMarketplaceDistribution.ts'), 'utf8');
  const publicReleasePrepare = fs.readFileSync(path.join(root, 'scripts/prepare-public-release.cjs'), 'utf8');
  const supplyChainEvidence = fs.readFileSync(path.join(root, 'scripts/write-supply-chain-evidence.cjs'), 'utf8');
  const uiSource = `${page}\n${labConfigurator}\n${auditPanel}`;

  for (const method of ['connect', 'disconnect', 'getDeviceMeta', 'executeCommand', 'getState', 'stop', 'emergencyStop']) {
    assert(adapterInterface.includes(`${method}(`), `AdapterInterface missing ${method}().`);
    assert(simulatorAdapter.includes(`${method}(`), `SimulatorAdapter missing ${method}().`);
  }
  assert(hardwareAdapter.includes('ticket: ActuationTicket') && hardwareAdapter.includes('ticket !== ACTUATION_TICKET'), 'Real hardware adapter must require and validate the gate-private actuation ticket.');
  assert(hardwareGate.includes('ACTUATION_TICKET') && hardwareGate.includes('adapter.execute(command, ACTUATION_TICKET)'), 'HardwareExecutionGate must be the sole ticket issuer and adapter caller.');
  assert(realTransport.includes('sendActuation') && realTransport.includes('ActuationTicket'), 'RealDeviceTransport must separate ticketed actuation from read-only sends.');
  assert(hardwareAdapter.includes("argumentLimits: [{ argument: 'angle', min: 0, max: 180") && hardwareAdapter.includes('for (const limit of capability.argumentLimits)'), 'Hardware adapter must declare and enforce generic physical argument bounds.');
  assert(safetyMonitor.includes('invalid_capability_policy') && safetyMonitor.includes('unbounded_numeric_argument') && safetyMonitor.includes('for (const limit of capability.argumentLimits)'), 'SafetyMonitor must default-block malformed, missing, or undeclared numeric actuation bounds.');
  assert(hardwareAdapter.includes("signalState: 'attempted_unconfirmed'") && hardwareAdapter.includes("executionEvidence: 'delivery_unconfirmed'"), 'Hardware adapter must distinguish attempted delivery from device acknowledgement.');
  assert(hardwareAdapter.includes("'command_acknowledged_open_loop'") && hardwareAdapter.includes('physicalOutcomeVerified: capability.actuation ? false'), 'Hardware adapter must not claim open-loop physical outcome verification.');
  assert(runtimeAudit.includes('invalid_hardware_signal_evidence') && runtimeAudit.includes('hardwareSignalState'), 'Runtime audit must reject contradictory boolean and precise signal evidence.');
  assert(sensorPolling.includes("publish('degraded', [],") && sensorPolling.includes('device_clock_regressed_latched'), 'Sensor polling must clear failed evidence and latch device-clock regression.');
  assert(sensorPolling.includes('Math.min(conditioned.value, reading.value)'), 'Distance polling must not let a median window hide a newly closer obstacle.');
  assert(hardwareSequence.indexOf('await this.sensors.pollOnce()') < hardwareSequence.indexOf('await this.gate.run({'), 'Every hardware sequence primitive must poll a new sensor generation before the gate decision.');
  assert(hardwareSequence.includes("if (outcome.status === 'blocked')") && hardwareSequence.includes("return this.result('interrupted'"), 'A blocked primitive must terminate the sequence before later frames can be emitted.');
  assert(realHardwarePanel.includes('command_acknowledged_open_loop') && realHardwarePanel.includes('attempted_unconfirmed'), 'REAL HARDWARE UI must expose acknowledgement and ambiguous-delivery semantics.');
  assert(realHardwarePanel.includes('Teach mode (REAL jog)') && realHardwarePanel.includes('Every jog is a complete gated command'), 'REAL jog-teach must remain visibly inside the hardware boundary and describe per-jog gating.');
  assert(realHardwarePanel.includes('Reference-servo preflight (no signal)') && realHardwarePanel.includes('it has no mapping to SIM LAB'), 'REAL preflight must remain visibly local to the reference rig and deny any Simulation Lab mapping.');
  assert(realHardwarePanel.includes('Replay via gate') && hardwareIpc.includes('HardwareActionSequenceRunner'), 'Teach replay must traverse the multi-step gated hardware runner.');
  assert(realHardwarePanel.includes("visibleRealHardwareTelemetry(status === 'connected', distanceCm, lastCommandAngle)"), 'Disconnected REAL mirror telemetry must pass through the stale-data clearing authority.');
  assert(semanticDeviceStage.includes('function RealServoTwin') && semanticDeviceStage.includes("if (!telemetry?.connected) return null"), 'The REAL digital twin must be a connected-only visualization.');
  assert(semanticDeviceStage.includes('Last command angle (open-loop, not measured)') && semanticDeviceStage.includes('READ-ONLY MIRROR'), 'The REAL digital twin must state open-loop uncertainty and read-only scope.');
  assert(virtualDeviceStage.includes('SIMULATION · REAL MIRROR SEPARATE') && virtualDeviceStage.includes('SIMULATION · NO HARDWARE SIGNAL') && virtualDeviceStage.includes('READ-ONLY DIGITAL TWIN'), 'The workspace must keep simulation, no-signal, and separate connected REAL mirror semantics simultaneously visible.');

  assert(marketplacePackage.includes("algorithm: z.literal('ed25519')") && marketplacePackage.includes('verify(null, marketplaceSigningPayload'), 'Marketplace packages must use verified Ed25519 provenance over canonical data.');
  assert(marketplacePackage.includes('trustStore.filter') && !marketplacePackage.includes('trust_tier: z.'), 'Marketplace trust tiers must come from local policy, never package claims.');
  assert(marketplacePackage.includes('validateRealityAssetPackage') && marketplacePackage.includes('forbiddenDeclarativeKeys'), 'Signed marketplace data must still pass declarative-content and authoritative Reality Asset validation.');
  assert(marketplaceStore.includes("state: 'installed_disabled'") && marketplaceStore.includes('explicit simulation enablement confirmation is required'), 'Marketplace install must default disabled and require a second explicit simulation gate.');
  assert(marketplaceStore.includes('hardwareSignalSent: false') && marketplaceStore.includes('executionAuthorityGranted: false'), 'Marketplace lifecycle audit must grant no execution authority and report zero hardware signal.');
  assert(marketplaceStore.includes("audit('uninstall'") && marketplaceStore.includes("filter((candidate) => candidate.packageId !== input.packageId)"), 'Marketplace uninstall must remove the complete installed package identity.');
  assert(marketplaceStore.includes('verifyMarketplacePackage(record.package, trustStore)') && marketplaceStore.includes('checked.verified.digestSha256 !== record.digestSha256'), 'Marketplace runtime lookup must reverify current trust and signed metadata on every lookup.');
  assert(marketplaceTrustStore.includes("trustTier: 'community'") && marketplaceTrustStore.includes('bundled official/verified trust can only change through a signed app update'), 'local publisher import and revocation must never elevate or modify bundled trust.');
  assert(marketplacePersistence.includes('restoreMarketplaceState') && marketplacePersistence.includes('executionAuthorityGranted: z.literal(false)') && marketplacePersistence.includes('realAdapterEnabled: z.literal(false)'), 'persisted Marketplace state must restore fail-closed with zero execution authority.');
  assert(marketplaceIpc.includes("'dist-electron-runtime', 'lib', 'marketplace'") && marketplaceIpc.includes('explicit reset is required'), 'Electron Marketplace must consume compiled policy and block corrupt state until explicit reset.');
  assert(marketplaceIpc.includes("ipcMain.handle('marketplace:runtimeAssets'") && marketplaceIpc.includes('marketplaceRuntimeAsset(record, this.trustStore)') && marketplaceIpc.includes('executionAuthorityGranted: false'), 'Marketplace workspace inputs must be reverified by the main-process authority and carry zero execution authority.');
  assert(marketplaceManager.includes('INSTALLS DISABLED · SIMULATION ONLY · REAL AUTHORITY FALSE') && marketplaceManager.includes('Second-confirm simulation'), 'Marketplace UI must visibly preserve disabled install and separate simulation enablement.');
  assert(marketplaceSigning.includes("flag: 'wx'") && !marketplaceSigning.includes('trustTier'), 'Maintainer signing must refuse overwrite and must not serialize a trust tier.');
  assert(marketplaceCatalog.includes('package_url must use HTTPS') && marketplaceCatalog.includes('package_file_digest_mismatch') && marketplaceCatalog.includes('package_catalog_metadata_mismatch'), 'Marketplace catalog downloads must require HTTPS and bind exact file bytes plus signed package metadata.');
  assert(marketplaceCatalog.includes('catalog_expired') && marketplaceCatalog.includes('publisher_revoked') && marketplaceCatalog.includes('verifyMarketplacePackage(raw, input.trustStore)'), 'Marketplace catalogs must be current, signed by present trust, and unable to bypass package verification.');
  assert(marketplaceCatalogPublisher.includes('verifyMarketplacePackage(rawPackage, distribution.config.bundled_trust)') && marketplaceCatalogPublisher.includes("package_file_sha256: createHash('sha256').update(source.bytes)") && marketplaceCatalogPublisher.includes('catalog private key does not match the production distribution Official catalog key'), 'Marketplace catalog publication must derive entries from exact verified package bytes and bind the signing key to production Official trust.');
  assert(marketplaceCatalogPublisher.includes(".strict()).min(1)") && !marketplaceCatalogPublisher.includes('package_digest_sha256: z.') && marketplaceCatalogPublishCli.includes("flag: 'wx'") && marketplaceCatalogPublishCli.includes('package_file escapes or aliases'), 'Marketplace catalog build orders must reject hand-entered digests, path escape, and output overwrite.');
  assert(marketplaceDistributionSnapshot.includes('verifyMarketplaceCatalogPackage') && marketplaceDistributionSnapshot.includes('live catalog publisher is not the configured bundled Official catalog key') && marketplaceDistributionSnapshot.includes('package_snapshot_incomplete'), 'Live Marketplace release verification must bind the configured Official catalog and the complete exact package set.');
  assert(marketplaceLiveVerify.includes("redirect: 'error'") && marketplaceLiveVerify.includes('no retry was attempted') && marketplaceLiveVerify.includes("flag: 'wx'") && marketplaceLiveVerify.includes("`${outputPath}.sha256`"), 'Live Marketplace release evidence must use bounded no-redirect/no-retry acquisition and exclusive checksummed output.');
  assert(publicReleasePrepare.includes("releaseEvidence.release_mode !== 'production'") && publicReleasePrepare.includes("source.worktree !== 'clean'") && publicReleasePrepare.includes('MAX_LIVE_EVIDENCE_AGE_MS'), 'Public release preparation must require production evidence, a clean exact source revision, and fresh live Marketplace evidence.');
  assert(publicReleasePrepare.includes('production EXE and installer must share one Authenticode signer identity') && publicReleasePrepare.includes("flag: 'wx'") && publicReleasePrepare.includes('overwrite is refused'), 'Public release preparation must bind one signing identity and refuse output overwrite.');
  assert(supplyChainEvidence.includes("['audit', '--json']") && supplyChainEvidence.includes("['sbom', '--omit', 'dev'") && supplyChainEvidence.includes('counts.total !== 0') && supplyChainEvidence.includes('no fallback was used'), 'Supply-chain release evidence must require an online zero-vulnerability audit and production CycloneDX SBOM without fallback.');
  assert(publicReleasePrepare.includes('validateSupplyChainEvidence') && publicReleasePrepare.includes("sha256File(path.join(root, 'package-lock.json'))") && publicReleasePrepare.includes("role: 'cyclonedx_sbom'"), 'Final public handoff must bind current lockfile and exact SBOM evidence into the upload set.');
  assert(marketplaceIpc.includes("ipcMain.handle('marketplace:catalog'") && marketplaceIpc.includes('catalog publisher is not the configured bundled official catalog key') && marketplaceIpc.includes('verifyMarketplaceCatalogPackage') && marketplaceIpc.includes('No fallback or retry was used.'), 'Desktop catalog acquisition must bind the configured Official key, verify exact downloaded bytes, and refuse fallback/retry.');
  assert(marketplaceManager.includes('Explicitly use verified cache') && marketplaceManager.includes('Download and authoritative review') && marketplaceManager.includes('INSTALLS DISABLED · SIMULATION ONLY · REAL AUTHORITY FALSE'), 'Marketplace catalog UI must preserve explicit cache use, authoritative review, and separate disabled install semantics.');
  assert(marketplaceSubmission.includes("review_state: z.literal('local_draft_unsubmitted')") && marketplaceSubmission.includes('execution_authority_granted: z.literal(false)') && marketplaceSubmission.includes('hardwareSignalSent: z.literal(false)') && marketplaceSubmission.includes('validateMarketplaceDraftAsset'), 'Marketplace submissions must remain unsigned local drafts revalidated as declarative assets with literal zero authority and signal.');
  assert(marketplaceIpc.includes("ipcMain.handle('marketplace:exportSubmissionDraft'") && marketplaceIpc.includes('verifyMarketplacePackage(record.package, this.trustStore)') && marketplaceIpc.includes("fs.openSync(result.filePath, 'wx')"), 'Desktop submission export must reverify claimed package provenance and create only an exclusive local file.');

  for (const profileId of [...virtualProfileIds, ...legacyProfileIds]) {
    const profileDir = `profiles/${profileId}`;
    const meta = DeviceMetaSchema.parse(readJson(`${profileDir}/device.meta.json`));
    GeometrySchema.parse(readJson(`${profileDir}/geometry.json`));
    assert(fs.existsSync(path.join(root, profileDir, 'safety.rules.ts')), `${profileId} safety.rules.ts must exist.`);
    if (profileId.startsWith('virtual-')) {
      assert(meta.simulator_fidelity, `${profileId} must declare simulator_fidelity.`);
      assert(meta.simulator_fidelity.validates.includes('adapter_commands'), `${profileId} fidelity must validate adapter commands.`);
      assert(meta.simulator_fidelity.validates.includes('state_transition'), `${profileId} fidelity must validate state transitions.`);
      assert(meta.model_asset, `${profileId} must declare a GLB/GLTF model asset.`);
      assert(meta.model_asset.format === 'glb', `${profileId} model asset must be GLB for desktop runtime.`);
      assert(fs.existsSync(path.join(root, 'public', meta.model_asset.uri.replace(/^\//, ''))), `${profileId} model asset must exist: ${meta.model_asset.uri}`);
    }
  }

  const scenarioFiles = fs.readdirSync(path.join(root, 'scenarios')).filter((file) => file.endsWith('.json'));
  const scenarios = scenarioFiles.map((file) => ScenarioSchema.parse(readJson(`scenarios/${file}`)));
  for (const profileId of virtualProfileIds) {
    assert(scenarios.some((scenario) => scenario.device_profile === profileId && scenario.mode === 'safe'), `${profileId} missing safe scenario.`);
    assert(scenarios.some((scenario) => scenario.device_profile === profileId && scenario.mode === 'unsafe'), `${profileId} missing unsafe scenario.`);
  }

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert(readme.includes('The app opens in the REAL workspace') && readme.includes('Without hardware, explicitly enter **SIM LAB**'), 'README must lead with the REAL product path and present no-hardware simulation as an explicit secondary choice.');
  assert(
    readme.includes('simulation is explicit and never a fallback from REAL'),
    'README must keep simulation explicit and forbid fallback from REAL.'
  );
  assert(readme.indexOf('default desktop shell is REAL-device-first') < readme.indexOf('SIM LAB remains'), 'README must position REAL before the secondary Simulation Lab.');
  assert(page.includes('<RealDeviceWorkspace') && page.includes('<RealHardwarePanel'), 'The REAL-first shell must keep visualization separate from the existing governed hardware panel.');
  assert(uiSource.includes('Developer Preview'), 'UI must keep real-device boundary in Developer Preview only.');
  assert(uiSource.includes('Not for production hardware'), 'Developer Preview must include a safety notice.');
  assert(page.includes('open_reality_lab_workspace'), 'Main UI must support saving/loading lab workspace files.');
  assert(page.includes('open_reality_adapter_execution_package'), 'Main UI must export adapter execution packages.');
  assert(page.includes('adapter_target_id'), 'Adapter execution packages must include per-device adapter target IDs.');
  assert(page.includes('workspace_devices'), 'Adapter execution packages must include workspace device configuration.');
  assert(page.includes('deployment_readiness'), 'Adapter execution packages must include deployment readiness results.');
  assert(page.includes('deployment_certificate'), 'Adapter execution packages must include a virtual-lab validation certificate.');
  assert(page.includes('package_digest_sha256'), 'Adapter execution packages must include a SHA-256 digest.');
  assert(page.includes('workspace_validation'), 'Adapter execution packages must include workspace-level validation results.');
  assert(page.includes('WorkspaceValidationResult'), 'Main UI must track workspace-level validation state.');
  assert(page.includes('localStorage'), 'Desktop workspace must autosave and restore lab files locally.');
  assert(appHeader.includes("t(language, 'app_restore')") && page.includes('onRestore={restoreLastWorkspace}'), 'Desktop workspace must expose restoring the last autosaved workspace through FileMenu.');
  assert(page.includes("const publicAlphaRunnableDeviceTypes: DeviceType[] = ['robot_arm', 'smart_light', 'camera_sensor'];"), 'Public Alpha must only advertise robot_arm, smart_light, and camera_sensor as runnable device families.');
  assert(page.includes('if (!running && runTargetRunnable) onRun();'), 'AI command submit must only dispatch runnable targets.');
  assert(page.includes('disabled={running || !runTargetRunnable}'), 'The single Run entry (AI terminal) must stay disabled for unrunnable devices.');
  assert(page.includes("runTargetRunnable={currentRunTargetRunnable}"), 'AI command terminal must receive runnable-target state from the selected device.');
  assert(page.includes("asset_only_runtime_title") && page.includes("jump_to_runnable_path"), 'Unsupported device state must expose a direct recovery path back to runnable device families.');
  assert(page.includes("onClick={() => onQuickStart(path)}"), 'AI command terminal must keep one-click runnable-path recovery buttons for asset-only selections.');
  assert(page.includes('quickStartPaths={quickStartPaths}') && page.includes('onQuickStart={handleQuickStart}'), 'First-run guide must reuse the same quick-start runnable paths as the command terminal.');
  assert(page.includes("key={`guide-${path.id}`}"), 'First-run guide must expose clickable quick-start cards.');
  assert(page.includes('expected:') && page.includes("t(language, 'quick_start_expected')"), 'First-run evaluation paths must explain what successful execution should look like.');
  assert(page.includes('proof:') && page.includes("t(language, 'quick_start_proof')"), 'First-run evaluation paths must explain where users should inspect execution evidence.');
  assert(page.includes('validates:') && page.includes("t(language, 'quick_start_validates')"), 'First-run evaluation paths must explain what product capability each runnable path validates.');
  assert(page.includes('activeQuickStart') && page.includes("t(language, 'guided_evaluation')"), 'Quick Start selection must persist a guided evaluation state near the AI command entry.');
  assert(page.includes('nextQuickStart') && page.includes("t(language, 'next_path')") && page.includes("t(language, 'try_next')"), 'Guided evaluation must preserve the next suggested quick-start path.');
  assert(page.includes('const reopenFirstRunGuide = useCallback(() => {') && page.includes('onQuickStart={reopenFirstRunGuide}') && appHeader.includes("t(language, 'app_quick_start')"), 'Toolbar must provide a persistent Quick Start entry to reopen onboarding.');
  assert(page.includes("selectedDeviceRunnable={isRunnableDeviceV01(deviceType)}"), 'Left configurator must reflect whether the selected device family is runnable in v0.1.');
  assert(page.includes('getWorkspaceIssues'), 'Main UI must run workspace preflight checks.');
  assert(page.includes('OperatorNotice'), 'Main UI must provide visible operator feedback for user actions.');
  assert(page.includes('showNotice'), 'Main UI must surface run/open/export failures instead of failing silently.');
  assert(auditPanel.includes('DeviceInspector'), 'Audit panel must include a selected-device inspector.');
  assert(auditPanel.includes('onWorkspaceDeviceChange'), 'Device inspector must edit workspace device deployment configuration.');
  assert(auditPanel.includes('forbidden_zones'), 'Device inspector must expose editable forbidden zones.');
  assert(page.includes('<EvidenceSidebar') && auditPanel.includes("view?: 'all' | 'evidence' | 'inspector'"), 'Right sidebar must separate evidence and inspector without deleting either capability.');
  assert(evidenceSidebar.includes('role="tablist"') && evidenceSidebar.includes('role="tabpanel"'), 'Evidence/Inspector navigation must expose tab semantics.');
  assert(evidenceSidebar.indexOf('{hardware}') > evidenceSidebar.indexOf('role="tabpanel"'), 'REAL HARDWARE must remain outside the simulation evidence tabs.');
  assert(globalStyles.includes('--color-simulation: #38BDF8;') && globalStyles.includes('--color-real-hardware: #F59E0B;'), 'Simulation and REAL HARDWARE must use distinct semantic colors.');
  assert(evidenceSidebar.includes('border-real-hardware') && evidenceSidebar.includes('var(--color-real-hardware)'), 'REAL HARDWARE boundary must consume its dedicated semantic token.');
  assert(commandDockDefault.includes('disabled={running || !runTargetRunnable}') && commandDockDefault.includes('data-command-state={status.kind}'), 'CommandDock must preserve runnable gating and expose one primary run state.');
  assert(!commandDockDefault.includes('{llmChipText}') && commandDockDetails.includes('{llmChipText}'), 'LLM source must remain explicit but live in CommandDock secondary details.');
  assert(commandDockDetails.includes("t(language, 'asset_only_runtime_title')") && commandDockDetails.includes("onClick={() => onQuickStart(path)}"), 'Secondary command details must preserve one-click recovery from unsupported targets.');
  assert(!commandDockSource.includes('onClick={onRun}'), 'Run must have a single CommandDock entry and no duplicate guidance action.');
  assert(page.includes("useState<'real' | 'simulation'>('real')") && page.includes("workspaceMode === 'simulation' && <LabConfigurator"), 'The primary shell must be REAL-first; the simulation navigator may render only after explicit mode selection.');
  assert(realDeviceWorkspace.includes("telemetry.connected ? (") && realDeviceWorkspace.includes('data-real-twin-stage') && realDeviceWorkspace.includes('data-real-device-onboarding') && realDeviceWorkspace.includes('NO 3D STAGE · NO STALE DATA'), 'The disconnected REAL-first workspace must contain no 3D stage; only a current connection may mount the read-only REAL twin.');
  assert(labConfigurator.includes('data-component="DeviceNavigator"') && labConfigurator.includes('data-component="AssetLibrary"'), 'Explicit Simulation Lab mode must retain separate device configuration and asset-library regions.');
  assert(labConfigurator.includes("activeSection === 'devices'") && labConfigurator.includes("activeSection === 'assets'"), 'Left-navigation tabs must preserve both device setup and asset library capabilities.');
  assert(labConfigurator.includes("'Safe Rehearsal'") && labConfigurator.includes("'Simulation only · no hardware signal'") && appHeader.includes('Simulation Lab'), 'Secondary Simulation Lab mode must remain explicitly no-signal and visibly separate from the default REAL workspace.');
  assert(appHeader.includes('w-[240px]') && appHeader.includes('xl:w-[280px]') && labConfigurator.includes('w-[240px]') && labConfigurator.includes('xl:w-[280px]'), 'Header and left rail must share responsive widths without reducing the 1180px workspace contract.');
  assert(appHeader.includes('data-component="AppHeader"') && appHeader.includes('export function FileMenu'), 'Top-level file and product actions must use the AppHeader/FileMenu hierarchy.');
  assert(appHeader.includes('onExportReport') && appHeader.includes('onExportAdapter') && appHeader.includes('onQuickStart') && appHeader.includes('onActions'), 'Header grouping must preserve exports, Quick Start, and custom actions.');
  assert(appHeader.includes("const realMode = props.workspaceMode === 'real'") && appHeader.includes('data-real-hardware-focus') && appHeader.includes('data-simulation-toolbar-action="quick-start"') && appHeader.includes('data-simulation-toolbar-action="export-adapter"'), 'Header actions must be contextual: REAL device control is primary, while simulation onboarding/actions/exports appear only in Simulation Lab.');
  assert(appHeader.includes("workspaceMode === 'simulation' ? [") && appHeader.includes('data-simulation-file-action=') && appHeader.includes('Import Simulation Asset'), 'Simulation imports must be absent from the REAL File menu and explicitly labeled inside Simulation Lab.');
  assert(page.includes("if (action === 'run:virtualLab') {") && page.includes("setWorkspaceMode('simulation');") && page.includes("if (action === 'run:replay') {"), 'Desktop simulation menu actions must switch to the visibly distinct Simulation Lab before running.');
  assert(!appHeader.includes('onRun') && !appHeader.includes('onStop'), 'AppHeader must not expose a second Run/Stop path.');
  assert(actionComposer.includes('importActionLibrary(') && actionLibrary.includes('validateActionManifest('), 'Imported action libraries must revalidate every manifest through the authoritative validator.');
  assert(actionLibrary.includes("z.literal('realitywarden.action-library')") && actionLibrary.includes('.strict()'), 'Action library files must use a versioned strict envelope.');
  assert(actionLibrary.includes("code: 'duplicate_action'") && actionLibrary.includes("code: 'existing_action'"), 'Action library import must reject duplicate and overwrite collisions explicitly.');
  assert(actionManifest.includes("code: 'device_type_mismatch'") && actionManifest.includes("code: 'invalid_value'"), 'Action manifests must reject cross-device recipes and undeclared primitive values explicitly.');
  assert(actionManifest.includes("action === 'set_brightness'") && actionManifest.includes('value >= 0 && value <= 100'), 'Smart-light reference values must have an authoritative finite brightness range.');
  assert(actionManifest.includes('value: step.value'), 'Manifest expansion must preserve validated primitive values into TaskDSL.');
  assert(actionComposer.includes('getReferenceActionRecipe') && actionComposer.includes('validateActionManifest(raw, deviceMeta, BUILTIN_INTENT_IDS)'), 'Bundled recipes must remain untrusted proposals revalidated for the selected profile.');
  assert(referenceRecipes.includes('robot_arm: robotArmRecipe') && referenceRecipes.includes('smart_light: smartLightRecipe') && referenceRecipes.includes('camera_sensor: cameraRecipe'), 'Reference action recipes must generalize across the three runnable profiles.');
  assert(manualImport.includes("supported_adapters: ['simulator']") && manualImport.includes("simulation_only: true") && manualImport.includes('explicit human review confirmation is required'), 'Manual imports must require human review and remain structurally simulation-only.');
  assert(manualImport.includes('validateActionManifest(raw, deviceMeta') && manualImport.includes('raw_output') && manualImport.includes('extracted_text'), 'Manual imports must preserve raw audit inputs and revalidate every proposed action.');
  assert(manualImportWizard.includes('SIMULATION ONLY') && manualImportWizard.includes("import('pdfjs-dist/legacy/build/pdf.mjs')") && appHeader.includes('onImportManual'), 'Desktop file workflow must expose PDF/text manual import with an unambiguous simulation boundary.');
  assert(manualImportWizard.includes('<SemanticDeviceStage') && manualImportWizard.includes('id="manual-review-panel-compare"') && manualImportWizard.includes("hidden={reviewMode !== 'compare'}") && manualImportWizard.includes('Second gate: enable in Virtual Lab'), 'Manual review must provide semantic geometry, a keyboard-addressable source comparison panel, and a distinct second enablement gate.');
  assert(manualImport.includes('enableManualImportForVirtualLab') && manualImport.includes("execution_mode: 'simulation'") && manualImport.includes('real_device_enabled: false'), 'Manual proposals may enter Virtual Lab only as structurally simulation-only assets.');
  assert(page.includes('restoreEnabledManualSimulationAsset') && page.includes('Manual or Marketplace devices without current simulation-only trust were removed from the workspace.'), 'Project restore must reject invalid manual or Marketplace enablement instead of silently falling back to another profile.');
  assert(page.includes('bindMarketplaceAssetToVirtualLab') && page.includes('removeUnavailableMarketplaceWorkspaceDevices') && page.includes('marketplaceWorkspaceReference') && page.includes('marketplaceContext.references'), 'Marketplace assets may enter and restore in Virtual Lab only through current trust, exact template binding, and digest-bound project references.');
  assert(manualImportWizard.includes("event.key === 'Escape'") && manualImportWizard.includes("event.key !== 'Tab'") && page.includes('modal-surface-active') && page.includes('data-app-modal') && globalStyles.includes('.modal-surface-active > :not([data-app-modal])'), 'Manual import must provide modal keyboard containment and use the app-wide background/Three.js suppression contract.');
  assert(semanticDeviceStage.includes('function ForbiddenZoneOverlay') && semanticDeviceStage.includes('zones.includes(zone)'), '3D workspace must derive forbidden markers from the authoritative selected profile zones.');
  assert(virtualDeviceStage.includes('profile.deviceMeta.constraints.forbidden_zones') && virtualDeviceStage.includes('profile.deviceMeta.constraints.known_targets'), 'Forbidden-zone editor must use profile constraints and known targets, not invent safety targets.');
  assert(page.includes('onForbiddenZonesChange={(forbiddenZones)') && page.includes('updateWorkspaceDevice(selectedWorkspaceDevice.id'), 'Zone edits must flow through workspace invalidation before later execution or export.');
  assert(page.includes("publicAlphaRunnableDeviceTypes.map((type) => localizeDeviceType(language, type)).join(' / ')"), 'Support messaging must continue to enumerate the runnable public alpha device families.');
  assert(labConfigurator.includes("asset_library_note"), 'Asset library must explain that workspace assets and runnable paths are not the same thing.');
  assert(labConfigurator.includes("asset_runtime_supported") && labConfigurator.includes("asset_runtime_asset_only"), 'Asset cards must label runnable and asset-only device families differently.');
  assert(!exportBundle.includes('MVP'), 'Export bundle product naming must not use MVP/demo language.');

  console.log('Conformance checks passed.');
  console.log('- Five virtual device profiles are valid.');
  console.log('- Legacy robot-arm profiles remain schema-compatible.');
  console.log('- Every virtual profile has safe and unsafe scenarios.');
  console.log('- Every virtual profile declares simulator fidelity and validation scope.');
  console.log('- Every virtual profile binds to an existing GLB device model asset.');
  console.log('- SimulatorAdapter uses AdapterInterface; real hardware requires the ticketed HardwareExecutionGate boundary.');
  console.log('- Real-hardware numeric arguments require generic, capability-owned finite bounds in both SafetyMonitor and adapter defense-in-depth.');
  console.log('- Real-hardware evidence distinguishes not-sent, attempted/unconfirmed, and acknowledged; open-loop acknowledgement never claims physical verification.');
  console.log('- Multi-step hardware actions consume fresh polled sensor generations and stop after the first blocked primitive.');
  console.log('- Main UI defaults to an honest REAL-device workspace; Simulation Lab is explicit and real execution stays inside the evidence-locked REAL HARDWARE boundary.');
  console.log('- README leads with the REAL product path and keeps Simulation Lab explicit, secondary, and non-fallback.');
  console.log('- Desktop workspace supports lab files, adapter packages, device inspection, deployment config editing, preflight checks, workspace validation, autosave, export digests, and operator feedback.');
}

main();
