const assert = require('node:assert/strict');
const fs = require('node:fs');
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

console.log('Device onboarding tests passed.');
console.log('- Fictional simple_sensor manifest loads.');
console.log('- realAdapterEnabled remains false.');
console.log('- Supported read prompt compiles.');
console.log('- Unsupported actuation prompt does not execute.');
