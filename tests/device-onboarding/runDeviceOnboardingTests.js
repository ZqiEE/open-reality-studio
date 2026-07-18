const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const compiledRoot = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', '..');

function requireFromCompiled(relativePath) {
  return require(path.join(compiledRoot, relativePath));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(path.resolve(__dirname, '..', '..'), relativePath));
}

assert(fileExists('docs/DEVICE_ONBOARDING.md'), 'docs/DEVICE_ONBOARDING.md must exist.');
assert(fileExists('examples/device-manifest-template.ts'), 'examples/device-manifest-template.ts must exist.');

const { simpleSensorDeviceManifest, simpleSensorWorldModel, simpleSensorOnboardingChecklist } = requireFromCompiled('examples/device-manifest-template.js');
const { compileOpenRealityRuntime } = requireFromCompiled('lib/open-reality-runtime/runtimeKernel.js');
const { createFirmwareConfigurationDraft, validateFirmwareConfigurationDraft } = requireFromCompiled('lib/device-onboarding/FirmwareConfiguration.js');

assert.equal(simpleSensorDeviceManifest.deviceId, 'simple_sensor_01', 'Example manifest should export the fictional simple sensor.');
assert.equal(simpleSensorDeviceManifest.adapter.realAdapterEnabled, false, 'Onboarding example must keep realAdapterEnabled false.');
assert.ok(['simulation_only', 'coming_soon'].includes(simpleSensorDeviceManifest.supportLevel), 'Onboarding example must stay simulation_only or coming_soon.');

const supported = compileOpenRealityRuntime({
  userPrompt: 'read sensor state',
  targetDeviceId: simpleSensorDeviceManifest.deviceId,
  manifest: simpleSensorDeviceManifest,
  worldModel: simpleSensorWorldModel,
  locale: 'en'
});

assert.equal(supported.status, 'compiled', 'Supported low-risk prompt should compile for the onboarding example.');

const unsupported = compileOpenRealityRuntime({
  userPrompt: 'turn on the light',
  targetDeviceId: simpleSensorDeviceManifest.deviceId,
  manifest: simpleSensorDeviceManifest,
  worldModel: simpleSensorWorldModel,
  locale: 'en'
});

assert.equal(unsupported.status, 'unsupported', 'Unsupported capability must not execute for the onboarding example.');
assert.equal(unsupported.taskDsl, undefined, 'Unsupported capability must not produce TaskDSL execution output.');

assert.equal(simpleSensorOnboardingChecklist.simulationAdapter.dryRunOnly, true, 'Onboarding example must keep simulation adapter dry-run only.');

const sourceSha = 'a'.repeat(64);
const reviewedRig = createFirmwareConfigurationDraft({
  source_sha256: sourceSha, reviewed_profile_id: 'manual-reviewed-rig', device_type: 'robot_arm', board: 'esp32_s3', human_review_confirmed: true,
  components: [
    { kind: 'sg90_servo', pwm_pin: 18, min_angle: 0, max_angle: 180 },
    { kind: 'hc_sr04', trigger_pin: 5, echo_pin: 4, min_safe_distance_cm: 20 }
  ]
}, '2026-07-15T00:00:00.000Z');
assert.equal(reviewedRig.ok, true, 'Reviewed SG90 + HC-SR04 configuration should produce a draft.');
assert.equal(reviewedRig.draft.write_authorized, false, 'A firmware draft must never authorize writing.');
assert.equal(reviewedRig.draft.real_adapter_enabled, false, 'A firmware draft must never enable a real adapter.');
assert.equal(reviewedRig.draft.simulation_only, true, 'A firmware draft must remain simulation-only.');
assert.equal(createFirmwareConfigurationDraft({ source_sha256: sourceSha, reviewed_profile_id: 'x', device_type: 'smart_light', board: 'esp32_s3', human_review_confirmed: false, components: [{ kind: 'digital_output', output_pin: 8, active_high: true, safe_default: false }] }).ok, false, 'Firmware configuration requires explicit review.');
assert.equal(createFirmwareConfigurationDraft({ source_sha256: sourceSha, reviewed_profile_id: 'x', device_type: 'smart_light', board: 'esp32_s3', human_review_confirmed: true, components: [{ kind: 'digital_output', output_pin: 0, active_high: true, safe_default: false }] }).ok, false, 'Reserved or unreviewed GPIO must be rejected.');
assert.equal(createFirmwareConfigurationDraft({ source_sha256: sourceSha, reviewed_profile_id: 'x', device_type: 'smart_light', board: 'esp32_s3', human_review_confirmed: true, components: [{ kind: 'sg90_servo', pwm_pin: 18, min_angle: 0, max_angle: 180 }] }).ok, false, 'Cross-device component sets must be rejected.');
assert.equal(createFirmwareConfigurationDraft({ source_sha256: sourceSha, reviewed_profile_id: 'x', device_type: 'robot_arm', board: 'esp32_s3', human_review_confirmed: true, components: [{ kind: 'sg90_servo', pwm_pin: 5, min_angle: 0, max_angle: 180 }, { kind: 'hc_sr04', trigger_pin: 5, echo_pin: 4, min_safe_distance_cm: 20 }] }).ok, false, 'Duplicate pin assignments must be rejected.');
assert.equal(validateFirmwareConfigurationDraft({ ...reviewedRig.draft, write_authorized: true }).ok, false, 'Stored draft tampering cannot authorize writing.');
assert.equal(validateFirmwareConfigurationDraft({ ...reviewedRig.draft, real_adapter_enabled: true }).ok, false, 'Stored draft tampering cannot enable a real adapter.');

