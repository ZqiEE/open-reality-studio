/**
 * sdk:conformance — a developer-runnable governance self-check for a device
 * adapter, BEFORE it is submitted to the marketplace.
 *
 * WHY (platform/ecosystem): the winning move for a low-barrier platform is a
 * self-serve on-ramp where a third-party developer can prove, on their own
 * machine, that their adapter passes the SAME governance the platform enforces
 * — no human review round-trip to discover a violation. Green here === the
 * platform's Safety Governor will accept it as a zero-execution-authority,
 * simulation-only proposal.
 *
 * SAFETY (non-negotiable): this self-check calls the EXACT authoritative
 * validators the runtime uses — `buildManifestFromProfile`, the adapter SDK
 * boundary (`getSimulationAdapterForManifest` + validate + dryRun), and
 * `SafetyMonitor.evaluateSimulationBoundary`. It NEVER re-implements a weaker
 * parallel copy of the governance rules; a weakened self-check that always
 * passes would be worse than none. If the platform tightens the gate, this
 * check tightens with it automatically.
 *
 * Scope: reads a device profile (device.meta.json + geometry.json) — the unit
 * a device-adapter author authors — and reports a pass/fail checklist with an
 * actionable reason per item. It grants no execution authority and touches no
 * hardware.
 *
 * Usage (developer):  npm run sdk:conformance -- profiles/<your-device>
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildManifestFromProfile } from '../lib/open-reality-runtime/deviceManifests';
import { buildWorldModelFromProfile } from '../lib/open-reality-runtime/worldModel';
import { compileOpenRealityRuntime } from '../lib/open-reality-runtime/runtimeKernel';
import { getSimulationAdapterForManifest, REAL_ADAPTER_BOUNDARY } from '../lib/adapter-sdk';
import { SafetyMonitor } from '../lib/runtime/SafetyMonitor';
import type { DeviceProfile } from '../types/deviceMeta';
import type { DeviceType } from '../types/deviceMeta';

export interface SdkConformanceCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SdkConformanceResult {
  ok: boolean;
  profileId: string;
  deviceType: string;
  checks: SdkConformanceCheck[];
}

const DEFAULT_PROMPTS: Partial<Record<DeviceType, string>> = {
  robot_arm: 'put the red cube in the back area',
  smart_light: 'set the light to blue',
  camera_sensor: 'take a photo'
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the governance self-check against one authored device profile.
 * Returns a structured checklist; `ok` is true only if every check passes.
 */
