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

function timestampMilliseconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[7];
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]!
    || hour > 23
    || minute > 59
    || second > 59
  ) return null;
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || timestampMilliseconds(value) !== null;
}

function isOptionalNullableTimestamp(value: unknown): boolean {
  return value === undefined
    || value === null
    || timestampMilliseconds(value) !== null;
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
        && evidence.expectedRequiredCapabilities.length <= 1_024
        && evidence.expectedRequiredCapabilities.every((item) => typeof item === 'string')
      )
    )
    && (
      evidence.observedAvailableCapabilities === undefined
      || evidence.observedAvailableCapabilities === null
      || (
        Array.isArray(evidence.observedAvailableCapabilities)
        && evidence.observedAvailableCapabilities.length <= 1_024
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
    && !['undefined', 'function', 'symbol', 'bigint'].includes(typeof evidence.proposedAction)
    && ['allowed', 'blocked', 'approval_required', 'failed'].includes(
      evidence.decision ?? ''
    )
    && typeof evidence.decisionReason === 'string'
    && evidence.decisionReason.length > 0
    && Array.isArray(evidence.matchedRuleIds)
    && evidence.matchedRuleIds.length <= 1_024
    && evidence.matchedRuleIds.every((rule) => typeof rule === 'string')
    && isOptionalTimestamp(evidence.stateObservedAt)
    && timestampMilliseconds(evidence.decisionMadeAt) !== null
    && isOptionalTimestamp(evidence.dispatchedAt)
    && typeof evidence.hardwareSignalSent === 'boolean'
    && ['not_sent', 'attempted_unconfirmed'].includes(
      evidence.hardwareSignalState ?? ''
    )
    && typeof evidence.executionEvidence === 'string'
    && evidence.executionEvidence.length > 0
  );
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const MAXIMUM_CANONICAL_DEPTH = 128;
const MAXIMUM_CANONICAL_NODES = 1_000_000;
const MAXIMUM_CANONICAL_ARRAY_ITEMS = 100_000;
const MAXIMUM_CANONICAL_OBJECT_FIELDS = 100_000;
const MAXIMUM_CANONICAL_STRING_CODE_UNITS = 16 * 1024 * 1024;

interface CanonicalBudget {
  nodes: number;
  stringCodeUnits: number;
}

function accountCanonicalString(value: string, budget: CanonicalBudget): void {
  budget.stringCodeUnits += value.length;
  if (budget.stringCodeUnits > MAXIMUM_CANONICAL_STRING_CODE_UNITS) {
    throw new Error('canonical_json_string_budget_exceeded');
  }
}

function canonicalize(
  value: unknown,
  budget: CanonicalBudget,
  depth = 0
): unknown {
  if (depth > MAXIMUM_CANONICAL_DEPTH) {
    throw new Error('canonical_json_depth_exceeded');
  }
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_CANONICAL_NODES) {
    throw new Error('canonical_json_node_budget_exceeded');
  }
  if (
    value === undefined
    || typeof value === 'function'
    || typeof value === 'symbol'
    || typeof value === 'bigint'
  ) {
    throw new Error('canonical_json_rejects_unsupported_value');
  }
  if (Array.isArray(value)) {
    if (value.length > MAXIMUM_CANONICAL_ARRAY_ITEMS) {
      throw new Error('canonical_json_array_budget_exceeded');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error('canonical_json_rejects_unsupported_value');
      }
    }
    return value.map((item) => canonicalize(item, budget, depth + 1));
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('canonical_json_rejects_unsupported_value');
    }
    if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
      throw new Error('canonical_json_rejects_unsupported_value');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      // Match JSON object semantics for optional fields while rejecting the
      // same value in arrays or at the root, where JSON would coerce to null.
      .filter(([, item]) => item !== undefined);
    if (entries.length > MAXIMUM_CANONICAL_OBJECT_FIELDS) {
      throw new Error('canonical_json_object_budget_exceeded');
    }
    if (entries.some(([key]) => !isUnicodeScalarString(key))) {
      throw new Error('canonical_json_rejects_unpaired_surrogate');
    }
    for (const [key] of entries) accountCanonicalString(key, budget);
    return Object.fromEntries(
      entries
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item, budget, depth + 1)])
    );
  }
  if (typeof value === 'string' && !isUnicodeScalarString(value)) {
    throw new Error('canonical_json_rejects_unpaired_surrogate');
  }
  if (typeof value === 'string') accountCanonicalString(value, budget);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical_json_rejects_non_finite_number');
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value, { nodes: 0, stringCodeUnits: 0 }));
  if (typeof encoded !== 'string') {
    throw new Error('canonical_json_rejects_unsupported_value');
  }
  return encoded;
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
    || timestampMilliseconds(bundle.createdAt) === null
    || !Array.isArray(bundle.entries)
    || bundle.entries.length > 10_000
    || (bundle.testReportSha256 !== undefined && !isSha256(bundle.testReportSha256))
  ) {
    return { ok: false, reason: 'bundle_missing_or_malformed' };
  }
  if (bundle.entries.length === 0) {
    return { ok: false, reason: 'bundle_empty' };
  }
  if (
    options.expectedReleaseId !== undefined
    && bundle.releaseId !== options.expectedReleaseId
  ) {
    return { ok: false, reason: 'release_id_mismatch' };
  }
  if (
    options.expectedExecutablePolicyHash !== undefined
    && bundle.executablePolicyHash !== options.expectedExecutablePolicyHash
  ) {
    return { ok: false, reason: 'executable_policy_hash_mismatch' };
  }
  if (options.revokedReleaseIds?.has(bundle.releaseId)) {
    return { ok: false, reason: 'release_revoked' };
  }
  const verificationTime = options.now ?? new Date();
  const verificationTimeMs = verificationTime instanceof Date
    ? verificationTime.getTime()
    : Number.NaN;
  if (!Number.isFinite(verificationTimeMs)) {
    return { ok: false, reason: 'verification_time_invalid' };
  }
  const bundleCreatedAtMs = timestampMilliseconds(bundle.createdAt)!;
  if (bundleCreatedAtMs > verificationTimeMs) {
    return { ok: false, reason: 'bundle_created_at_future' };
  }
  if (options.expiresAt !== undefined) {
    const expirationMs = timestampMilliseconds(options.expiresAt);
    if (expirationMs === null) {
      return { ok: false, reason: 'release_expiry_invalid' };
    }
    if (expirationMs <= verificationTimeMs) {
      return { ok: false, reason: 'release_expired' };
    }
  }

  let previousHash: string | null = null;
  let previousDecisionMadeAtMs: number | null = null;
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
    const signalSent = entry.evidence.hardwareSignalSent;
    const dispatchedAtPresent = entry.evidence.dispatchedAt !== undefined;
    const controllerResultPresent = entry.evidence.controllerResult !== undefined;
    const dispatchedAtMs = timestampMilliseconds(entry.evidence.dispatchedAt);
    const decisionMadeAtMs = timestampMilliseconds(entry.evidence.decisionMadeAt);
    const stateObservedAtMs = entry.evidence.stateObservedAt === undefined
      ? null
      : timestampMilliseconds(entry.evidence.stateObservedAt);
    if (
      signalSent !== (entry.evidence.hardwareSignalState !== 'not_sent')
      || (signalSent && !dispatchedAtPresent)
      || (!signalSent && (dispatchedAtPresent || controllerResultPresent))
      || (
        ['blocked', 'approval_required'].includes(entry.evidence.decision)
        && signalSent
      )
      || (
        dispatchedAtPresent
        && dispatchedAtMs !== null
        && decisionMadeAtMs !== null
        && dispatchedAtMs < decisionMadeAtMs
      )
    ) {
      return { ok: false, reason: `hardware_evidence_inconsistent:${index}` };
    }
    if (
      decisionMadeAtMs === null
      || decisionMadeAtMs > bundleCreatedAtMs
      || decisionMadeAtMs > verificationTimeMs
      || (previousDecisionMadeAtMs !== null && decisionMadeAtMs < previousDecisionMadeAtMs)
      || (stateObservedAtMs !== null && stateObservedAtMs > decisionMadeAtMs)
    ) {
      return { ok: false, reason: `evidence_time_inconsistent:${index}` };
    }
    const { hash, ...body } = entry;
    let observedHash: string;
    try {
      observedHash = sha256(canonicalJson(body));
    } catch {
      return { ok: false, reason: `entry_missing_or_malformed:${index}` };
    }
    if (observedHash !== hash) {
      return { ok: false, reason: `content_hash_mismatch:${index}` };
    }
    previousHash = hash;
    previousDecisionMadeAtMs = decisionMadeAtMs;
  }
  return { ok: true };
}
