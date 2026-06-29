import { getBuiltinRealityAssets } from './assetRegistry';
import { validateRealityAssetPackage } from './assetValidator';
import type { RealityAssetPackage } from './types';

const importedAssets = new Map<string, RealityAssetPackage>();

export function getImportedRealityAssets(): RealityAssetPackage[] {
  return Array.from(importedAssets.values());
}

export function clearImportedRealityAssets() {
  importedAssets.clear();
}

export function addImportedRealityAsset(asset: RealityAssetPackage): RealityAssetPackage {
  const validation = validateRealityAssetPackage(asset);
  if (!validation.valid) {
    throw new Error(`Cannot import invalid Reality Asset: ${validation.errors.join('; ')}`);
  }
  if (getBuiltinRealityAssets().some((builtin) => builtin.assetId === asset.assetId)) {
    throw new Error(`Cannot override built-in Reality Asset: ${asset.assetId}`);
  }
  if (importedAssets.has(asset.assetId)) {
    throw new Error(`Duplicate imported Reality Asset: ${asset.assetId}`);
  }
  importedAssets.set(asset.assetId, asset);
  return asset;
}

export function getAllRealityAssets(): RealityAssetPackage[] {
  return [...getBuiltinRealityAssets(), ...getImportedRealityAssets()];
}
