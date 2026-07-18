/**
 * Behavioral tests for the servo digital twin + its honest handoff to the
 * simulation-to-real bridge. These prove the full second span end to end:
 * a legit angle goal simulates to a servo-native track that the bridge accepts
 * and the real validator approves; an unsafe/out-of-range goal is BLOCKED by
 * the authoritative rules and therefore yields no proposal at all.
 */
import { simulateServoTrack, SERVO_TWIN_DEVICE_META } from '../../lib/hardware/ServoTwinSimulation';
import { extractServoAngleTrack, SERVO_TWIN_PROFILE_ID } from '../../lib/hardware/ServoTwinAngleTrack';
import { buildTeachManifest, REAL_TEACH_BUILTIN_INTENT_IDS } from '../../lib/hardware/TeachMode';
import { validateActionManifest } from '../../lib/action-manifest/ActionManifest';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }

function testLegitGoalSimulatesAndBridges() {
  const run = simulateServoTrack([30, 90, 0], { actionId: 'twin_demo', displayName: 'Twin demo' });
  assert(run.status === 'completed', 'a legit angle goal must complete');
  // Native 1-DOF track: every command is a scalar servo angle, NO 3D pose.
  assert(run.adapterCommands.length === 3, 'three steps expected');
  assert(run.adapterCommands.every((c) => c.command === 'move_to_angle'), 'all commands must be move_to_angle');
  assert(run.adapterCommands.every((c) => typeof c.target_angle_deg === 'number'), 'each command carries a scalar angle');
  assert(run.adapterCommands.every((c) => c.target_position === undefined), 'a native servo track must carry NO Vec3 pose');
  assert(run.riskLevel !== undefined, 'risk is authoritatively recomputed');

  // Honest handoff: the twin output feeds the bridge, which feeds the real validator.
  const extracted = extractServoAngleTrack({
    deviceProfileId: run.deviceProfileId,
    runStatus: run.status,
    adapterCommands: run.adapterCommands
  });
  assert(extracted.ok === true, 'bridge must accept the servo-twin run');
  assert(JSON.stringify(extracted.angles) === JSON.stringify([30, 90, 0]), 'identity mapping, no remap');
  const checked = validateActionManifest(
    buildTeachManifest('twin_demo', 'Twin demo', extracted.angles),
    SERVO_TWIN_DEVICE_META,
    REAL_TEACH_BUILTIN_INTENT_IDS
  );
  assert(checked.ok === true, 'the real validator must approve the bridged track');
  assert(run.deviceProfileId === SERVO_TWIN_PROFILE_ID, 'twin declares its own profile id to the bridge');
  ok('legit goal -> twin completes -> bridge accepts -> real validator approves');
}

function testOutOfRangeGoalBlockedYieldsNoProposal() {
  const run = simulateServoTrack([200]);
  assert(run.status === 'blocked', 'a 200-degree goal must be blocked by the authoritative value policy, never clamped');
  // And a blocked run carries nothing the bridge could turn into a proposal.
  const extracted = extractServoAngleTrack({
    deviceProfileId: SERVO_TWIN_PROFILE_ID,
    runStatus: run.status,
    adapterCommands: []
  });
  assert(extracted.ok === false && extracted.reason === 'run_not_completed', 'a blocked run yields no executable proposal');
  ok('out-of-range goal -> blocked -> no proposal end to end');
}

function testNegativeAngleBlocked() {
  const run = simulateServoTrack([-5]);
  assert(run.status === 'blocked', 'a negative angle must be blocked');
  ok('negative angle -> blocked');
}

function testSequenceLengthBounds() {
  assert(simulateServoTrack([]).status === 'blocked', 'empty goal must be blocked (schema min 1)');
  assert(simulateServoTrack(new Array(17).fill(10)).status === 'blocked', '17 steps must be blocked (schema max 16)');
  ok('sequence length bounds enforced by authoritative schema');
}

function main() {
  console.log('servo-twin simulation + honest bridge handoff:');
  testLegitGoalSimulatesAndBridges();
  testOutOfRangeGoalBlockedYieldsNoProposal();
  testNegativeAngleBlocked();
  testSequenceLengthBounds();
  console.log(`\nservo-twin: ${passed} assertions passed`);
}

main();
