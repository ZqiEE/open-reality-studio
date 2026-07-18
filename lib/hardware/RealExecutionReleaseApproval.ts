/**
 * Version-bound release approval for the one reviewed REAL execution profile.
 *
 * This is deliberately stricter than counting files. A release may enable
 * REAL execution only when the exact owner-reviewed four-scenario evidence is
 * present, byte-for-byte, and still carries the expected fail-closed semantics.
 * The runtime safety gate and per-run operator confirmation remain mandatory;
 * this approval grants no ticket and sends no hardware signal.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REAL_EXECUTION_RELEASE_APPROVAL = Object.freeze({
  approvalId: 'rw-0.5.1-esp32-s3-reference-rig-2026-07-16',
  appVersion: '0.5.1',
  profileId: 'esp32_s3_sg90_hc_sr04_v1',
  evidence: Object.freeze([
    Object.freeze({ scenario: 1, file: '2026-07-16-scenario-1.json', sha256: '69f70a931f067ad19aa539c9c9b9077d760c98e50fb05c3635f39a8cbd0b348f' }),
    Object.freeze({ scenario: 2, file: '2026-07-16-scenario-2.json', sha256: 'df3e7b20ec0df56de51711c94f8a2039d734641b1c8ec92fcae1ebecbf1f36c8' }),
    Object.freeze({ scenario: 3, file: '2026-07-16-scenario-3.json', sha256: '54c48ced63b113d9a340dd61c00afbb4e6d2dbba5923f3e627a519632a6c312e' }),
    Object.freeze({ scenario: 4, file: '2026-07-16-scenario-4.json', sha256: '632d00fd9692cfd5c7cacb40a382a09002e9f64faddb92d31de8694a0e265bcb' })
  ])
});

export type RealExecutionReleaseApprovalResult =
  | { approved: true; approvalId: string; profileId: string; evidenceCount: 4 }
  | { approved: false; evidenceCount: number; reason: string };

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function auditSemanticsMatch(raw: unknown, scenario: number): boolean {
  const evidence = record(raw);
  if (!evidence || evidence.schema !== 'realitywarden.acceptance-evidence' || evidence.schema_version !== 1 || evidence.scenario !== scenario) return false;
  const operator = record(evidence.operator_confirmed);
  const audit = Array.isArray(evidence.audit) && evidence.audit.length === 1 ? record(evidence.audit[0]) : null;
  const data = record(audit?.data);
  const args = record(data?.args);
  if (!operator || !audit || !data || data.executionMode !== 'real_hardware') return false;

  if (scenario === 1) {
    return operator.servo_moved === true
      && audit.code === 'hardware_command_executed'
      && audit.hardwareSignalSent === true
      && audit.hardwareSignalState === 'device_acknowledged'
      && data.executionEvidence === 'command_acknowledged_open_loop'
      && data.physicalOutcomeVerified === false
      && args?.angle === 45;
  }

  const reason = typeof data.reason === 'string' ? data.reason : '';
  const expectedReason = scenario === 2 ? 'angle_out_of_range:' : scenario === 3 ? 'min_safe_distance_violation:' : 'sensor_missing:';
  const expectedAngle = scenario === 2 ? 200 : 45;
  return operator.servo_stayed_still === true
    && audit.code === 'hardware_command_blocked'
    && audit.hardwareSignalSent === false
    && audit.hardwareSignalState === 'not_sent'
    && reason.startsWith(expectedReason)
    && args?.angle === expectedAngle;
}

export function verifyRealExecutionReleaseApproval(input: {
  appVersion: string;
  evidenceDir: string;
}): RealExecutionReleaseApprovalResult {
  if (input.appVersion !== REAL_EXECUTION_RELEASE_APPROVAL.appVersion) {
    return { approved: false, evidenceCount: 0, reason: `release_version_not_approved:${input.appVersion}` };
  }

  let evidenceCount = 0;
  for (const expected of REAL_EXECUTION_RELEASE_APPROVAL.evidence) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(input.evidenceDir, expected.file));
    } catch {
      return { approved: false, evidenceCount, reason: `approved_evidence_missing:${expected.file}` };
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expected.sha256) {
      return { approved: false, evidenceCount, reason: `approved_evidence_digest_mismatch:${expected.file}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { approved: false, evidenceCount, reason: `approved_evidence_invalid_json:${expected.file}` };
    }
    if (!auditSemanticsMatch(parsed, expected.scenario)) {
      return { approved: false, evidenceCount, reason: `approved_evidence_semantics_mismatch:${expected.file}` };
    }
    evidenceCount += 1;
  }

  return {
    approved: true,
    approvalId: REAL_EXECUTION_RELEASE_APPROVAL.approvalId,
    profileId: REAL_EXECUTION_RELEASE_APPROVAL.profileId,
    evidenceCount: 4
  };
}
