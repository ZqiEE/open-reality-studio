import type {
  CapabilityContract,
  DeviceManifest,
  RuntimeDeviceType,
  SupportLevel,
  WorldModel
} from '../open-reality-runtime/types';

export type RealityAssetSupportLevel = SupportLevel;
export type RealityAssetAdapterMode = 'simulation_only' | 'read_only' | 'real_disabled';

export interface RealityAssetAdapterBoundary {
  simulationAdapterAvailable: boolean;
  readOnlyAdapterAvailable: boolean;
  realAdapterEnabled: boolean;
  adapterMode: RealityAssetAdapterMode;
  taskDslIsHardwareCommand: false;
  notes: string[];
}

export interface RealityAssetExamplePrompts {
  supported: string[];
  unsupported: string[];
  unsafe: string[];
  ambiguous: string[];
}

export interface RealityAssetValidationRules {
  requiresDeviceManifest: boolean;
  requiresCapabilityContracts: boolean;
  requiresSupportLevel: boolean;
  realAdapterMustBeDisabled: boolean;
  comingSoonMustNotBeRunnable: boolean;
  unsupportedMustNotFallback: boolean;
  requiresExamplePrompt: boolean;
}

export interface RealityAssetPackage {
  assetId: string;
  name: string;
  version: string;
  vendor: string;
  description: string;
  deviceType: RuntimeDeviceType | string;
  deviceManifest: DeviceManifest;
  capabilityContracts: CapabilityContract[];
  worldModelAssumptions: Pick<WorldModel, 'objects' | 'zones' | 'confidence'>;
  adapterBoundary: RealityAssetAdapterBoundary;
  examplePrompts: RealityAssetExamplePrompts;
  validationRules: RealityAssetValidationRules;
  supportLevel: RealityAssetSupportLevel;
  safetyNotes: string[];
  tags: string[];
}

export interface RealityAssetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedAsset?: RealityAssetPackage;
}
