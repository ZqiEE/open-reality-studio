import type { RealityAssetPackage, RealityAssetValidationResult } from './types';

const runnableSupportLevels = new Set(['simulation_only', 'read_only']);
const validSupportLevels = new Set(['simulation_only', 'read_only', 'coming_soon', 'unsupported']);
const readOnlyForbiddenCategories = new Set(['motion', 'manipulation', 'actuation', 'transport', 'process']);

function hasPrompts(asset: RealityAssetPackage) {
  return Object.values(asset.examplePrompts).some((items) => items.length > 0);
}

export function validateRealityAssetPackage(asset: RealityAssetPackage): RealityAssetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!asset.assetId) errors.push('assetId is required.');
  if (!asset.name) errors.push('name is required.');
  if (!asset.version) errors.push('version is required.');
  if (!asset.vendor) errors.push('vendor is required.');
  if (!asset.description) errors.push('description is required.');
  if (!asset.deviceManifest) errors.push('deviceManifest is required.');
  if (!asset.supportLevel) errors.push('supportLevel is required.');
  if (asset.supportLevel && !validSupportLevels.has(asset.supportLevel)) {
    errors.push(`supportLevel is invalid: ${asset.supportLevel}`);
  }
  if (!asset.capabilityContracts || asset.capabilityContracts.length === 0) {
    errors.push('capabilityContracts must contain at least one capability.');
  }
  if (!asset.adapterBoundary) {
    errors.push('adapterBoundary is required.');
  } else {
    if (asset.adapterBoundary.realAdapterEnabled !== false) {
      errors.push('realAdapterEnabled must be false for Public Alpha assets.');
    }
    if (asset.adapterBoundary.taskDslIsHardwareCommand !== false) {
      errors.push('TaskDSL must not be represented as a hardware command.');
    }
    if (asset.adapterBoundary.adapterMode === 'real_disabled' && (asset.adapterBoundary.simulationAdapterAvailable || asset.adapterBoundary.readOnlyAdapterAvailable)) {
      errors.push('real_disabled adapter mode cannot expose runnable adapters.');
    }
  }
  if (!asset.worldModelAssumptions?.zones?.length) {
    warnings.push('worldModelAssumptions should include at least one zone.');
  }
  if (!asset.safetyNotes || asset.safetyNotes.length === 0) {
    errors.push('safetyNotes must describe the simulation-only boundary.');
  }
  if (!asset.examplePrompts || !hasPrompts(asset)) {
    errors.push('examplePrompts must include at least one prompt.');
  }
  if (asset.deviceManifest?.adapter?.realAdapterEnabled !== false) {
    errors.push('deviceManifest.adapter.realAdapterEnabled must be false.');
  }
  if (asset.deviceManifest && asset.deviceManifest.supportLevel !== asset.supportLevel) {
    errors.push('supportLevel must match deviceManifest.supportLevel.');
  }
  const capabilityIds = new Set(asset.capabilityContracts?.map((capability) => capability.id) ?? []);
  const manifestCapabilityIds = asset.deviceManifest?.capabilities?.map((capability) => capability.id) ?? [];
  for (const id of manifestCapabilityIds) {
    if (!capabilityIds.has(id)) errors.push(`deviceManifest capability is missing from capabilityContracts: ${id}`);
  }
  if (asset.supportLevel === 'read_only') {
    for (const capability of asset.capabilityContracts ?? []) {
      if (readOnlyForbiddenCategories.has(capability.category) && capability.executionPermission !== 'read_only') {
        errors.push(`read_only asset cannot declare executable ${capability.category} capability: ${capability.id}`);
      }
    }
  }
  if (asset.supportLevel === 'coming_soon' && asset.adapterBoundary?.simulationAdapterAvailable) {
    errors.push('Coming Soon assets cannot expose a runnable simulation adapter.');
  }
  if (asset.supportLevel === 'coming_soon' && asset.adapterBoundary?.readOnlyAdapterAvailable) {
    errors.push('Coming Soon assets cannot expose a read-only adapter.');
  }
  if (asset.supportLevel === 'coming_soon' && runnableSupportLevels.has(asset.deviceManifest?.supportLevel)) {
    errors.push('Coming Soon assets cannot be runnable at manifest level.');
  }
  if (asset.supportLevel === 'unsupported' && asset.adapterBoundary?.simulationAdapterAvailable) {
    errors.push('Unsupported assets cannot expose a runnable simulation adapter.');
  }
  if (!asset.tags || asset.tags.length === 0) {
    warnings.push('tags should identify asset source and support level.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedAsset: errors.length === 0 ? asset : undefined
  };
}
