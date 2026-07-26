import type { ExecutablePolicySpec } from '../exec-spec';
import { executablePolicyHash } from '../exec-spec';
import type { ExecutionEvidence } from '../evidence';

export type ReleaseState =
  | 'draft'
  | 'tested'
  | 'approved'
  | 'shadow'
  | 'canary'
  | 'released'
  | 'revoked';

const transitions: Readonly<Record<ReleaseState, readonly ReleaseState[]>> = {
  draft: ['tested', 'revoked'],
  tested: ['approved', 'revoked'],
  approved: ['shadow', 'revoked'],
  shadow: ['canary', 'revoked'],
  canary: ['released', 'revoked'],
  released: ['revoked'],
  revoked: []
};

export interface ReleaseRecord {
  releaseId: string;
  state: ReleaseState;
  executablePolicyHash: string;
  approvedIdentityHash?: string;
  approvedBy?: string;
  approvedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface ReleaseTransition {
  releaseId: string;
  from: ReleaseState;
  to: ReleaseState;
  actor: string;
  occurredAt: string;
  reason: string;
  executablePolicyHash: string;
}

export function transitionRelease(
  record: ReleaseRecord,
  to: ReleaseState,
  context: {
    actor: string;
    occurredAt: string;
    reason: string;
    spec: ExecutablePolicySpec;
    evidence: ExecutionEvidence[];
  }
): { record: ReleaseRecord; transition: ReleaseTransition } {
  if (!transitions[record.state].includes(to)) {
    throw new Error(`invalid_release_transition:${record.state}->${to}`);
  }
  const currentHash = executablePolicyHash(context.spec);
  if (record.executablePolicyHash !== currentHash) {
    throw new Error('release_identity_changed_reapproval_required');
  }
  if (to === 'approved') {
    if (!context.actor || context.evidence.length === 0) {
      throw new Error('approval_requires_identity_and_evidence');
    }
  }
  const next: ReleaseRecord = {
    ...record,
    state: to,
    approvedBy: to === 'approved' ? context.actor : record.approvedBy,
    approvedAt: to === 'approved' ? context.occurredAt : record.approvedAt,
    approvedIdentityHash: to === 'approved' ? currentHash : record.approvedIdentityHash,
    revokedAt: to === 'revoked' ? context.occurredAt : record.revokedAt,
    revokedReason: to === 'revoked' ? context.reason : record.revokedReason
  };
  return {
    record: next,
    transition: {
      releaseId: record.releaseId,
      from: record.state,
      to,
      actor: context.actor,
      occurredAt: context.occurredAt,
      reason: context.reason,
      executablePolicyHash: currentHash
    }
  };
}

export function executionEligibility(
  spec: ExecutablePolicySpec,
  record: ReleaseRecord,
  deviceId: string,
  now: Date = new Date()
): { allowed: true } | { allowed: false; reason: string } {
  if (record.releaseId !== spec.metadata.releaseId) {
    return { allowed: false, reason: 'release_id_mismatch' };
  }
  if (record.state === 'revoked' || spec.evidence.status === 'revoked') {
    return { allowed: false, reason: 'release_revoked' };
  }
  if (!['canary', 'released'].includes(record.state)) {
    return { allowed: false, reason: `release_state_${record.state}_cannot_dispatch` };
  }
  if (record.executablePolicyHash !== executablePolicyHash(spec)) {
    return { allowed: false, reason: 'release_identity_changed_reapproval_required' };
  }
  if (record.approvedIdentityHash !== record.executablePolicyHash) {
    return { allowed: false, reason: 'release_approval_identity_mismatch' };
  }
  if (spec.evidence.status !== 'approved') {
    return { allowed: false, reason: 'release_not_approved' };
  }
  if (spec.deployment.mode !== record.state) {
    return { allowed: false, reason: 'release_deployment_mode_mismatch' };
  }
  if (Date.parse(spec.deployment.expiresAt) <= now.getTime()) {
    return { allowed: false, reason: 'release_expired' };
  }
  if (!spec.deployment.allowedDeviceIds.includes(deviceId)) {
    return { allowed: false, reason: 'device_not_allowed' };
  }
  return { allowed: true };
}