export function runSdkConformance(
  profile: DeviceProfile,
  options: { prompt?: string } = {}
): SdkConformanceResult {
  const checks: SdkConformanceCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const deviceType = profile.deviceMeta.device_type;
  const finalize = (): SdkConformanceResult => ({
    ok: checks.every((check) => check.ok),
    profileId: profile.id,
    deviceType,
    checks
  });

  // 1. Manifest builds from the authored profile.
  let manifest;
  try {
    manifest = buildManifestFromProfile(profile);
    add('manifest_builds', true, `support level: ${manifest.supportLevel}`);
  } catch (error) {
    add('manifest_builds', false, `buildManifestFromProfile threw: ${errorMessage(error)}`);
    return finalize();
  }

  // 2. Zero real execution authority (invariant 5). A submitted adapter is a
  //    proposal; it may never carry real actuation authority.
  add(
    'zero_real_execution_authority',
    manifest.adapter.realAdapterEnabled === false,
    `manifest.adapter.realAdapterEnabled = ${manifest.adapter.realAdapterEnabled} (must be false)`
  );
  add(
    'sdk_real_boundary_disabled',
    REAL_ADAPTER_BOUNDARY.realDeviceExecution === false && REAL_ADAPTER_BOUNDARY.allRealAdaptersDisabled === true,
    'adapter SDK exposes no real-device execution path'
  );

  // 3. A simulation adapter boundary exists (real_disabled devices expose none).
  const adapter = getSimulationAdapterForManifest(manifest);
  if (!adapter) {
    add(
      'simulation_adapter_available',
      false,
      `support level ${manifest.supportLevel} exposes no simulation adapter (device is real_disabled / not yet runnable)`
    );
    return finalize();
  }
  add('simulation_adapter_available', true, `adapter ${adapter.adapterId}, mode ${adapter.mode}`);

  // 4. A runtime task compiles for a representative prompt.
  const prompt = options.prompt ?? DEFAULT_PROMPTS[deviceType] ?? 'run a safe default action';
  const worldModel = buildWorldModelFromProfile(profile, {
    targetDeviceId: profile.deviceMeta.device_id,
    selected: true
  });
  const task = compileOpenRealityRuntime({
    userPrompt: prompt,
    targetDeviceId: profile.deviceMeta.device_id,
    manifest,
    worldModel
  });
  if (task.status !== 'compiled' || !task.taskDsl) {
    add('runtime_task_compiles', false, `runtime status "${task.status}" for prompt "${prompt}"`);
    return finalize();
  }
  const taskDsl = task.taskDsl;
  add('runtime_task_compiles', true, `compiled for "${prompt}"`);

  // 5. The adapter plan stays dry-run-only and non-real.
  let plan;
  try {
    plan = adapter.compileTaskDslToAdapterPlan(taskDsl);
  } catch (error) {
    add('plan_dry_run_only', false, `compileTaskDslToAdapterPlan threw: ${errorMessage(error)}`);
    return finalize();
  }
  add(
    'plan_dry_run_only',
    plan.dryRunOnly === true && plan.mode !== 'real_disabled',
    `dryRunOnly=${plan.dryRunOnly}, mode=${plan.mode}`
  );

  // 6. The adapter's own plan validation passes.
  const validation = adapter.validateAdapterPlan(plan);
  add('plan_validates', validation.ok, validation.ok ? 'plan valid' : validation.errors.join('; '));

  // 7. Dry run succeeds and stays dry-run-only.
  let dryRun;
  try {
    dryRun = adapter.dryRun(plan);
    add(
      'dry_run_succeeds',
      dryRun.ok === true && dryRun.dryRunOnly === true,
      `simulated ${dryRun.simulatedStepCount} step(s)`
    );
  } catch (error) {
    add('dry_run_succeeds', false, `dryRun threw: ${errorMessage(error)}`);
    return finalize();
  }

  // 8. THE authoritative platform gate. Green here === the Safety Governor
  //    authorizes this as a simulation-only proposal. This is the same call
  //    the runtime makes; the self-check has no private, softer path.
  const decision = new SafetyMonitor().evaluateSimulationBoundary(manifest, plan, validation, dryRun);
  add('platform_safety_gate', decision.ok, decision.reason);

  return finalize();
}

/** Load an authored profile from a directory (device.meta.json + geometry.json). */
export function loadProfileFromDirectory(profileDirectory: string): DeviceProfile {
  const deviceMeta = JSON.parse(
    fs.readFileSync(path.join(profileDirectory, 'device.meta.json'), 'utf8')
  );
  const geometry = JSON.parse(
    fs.readFileSync(path.join(profileDirectory, 'geometry.json'), 'utf8')
  );
  const id = typeof deviceMeta.device_id === 'string' ? deviceMeta.device_id : path.basename(profileDirectory);
  const label = typeof deviceMeta.display_name === 'string' ? deviceMeta.display_name : id;
  return { id, label, deviceMeta, geometry };
}

function formatResult(result: SdkConformanceResult): string {
  const lines: string[] = [];
  lines.push(`sdk:conformance — ${result.profileId} (${result.deviceType})`);
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.id.padEnd(30)} ${check.detail}`);
  }
  lines.push('');
  lines.push(
    result.ok
      ? 'RESULT: GREEN — this adapter passes platform governance; safe to submit as a simulation-only proposal.'
      : 'RESULT: BLOCKED — fix the FAIL items above before submitting. Nothing was executed on hardware.'
  );
  return lines.join('\n');
}

// CLI entry: `node scripts/sdkConformance.js profiles/<device>`
if (require.main === module) {
  const argv = process.argv.slice(2);
  const promptFlagIndex = argv.indexOf('--prompt');
  const prompt = promptFlagIndex >= 0 ? argv[promptFlagIndex + 1] : undefined;
  const target = argv.find((token) => !token.startsWith('--') && token !== prompt);
  if (!target) {
    process.stderr.write('Usage: node scripts/sdkConformance.js <profile-directory> [--prompt "a task for this device"]\n');
    process.exit(2);
  }
  try {
    const profile = loadProfileFromDirectory(path.resolve(target));
    const result = runSdkConformance(profile, { prompt });
    process.stdout.write(`${formatResult(result)}\n`);
    if (result.ok) {
      process.stdout.write(`\nNext step:  npm run sdk:submit -- ${target}\n`);
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`sdk:conformance failed to run: ${errorMessage(error)}\n`);
    process.exit(2);
  }
}
