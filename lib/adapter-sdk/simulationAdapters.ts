import type { DeviceManifest, OpenRealityTaskDSL } from '../open-reality-runtime/types';
import type { AdapterMode, AdapterPlan, AdapterPlanValidationResult, AdapterSdkBoundary } from './types';

function modeFromManifest(manifest: DeviceManifest): AdapterMode {
  if (manifest.supportLevel === 'simulation_only') return 'simulation';
  if (manifest.supportLevel === 'read_only') return 'read_only';
  return 'real_disabled';
}

function permissionsForTask(taskDsl: OpenRealityTaskDSL) {
  return taskDsl.executionMode === 'read_only'
    ? ['adapter.dry_run', 'simulation.read_only']
    : ['adapter.dry_run', 'simulation.execute'];
}

function assertCompilable(manifest: DeviceManifest, adapterId: string, taskDsl: OpenRealityTaskDSL) {
  const mode = modeFromManifest(manifest);
  if (mode === 'real_disabled') {
    throw new Error(`${adapterId} is disabled for non-runnable device support level ${manifest.supportLevel}.`);
  }
  if (taskDsl.targetDeviceId !== manifest.deviceId) {
    throw new Error(`Task target ${taskDsl.targetDeviceId} does not match adapter target ${manifest.deviceId}.`);
  }

  for (const step of taskDsl.steps) {
    if (!manifest.capabilities.some((capability) => capability.id === step.capabilityId)) {
      throw new Error(`Unsupported capability for adapter plan: ${step.capabilityId}`);
    }
  }

  return mode;
}

function createSimulationAdapter(manifest: DeviceManifest): AdapterSdkBoundary {
  const mode = modeFromManifest(manifest);
  const adapterId = manifest.adapter.simulationAdapter;
  const supportedCapabilities = manifest.capabilities.map((capability) => capability.id);

  return {
    adapterId,
    targetDeviceId: manifest.deviceId,
    supportedCapabilities,
    mode,
    manifest,
    compileTaskDslToAdapterPlan(taskDsl: OpenRealityTaskDSL): AdapterPlan {
      const currentMode = assertCompilable(manifest, adapterId, taskDsl);
      return {
        adapterId,
        targetDeviceId: manifest.deviceId,
        mode: currentMode,
        steps: taskDsl.steps.map((step) => ({
          stepId: step.id,
          capabilityId: step.capabilityId,
          action: step.action,
          target: step.target,
          zone: step.zone,
          value: step.value,
          speed: step.speed,
          force: step.force,
          note: step.note
        })),
        requiredPermissions: permissionsForTask(taskDsl),
        safetyEnvelope: taskDsl.safetyEnvelope,
        dryRunOnly: true,
        sourceTaskId: taskDsl.task_id
      };
    },
    validateAdapterPlan(plan: AdapterPlan): AdapterPlanValidationResult {
      const errors: string[] = [];
      if (plan.targetDeviceId !== manifest.deviceId) errors.push('targetDeviceId mismatch');
      if (plan.adapterId !== adapterId) errors.push('adapterId mismatch');
      if (plan.dryRunOnly !== true) errors.push('dryRunOnly must remain true');
      if (plan.mode === 'real_disabled') errors.push('real_disabled adapters cannot validate executable plans');
      for (const step of plan.steps) {
        if (!supportedCapabilities.includes(step.capabilityId)) {
          errors.push(`unsupported capabilityId ${step.capabilityId}`);
        }
      }
      return { ok: errors.length === 0, errors };
    },
    dryRun(plan: AdapterPlan) {
      const validation = this.validateAdapterPlan(plan);
      if (!validation.ok) {
        throw new Error(`Adapter plan invalid: ${validation.errors.join('; ')}`);
      }
      return {
        ok: true,
        mode: plan.mode,
        simulatedStepCount: plan.steps.length,
        dryRunOnly: true as const
      };
    }
  };
}

export function getSimulationAdapterForManifest(manifest: DeviceManifest) {
  if (modeFromManifest(manifest) === 'real_disabled') return null;
  return createSimulationAdapter(manifest);
}

export const REAL_ADAPTER_BOUNDARY = {
  realDeviceExecution: false as const,
  allRealAdaptersDisabled: true as const
};