// ---------------------------------------------------------------------------
// Write orders, read-only diagnostics evidence, and onboarding closure
// ---------------------------------------------------------------------------
const { createFirmwareWriteOrder, validateFirmwareWriteOrder, PREBUILT_FIRMWARE_IMAGES } = requireFromCompiled('lib/device-onboarding/FirmwareWriteOrder.js');
const { recordOnboardingDiagnostics, completeOnboardingClosure } = requireFromCompiled('lib/device-onboarding/DiagnosticsEvidence.js');
const { approveManualImport, enableManualImportForVirtualLab } = requireFromCompiled('lib/manual-import/ManualProfileImport.js');

const imageSha = 'b'.repeat(64);
const noOrder = createFirmwareWriteOrder({ draft: reviewedRig.draft, operator: 'zq', write_review_confirmed: false, image_sha256: imageSha });
assert.equal(noOrder.ok, false, 'Write orders require a second explicit authorization review.');

const order = createFirmwareWriteOrder({ draft: reviewedRig.draft, operator: 'zq', write_review_confirmed: true, image_sha256: imageSha }, '2026-07-15T00:00:00.000Z');
assert.equal(order.ok, true, 'A reviewed draft plus explicit authorization should produce a write order.');
assert.equal(order.order.execution_authority_granted, false, 'A write order never grants execution authority.');
assert.equal(order.order.real_adapter_enabled, false, 'A write order never enables a real adapter.');
assert.equal(order.order.image.file, PREBUILT_FIRMWARE_IMAGES.esp32_s3_sg90_hc_sr04_v1.file, 'The order must reference the reviewed prebuilt image.');

const lightDraft = createFirmwareConfigurationDraft({
  source_sha256: sourceSha, reviewed_profile_id: 'light', device_type: 'smart_light', board: 'esp32_s3', human_review_confirmed: true,
  components: [{ kind: 'digital_output', output_pin: 8, active_high: true, safe_default: false }]
}, '2026-07-15T00:00:00.000Z');
assert.equal(lightDraft.ok, true, 'smart_light drafts remain accepted at the draft stage.');
const lightOrder = createFirmwareWriteOrder({ draft: lightDraft.draft, operator: 'zq', write_review_confirmed: true, image_sha256: imageSha });
assert.equal(lightOrder.ok, false, 'Templates without a reviewed prebuilt image must refuse write orders.');
assert.match(lightOrder.detail, /no reviewed prebuilt image/, 'The refusal must be explicit, not a substituted image.');

