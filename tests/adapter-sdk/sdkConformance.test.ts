/**
 * Behavior test for the sdk:conformance governance self-check.
 *
 * Positive: the three runnable reference profiles pass every governance check,
 * ending on the authoritative `platform_safety_gate`.
 *
 * Negative (the important half): the self-check must have TEETH. A non-runnable
 * device is rejected, and the authoritative gate the check relies on rejects a
 * tampered plan (real execution enabled / not dry-run-only). A self-check that
 * always passed would be worse than none.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { runSdkConformance, loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { buildManifestFromProfile } from '../../lib/open-reality-runtime/deviceManifests';
import { buildWorldModelFromProfile } from '../../lib/open-reality-runtime/worldModel';
import { compileOpenRealityRuntime } from '../../lib/open-reality-runtime/runtimeKernel';
import { getSimulationAdapterForManifest } from '../../lib/adapter-sdk';
import { SafetyMonitor } from '../../lib/runtime/SafetyMonitor';

const REPO_ROOT = process.cwd();
const profileDir = (name: string) => path.join(REPO_ROOT, 'profiles', name);

// --- Positive: runnable reference profiles pass every check ---
for (const name of ['virtual-robot-arm', 'virtual-smart-light', 'virtual-camera-sensor']) {
  const profile = loadProfileFromDirectory(profileDir(name));
  const result = runSdkConformance(profile);
  assert.equal(result.ok, true, `${name} must pass sdk:conformance; failing: ${result.checks.filter((c) => !c.ok).map((c) => `${c.id}(${c.detail})`).join(', ')}`);
  const gate = result.checks.find((c) => c.id === 'platform_safety_gate');
  assert(gate && gate.ok, `${name} must clear the authoritative platform_safety_gate`);
  const authority = result.checks.find((c) => c.id === 'zero_real_execution_authority');
  assert(authority && authority.ok, `${name} must declare zero real execution authority`);
}

// --- Negative 1: a non-runnable device is rejected, not silently passed ---
const mobile = loadProfileFromDirectory(profileDir('virtual-mobile-robot'));
const mobileResult = runSdkConformance(mobile);
assert.equal(mobileResult.ok, false, 'A coming-soon / non-runnable device must NOT pass sdk:conformance.');
assert(
  mobileResult.checks.some((c) => c.id === 'simulation_adapter_available' && !c.ok),
  'A non-runnable device must fail on simulation_adapter_available.'
);

// --- Negative 2: the authoritative gate the check relies on rejects tampering ---
const armProfile = loadProfileFromDirectory(profileDir('virtual-robot-arm'));
const manifest = buildManifestFromProfile(armProfile);
const adapter = getSimulationAdapterForManifest(manifest);
assert(adapter, 'robot arm must expose a simulation adapter for the tamper test.');
const task = compileOpenRealityRuntime({
  userPrompt: 'put the red cube in the back area',
  targetDeviceId: armProfile.deviceMeta.device_id,
  manifest,
  worldModel: buildWorldModelFromProfile(armProfile, { targetDeviceId: armProfile.deviceMeta.device_id, selected: true })
});
assert.equal(task.status, 'compiled', 'tamper-test task must compile first.');
assert(task.taskDsl, 'tamper-test task must expose a taskDsl.');
const plan = adapter.compileTaskDslToAdapterPlan(task.taskDsl);
const validation = adapter.validateAdapterPlan(plan);
const dryRun = adapter.dryRun(plan);
const monitor = new SafetyMonitor();

// Baseline passes.
assert.equal(monitor.evaluateSimulationBoundary(manifest, plan, validation, dryRun).ok, true, 'baseline plan must pass the gate.');

// Tamper A: plan no longer dry-run-only -> gate must block.
const notDryRun = { ...plan, dryRunOnly: false as unknown as true };
assert.equal(
  monitor.evaluateSimulationBoundary(manifest, notDryRun, adapter.validateAdapterPlan(notDryRun), dryRun).ok,
  false,
  'A plan that is not dry-run-only must be blocked by the gate.'
);

// Tamper B: manifest claims real execution authority -> gate must block.
const realEnabledManifest = { ...manifest, adapter: { ...manifest.adapter, realAdapterEnabled: true } };
assert.equal(
  monitor.evaluateSimulationBoundary(realEnabledManifest, plan, validation, dryRun).ok,
  false,
  'A manifest with realAdapterEnabled must be blocked by the gate.'
);

console.log('sdk:conformance self-check tests passed (positive + negative).');
