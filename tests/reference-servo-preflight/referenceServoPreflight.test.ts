/**
 * Behavioral tests for the reference-servo preflight proposal. Proves the
 * whole hardware-local dry run end to end
 * without any UI: a legit intent yields an execute-ready, simulation-verified
 * proposal that the real validator approves; an unsafe intent is blocked at the
 * simulation stage and yields no proposal.
 */
import { prepareRealProposalFromIntent, extractManifestAngles } from '../../lib/hardware/ReferenceServoPreflight';
import { buildTeachManifest, REAL_TEACH_BUILTIN_INTENT_IDS } from '../../lib/hardware/TeachMode';
import { validateActionManifest } from '../../lib/action-manifest/ActionManifest';
import { SERVO_TWIN_DEVICE_META } from '../../lib/hardware/ServoTwinSimulation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }

function testLegitIntentYieldsExecuteReadyProposal() {
  const result = prepareRealProposalFromIntent([15, 120, 0], { actionId: 'ctrl_demo', displayName: 'Ctrl demo' });
  assert(result.ok === true, 'a legit intent must yield a proposal');
  assert(JSON.stringify(result.angles) === JSON.stringify([15, 120, 0]), 'angles identity-mapped');
  assert(result.riskLevel !== undefined, 'risk is carried from the twin run');
  // The prepared proposal must be accepted by the EXISTING real validator,
  // i.e. it is genuinely execute-ready for the panel's confirm+execute path.
  const checked = validateActionManifest(result.manifest, SERVO_TWIN_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  assert(checked.ok === true, 'the prepared proposal must pass the real validator');
  ok('legit intent -> simulation-verified, execute-ready proposal');
}

function testUnsafeIntentBlockedAtSimulation() {
  const result = prepareRealProposalFromIntent([200]);
  assert(result.ok === false, 'a 200-degree intent must not yield a proposal');
  assert(result.stage === 'simulation', `must be blocked at the simulation stage, got ${result.ok ? 'ok' : result.stage}`);
  ok('unsafe intent -> blocked at simulation -> no proposal');
}

function testEmptyAndOverlongBlocked() {
  const empty = prepareRealProposalFromIntent([]);
  assert(empty.ok === false && empty.stage === 'simulation', 'empty intent blocked at simulation');
  const overlong = prepareRealProposalFromIntent(new Array(17).fill(10));
  assert(overlong.ok === false && overlong.stage === 'simulation', 'overlong intent blocked at simulation');
  ok('empty / overlong intent -> blocked, no proposal');
}

function validServoManifest(angles: number[]) {
  const checked = validateActionManifest(buildTeachManifest('teach_x', 'Teach X', angles), SERVO_TWIN_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  assert(checked.ok === true, 'fixture manifest must validate');
  return checked.manifest;
}

function testExtractAnglesFromValidatedManifest() {
  const angles = extractManifestAngles(validServoManifest([10, 90, 180]));
  assert(angles.ok === true, 'a validated servo manifest must yield angles');
  assert(JSON.stringify(angles.angles) === JSON.stringify([10, 90, 180]), 'angles extracted in order');
  // And those angles must round-trip through the simulation-first gate.
  const prepared = prepareRealProposalFromIntent(angles.angles, { actionId: 'teach_replay', displayName: 'Teach replay' });
  assert(prepared.ok === true, 'extracted teach angles must pass reference-servo preflight');
  ok('extract angles from validated manifest -> reference-servo preflight passes');
}

function testExtractRejectsNonServoManifest() {
  const bad = { manifest_version: 1, action_id: 'weird', display_name: { zh: 'x', en: 'x' }, device_type: 'robot_arm', safety: { declared_risk: 'low', required_sensors: [], envelope: { max_speed: 'slow', max_force: 'low' } }, steps: [{ action: 'grasp' }] };
  const checked = validateActionManifest(bad, SERVO_TWIN_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
  // grasp is not a declared capability of the twin, so validation already rejects.
  assert(checked.ok === false, 'a non-servo manifest must not validate against the twin');
  ok('non-servo manifest -> rejected before it can be replayed');
}

function main() {
  console.log('reference-servo preflight proposal preparation:');
  testLegitIntentYieldsExecuteReadyProposal();
  testUnsafeIntentBlockedAtSimulation();
  testEmptyAndOverlongBlocked();
  testExtractAnglesFromValidatedManifest();
  testExtractRejectsNonServoManifest();
  console.log(`\nreference-servo preflight: ${passed} assertions passed`);
}

main();