assert.equal(validateFirmwareWriteOrder({ ...order.order, execution_authority_granted: true }).ok, false, 'Order tampering cannot grant execution authority.');
assert.equal(validateFirmwareWriteOrder({ ...order.order, real_adapter_enabled: true }).ok, false, 'Order tampering cannot enable a real adapter.');
assert.equal(validateFirmwareWriteOrder({ ...order.order, image: { ...order.order.image, file: 'firmware/prebuilt/other.bin' } }).ok, false, 'Order tampering cannot swap the authorized image.');
assert.equal(validateFirmwareWriteOrder(order.order, { image_sha256: 'c'.repeat(64) }).ok, false, 'An on-disk digest mismatch must refuse the flash.');
assert.equal(validateFirmwareWriteOrder(order.order, { image_sha256: imageSha }).ok, true, 'A matching on-disk digest passes.');

const { resolveGovernedFirmwareImage, governedFirmwareAvailability } = requireFromCompiled('lib/device-onboarding/GovernedFirmwareImage.js');
const { createFirmwareTargetAuthorization, validateFirmwareTargetAuthorization } = requireFromCompiled('lib/device-onboarding/FirmwareTargetAuthorization.js');
const blankBoardRequest = { source: 'reviewed_prebuilt' };
const blankBoardPorts = [{ path: 'COM7', manufacturer: 'Espressif', serialNumber: 'S3-001', vendorId: '303a', productId: '1001' }];
const blankBoardAuthorization = createFirmwareTargetAuthorization({
  authorizationId: 'first-flash-1',
  requestedPortPath: 'COM7',
  listedPorts: blankBoardPorts,
  request: blankBoardRequest,
  imageSha256: imageSha,
  nowMs: 1000
});
assert.equal(blankBoardAuthorization.ok, true, 'A currently listed blank board can receive a short-lived governed first-flash authorization without a firmware handshake.');
assert.equal(createFirmwareTargetAuthorization({ authorizationId: 'metadata-optional', requestedPortPath: 'COM8', listedPorts: [{ path: 'COM8' }], request: blankBoardRequest, imageSha256: imageSha, nowMs: 1000 }).ok, true, 'A listed port without optional USB metadata remains bindable by its exact enumerated path.');
assert.equal(createFirmwareTargetAuthorization({ authorizationId: 'bad-path', requestedPortPath: 'C:\\arbitrary.bin', listedPorts: blankBoardPorts, request: blankBoardRequest, imageSha256: imageSha, nowMs: 1000 }).ok, false, 'An arbitrary renderer path cannot become a firmware target.');
assert.equal(validateFirmwareTargetAuthorization({ authorization: blankBoardAuthorization.authorization, authorizationId: 'first-flash-1', requestedPortPath: 'COM7', listedPorts: blankBoardPorts, request: blankBoardRequest, imageSha256: imageSha, nowMs: 2000 }).ok, true, 'The exact listed port, request, and image digest pass before expiry.');
assert.equal(validateFirmwareTargetAuthorization({ authorization: blankBoardAuthorization.authorization, authorizationId: 'first-flash-1', requestedPortPath: 'COM7', listedPorts: [{ ...blankBoardPorts[0], serialNumber: 'SWAPPED' }], request: blankBoardRequest, imageSha256: imageSha, nowMs: 2000 }).ok, false, 'A device swap on the same port is rejected before flashing.');
assert.equal(validateFirmwareTargetAuthorization({ authorization: blankBoardAuthorization.authorization, authorizationId: 'first-flash-1', requestedPortPath: 'COM7', listedPorts: blankBoardPorts, request: { source: 'reviewed_prebuilt', order: {} }, imageSha256: imageSha, nowMs: 2000 }).ok, false, 'A firmware request changed after preview is rejected.');
assert.equal(validateFirmwareTargetAuthorization({ authorization: blankBoardAuthorization.authorization, authorizationId: 'first-flash-1', requestedPortPath: 'COM7', listedPorts: blankBoardPorts, request: blankBoardRequest, imageSha256: 'f'.repeat(64), nowMs: 2000 }).ok, false, 'An image digest changed after preview is rejected.');
assert.equal(validateFirmwareTargetAuthorization({ authorization: blankBoardAuthorization.authorization, authorizationId: 'first-flash-1', requestedPortPath: 'COM7', listedPorts: blankBoardPorts, request: blankBoardRequest, imageSha256: imageSha, nowMs: 301000 }).ok, false, 'A firmware preview is rejected at its exact expiry boundary instead of silently refreshed.');
const flashFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realitywarden-governed-flash-'));
try {
  const fixtureImageFile = PREBUILT_FIRMWARE_IMAGES.esp32_s3_sg90_hc_sr04_v1.file;
  const fixtureImagePath = path.join(flashFixtureRoot, fixtureImageFile);
  fs.mkdirSync(path.dirname(fixtureImagePath), { recursive: true });
  const fixtureBytes = Buffer.from('reviewed-test-image');
  const fixtureSha = crypto.createHash('sha256').update(fixtureBytes).digest('hex');
  fs.writeFileSync(fixtureImagePath, fixtureBytes);
  fs.writeFileSync(`${fixtureImagePath}.sha256`, `${fixtureSha}  ${path.basename(fixtureImagePath)}\n`);

  const prebuiltPlan = resolveGovernedFirmwareImage({ source: 'reviewed_prebuilt' }, flashFixtureRoot);
  assert.equal(prebuiltPlan.ok, true, 'A registered image with its matching companion should produce a governed flash plan.');
  assert.equal(prebuiltPlan.plan.sha256, fixtureSha, 'The governed plan reports the digest of the exact returned bytes.');
  assert.equal(resolveGovernedFirmwareImage({ source: 'reviewed_prebuilt', imageFile: 'firmware/prebuilt/arbitrary.bin' }, flashFixtureRoot).ok, false, 'Built-in flash IPC authority must reject a non-registered image path.');

  const fixtureOrder = createFirmwareWriteOrder({ draft: reviewedRig.draft, operator: 'test', write_review_confirmed: true, image_sha256: fixtureSha });
  assert.equal(fixtureOrder.ok, true, 'Governed flash fixture order should validate.');
  assert.equal(resolveGovernedFirmwareImage({ source: 'write_order', order: fixtureOrder.order }, flashFixtureRoot).ok, true, 'Order, companion, and image with the same sha should pass three-way validation.');

  fs.writeFileSync(fixtureImagePath, Buffer.from('tampered-test-image'));
  const tampered = resolveGovernedFirmwareImage({ source: 'write_order', order: fixtureOrder.order }, flashFixtureRoot);
  assert.equal(tampered.ok, false, 'A tampered image must be rejected before flashing.');
  assert.equal(tampered.code, 'image_sha256_mismatch', 'Tampered bytes must fail at the mandatory companion boundary.');
  assert.equal(governedFirmwareAvailability('serial_ttl').available, false, 'serial_ttl must report no reviewed image instead of falling back to compilation.');
} finally {
  fs.rmSync(flashFixtureRoot, { recursive: true, force: true });
}

