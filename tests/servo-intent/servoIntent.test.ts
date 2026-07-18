/**
 * Behavioral tests for the deterministic broader NL understanding. It widens
 * what is understood (named positions, sequences, bilingual) WITHOUT guessing:
 * unknown phrasing rejects the whole command; explicit out-of-range angles pass
 * through to be rejected downstream (never clamped here).
 */
import { parseServoIntent } from '../../lib/hardware/ServoIntentParser';
import { prepareRealProposalFromIntent } from '../../lib/hardware/ReferenceServoPreflight';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }
function angles(text: string): number[] { const r = parseServoIntent(text); assert(r.ok, `expected ok for "${text}": ${r.ok ? '' : r.detail}`); return r.angles; }

function testNamedPositions() {
  assert(JSON.stringify(angles('left')) === '[0]', 'left = 0');
  assert(JSON.stringify(angles('center')) === '[90]', 'center = 90');
  assert(JSON.stringify(angles('point right')) === '[180]', 'point right = 180');
  assert(JSON.stringify(angles('go home')) === '[0]', 'home = 0');
  assert(JSON.stringify(angles('偏右')) === '[135]', '偏右 = 135');
  ok('named positions (en + zh)');
}

function testSequences() {
  assert(JSON.stringify(angles('left then center then right')) === '[0,90,180]', 'en sequence');
  assert(JSON.stringify(angles('转到左边，再归零')) === '[0,0]', 'zh sequence with connectors');
  assert(JSON.stringify(angles('go to 45 degrees then center')) === '[45,90]', 'mixed explicit + named');
  ok('multi-step sequences, bilingual, mixed');
}

function testUnknownРhrasingRejectedWhole() {
  const r = parseServoIntent('wave around and dance');
  assert(r.ok === false, 'unknown phrasing must reject');
  assert(r.detail.includes('unrecognized') || r.detail.includes('rejected'), 'honest rejection detail');
  // Partial-known must ALSO reject the whole thing, never run the known part.
  const r2 = parseServoIntent('left then wiggle');
  assert(r2.ok === false, 'a partially-unknown sequence rejects entirely, never partially runs');
  ok('unknown / partially-unknown -> whole command rejected, never guessed');
}

function testExplicitOutOfRangePassesThroughNotClamped() {
  const r = parseServoIntent('turn to 200');
  assert(r.ok === true && JSON.stringify(r.angles) === '[200]', 'explicit 200 passes through unclamped (downstream rejects it)');
  ok('out-of-range explicit angle passes through, not clamped here');
}

function testStepLimit() {
  const many = new Array(17).fill('center').join(' then ');
  const r = parseServoIntent(many);
  assert(r.ok === false && r.detail.includes('limit'), '17 steps exceed the governed limit');
  ok('governed step limit enforced');
}

function testBroadUnderstandingStillGatedBySafety() {
  // Understood perfectly, but out of range: blocked at simulation, never executed.
  const understood = parseServoIntent('turn to 200');
  assert(understood.ok === true && understood.angles[0] === 200, 'precondition: understood as 200');
  const gated = prepareRealProposalFromIntent(understood.angles);
  assert(gated.ok === false && gated.stage === 'simulation', 'understood-but-unsafe is blocked by the reference-servo preflight, not executed');

  // An adversarial proposer bypassing the parser (oversized track) is also blocked.
  const adversarial = prepareRealProposalFromIntent(new Array(20).fill(90));
  assert(adversarial.ok === false, 'oversized adversarial proposal is blocked, no matter how it was produced');

  // A safe understood sequence DOES pass the gate (understanding is not crippled).
  const safe = prepareRealProposalFromIntent(parseServoIntent('left then center then right').ok ? [0, 90, 180] : []);
  assert(safe.ok === true, 'a safe understood sequence still passes the full chain');
  ok('broad understanding is uniformly gated: unsafe blocked, safe allowed');
}

function main() {
  console.log('servo-intent deterministic understanding:');
  testNamedPositions();
  testSequences();
  testUnknownРhrasingRejectedWhole();
  testExplicitOutOfRangePassesThroughNotClamped();
  testStepLimit();
  testBroadUnderstandingStillGatedBySafety();
  console.log(`\nservo-intent: ${passed} assertions passed`);
}
main();
