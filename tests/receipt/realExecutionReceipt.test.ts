/**
 * Real-execution receipt mapping tests: REAL outcome evidence must land in
 * the audit log verbatim when consistent, and conservatively (never
 * proven-clean) when missing — then be exportable as a valid receipt.
 */

import { RuntimeAuditLog } from '../../lib/runtime/RuntimeAuditLog';
import { recordRealExecutionOutcome } from '../../lib/hardware/RealExecutionReceipt';
import { buildAuditReceipt, verifyAuditReceipt } from '../../lib/receipt/AuditReceipt';

const assert = require('node:assert/strict');

/* 1. Executed with acknowledged delivery: recorded verbatim. */
{
  const log = new RuntimeAuditLog();
  const code = recordRealExecutionOutcome(log, {
    ok: true,
    status: 'executed',
    executionMode: 'real_hardware',
    signalSent: true,
    signalState: 'device_acknowledged',
    executionEvidence: 'command_acknowledged_open_loop',
    lastAcknowledgedAngle: 45,
    distanceCm: 21.4
  }, { intent: 'move_to_angle:45' });
  assert.equal(code, 'real_executed');
  const entry = log.list()[0];
  assert.equal(entry.level, 'info');
  assert.equal(entry.hardwareSignalSent, true);
  assert.equal(entry.hardwareSignalState, 'device_acknowledged');
  assert.equal(entry.data?.lastAcknowledgedAngle, 45);
  assert(entry.message.includes('move_to_angle:45'));
}

/* 2. Blocked with zero signal: the refusal is a first-class record. */
{
  const log = new RuntimeAuditLog();
  const code = recordRealExecutionOutcome(log, {
    ok: false,
    status: 'blocked',
    reason: 'min_safe_distance: obstacle at 4cm',
    signalSent: false,
    signalState: 'not_sent'
  }, { intent: 'move_to_angle:170' });
  assert.equal(code, 'real_blocked');
  const entry = log.list()[0];
  assert.equal(entry.level, 'warn');
  assert.equal(entry.hardwareSignalSent, false);
  assert.equal(entry.hardwareSignalState, 'not_sent');
  assert(entry.message.includes('min_safe_distance'));
}

/* 3. Missing evidence (bridge threw): conservative, visible, never clean. */
{
  const log = new RuntimeAuditLog();
  const code = recordRealExecutionOutcome(log, {
    ok: false,
    error: 'ipc_bridge_unavailable'
  }, { intent: 'move_to_angle:90' });
  assert.equal(code, 'real_outcome_evidence_missing');
  const entry = log.list()[0];
  assert.equal(entry.level, 'error');
  assert.equal(entry.hardwareSignalSent, true, 'missing evidence must never be recorded as proven-clean');
  assert.equal(entry.hardwareSignalState, 'attempted_unconfirmed');
  assert(entry.message.includes('conservatively'));
}

/* 4. Inconsistent evidence (sent=true but state=not_sent): treated as missing. */
{
  const log = new RuntimeAuditLog();
  const code = recordRealExecutionOutcome(log, {
    ok: true,
    status: 'executed',
    signalSent: true,
    signalState: 'not_sent'
  }, { intent: 'move_to_angle:10' });
  assert.equal(code, 'real_outcome_evidence_missing', 'inconsistent evidence must not be notarized as-is');
}

/* 5. The recorded session exports as a valid, verifiable receipt. */
{
  const log = new RuntimeAuditLog();
  recordRealExecutionOutcome(log, { ok: true, status: 'executed', signalSent: true, signalState: 'device_acknowledged' }, { intent: 'move_to_angle:45' });
  recordRealExecutionOutcome(log, { ok: false, status: 'blocked', reason: 'interlock', signalSent: false, signalState: 'not_sent' }, { intent: 'move_to_angle:180' });
  const receipt = buildAuditReceipt(log.list(), { appVersion: '0.5.1', deviceProfileId: 'esp32_servo_reference_rig' });
  assert.deepEqual(verifyAuditReceipt(receipt), { ok: true });
  assert.equal(receipt.summary.byHardwareSignalState.device_acknowledged, 1);
  assert.equal(receipt.summary.byHardwareSignalState.not_sent, 1);
}

console.log('Real-execution receipt tests passed.');
console.log('- Consistent outcomes recorded verbatim; refusals are first-class.');
console.log('- Missing/inconsistent evidence recorded conservatively, never as proven-clean.');
console.log('- Recorded sessions export as verifiable receipts.');
