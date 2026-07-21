/**
 * Real-execution receipt recording — maps a REAL hardware execution outcome
 * (as returned by the main-process gate chain over IPC) into the runtime
 * audit log, so the operator can export an evidence-grade receipt of the
 * session (docs/POSITIONING.md: every action gated, refusable, receipted).
 *
 * Honesty rules (invariant 4):
 * - When the outcome carries explicit, internally consistent delivery
 *   evidence (signalSent + signalState), it is recorded verbatim.
 * - When evidence is missing or inconsistent (e.g. the IPC bridge threw
 *   before the gate could report), we NEVER claim "no signal left the host"
 *   — that claim requires proof. The conservative, honest record is
 *   signalSent=true with state `attempted_unconfirmed` (per the documented
 *   RuntimeAuditLog semantics: false PROVES no signal; true is the
 *   conservative cover), under an explicit `real_outcome_evidence_missing`
 *   code so the gap itself is visible in the receipt.
 *
 * This module never touches the transport. It only records.
 */

import { RuntimeAuditLog } from '../runtime/RuntimeAuditLog';
import type { HardwareSignalState } from './types';

/** Structural subset of the renderer-side execution outcome. */
export interface RealExecutionOutcomeEvidence {
  ok: boolean;
  status?: 'executed' | 'failed' | 'blocked';
  reason?: string;
  error?: string;
  executionMode?: string;
  signalSent?: boolean;
  signalState?: HardwareSignalState;
  executionEvidence?: string;
  detail?: string;
  distanceCm?: number;
  completedSteps?: number;
  attemptedSteps?: number;
  lastAcknowledgedAngle?: number;
}

export interface RealExecutionContext {
  /** What the operator asked for, e.g. `move_to_angle:45` or `replay:pick_place`. */
  intent: string;
}

function outcomeData(
  outcome: RealExecutionOutcomeEvidence,
  context: RealExecutionContext
): Record<string, unknown> {
  const data: Record<string, unknown> = { intent: context.intent };
  if (outcome.executionMode !== undefined) data.executionMode = outcome.executionMode;
  if (outcome.executionEvidence !== undefined) data.executionEvidence = outcome.executionEvidence;
  if (outcome.reason !== undefined) data.reason = outcome.reason;
  if (outcome.error !== undefined) data.error = outcome.error;
  if (outcome.detail !== undefined) data.detail = outcome.detail;
  if (outcome.distanceCm !== undefined) data.distanceCm = outcome.distanceCm;
  if (outcome.completedSteps !== undefined) data.completedSteps = outcome.completedSteps;
  if (outcome.attemptedSteps !== undefined) data.attemptedSteps = outcome.attemptedSteps;
  if (outcome.lastAcknowledgedAngle !== undefined) data.lastAcknowledgedAngle = outcome.lastAcknowledgedAngle;
  return data;
}

/**
 * Record one REAL execution outcome into the audit log. Returns the code that
 * was recorded (useful for tests and UI messaging).
 */
export function recordRealExecutionOutcome(
  log: RuntimeAuditLog,
  outcome: RealExecutionOutcomeEvidence,
  context: RealExecutionContext
): string {
  const hasConsistentEvidence =
    typeof outcome.signalSent === 'boolean' &&
    (outcome.signalState === 'not_sent' ||
      outcome.signalState === 'attempted_unconfirmed' ||
      outcome.signalState === 'device_acknowledged') &&
    outcome.signalSent === (outcome.signalState !== 'not_sent');

  if (hasConsistentEvidence) {
    const status = outcome.status ?? (outcome.ok ? 'executed' : 'failed');
    const level = status === 'executed' ? 'info' : status === 'blocked' ? 'warn' : 'error';
    const code = status === 'executed' ? 'real_executed' : status === 'blocked' ? 'real_blocked' : 'real_failed';
    const summary = outcome.reason ?? outcome.error ?? outcome.detail ?? status;
    log.decision(
      'hardware',
      level,
      code,
      `[${outcome.executionMode ?? 'real_hardware'}] ${context.intent} -> ${status}: ${summary}`,
      outcome.signalSent as boolean,
      outcome.signalState as HardwareSignalState,
      outcomeData(outcome, context)
    );
    return code;
  }

  // Missing or inconsistent delivery evidence. Refuse to fabricate a clean
  // "not_sent": record the gap conservatively and visibly.
  log.decision(
    'hardware',
    'error',
    'real_outcome_evidence_missing',
    `[real_hardware] ${context.intent} -> outcome carried no consistent delivery evidence ` +
      `(${outcome.error ?? outcome.reason ?? outcome.detail ?? 'no detail'}); ` +
      'delivery is conservatively treated as attempted/unconfirmed, never as proven-clean.',
    true,
    'attempted_unconfirmed',
    outcomeData(outcome, context)
  );
  return 'real_outcome_evidence_missing';
}