function diagnosticsReport(overrides = {}) {
  return {
    schema: 'realitywarden.readonly-diagnostics-report', schema_version: 1, port: 'COM3', captured_at: '2026-07-15T00:05:00.000Z',
    commands_used: ['diagnose_hardware', 'read_distance'],
    firmware: { firmware: 'realitywarden-esp32', firmware_version: '0.1.4', protocol_version: 4, sensor_interface: 'pulse_width', reports_device_ms: true, legacy: false },
    samples: [
      { ok: true, distance_cm: 25.1, device_ms: 1000 },
      { ok: true, distance_cm: 25.3, device_ms: 1100 },
      { ok: true, distance_cm: 24.9, device_ms: 1200 }
    ],
    ...overrides
  };
}

const evidence = recordOnboardingDiagnostics({ order: order.order, report: diagnosticsReport() }, '2026-07-15T00:10:00.000Z');
assert.equal(evidence.ok, true, 'A read-only report with device clock and plausible samples produces evidence.');
assert.equal(evidence.evidence.physical_outcome_verified, false, 'Diagnostics evidence never claims a physical outcome.');
assert.equal(evidence.evidence.execution_authority_granted, false, 'Diagnostics evidence never grants execution authority.');

assert.equal(recordOnboardingDiagnostics({ order: order.order, report: diagnosticsReport({ commands_used: ['move_to_angle'] }) }).ok, false, 'A report naming an actuation command is structurally rejected.');
assert.equal(recordOnboardingDiagnostics({ order: order.order, report: diagnosticsReport({ firmware: { firmware: 'someone-else', firmware_version: '9', protocol_version: 4, sensor_interface: 'pulse_width', reports_device_ms: true, legacy: false } }) }).ok, false, 'Foreign firmware cannot back onboarding evidence.');
assert.equal(recordOnboardingDiagnostics({ order: order.order, report: diagnosticsReport({ firmware: { firmware: 'realitywarden-esp32', firmware_version: '0.1.4', protocol_version: 4, sensor_interface: 'pulse_width', reports_device_ms: false, legacy: false } }) }).ok, false, 'Missing device clock (audit 2.2) refuses evidence.');
assert.equal(recordOnboardingDiagnostics({ order: order.order, report: diagnosticsReport({ samples: [{ ok: true, distance_cm: 25, device_ms: 1000 }] }) }).ok, false, 'Too few plausible interlock samples refuse evidence.');
assert.equal(recordOnboardingDiagnostics({ order: { ...order.order, status: 'draft' }, report: diagnosticsReport() }).ok, false, 'A tampered order status refuses evidence.');

