/**
 * ServoTwinAngleTrack — strict extraction for the REAL panel's reference-servo
 * preflight. This is not a bridge from the generic left simulation workspace.
 *
 * WHY THIS EXISTS, AND WHY IT IS NARROW
 * The simulation pipeline speaks 3D poses (AdapterCommand.target_position: Vec3).
 * A 3D pose CANNOT be honestly projected onto a 1-DOF servo angle, so this
 * extractor refuses to try. It accepts a result ONLY when that result
 * was produced by the 1-DOF servo digital twin, whose action space is natively
 * `move_to_angle` in degrees — an identity mapping onto the real SG90 servo,
 * fabricating nothing.
 *
 * WHAT IT PRODUCES
 * A plain angle sequence. That sequence is an UNTRUSTED PROPOSAL. It is meant to
 * be handed to the EXISTING real path (buildTeachManifest -> validateActionManifest
 * -> executeManifest IPC -> main-process authority -> HardwareExecutionGate),
 * which re-derives risk, re-validates range (out-of-range rejected, never
 * clamped), takes a fresh sensor generation per step, and keeps the evidence
 * lock plus per-run operator confirmation. This module adds a new SOURCE of
 * proposals; it adds ZERO new IPC and ZERO new execution channel. Nothing here
 * reads or maps the generic simulation model selected in the left workspace.
 *
 * STRUCTURAL HONESTY (only ever tightens)
 * The extractor rejects the WHOLE run — never a partial or projected result —
 * if the run was not completed, the device is not the servo twin, any command
 * is not a clean scalar `move_to_angle`, any command still carries a Vec3
 * target_position (a 3D leak), any angle is missing / non-finite / out of the
 * [0,180] envelope, or the sequence length is outside [1,16].
 */
import type { AdapterCommand } from '../../types/simulation';

/** The one simulation device whose native action space is a scalar servo angle. */
export const SERVO_TWIN_PROFILE_ID = 'sim-esp32-sg90-twin-v1';
export const SERVO_TWIN_COMMAND = 'move_to_angle';
export const SERVO_ANGLE_MIN_DEG = 0;
export const SERVO_ANGLE_MAX_DEG = 180;
export const BRIDGE_MIN_STEPS = 1;
export const BRIDGE_MAX_STEPS = 16;

export type BridgeRejectReason =
  | 'run_not_completed'
  | 'not_servo_twin_device'
  | 'empty_command_sequence'
  | 'too_many_steps'
  | 'non_angle_command'
  | 'three_d_pose_present'
  | 'missing_angle'
  | 'non_finite_angle'
  | 'angle_out_of_range';

export type BridgeExtractResult =
  | { ok: true; angles: number[] }
  | { ok: false; reason: BridgeRejectReason; detail: string };

export interface BridgeSimulationInput {
  /** profile_id of the simulation device that produced this run. */
  deviceProfileId: string;
  /** 'completed' is the only status that can yield an executable proposal. */
  runStatus: string;
  /** The simulation's emitted adapter commands, in execution order. */
  adapterCommands: ReadonlyArray<AdapterCommand>;
}

/**
 * Extract an honest servo angle track from a completed servo-twin simulation.
 * Returns a rejection (never a guess, never a partial track) if anything about
 * the run is not a clean 1-DOF servo-angle sequence.
 */
export function extractServoAngleTrack(input: BridgeSimulationInput): BridgeExtractResult {
  if (input.runStatus !== 'completed') {
    return { ok: false, reason: 'run_not_completed', detail: `run status is "${input.runStatus}", not "completed"` };
  }
  if (input.deviceProfileId !== SERVO_TWIN_PROFILE_ID) {
    return {
      ok: false,
      reason: 'not_servo_twin_device',
      detail: `device "${input.deviceProfileId}" is not the 1-DOF servo twin (${SERVO_TWIN_PROFILE_ID}); a 3D pose cannot be honestly mapped to a servo angle`
    };
  }

  const commands = input.adapterCommands;
  if (commands.length < BRIDGE_MIN_STEPS) {
    return { ok: false, reason: 'empty_command_sequence', detail: 'the run produced no adapter commands' };
  }
  if (commands.length > BRIDGE_MAX_STEPS) {
    return { ok: false, reason: 'too_many_steps', detail: `${commands.length} steps exceed the governed limit of ${BRIDGE_MAX_STEPS}` };
  }

  const angles: number[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command.command !== SERVO_TWIN_COMMAND) {
      return { ok: false, reason: 'non_angle_command', detail: `step ${index}: command "${command.command}" is not "${SERVO_TWIN_COMMAND}"` };
    }
    // A 3D pose present anywhere means this is not a native servo track. Refuse
    // to silently drop it and pretend the angle field is the whole truth.
    if (command.target_position !== undefined) {
      return { ok: false, reason: 'three_d_pose_present', detail: `step ${index}: command carries a 3D target_position; refusing to project a pose onto a servo angle` };
    }
    const angle = command.target_angle_deg;
    if (angle === undefined) {
      return { ok: false, reason: 'missing_angle', detail: `step ${index}: no target_angle_deg` };
    }
    if (typeof angle !== 'number' || !Number.isFinite(angle)) {
      return { ok: false, reason: 'non_finite_angle', detail: `step ${index}: target_angle_deg is not a finite number` };
    }
    if (angle < SERVO_ANGLE_MIN_DEG || angle > SERVO_ANGLE_MAX_DEG) {
      // Never clamp. Downstream validators reject too; this fails early, honestly.
      return { ok: false, reason: 'angle_out_of_range', detail: `step ${index}: angle ${angle} is outside [${SERVO_ANGLE_MIN_DEG}, ${SERVO_ANGLE_MAX_DEG}]` };
    }
    angles.push(angle);
  }

  return { ok: true, angles };
}
