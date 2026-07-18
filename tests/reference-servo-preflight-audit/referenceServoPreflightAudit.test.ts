/**
 * Behavioral tests for reference-servo preflight receipts: pass and block both
 * produce hardwareSignalSent=false receipts that the REAL RuntimeAuditLog
 * accepts (its signal-evidence invariant would throw on a malformed one) and
 * that appear in the exported JSON.
 */
import { buildReferenceServoPreflightDecision, recordReferenceServoPreflightDecision } from '../../lib/hardware/ReferenceServoPreflightAudit';
import { prepareRealProposalFromIntent } from '../../lib/hardware/ReferenceServoPreflight';
import { RuntimeAuditLog } from '../../lib/runtime/RuntimeAuditLog';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
let passed = 0;
function ok(name: string) { passed += 1; console.log(`  ok  ${name}`); }

function testPassReceipt() {
  const result = prepareRealProposalFromIntent([45, 0]);
  assert(result.ok === true, 'precondition');
  const d = buildReferenceServoPreflightDecision(result, { intent: 'turn to 45 then zero' });
  assert(d.code === 'reference_servo_preflight_pass', 'pass code');
  assert(d.level === 'info' && d.stage === 'dry_run', 'pass level/stage');
  assert(d.hardwareSignalSent === false && d.hardwareSignalState === 'not_sent', 'no signal sent on a simulation receipt');
  assert(Array.isArray(d.data.angles), 'pass data carries the track');
  ok('pass -> reference_servo_preflight_pass receipt, no signal');
}

function testBlockReceipt() {
  const result = prepareRealProposalFromIntent([200]);
  assert(result.ok === false, 'precondition');
  const d = buildReferenceServoPreflightDecision(result, { intent: 'turn to 200' });
  assert(d.code === 'reference_servo_preflight_blocked', 'block code');
  assert(d.level === 'warn', 'block level');
  assert(d.hardwareSignalSent === false && d.hardwareSignalState === 'not_sent', 'no signal sent even on a block');
  assert(String(d.data.reason).length > 0, 'block reason preserved');
  ok('block -> reference_servo_preflight_blocked receipt, reason preserved');
}

function testRecordsIntoRealAuditLogAndExports() {
  const log = new RuntimeAuditLog();
  const blocked = prepareRealProposalFromIntent([200]);
  const passed_ = prepareRealProposalFromIntent([30]);
  // If the receipt violated the signal-evidence invariant, decision() -> createEntry would THROW.
  recordReferenceServoPreflightDecision(log, blocked, { intent: '200' });
  recordReferenceServoPreflightDecision(log, passed_, { intent: '30' });
  const entries = log.list();
  assert(entries.length === 2, 'both receipts recorded by the authoritative log');
  assert(entries.every((e) => e.hardwareSignalSent === false), 'every recorded receipt proves no signal left the host');
  const json = log.exportJson();
  assert(json.includes('reference_servo_preflight_blocked') && json.includes('reference_servo_preflight_pass'), 'receipts appear in the exported audit JSON');
  ok('receipts accepted by the real audit log and present in exportJson');
}

function main() {
  console.log('reference-servo preflight receipts:');
  testPassReceipt();
  testBlockReceipt();
  testRecordsIntoRealAuditLogAndExports();
  console.log(`\nreference-servo preflight audit: ${passed} assertions passed`);
}
main();
