/**
 * ServoTwinSimulation — the 1-DOF servo digital twin that natively speaks
 * angles, giving the hardware-local reference-servo preflight an honest source.
 *
 * WHY IT REUSES THE REAL RULES
 * The twin does not invent a parallel safety check. It runs an angle sequence
 * through the SAME authoritative validators the real path uses at execution:
 * validateActionManifest (capability + value policy: move_to_angle in [0,180])
 * and expandManifestToTaskDsl (envelope tightening + recomputed risk). If those
 * reject, the twin run is BLOCKED and yields no proposal — an unsafe or
 * out-of-range goal produces nothing to execute, exactly like the real gate.
 *
 * HONESTY BOUNDARY (only ever tightens)
 * A "completed" twin run means the MOTION PLAN is well-formed and in-envelope —
 * never that the physical world is safe. The twin does NOT and cannot simulate
 * a real sensor: sensor freshness and the distance interlock are REAL signals
 * the hardware gate enforces independently at execution time. Fabricating a
 * sensor reading here is forbidden. The twin's output is a servo-native command
 * track (move_to_angle carrying target_angle_deg, never a Vec3), which
 * extractServoAngleTrack can honestly hand to the existing evidence-locked,
 * per-run-confirmed real path.
 */
import type { AdapterCommand } from '../../types/simulation';
import type { DeviceMeta } from '../../types/deviceMeta';
import type { TaskDSL } from '../../types/taskDsl';
import { validateActionManifest, expandManifestToTaskDsl } from '../action-manifest/ActionManifest';
import { buildTeachManifest, REAL_TEACH_BUILTIN_INTENT_IDS } from './TeachMode';
import { SERVO_TWIN_PROFILE_ID, SERVO_TWIN_COMMAND } from './ServoTwinAngleTrack';

/**
 * The simulation-only twin device. device_type stays 'robot_arm' for the same
 * reason as REAL_SERVO_TEACH_DEVICE_META: move_to_angle is a real-hardware
 * capability intentionally kept out of the simulation-only DeviceCapability
 * union, while the manifest validator reads capability strings generically.
 * The profile_id is the twin's own identity, which the bridge keys on.
 */
export const SERVO_TWIN_DEVICE_META: DeviceMeta = {
  profile_id: SERVO_TWIN_PROFILE_ID,
  profile_version: '1.0.0',
  manufacturer: 'RealityWarden reference kit',
  model: 'ESP32-S3 + SG90 (digital twin)',
  device_id: 'sim-esp32-servo-twin',
  device_type: 'robot_arm',
  simulator_profile: 'robot_arm_semantic_v1',
  supported_adapters: ['esp32_serial'],
  risk_class: 'medium',
  display_name: 'SIM SG90 twin (simulation-only)',
  capabilities: ['move_to_angle'] as unknown as DeviceMeta['capabilities'],
  constraints: {
    workspace: { x_min: 0, x_max: 0, y_min: 0, y_max: 0, z_min: 0, z_max: 0 },
    max_speed: 'slow',
    force_limit: 'low',
    forbidden_zones: [],
    known_targets: []
  },
  safety_profile: {
    allow_throwing: false,
    allow_high_force: false,
    allow_outside_workspace: false,
    require_logging: true,
    require_human_confirmation_for_risky_actions: true
  },
  runtime_state: { status: 'idle', current_position: 'open_loop_unknown' }
};

export interface ServoTwinBlocked {
  status: 'blocked';
  reason: string;
}

export interface ServoTwinCompleted {
  status: 'completed';
  /** The twin's own profile id; the bridge keys on this. */
  deviceProfileId: string;
  /** Authoritatively recomputed risk (declared risk is discarded upstream). */
  riskLevel: TaskDSL['risk_level'];
  /** Servo-native track: every command is move_to_angle with target_angle_deg. */
  adapterCommands: AdapterCommand[];
}

export type ServoTwinResult = ServoTwinCompleted | ServoTwinBlocked;

export interface ServoTwinOptions {
  actionId?: string;
  displayName?: string;
  prompt?: string;
}

/**
 * Simulate a servo angle track through the authoritative real-path rules.
 * Returns a servo-native adapter command sequence on success, or a blocked
 * result carrying the authoritative rejection reason.
 */
export function simulateServoTrack(
  angles: readonly number[],
  options: ServoTwinOptions = {}
): ServoTwinResult {
  const actionId = options.actionId ?? 'sim_servo_track';
  const displayName = options.displayName ?? 'Simulated servo track';
  const prompt = options.prompt ?? displayName;

  // Authoritative gate #1: schema + capability + value policy (angle in [0,180]).
  const manifest = buildTeachManifest(actionId, displayName, angles);
  const checked = validateActionManifest(manifest, SERVO_TWIN_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  if (!checked.ok) {
    return { status: 'blocked', reason: `${checked.code}: ${checked.detail}` };
  }

  // Authoritative gate #2: envelope tightening + risk recomputation.
  const expanded = expandManifestToTaskDsl(checked.manifest, SERVO_TWIN_DEVICE_META, prompt);
  if (!expanded.ok) {
    return { status: 'blocked', reason: `${expanded.code}: ${expanded.detail}` };
  }

  const adapterCommands: AdapterCommand[] = [];
  for (const step of expanded.taskDsl.steps) {
    // The authoritative expansion guarantees this, but the twin refuses to
    // emit anything it cannot honestly certify as a scalar servo angle.
    // String() mirrors TeachMode: move_to_angle is intentionally absent from
    // the simulation-only action union, though the runtime value is exactly it.
    if (String(step.action) !== SERVO_TWIN_COMMAND || typeof step.value !== 'number' || !Number.isFinite(step.value)) {
      return { status: 'blocked', reason: `twin_non_scalar_step:${step.id}` };
    }
    adapterCommands.push({
      command: SERVO_TWIN_COMMAND,
      target_angle_deg: step.value,
      speed: step.speed,
      force: step.force,
      source_step_id: step.id
    });
  }

  return {
    status: 'completed',
    deviceProfileId: SERVO_TWIN_PROFILE_ID,
    riskLevel: expanded.taskDsl.risk_level,
    adapterCommands
  };
}
