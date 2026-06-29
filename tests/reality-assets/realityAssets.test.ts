import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  getBuiltinRealityAssets,
  getRealityAssetByDeviceType,
  listRealityAssetsBySupportLevel,
  toRuntimeDeviceManifest,
  validateAllBuiltinAssets,
  validateRealityAssetPackage
} from '../../lib/reality-assets';
import type { RealityAssetPackage } from '../../lib/reality-assets';

const assets = getBuiltinRealityAssets();
const byType = (deviceType: string) => {
  const asset = getRealityAssetByDeviceType(deviceType as never);
  assert(asset, `${deviceType} asset must exist.`);
  return asset;
};

assert.equal(assets.length, 10, 'Registry must expose the ten v0.2 Sprint 1 built-in Reality Assets.');

for (const deviceType of [
  'robot_arm',
  'smart_light',
  'camera_sensor',
  'mobile_robot',
  'conveyor_belt',
  'plc_cabinet',
  'lab_instrument',
  'drone_unit',
  'warehouse_rack',
  'sensor_box'
] as const) {
  const asset = byType(deviceType);
  const result = validateRealityAssetPackage(asset);
  assert.equal(result.valid, true, `${deviceType} must validate: ${result.errors.join(', ')}`);
  assert(asset.deviceManifest, `${deviceType} must include DeviceManifest.`);
  assert(asset.capabilityContracts.length > 0, `${deviceType} must include CapabilityContract entries.`);
  assert(asset.adapterBoundary, `${deviceType} must include adapterBoundary.`);
  assert(Object.values(asset.examplePrompts).some((prompts) => prompts.length > 0), `${deviceType} must include example prompts.`);
  assert.equal(asset.adapterBoundary.realAdapterEnabled, false, `${deviceType} realAdapterEnabled must be false.`);
  assert.equal(asset.deviceManifest.adapter.realAdapterEnabled, false, `${deviceType} manifest realAdapterEnabled must be false.`);
  assert.equal(toRuntimeDeviceManifest(asset).deviceId, asset.deviceManifest.deviceId, `${deviceType} bridge must return the runtime manifest.`);
}

assert.equal(byType('robot_arm').supportLevel, 'simulation_only', 'robot_arm must be simulation_only.');
assert.equal(byType('smart_light').supportLevel, 'simulation_only', 'smart_light must be simulation_only.');
assert.equal(byType('camera_sensor').supportLevel, 'read_only', 'camera_sensor must be read_only.');

for (const deviceType of ['mobile_robot', 'conveyor_belt', 'plc_cabinet', 'lab_instrument', 'drone_unit', 'warehouse_rack', 'sensor_box'] as const) {
  const asset = byType(deviceType);
  assert.equal(asset.supportLevel, 'coming_soon', `${deviceType} must remain coming_soon.`);
  assert.equal(asset.adapterBoundary.simulationAdapterAvailable, false, `${deviceType} must not expose simulation adapter.`);
  assert.equal(asset.adapterBoundary.readOnlyAdapterAvailable, false, `${deviceType} must not expose read-only adapter.`);
  assert.equal(toRuntimeDeviceManifest(asset).supportLevel, 'coming_soon', `${deviceType} bridge must preserve coming_soon.`);
}

assert.equal(listRealityAssetsBySupportLevel('simulation_only').length, 2, 'Two assets should be simulation_only.');
assert.equal(listRealityAssetsBySupportLevel('read_only').length, 1, 'One asset should be read_only.');
assert.equal(listRealityAssetsBySupportLevel('coming_soon').length, 7, 'Seven assets should be coming_soon.');

const invalidWithoutManifest = {
  ...byType('robot_arm'),
  deviceManifest: undefined
} as unknown as RealityAssetPackage;
assert.equal(validateRealityAssetPackage(invalidWithoutManifest).valid, false, 'Asset without manifest must fail validation.');
assert.throws(() => toRuntimeDeviceManifest(invalidWithoutManifest), /Invalid Reality Asset Package/, 'Bridge must reject invalid asset.');

const invalidRealAdapter = {
  ...byType('smart_light'),
  adapterBoundary: {
    ...byType('smart_light').adapterBoundary,
    realAdapterEnabled: true
  }
} as unknown as RealityAssetPackage;
assert.equal(validateRealityAssetPackage(invalidRealAdapter).valid, false, 'Asset with realAdapterEnabled true must fail validation.');

const invalidComingSoonRunnable = {
  ...byType('mobile_robot'),
  adapterBoundary: {
    ...byType('mobile_robot').adapterBoundary,
    simulationAdapterAvailable: true
  }
};
assert.equal(validateRealityAssetPackage(invalidComingSoonRunnable).valid, false, 'Coming Soon runnable asset must fail validation.');

const invalidFallback = {
  ...byType('mobile_robot'),
  deviceManifest: {
    ...byType('mobile_robot').deviceManifest,
    deviceId: byType('robot_arm').deviceManifest.deviceId,
    supportLevel: 'simulation_only'
  }
} as unknown as RealityAssetPackage;
assert.equal(validateRealityAssetPackage(invalidFallback).valid, false, 'Asset cannot fallback or upgrade to robot_arm runtime support.');

const desktopFan = JSON.parse(readFileSync('examples/reality-assets/desktop_fan.asset.json', 'utf8').replace(/^\uFEFF/, '')) as RealityAssetPackage;
const fanResult = validateRealityAssetPackage(desktopFan);
assert.equal(fanResult.valid, true, `desktop_fan third-party asset must validate: ${fanResult.errors.join(', ')}`);
assert.equal(toRuntimeDeviceManifest(desktopFan).deviceId, 'virtual_desktop_fan', 'desktop_fan bridge must return its own runtime manifest.');
assert.notEqual(toRuntimeDeviceManifest(desktopFan).deviceId, byType('robot_arm').deviceManifest.deviceId, 'desktop_fan must not fallback to robot_arm.');

const allResults = validateAllBuiltinAssets();
assert.equal(allResults.every((result) => result.valid), true, 'All built-in Reality Assets must validate.');

console.log('Reality Asset platform tests passed.');
