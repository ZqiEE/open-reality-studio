/**
 * Behavioral tests for reference-servo angle-track extraction honesty.
 *
 * These prove structural refusal, not documentation:
 * - a completed 1-DOF servo-twin run -> honest angle track -> a manifest that
 *   the EXISTING real validator accepts (the bridge reuses the real path).
 * - a 3D robot-arm run (Vec3 poses) -> structurally rejected; no projection.
 * - a run spoofing the twin id but carrying a Vec3 pose -> rejected (3D leak).
 * - a blocked run -> rejected (no executable proposal from a blocked sim).
 * - out-of-range / missing / non-finite angle -> rejected, never clamped, and
 *   an out-of-range angle that bypassed the bridge is still rejected downstream
 *   by validateActionManifest (defense in depth).
 */
import {
  extractServoAngleTrack,
  SERVO_TWIN_PROFILE_ID,
  type BridgeSimulationInput
} from '../../lib/hardware/ServoTwinAngleTrack';
import { buildTeachManifest, REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS } from '../../lib/hardware/TeachMode';
import { validateActionManifest } from '../../lib/action-manifest/ActionManifest';
import type { AdapterCommand } from '../../types/simulation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function servoCommand(angle: number, index: number): AdapterCommand {
  return { command: 'move_to_angle', target_angle_deg: angle, speed: 'slow', force: 'low', source_step_id: `s${index}` };
}

function completedServoRun(angles: number[]): BridgeSimulationInput {
  return {
    deviceProfileId: SERVO_TWIN_PROFILE_ID,
    runStatus: 'completed',
    adapterCommands: angles.map(servoCommand)
  };
}

let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }

function testHappyPathFeedsRealValidator() {
  const result = extractServoAngleTrack(completedServoRun([30, 90, 0]));
  assert(result.ok === true, 'a clean servo-twin run must extract');
  assert(JSON.stringify(result.angles) === JSON.stringify([30, 90, 0]), 'angles must be identity, not remapped');
  // The extracted track must be accepted by the EXISTING real path validator.
  const manifest = buildTeachManifest('sim_bridge_demo', 'Sim bridge demo', result.angles);
  const checked = validateActionManifest(manifest, REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  assert(checked.ok === true, 'bridge output must pass the real ActionManifest validator');
  ok('completed servo-twin run -> honest angles -> validated real manifest');
}

function testThreeDArmRunStructurallyRejected() {
  const armRun: BridgeSimulationInput = {
    deviceProfileId: 'robot_arm_semantic_v1',
    runStatus: 'completed',
    adapterCommands: [
      { command: 'move_to', target_position: [0.2, 0.1, 0.3], source_step_id: 'a0' },
      { command: 'move_to', target_position: [0.0, 0.0, 0.0], source_step_id: 'a1' }
    ]
  };
  const result = extractServoAngleTrack(armRun);
  assert(result.ok === false, 'a 3D arm run must never yield a servo track');
  assert(result.reason === 'not_servo_twin_device', `expected not_servo_twin_device, got ${result.ok ? 'ok' : result.reason}`);
  ok('3D robot-arm run -> structurally rejected (no projection)');
}

function testTwinIdSpoofWithVec3Rejected() {
  const spoof: BridgeSimulationInput = {
    deviceProfileId: SERVO_TWIN_PROFILE_ID, // claims to be the twin...
    runStatus: 'completed',
    adapterCommands: [
      // ...but a 3D pose rode along. Refuse rather than drop it silently.
      { command: 'move_to_angle', target_angle_deg: 45, target_position: [0.1, 0, 0], source_step_id: 's0' }
    ]
  };
  const result = extractServoAngleTrack(spoof);
  assert(result.ok === false, 'a Vec3 pose on a twin-labelled command must be rejected');
  assert(result.reason === 'three_d_pose_present', `expected three_d_pose_present, got ${result.ok ? 'ok' : result.reason}`);
  ok('twin-id + Vec3 pose -> rejected (3D leak guard)');
}

function testBlockedRunRejected() {
  const blocked: BridgeSimulationInput = { ...completedServoRun([45]), runStatus: 'blocked' };
  const result = extractServoAngleTrack(blocked);
  assert(result.ok === false && result.reason === 'run_not_completed', 'a blocked run must not yield a proposal');
  ok('blocked simulation run -> rejected');
}

function testOutOfRangeAngleRejectedAndDownstreamGuards() {
  const result = extractServoAngleTrack(completedServoRun([200]));
  assert(result.ok === false && result.reason === 'angle_out_of_range', 'angle 200 must be rejected, never clamped');
  // Defense in depth: if an out-of-range angle bypassed the bridge, the EXISTING
  // real validator must still reject it (out-of-range rejected, not clamped).
  const manifest = buildTeachManifest('oob_demo', 'OOB', [200]);
  const checked = validateActionManifest(manifest, REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  assert(checked.ok === false, 'the real validator must independently reject a 200-degree step');
  ok('out-of-range angle -> rejected by bridge AND by downstream validator');
}

function testMissingAndNonFiniteAngleRejected() {
  const missing: BridgeSimulationInput = {
    deviceProfileId: SERVO_TWIN_PROFILE_ID,
    runStatus: 'completed',
    adapterCommands: [{ command: 'move_to_angle', source_step_id: 's0' }]
  };
  const r1 = extractServoAngleTrack(missing);
  assert(r1.ok === false && r1.reason === 'missing_angle', 'a command with no angle must be rejected');

  const nonFinite: BridgeSimulationInput = {
    deviceProfileId: SERVO_TWIN_PROFILE_ID,
    runStatus: 'completed',
    adapterCommands: [{ command: 'move_to_angle', target_angle_deg: Number.NaN, source_step_id: 's0' }]
  };
  const r2 = extractServoAngleTrack(nonFinite);
  assert(r2.ok === false && r2.reason === 'non_finite_angle', 'a NaN angle must be rejected');
  ok('missing / non-finite angle -> rejected');
}

function testSequenceLengthBounds() {
  const empty: BridgeSimulationInput = { deviceProfileId: SERVO_TWIN_PROFILE_ID, runStatus: 'completed', adapterCommands: [] };
  assert(extractServoAngleTrack(empty).ok === false, 'empty sequence must be rejected');
  const tooMany = completedServoRun(new Array(17).fill(10));
  const r = extractServoAngleTrack(tooMany);
  assert(r.ok === false && r.reason === 'too_many_steps', '17 steps must exceed the governed limit');
  ok('sequence length bounds enforced [1,16]');
}

function main() {
  console.log('reference-servo angle-track honesty contract:');
  testHappyPathFeedsRealValidator();
  testThreeDArmRunStructurallyRejected();
  testTwinIdSpoofWithVec3Rejected();
  testBlockedRunRejected();
  testOutOfRangeAngleRejectedAndDownstreamGuards();
  testMissingAndNonFiniteAngleRejected();
  testSequenceLengthBounds();
  console.log(`\nreference-servo angle track: ${passed} assertions passed`);
}

main();
