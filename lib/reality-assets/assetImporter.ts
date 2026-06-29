import { getBuiltinRealityAssets } from './assetRegistry';
import { addImportedRealityAsset, getImportedRealityAssets } from './importedAssetStore';
import { validateRealityAssetPackage } from './assetValidator';
import type { RealityAssetPackage, RealityAssetValidationResult } from './types';

export type AssetImportStatus =
  | 'imported'
  | 'invalid'
  | 'duplicate'
  | 'unsafe'
  | 'unsupported_schema';

export interface AssetImportResult {
  status: AssetImportStatus;
  asset?: RealityAssetPackage;
  validationResult?: RealityAssetValidationResult;
  errors: string[];
  warnings: string[];
  userFacingMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRealityAssetJson(input: string): AssetImportResult {
  try {
    const parsed = JSON.parse(input.replace(/^\uFEFF/, '')) as unknown;
    if (!isRecord(parsed)) {
      return {
        status: 'unsupported_schema',
        errors: ['Reality Asset JSON must be an object.'],
        warnings: [],
        userFacingMessage: 'Reality Asset JSON must be an object.'
      };
    }
    return importRealityAssetPackage(parsed);
  } catch (error) {
    return {
      status: 'invalid',
      errors: [error instanceof Error ? error.message : 'Invalid JSON.'],
      warnings: [],
      userFacingMessage: 'Invalid Reality Asset JSON.'
    };
  }
}

export function importRealityAssetPackage(input: unknown): AssetImportResult {
  if (!isRecord(input)) {
    return {
      status: 'unsupported_schema',
      errors: ['Reality Asset package must be an object.'],
      warnings: [],
      userFacingMessage: 'Reality Asset package must be an object.'
    };
  }

  const asset = input as unknown as RealityAssetPackage;
  const assetId = typeof asset.assetId === 'string' ? asset.assetId : '';
  if (assetId && getBuiltinRealityAssets().some((builtin) => builtin.assetId === assetId)) {
    return {
      status: 'duplicate',
      errors: [`Asset ID already exists as a built-in asset: ${assetId}`],
      warnings: [],
      userFacingMessage: 'This asset ID is already used by a built-in Reality Asset.'
    };
  }
  if (assetId && getImportedRealityAssets().some((imported) => imported.assetId === assetId)) {
    return {
      status: 'duplicate',
      errors: [`Asset ID already exists as an imported asset: ${assetId}`],
      warnings: [],
      userFacingMessage: 'This asset ID is already imported.'
    };
  }

  const validationResult = validateRealityAssetPackage(asset);
  if (!validationResult.valid) {
    const unsafe = asset.adapterBoundary?.realAdapterEnabled === true || asset.deviceManifest?.adapter?.realAdapterEnabled === true;
    return {
      status: unsafe ? 'unsafe' : 'invalid',
      validationResult,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      userFacingMessage: unsafe
        ? 'Rejected: real device execution must remain disabled.'
        : 'Rejected: Reality Asset validation failed.'
    };
  }

  try {
    const imported = addImportedRealityAsset(asset);
    return {
      status: 'imported',
      asset: imported,
      validationResult,
      errors: [],
      warnings: validationResult.warnings,
      userFacingMessage: 'Reality Asset imported into the local catalog.'
    };
  } catch (error) {
    return {
      status: 'duplicate',
      validationResult,
      errors: [error instanceof Error ? error.message : 'Import failed.'],
      warnings: validationResult.warnings,
      userFacingMessage: 'Reality Asset could not be imported.'
    };
  }
}
