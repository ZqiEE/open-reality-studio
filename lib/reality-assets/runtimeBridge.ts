import type { DeviceManifest } from '../open-reality-runtime/types';
import { validateRealityAssetPackage } from './assetValidator';
import type { RealityAssetPackage } from './types';

export function toRuntimeDeviceManifest(asset: RealityAssetPackage): DeviceManifest {
  const result = validateRealityAssetPackage(asset);
  if (!result.valid || !result.normalizedAsset) {
    throw new Error(`Invalid Reality Asset Package: ${result.errors.join('; ')}`);
  }

  const manifest = result.normalizedAsset.deviceManifest;
  if (manifest.adapter.realAdapterEnabled) {
    throw new Error('Reality Asset cannot enter Runtime Kernel with realAdapterEnabled=true.');
  }
  if (asset.supportLevel === 'coming_soon' && manifest.supportLevel !== 'coming_soon') {
    throw new Error('Reality Asset bridge cannot upgrade coming_soon assets to runnable support.');
  }
  if (asset.supportLevel === 'unsupported' && manifest.supportLevel !== 'unsupported') {
    throw new Error('Reality Asset bridge cannot upgrade unsupported assets to runnable support.');
  }

  return manifest;
}
