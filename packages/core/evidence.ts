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
  expectedConfigurationDigest?: string | null;
  observedConfigurationDigest?: string | null;
  expectedConfigurationSchemaVersion?: 1 | 2 | null;
  observedConfigurationSchemaVersion?: 1 | 2 | null;
  attestationSourceIdentity?: string | null;
  attestationObservedAt?: string | null;
  expectedRequiredCapabilities?: string[];
  observedAvailableCapabilities?: string[] | null;
  runtimeAttestationDigest?: string | null;
  runtimeContinuityTokenHash?: string | null;
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
  /** Exact adapter/controller response; absence means no terminal result was observed. */
  controllerResult?: unknown;
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

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isOptionalNullableHash(value: unknown): boolean {
  return value === undefined || value === null || isSha256(value);
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isOptionalNullableTimestamp(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isExecutionEvidence(value: unknown): value is ExecutionEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<ExecutionEvidence>;
  return (
    typeof evidence.releaseId === 'string'
    && evidence.releaseId.length > 0
    && isSha256(evidence.executablePolicyHash)
    && isSha256(evidence.modelHash)
    && isSha256(evidence.actionContractHash)
    && isSha256(evidence.robotProfileHash)
    && isSha256(evidence.controllerProfileHash)
    && isOptionalNullableHash(evidence.expectedConfigurationDigest)
    && isOptionalNullableHash(evidence.observedConfigurationDigest)
    && (
      evidence.expectedConfigurationSchemaVersion === undefined
      || evidence.expectedConfigurationSchemaVersion === null
      || evidence.expectedConfigurationSchemaVersion === 1
      || evidence.expectedConfigurationSchemaVersion === 2
    )
    && (
      evidence.observedConfigurationSchemaVersion === undefined
      || evidence.observedConfigurationSchemaVersion === null
      || evidence.observedConfigurationSchemaVersion === 1
      || evidence.observedConfigurationSchemaVersion === 2
    )
    && isOptionalNullableString(evidence.attestationSourceIdentity)
    && isOptionalNullableTimestamp(evidence.attestationObservedAt)
    && (
      evidence.expectedRequiredCapabilities === undefined
      || (
        Array.isArray(evidence.expectedRequiredCapabilities)
        && evidence.expectedRequiredCapabilities.every((item) => typeof item === 'string')
      )
    )
    && (
      evidence.observedAvailableCapabilities === undefined
      || evidence.observedAvailableCapabilities === null
      || (
        Array.isArray(evidence.observedAvailableCapabilities)
        && evidence.observedAvailableCapabilities.every((item) => typeof item === 'string')
      )
    )
    && isOptionalNullableHash(evidence.runtimeAttestationDigest)
    && isOptionalNullableHash(evidence.runtimeContinuityTokenHash)
    && isSha256(evidence.runtimePolicyHash)
    && typeof evidence.deviceId === 'string'
    && evidence.deviceId.length > 0
    && typeof evidence.proposalId === 'string'
    && evidence.proposalId.length > 0
    && Object.prototype.hasOwnProperty.call(evidence, 'proposedAction')
    && ['allowed', 'blocked', 'approval_required', 'failed'].includes(
      evidence.decision ?? ''
    )
    && typeof evidence.decisionReason === 'string'
    && evidence.decisionReason.length > 0
    && Array.isArray(evidence.matchedRuleIds)
    && evidence.matchedRuleIds.every((rule) => typeof rule === 'string')
    && isOptionalTimestamp(evidence.stateObservedAt)
    && typeof evidence.decisionMadeAt === 'string'
    && Number.isFinite(Date.parse(evidence.decisionMadeAt))
    && isOptionalTimestamp(evidence.dispatchedAt)
    && typeof evidence.hardwareSignalSent === 'boolean'
    && ['not_sent', 'attempted_unconfirmed'].includes(
      evidence.hardwareSignalState ?? ''
    )
    && typeof evidence.executionEvidence === 'string'
    && evidence.executionEvidence.length > 0
  );
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
    || bundle.releaseId.length === 0
    || !isSha256(bundle.executablePolicyHash)
    || typeof bundle.createdAt !== 'string'
    || !Number.isFinite(Date.parse(bundle.createdAt))
    || !Array.isArray(bundle.entries)
    || (bundle.testReportSha256 !== undefined && !isSha256(bundle.testReportSha256))
  ) {
    return { ok: false, reason: 'bundle_missing_or_malformed' };
  }
  if (bundle.entries.length === 0) {
    return { ok: false, reason: 'bundle_empty' };
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
    if (
      !entry
      || typeof entry !== 'object'
      || !Number.isInteger(entry.sequence)
      || (entry.previousHash !== null && !isSha256(entry.previousHash))
      || !isSha256(entry.hash)
      || !isExecutionEvidence(entry.evidence)
    ) {
      return { ok: false, reason: `entry_missing_or_malformed:${index}` };
    }
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
