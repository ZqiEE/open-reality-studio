import type { DeviceManifest, OpenRealityTaskDSL, SafetyEnvelope } from '../open-reality-runtime/types';

export type AdapterMode = 'simulation' | 'read_only' | 'real_disabled';

export interface AdapterPlanStep {
  stepId: string;
  capabilityId: string;
  action: OpenRealityTaskDSL['steps'][number]['action'];
  target?: string;
  zone?: string;
  value?: string | number | boolean;
  speed?: 'slow' | 'normal' | 'fast';
  force?: 'low' | 'medium' | 'high';
  note?: string;
}

export interface AdapterPlan {
  adapterId: string;
  targetDeviceId: string;
  mode: AdapterMode;
  steps: AdapterPlanStep[];
  requiredPermissions: string[];
  safetyEnvelope: SafetyEnvelope;
  dryRunOnly: true;
  sourceTaskId: string;
}

export interface AdapterPlanValidationResult {
  ok: boolean;
  errors: string[];
}

export interface AdapterDryRunResult {
  ok: boolean;
  mode: AdapterMode;
  simulatedStepCount: number;
  dryRunOnly: true;
}

export interface AdapterSdkBoundary {
  adapterId: string;
  targetDeviceId: string;
  supportedCapabilities: string[];
  mode: AdapterMode;
  manifest: DeviceManifest;
  compileTaskDslToAdapterPlan(taskDsl: OpenRealityTaskDSL): AdapterPlan;
  validateAdapterPlan(plan: AdapterPlan): AdapterPlanValidationResult;
  dryRun(plan: AdapterPlan): AdapterDryRunResult;
}
