/**
 * ReferenceServoPreflightAudit — records the REAL panel's no-signal reference
 * servo preflight. It is not evidence from the generic simulation workspace.
 *
 * INVARIANT (structural honesty): a simulation decision NEVER sends a signal, so
 * every receipt is hardwareSignalSent=false / hardwareSignalState='not_sent'.
 * The real RuntimeAuditLog.decision() enforces the signal-evidence invariant, so
 * a malformed receipt cannot be recorded at all. The receipt is stage 'dry_run'
 * (simulated before execution): a pass is info, a block is warn, and the block's
 * refusing span + reason are preserved verbatim — never softened.
 */
import type { RuntimeAuditLevel, RuntimeAuditStage, RuntimeAuditLog } from '../runtime/RuntimeAuditLog';
import type { HardwareSignalState } from './types';
import type { RealProposalResult } from './ReferenceServoPreflight';

export interface ReferenceServoPreflightDecision {
  stage: RuntimeAuditStage;
  level: RuntimeAuditLevel;
  code: string;
  message: string;
  /** Simulation never sends a signal. */
  hardwareSignalSent: false;
  hardwareSignalState: HardwareSignalState;
  data: Record<string, unknown>;
}

export function buildReferenceServoPreflightDecision(
  result: RealProposalResult,
  context: { intent: string }
): ReferenceServoPreflightDecision {
  const intent = context.intent.trim().slice(0, 80);
  if (result.ok) {
    return {
      stage: 'dry_run',
      level: 'info',
      code: 'reference_servo_preflight_pass',
      message: `reference-servo preflight passed: ${result.angles.length} step(s), risk ${result.riskLevel}`,
      hardwareSignalSent: false,
      hardwareSignalState: 'not_sent',
      data: { intent, angles: result.angles, riskLevel: result.riskLevel, stepCount: result.angles.length }
    };
  }
  return {
    stage: 'dry_run',
    level: 'warn',
    code: 'reference_servo_preflight_blocked',
    message: `reference-servo preflight blocked at ${result.stage}: ${result.reason}`,
    hardwareSignalSent: false,
    hardwareSignalState: 'not_sent',
    data: { intent, blockedStage: result.stage, reason: result.reason }
  };
}

/**
 * Record a reference-servo preflight into the authoritative RuntimeAuditLog.
 * Goes through decision(), which enforces the hardware-signal-evidence invariant.
 */
export function recordReferenceServoPreflightDecision(
  log: RuntimeAuditLog,
  result: RealProposalResult,
  context: { intent: string }
): ReferenceServoPreflightDecision {
  const decision = buildReferenceServoPreflightDecision(result, context);
  log.decision(
    decision.stage,
    decision.level,
    decision.code,
    decision.message,
    decision.hardwareSignalSent,
    decision.hardwareSignalState,
    decision.data
  );
  return decision;
}
