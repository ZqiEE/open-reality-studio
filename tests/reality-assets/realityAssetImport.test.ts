import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  clearImportedRealityAssets,
  getAllRealityAssets,
  getImportedRealityAssets,
  importRealityAssetPackage,
  parseRealityAssetJson,
  toRuntimeDeviceManifest,
  type RealityAssetPackage
} from '../../lib/reality-assets';

function readAsset(path: string): RealityAssetPackage {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as RealityAssetPackage;
}

clearImportedRealityAssets();

const desktopFan = readAsset('examples/reality-assets/desktop_fan.asset.json');
const imported = importRealityAssetPackage(desktopFan);
assert.equal(imported.status, 'imported', `desktop_fan should import: ${imported.errors.join(', ')}`);
assert.equal(getImportedRealityAssets().some((asset) => asset.assetId === 'desktop_fan'), true, 'Imported store must include desktop_fan.');
assert.equal(getAllRealityAssets().some((asset) => asset.assetId === 'desktop_fan'), true, 'All assets must include imported desktop_fan.');
assert.equal(toRuntimeDeviceManifest(desktopFan).deviceId, 'virtual_desktop_fan', 'Imported desktop_fan must bridge to its own runtime manifest.');
assert.notEqual(toRuntimeDeviceManifest(desktopFan).deviceId, 'virtual_robot_arm', 'Imported asset must not fallback to robot_arm.');

const invalidJson = parseRealityAssetJson('{');
assert.equal(invalidJson.status, 'invalid', 'Invalid JSON must return invalid.');

const missingManifest = importRealityAssetPackage({ ...desktopFan, assetId: 'missing_manifest', deviceManifest: undefined });
assert.equal(missingManifest.status, 'invalid', 'Missing deviceManifest must return invalid.');

const missingCapabilities = importRealityAssetPackage({ ...desktopFan, assetId: 'missing_capabilities', capabilityContracts: [] });
assert.equal(missingCapabilities.status, 'invalid', 'Missing capabilityContracts must return invalid.');

const unsafe = readAsset('examples/reality-assets/unsafe_real_adapter.asset.json');
const unsafeResult = importRealityAssetPackage(unsafe);
assert.equal(unsafeResult.status, 'unsafe', 'realAdapterEnabled true must return unsafe.');
assert.equal(getImportedRealityAssets().some((asset) => asset.assetId === 'unsafe_real_adapter'), false, 'Unsafe asset must not be added to store.');

const duplicateImported = importRealityAssetPackage(desktopFan);
assert.equal(duplicateImported.status, 'duplicate', 'Duplicate imported assetId must return duplicate.');

const builtinOverride = importRealityAssetPackage({ ...desktopFan, assetId: 'openreality.robot_arm' });
assert.equal(builtinOverride.status, 'duplicate', 'Imported asset cannot override builtin robot_arm.');

const comingSoonAsset = {
  ...desktopFan,
  assetId: 'third_party_future_fan',
  supportLevel: 'coming_soon',
  deviceManifest: {
    ...desktopFan.deviceManifest,
    deviceId: 'virtual_future_fan',
    supportLevel: 'coming_soon'
  },
  adapterBoundary: {
    ...desktopFan.adapterBoundary,
    simulationAdapterAvailable: false,
    readOnlyAdapterAvailable: false,
    adapterMode: 'real_disabled'
  }
} as RealityAssetPackage;
const comingSoonResult = importRealityAssetPackage(comingSoonAsset);
assert.equal(comingSoonResult.status, 'imported', 'Valid coming_soon asset can be imported for catalog inspection.');
assert.equal(toRuntimeDeviceManifest(comingSoonAsset).supportLevel, 'coming_soon', 'Runtime bridge must preserve coming_soon.');
assert.equal(comingSoonAsset.adapterBoundary.simulationAdapterAvailable, false, 'Imported coming_soon asset cannot become runnable.');

for (const asset of getImportedRealityAssets()) {
  assert.equal(asset.adapterBoundary.realAdapterEnabled, false, `${asset.assetId} cannot enable real execution.`);
  assert.equal(asset.deviceManifest.adapter.realAdapterEnabled, false, `${asset.assetId} manifest cannot enable real execution.`);
}

assert.throws(
  () => toRuntimeDeviceManifest({ ...desktopFan, assetId: 'invalid_bridge', capabilityContracts: [] }),
  /Invalid Reality Asset Package/,
  'Invalid asset cannot convert through runtime bridge.'
);

console.log('Reality Asset import tests passed.');
