import { createHash } from 'node:crypto';

type ExecutionEvidenceDecision =
  | 'allowed'
  | 'blocked'
  | 'approval_required'
  | 'failed';

export interface ExecutionEvidence {
  releaseId: string;
  executablePolicyHash: string;
  modelHash: string;
  actionContractHash: string;
  robotProfileHash: string;
  controllerProfileHash: string;
  runtimePolicyHash: string;
  deviceId: string;
  proposalId: string;
  proposedAction: unknown;
  decision: ExecutionEvidenceDecision;
  decisionReason: string;
  matchedRuleIds: string[];
  stateObservedAt?: string;
  decisionMadeAt: string;
  dispatchedAt?: string;
  hardwareSignalSent: boolean;
  hardwareSignalState: string;
  executionEvidence: string;
}

export interface ChainedEvidence {
  sequence: number;
  previousHash: string | null;
  evidence: ExecutionEvidence;
  hash: string;
}

export interface EvidenceBundle {
  apiVersion: 'realitywarden.io/v1alpha1';
  kind: 'EvidenceBundle';
  releaseId: string;
  executablePolicyHash: string;
  createdAt: string;
  entries: ChainedEvidence[];
  testReportSha256?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical_json_rejects_non_finite_number');
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function appendEvidence(
  entries: readonly ChainedEvidence[],
  evidence: ExecutionEvidence
): ChainedEvidence {
  const previousHash = entries.length === 0 ? null : entries[entries.length - 1].hash;
  const body = {
    sequence: entries.length,
    previousHash,
    evidence
  };
  return { ...body, hash: sha256(canonicalJson(body)) };
}

export function verifyEvidenceBundle(
  bundle: EvidenceBundle,
  options: {
    expectedReleaseId?: string;
    expectedExecutablePolicyHash?: string;
    revokedReleaseIds?: ReadonlySet<string>;
    expiresAt?: string;
    now?: Date;
  } = {}
): { ok: true } | { ok: false; reason: string } {
  if (
    bundle?.apiVersion !== 'realitywarden.io/v1alpha1'
    || bundle.kind !== 'EvidenceBundle'
    || typeof bundle.releaseId !== 'string'
    || !/^[a-f0-9]{64}$/.test(bundle.executablePolicyHash)
    || !Array.isArray(bundle.entries)
  ) {
    return { ok: false, reason: 'bundle_missing_or_malformed' };
  }
  if (bundle.releaseId !== options.expectedReleaseId && options.expectedReleaseId) {
    return { ok: false, reason: 'release_id_mismatch' };
  }
  if (
    bundle.executablePolicyHash !== options.expectedExecutablePolicyHash
    && options.expectedExecutablePolicyHash
  ) {
    return { ok: false, reason: 'executable_policy_hash_mismatch' };
  }
  if (options.revokedReleaseIds?.has(bundle.releaseId)) {
    return { ok: false, reason: 'release_revoked' };
  }
  if (options.expiresAt && Date.parse(options.expiresAt) <= (options.now ?? new Date()).getTime()) {
    return { ok: false, reason: 'release_expired' };
  }

  let previousHash: string | null = null;
  for (let index = 0; index < bundle.entries.length; index += 1) {
    const entry = bundle.entries[index];
    if (entry.sequence !== index || entry.previousHash !== previousHash) {
      return { ok: false, reason: `chain_link_invalid:${index}` };
    }
    if (
      entry.evidence.releaseId !== bundle.releaseId
      || entry.evidence.executablePolicyHash !== bundle.executablePolicyHash
    ) {
      return { ok: false, reason: `entry_identity_mismatch:${index}` };
    }
    if (entry.evidence.hardwareSignalSent !== (entry.evidence.hardwareSignalState !== 'not_sent')) {
      return { ok: false, reason: `hardware_evidence_inconsistent:${index}` };
    }
    const { hash, ...body } = entry;
    if (sha256(canonicalJson(body)) !== hash) {
      return { ok: false, reason: `content_hash_mismatch:${index}` };
    }
    previousHash = hash;
  }
  return { ok: true };
}