// Closure: link evidence to the manual-import record whose simulation asset
// was already enabled through the existing Virtual Lab gate.
const builtins = new Set(['move_red_cube']);
const manualProposal = {
  manufacturer: 'Acme', model: 'SafeArm 1', display_name: 'Acme SafeArm 1', device_type: 'robot_arm',
  capabilities: ['move_to_pose', 'return_home'],
  workspace: { x_min: -1, x_max: 1, y_min: 0, y_max: 1, z_min: -1, z_max: 1 },
  max_speed: 'slow', force_limit: 'low', known_targets: ['home'], forbidden_zones: [],
  actions: []
};
const manualSource = { file_name: 'manual.pdf', media_type: 'application/pdf', sha256: sourceSha, extracted_text: 'authoritative manual text' };
const manualExtraction = { model: 'test-model', elapsed_ms: 1, raw_output: JSON.stringify(manualProposal) };
const approved = approveManualImport({ proposal: manualProposal, source: manualSource, extraction: manualExtraction, builtinIntentIds: builtins, confirmed: true, now: '2026-07-15T00:00:00.000Z' });
assert.equal(approved.ok, true, `manual approval fixture must hold: ${approved.ok ? '' : approved.detail}`);
const templateAsset = {
  manifest: { asset_id: 'template-robot_arm', display_name: 'Trusted semantic template', category: 'template', device_type: 'robot_arm', license: 'MIT', brand: 'generic', source: 'test', visual_model: { type: 'procedural_fallback', path: null }, allowed_use: ['simulation'] },
  deviceMeta: {},
  geometry: {
    table: { width: 2, depth: 2, height: 0.1 }, robot: { base_position: [0, 0, 0], arm_segments: [0.5, 0.5], gripper_size: 0.1 },
    objects: { red_cube: { position: [0, 0, 0], size: 0.1 }, blue_cube: { position: [0, 0, 0], size: 0.1 }, glass_cup: { position: [0, 0, 0], radius: 0.1, height: 0.2 } },
    zones: {}, workspace: { x_min: -2, x_max: 2, y_min: 0, y_max: 2, z_min: -2, z_max: 2 }, camera: { position: [2, 2, 2], target: [0, 0, 0] }
  },
  adapterManifest: { adapter_id: 'simulator-template', adapter_type: 'simulator', interface: 'AdapterInterface', supported_commands: [], transport: 'virtual-device-runtime', real_device_enabled: false },
  scenarios: {
    safe: { id: 'safe', device_profile: 'template', initial_state: {}, prompt: 'safe', expected_task_type: 'safe', unsafe_actions: [], expected_safety_result: 'pass', expected_state_after: {} },
    unsafe: { id: 'unsafe', device_profile: 'template', initial_state: {}, prompt: 'unsafe', expected_task_type: 'unsafe', unsafe_actions: [], expected_safety_result: 'blocked', expected_state_after: {} }
  }
};
const enabled = enableManualImportForVirtualLab({ record: approved.record, templateAsset, builtinIntentIds: builtins, confirmed: true });
assert.equal(enabled.ok, true, `virtual lab enablement fixture must hold: ${enabled.ok ? '' : enabled.detail}`);

