/**
 * Behavioral tests for the reference-servo preflight formatter: a pass shows
 * the angle track + recomputed risk; a blocked run shows the refusing span and
 * reason, and never claims ok.
 */
import { formatReferenceServoPreflight } from '../../lib/hardware/ReferenceServoPreflightView';
import { prepareRealProposalFromIntent } from '../../lib/hardware/ReferenceServoPreflight';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }

function testPassingRunFormatsTrackAndRisk() {
  const result = prepareRealProposalFromIntent([45, 90, 0]);
  assert(result.ok === true, 'precondition: legit intent');
  const view = formatReferenceServoPreflight(result, false);
  assert(view.ok === true, 'view must be ok');
  assert(view.headline.includes('3 step'), `headline states step count: ${view.headline}`);
  assert(view.headline.toLowerCase().includes('risk'), 'headline states risk');
  assert(view.detail.includes('45') && view.detail.includes('→'), `detail shows the track: ${view.detail}`);
  ok('passing run -> track + risk shown');
}

function testBlockedRunFormatsStageAndReason() {
  const result = prepareRealProposalFromIntent([200]);
  assert(result.ok === false, 'precondition: blocked intent');
  const view = formatReferenceServoPreflight(result, false);
  assert(view.ok === false, 'view must not claim ok for a blocked run');
  assert(view.headline.toLowerCase().includes('blocked'), `headline states blocked: ${view.headline}`);
  assert(view.headline.includes('simulation'), 'headline names the refusing span');
  assert(view.detail.length > 0, 'detail carries the reason');
  ok('blocked run -> stage + reason shown, never ok');
}

function testBilingual() {
  const blocked = prepareRealProposalFromIntent([200]);
  const zh = formatReferenceServoPreflight(blocked, true);
  assert(zh.ok === false && zh.headline.includes('拦截'), 'zh block headline present');
  ok('bilingual output');
}

function main() {
  console.log('reference-servo preflight formatter:');
  testPassingRunFormatsTrackAndRisk();
  testBlockedRunFormatsStageAndReason();
  testBilingual();
  console.log(`\nreference-servo preflight view: ${passed} assertions passed`);
}
main();
