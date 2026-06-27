const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const compiledRoot = process.argv[2];

if (!compiledRoot) {
  throw new Error('Missing compiled output directory argument for adapter-sdk tests.');
}

const adapterSdk = require(path.resolve(compiledRoot, 'lib/adapter-sdk/index.js'));
const runtimeKernel = require(path.resolve(compiledRoot, 'lib/open-reality-runtime/runtimeKernel.js'));
const manifests = require(path.resolve(compiledRoot, 'lib/open-reality-runtime/deviceManifests.js'));
const worldModel = require(path.resolve(compiledRoot, 'lib/open-reality-runtime/worldModel.js'));

function loadProfile(profileDirectory, id, label) {
  const root = path.resolve(__dirname, '..', '..');
  const base = path.join(root, 'profiles', profileDirectory);
  return {
    id,
    label,
    deviceMeta: JSON.parse(fs.readFileSync(path.join(base, 'device.meta.json'), 'utf8')),
    geometry: JSON.parse(fs.readFileSync(path.join(base, 'geometry.json'), 'utf8'))
  };
}

const robotProfile = loadProfile('virtual-robot-arm', 'virtual-robot-arm', 'Virtual Robot Arm');
const smartLightProfile = loadProfile('virtual-smart-light', 'virtual-smart-light', 'Virtual Smart Light');
const cameraProfile = loadProfile('virtual-camera-sensor', 'virtual-camera-sensor', 'Virtual Camera Sensor');

const robotManifest = manifests.buildManifestFromProfile(robotProfile);
const lightManifest = manifests.buildManifestFromProfile(smartLightProfile);
const cameraManifest = manifests.buildManifestFromProfile(cameraProfile);

const robotTask = runtimeKernel.compileOpenRealityRuntime({
  userPrompt: 'put the red cube in the back area',
  targetDeviceId: robotProfile.deviceMeta.device_id,
  manifest: robotManifest,
  worldModel: worldModel.buildWorldModelFromProfile(robotProfile, { targetDeviceId: robotProfile.deviceMeta.device_id, selected: true })
});
assert.equal(robotTask.status, 'compiled', 'robot_arm runtime task should compile.');
const robotAdapter = adapterSdk.getSimulationAdapterForManifest(robotManifest);
assert(robotAdapter, 'robot_arm must expose a simulation adapter boundary.');
const robotPlan = robotAdapter.compileTaskDslToAdapterPlan(robotTask.taskDsl);
assert.equal(robotPlan.mode, 'simulation', 'robot_arm adapter plan must stay simulation mode.');
assert.equal(robotPlan.dryRunOnly, true, 'robot_arm adapter plan must remain dryRunOnly.');
assert.equal(robotAdapter.validateAdapterPlan(robotPlan).ok, true, 'robot_arm adapter plan must validate.');

const lightTask = runtimeKernel.compileOpenRealityRuntime({
  userPrompt: 'set the light to blue',
  targetDeviceId: smartLightProfile.deviceMeta.device_id,
  manifest: lightManifest,
  worldModel: worldModel.buildWorldModelFromProfile(smartLightProfile, { targetDeviceId: smartLightProfile.deviceMeta.device_id, selected: true })
});
assert.equal(lightTask.status, 'compiled', 'smart_light runtime task should compile.');
const lightAdapter = adapterSdk.getSimulationAdapterForManifest(lightManifest);
assert(lightAdapter, 'smart_light must expose a simulation adapter boundary.');
const lightPlan = lightAdapter.compileTaskDslToAdapterPlan(lightTask.taskDsl);
assert.equal(lightPlan.mode, 'simulation', 'smart_light adapter plan must stay simulation mode.');
assert.equal(lightPlan.dryRunOnly, true, 'smart_light adapter plan must remain dryRunOnly.');
assert(lightPlan.steps.some((step) => step.action === 'set_color'), 'smart_light adapter plan must preserve set_color actions.');

const cameraTask = runtimeKernel.compileOpenRealityRuntime({
  userPrompt: 'take a photo',
  targetDeviceId: cameraProfile.deviceMeta.device_id,
  manifest: cameraManifest,
  worldModel: worldModel.buildWorldModelFromProfile(cameraProfile, { targetDeviceId: cameraProfile.deviceMeta.device_id, selected: true })
});
assert.equal(cameraTask.status, 'compiled', 'camera_sensor runtime task should compile.');
const cameraAdapter = adapterSdk.getSimulationAdapterForManifest(cameraManifest);
assert(cameraAdapter, 'camera_sensor must expose a read-only simulation adapter boundary.');
const cameraPlan = cameraAdapter.compileTaskDslToAdapterPlan(cameraTask.taskDsl);
assert.equal(cameraPlan.mode, 'read_only', 'camera_sensor adapter plan must stay read_only.');
assert.equal(cameraPlan.dryRunOnly, true, 'camera_sensor adapter plan must remain dryRunOnly.');

const badPlanSource = {
  ...lightTask.taskDsl,
  steps: lightTask.taskDsl.steps.map((step, index) => index === 0 ? { ...step, capabilityId: 'robot.pick' } : step)
};
assert.throws(() => lightAdapter.compileTaskDslToAdapterPlan(badPlanSource), /Unsupported capability/, 'Unsupported capabilities must not compile into an adapter plan.');

const mobileManifest = manifests.getOpenRealityDeviceManifest('mobile_robot');
const conveyorManifest = manifests.getOpenRealityDeviceManifest('conveyor_belt');
assert.equal(adapterSdk.getSimulationAdapterForManifest(mobileManifest), null, 'Coming Soon devices must not expose a simulation adapter.');
assert.equal(adapterSdk.getSimulationAdapterForManifest(conveyorManifest), null, 'Non-runnable devices must stay outside the adapter runtime path.');

assert.equal(robotManifest.adapter.realAdapterEnabled, false, 'real adapter must stay disabled for robot_arm.');
assert.equal(lightManifest.adapter.realAdapterEnabled, false, 'real adapter must stay disabled for smart_light.');
assert.equal(cameraManifest.adapter.realAdapterEnabled, false, 'real adapter must stay disabled for camera_sensor.');
assert.equal(adapterSdk.REAL_ADAPTER_BOUNDARY.realDeviceExecution, false, 'real device execution boundary must remain false.');
assert.equal(adapterSdk.REAL_ADAPTER_BOUNDARY.allRealAdaptersDisabled, true, 'all real adapters must remain disabled.');

assert.deepEqual(robotAdapter.dryRun(robotPlan), {
  ok: true,
  mode: 'simulation',
  simulatedStepCount: robotPlan.steps.length,
  dryRunOnly: true
}, 'dryRun must simulate the plan without becoming a device command.');

console.log('Adapter SDK tests passed.');
console.log('- TaskDSL can enter simulation adapters for robot_arm, smart_light, and camera_sensor.');
console.log('- Real adapters remain disabled.');
console.log('- Coming Soon devices do not expose runnable adapters.');
console.log('- AdapterPlan stays dryRunOnly and is not a real device command.');
console.log('- Unsupported capabilities cannot generate adapter plans.');