const linkedDraft = createFirmwareConfigurationDraft({
  source_sha256: sourceSha, reviewed_profile_id: enabled.record.device_meta.profile_id, device_type: 'robot_arm', board: 'esp32_s3', human_review_confirmed: true,
  components: [
    { kind: 'sg90_servo', pwm_pin: 18, min_angle: 0, max_angle: 180 },
    { kind: 'hc_sr04', trigger_pin: 5, echo_pin: 4, min_safe_distance_cm: 20 }
  ]
}, '2026-07-15T00:00:00.000Z');
assert.equal(linkedDraft.ok, true, 'Draft linked to the enabled manual profile must validate.');
const linkedOrder = createFirmwareWriteOrder({ draft: linkedDraft.draft, operator: 'zq', write_review_confirmed: true, image_sha256: imageSha }, '2026-07-15T00:01:00.000Z');
assert.equal(linkedOrder.ok, true, 'Linked write order must validate.');
const linkedEvidence = recordOnboardingDiagnostics({ order: linkedOrder.order, report: diagnosticsReport() }, '2026-07-15T00:10:00.000Z');
assert.equal(linkedEvidence.ok, true, 'Linked diagnostics evidence must validate.');

const closure = completeOnboardingClosure({ record: enabled.record, evidence: linkedEvidence.evidence, builtinIntentIds: builtins }, '2026-07-15T00:20:00.000Z');
assert.equal(closure.ok, true, `Full loop closure should succeed: ${closure.ok ? '' : closure.detail}`);
assert.equal(closure.closure.status, 'onboarded_simulation_only', 'Closure is a simulation-only fact sheet.');
assert.equal(closure.closure.real_adapter_enabled, false, 'Closure never enables a real adapter.');
assert.equal(closure.closure.execution_authority_granted, false, 'Closure never grants execution authority.');

const notEnabled = completeOnboardingClosure({ record: approved.record, evidence: linkedEvidence.evidence, builtinIntentIds: builtins });
assert.equal(notEnabled.ok, false, 'Closure requires the Virtual Lab gate to have been passed first.');
const wrongProfile = completeOnboardingClosure({ record: enabled.record, evidence: evidence.evidence, builtinIntentIds: builtins });
assert.equal(wrongProfile.ok, false, 'Evidence drafted for a different profile cannot close this record.');

// The flash tool and diagnose CLI must keep the governed contract visible.
const flashSource = fs.readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'flashFirmware.cjs'), 'utf8');
assert(flashSource.includes('realitywarden.firmware-write-order'), 'flashFirmware must recognize governed write orders.');
assert(flashSource.includes('execution_authority_granted !== false'), 'flashFirmware must refuse orders that claim execution authority.');
assert(flashSource.includes('--order and --binary are mutually exclusive'), 'flashFirmware must not allow --binary to override an order.');
const diagnoseSource = fs.readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'hardwareDiagnose.ts'), 'utf8');
assert(diagnoseSource.includes('readonlyDiagnosticsReportSchema'), 'hardwareDiagnose must validate its JSON report against the read-only contract.');

console.log('Device onboarding tests passed.');
console.log('- Fictional simple_sensor manifest loads.');
console.log('- realAdapterEnabled remains false.');
console.log('- Supported read prompt compiles.');
console.log('- Unsupported actuation prompt does not execute.');
console.log('- Reviewed ESP32-S3 firmware drafts stay simulation-only and write-disabled.');
console.log('- Unsafe GPIO, duplicate pins, mismatched components, and authority tampering are rejected.');
console.log('- Write orders require a second review, a reviewed prebuilt image, and matching digests; they grant no execution authority.');
console.log('- Blank-board first flash binds a listed port, governed request, image digest, expiry, and device identity before writing.');
console.log('- Diagnostics evidence accepts only read-only commands, RealityWarden firmware with a device clock, and plausible interlock samples.');
console.log('- Onboarding closure links manual source, reviewed profile, write order, and diagnostics; it stays simulation-only.');
