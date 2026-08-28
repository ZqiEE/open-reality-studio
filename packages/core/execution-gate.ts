import { performance } from 'node:perf_hooks';
import type { ExecutablePolicySpec } from './exec-spec';
import { executablePolicyHash } from './exec-spec';
import { canonicalJson, sha256, type ExecutionEvidence } from './evidence';
import type { ReleaseRecord } from './release-policy';
import { executionEligibility } from './release-policy';
import {
  configurationDigest,
  evaluateConfigurationBinding,
  type ExecutionConfiguration
} from './execution-configuration';
import {
  continuityTokenHash,
  evaluateRuntimeAttestation,
  runtimeAttestationDigest,
  runtimeAttestationSchema,
  type RuntimeAttestation
} from './runtime-attestation';

declare const permitBrand: unique symbol;

/** Opaque type only. No permit value or constructor is exported. */
interface ExecutionPermit {
  readonly [permitBrand]: true;
}

export interface ExecutionRequest<TAction, TState> {
  release: ExecutablePolicySpec;
  releaseRecord: ReleaseRecord;
  deviceId: string;
  proposalId: string;
  action: TAction;
  actionHash: string;
  state?: TState;
  stateObservedAt?: string;
  /** Deployment-local controller identity; defaults to the controller profile hash. */
  controllerIdentity?: string;
  executionConfiguration?: ExecutionConfiguration;
  runtimeAttestation?: RuntimeAttestation;
  now?: Date;
}

interface AuthorizedExecutionRequest<TAction, TState>
  extends ExecutionRequest<TAction, TState> {
  permit: ExecutionPermit;
}

type ExecutionDecision<TAction, TState> =
  | {
      status: 'allowed';
      reason: string;
      authorizedRequest: AuthorizedExecutionRequest<TAction, TState>;
    }
  | {
      status: 'blocked' | 'approval_required';
      reason: string;
    };

export interface EvidenceSink {
  append(evidence: ExecutionEvidence): void | Promise<void>;
  /** Fail closed before a Run dispatch when durable Evidence cannot accept it. */
  assertWritableBeforeDispatch?(): void | Promise<void>;
}

interface ActionDispatcher<TAction, TResult> {
  dispatch(action: TAction, permit: ExecutionPermit): Promise<TResult>;
}

export type ActionPolicy<TAction, TState> = (
  action: TAction,
  state: TState
) => Promise<{ allowed: boolean; reason: string; matchedRuleIds: string[] }>;

function attestationMaxAgeMs(release: ExecutablePolicySpec): number {
  return release.runtimePolicy.maxAttestationAgeMs
    ?? release.runtimePolicy.maxStateAgeMs;
}

function snapshotNow(now: Date | undefined): Date {
  return new Date((now ?? new Date()).getTime());
}

function monotonicProjectedNow(
  authorizedAt: number,
  issuedAtMonotonic: number,
  currentMonotonic: number,
  suppliedNowMs?: number
): Date | null {
  if (
    !Number.isFinite(authorizedAt)
    || !Number.isFinite(issuedAtMonotonic)
    || !Number.isFinite(currentMonotonic)
    || currentMonotonic < issuedAtMonotonic
  ) return null;
  const projected = authorizedAt + Math.floor(currentMonotonic - issuedAtMonotonic);
  const wallClock = suppliedNowMs ?? Date.now();
  const effective = Math.max(projected, wallClock);
  const now = new Date(effective);
  return Number.isFinite(effective) && Number.isFinite(now.getTime()) ? now : null;
}

function attestationEvidence(
  release: ExecutablePolicySpec,
  attestation: RuntimeAttestation | undefined
): Partial<Pick<ExecutionEvidence,
  | 'attestationSourceIdentity'
  | 'attestationObservedAt'
  | 'expectedRequiredCapabilities'
  | 'observedAvailableCapabilities'
  | 'runtimeAttestationDigest'
  | 'runtimeContinuityTokenHash'>> {
  const required = release.runtimePolicy.requiredCapabilities ?? [];
  if (required.length === 0) return {};
  const parsed = attestation
    ? runtimeAttestationSchema.safeParse(attestation)
    : null;
  return {
    attestationSourceIdentity: parsed?.success ? parsed.data.source.identity : null,
    attestationObservedAt: parsed?.success ? parsed.data.observedAt : null,
    expectedRequiredCapabilities: [...required],
    observedAvailableCapabilities: parsed?.success
      ? [...parsed.data.availableCapabilities]
      : null,
    runtimeAttestationDigest: parsed?.success
      ? runtimeAttestationDigest(parsed.data)
      : null,
    runtimeContinuityTokenHash: parsed?.success
      ? continuityTokenHash(parsed.data.continuityToken)
      : null
  };
}

export class ReleaseExecutionGate<TAction, TState, TResult>
{
  private readonly permits = new Map<object, {
    actionHash: string;
    stateHash: string;
    stateObservedAt: string;
    proposalId: string;
    executablePolicyHash: string;
    evaluatedAt: number;
    authorizedAt: number;
    issuedAtMonotonic: number;
    expiresAtMonotonic: number;
    releaseId: string;
    deviceId: string;
    controllerIdentity: string;
    configurationDigest: string;
    runtimeAttestationDigest?: string;
    runtimeAttestationSourceDigest?: string;
    continuityToken?: string;
  }>();

  constructor(
    private readonly dispatcher: ActionDispatcher<TAction, TResult>,
    private readonly evidence: EvidenceSink,
    private readonly policy: ActionPolicy<TAction, TState>,
    private readonly hashAction: (action: TAction) => string,
    private readonly refreshReleaseRecord?: (
      request: AuthorizedExecutionRequest<TAction, TState>
    ) => Promise<ReleaseRecord>,
    private readonly refreshExecutionConfiguration?: (
      request: AuthorizedExecutionRequest<TAction, TState>
    ) => Promise<ExecutionConfiguration | undefined>,
    private readonly refreshRuntimeAttestation?: (
      request: AuthorizedExecutionRequest<TAction, TState>
    ) => Promise<RuntimeAttestation | undefined>,
    private readonly monotonicNow: () => number = () => performance.now()
  ) {}

  private evidenceFor(
    request: ExecutionRequest<TAction, TState>,
    decision: ExecutionEvidence['decision'],
    reason: string,
    matchedRuleIds: string[],
    signalState = 'not_sent',
    executionEvidence = 'not_executed',
    dispatchedAt?: string,
    controllerResult?: unknown
  ): ExecutionEvidence {
    return {
      releaseId: request.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(request.release),
      modelHash: request.release.model.sha256,
      actionContractHash: sha256(canonicalJson(request.release.actionContract)),
      robotProfileHash: request.release.robot.profileSha256,
      controllerProfileHash: request.release.robot.controllerConfigSha256,
      expectedConfigurationDigest: request.release.approvedConfigurationDigest ?? null,
      observedConfigurationDigest: request.executionConfiguration
        ? configurationDigest(request.executionConfiguration)
        : null,
      expectedConfigurationSchemaVersion:
        request.release.executionConfiguration?.schemaVersion ?? null,
      observedConfigurationSchemaVersion:
        request.executionConfiguration?.schemaVersion ?? null,
      ...attestationEvidence(request.release, request.runtimeAttestation),
      runtimePolicyHash: request.release.runtimePolicy.policySha256,
      deviceId: request.deviceId,
      proposalId: request.proposalId,
      proposedAction: request.action,
      decision,
      decisionReason: reason,
      matchedRuleIds,
      stateObservedAt: request.stateObservedAt,
      decisionMadeAt: (request.now ?? new Date()).toISOString(),
      dispatchedAt,
      hardwareSignalSent: signalState !== 'not_sent',
      hardwareSignalState: signalState,
      executionEvidence,
      controllerResult
    };
  }

  async evaluate(
    request: ExecutionRequest<TAction, TState>
  ): Promise<ExecutionDecision<TAction, TState>> {
    const now = snapshotNow(request.now);
    if (!Number.isFinite(now.getTime())) {
      await this.evidence.append(this.evidenceFor(
        { ...request, now: new Date() },
        'blocked',
        'current_time_invalid',
        ['clock_validity']
      ));
      return { status: 'blocked', reason: 'current_time_invalid' };
    }
    const evidenceRequest = { ...request, now };
    const evaluationStartedAtMonotonic = this.monotonicNow();
    if (!Number.isFinite(evaluationStartedAtMonotonic)) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'permit_clock_invalid',
        ['clock_validity', 'single_use_permit']
      ));
      return { status: 'blocked', reason: 'permit_clock_invalid' };
    }
    const eligible = executionEligibility(request.release, request.releaseRecord, request.deviceId, now);
    if (!eligible.allowed) {
      const approvalRequired = eligible.reason.includes('approval') || eligible.reason.includes('state_tested');
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        approvalRequired ? 'approval_required' : 'blocked',
        eligible.reason,
        ['release_eligibility']
      ));
      return {
        status: approvalRequired ? 'approval_required' : 'blocked',
        reason: eligible.reason
      };
    }
    const configuration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: request.executionConfiguration,
      mode: 'run',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now
    });
    if (!configuration.allowed) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        configuration.reason!,
        ['configuration_binding']
      ));
      return { status: 'blocked', reason: configuration.reason! };
    }
    const attestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: request.runtimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now
    });
    if (!attestation.allowed) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        attestation.reason!,
        ['runtime_attestation']
      ));
      return { status: 'blocked', reason: attestation.reason! };
    }
    if (request.state === undefined || !request.stateObservedAt) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'state_missing',
        ['state_freshness']
      ));
      return { status: 'blocked', reason: 'state_missing' };
    }
    const ageMs = now.getTime() - Date.parse(request.stateObservedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > request.release.runtimePolicy.maxStateAgeMs) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'state_stale_or_invalid',
        ['state_freshness']
      ));
      return { status: 'blocked', reason: 'state_stale_or_invalid' };
    }
    let observedActionHash: string;
    let stateHash: string;
    let releaseHash: string;
    let actionCanonical: string;
    let stateCanonical: string;
    let policyAction: TAction;
    let policyState: TState;
    try {
      actionCanonical = canonicalJson(request.action);
      stateCanonical = canonicalJson(request.state);
      policyAction = JSON.parse(actionCanonical) as TAction;
      policyState = JSON.parse(stateCanonical) as TState;
      observedActionHash = this.hashAction(policyAction);
      stateHash = sha256(stateCanonical);
      releaseHash = executablePolicyHash(request.release);
    } catch {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'authorization_input_invalid',
        ['action_identity', 'state_identity', 'release_eligibility']
      ));
      return { status: 'blocked', reason: 'authorization_input_invalid' };
    }
    if (observedActionHash !== request.actionHash) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'action_hash_mismatch',
        ['action_identity']
      ));
      return { status: 'blocked', reason: 'action_hash_mismatch' };
    }
    const snapshotEvidenceRequest = {
      ...evidenceRequest,
      action: JSON.parse(actionCanonical) as TAction,
      state: JSON.parse(stateCanonical) as TState
    };
    const policy = await this.policy(policyAction, policyState);
    if (!policy.allowed) {
      await this.evidence.append(this.evidenceFor(
        snapshotEvidenceRequest,
        'blocked',
        policy.reason,
        policy.matchedRuleIds
      ));
      return { status: 'blocked', reason: policy.reason };
    }
    let postPolicyActionHash: string;
    let postPolicyStateHash: string;
    let postPolicyReleaseHash: string;
    let postPolicySnapshotActionHash: string;
    let postPolicySnapshotStateHash: string;
    try {
      postPolicyActionHash = this.hashAction(request.action);
      postPolicyStateHash = sha256(canonicalJson(request.state));
      postPolicyReleaseHash = executablePolicyHash(request.release);
      postPolicySnapshotActionHash = this.hashAction(policyAction);
      postPolicySnapshotStateHash = sha256(canonicalJson(policyState));
    } catch {
      postPolicyActionHash = '';
      postPolicyStateHash = '';
      postPolicyReleaseHash = '';
      postPolicySnapshotActionHash = '';
      postPolicySnapshotStateHash = '';
    }
    if (
      postPolicyActionHash !== observedActionHash
      || postPolicyStateHash !== stateHash
      || postPolicyReleaseHash !== releaseHash
      || postPolicySnapshotActionHash !== observedActionHash
      || postPolicySnapshotStateHash !== stateHash
    ) {
      await this.evidence.append(this.evidenceFor(
        snapshotEvidenceRequest,
        'blocked',
        'authorization_input_changed_during_evaluation',
        ['action_identity', 'state_identity', 'release_eligibility']
      ));
      return { status: 'blocked', reason: 'authorization_input_changed_during_evaluation' };
    }
    const issuedAtMonotonic = this.monotonicNow();
    const authorizationNow = monotonicProjectedNow(
      now.getTime(),
      evaluationStartedAtMonotonic,
      issuedAtMonotonic,
      now.getTime()
    );
    if (!authorizationNow) {
      await this.evidence.append(this.evidenceFor(
        snapshotEvidenceRequest,
        'blocked',
        'permit_clock_invalid',
        ['clock_validity', 'single_use_permit']
      ));
      return { status: 'blocked', reason: 'permit_clock_invalid' };
    }
    const authorizationEvidenceRequest = {
      ...snapshotEvidenceRequest,
      now: authorizationNow
    };
    const authorizationEligible = executionEligibility(
      request.release,
      request.releaseRecord,
      request.deviceId,
      authorizationNow
    );
    if (!authorizationEligible.allowed) {
      await this.evidence.append(this.evidenceFor(
        authorizationEvidenceRequest,
        'blocked',
        authorizationEligible.reason,
        ['release_eligibility']
      ));
      return { status: 'blocked', reason: authorizationEligible.reason };
    }
    const authorizationConfiguration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: request.executionConfiguration,
      mode: 'run',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now: authorizationNow
    });
    if (!authorizationConfiguration.allowed) {
      await this.evidence.append(this.evidenceFor(
        authorizationEvidenceRequest,
        'blocked',
        authorizationConfiguration.reason!,
        ['configuration_binding']
      ));
      return { status: 'blocked', reason: authorizationConfiguration.reason! };
    }
    const authorizationAttestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: request.runtimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now: authorizationNow
    });
    if (!authorizationAttestation.allowed) {
      await this.evidence.append(this.evidenceFor(
        authorizationEvidenceRequest,
        'blocked',
        authorizationAttestation.reason!,
        ['runtime_attestation']
      ));
      return { status: 'blocked', reason: authorizationAttestation.reason! };
    }
    const authorizationStateAgeMs = authorizationNow.getTime() - Date.parse(request.stateObservedAt);
    if (
      !Number.isFinite(authorizationStateAgeMs)
      || authorizationStateAgeMs < 0
      || authorizationStateAgeMs > request.release.runtimePolicy.maxStateAgeMs
    ) {
      await this.evidence.append(this.evidenceFor(
        authorizationEvidenceRequest,
        'blocked',
        'state_stale_or_invalid',
        ['state_freshness']
      ));
      return { status: 'blocked', reason: 'state_stale_or_invalid' };
    }
    const permit = Object.freeze({}) as ExecutionPermit;
    this.permits.set(permit as object, {
      actionHash: request.actionHash,
      stateHash,
      stateObservedAt: request.stateObservedAt,
      proposalId: request.proposalId,
      executablePolicyHash: releaseHash,
      evaluatedAt: now.getTime(),
      authorizedAt: authorizationNow.getTime(),
      issuedAtMonotonic,
      expiresAtMonotonic:
        issuedAtMonotonic + Math.min(1_000, request.release.runtimePolicy.maxStateAgeMs),
      releaseId: request.release.metadata.releaseId,
      deviceId: request.deviceId,
      controllerIdentity: request.controllerIdentity ?? request.release.robot.controllerConfigSha256,
      configurationDigest: authorizationConfiguration.observedDigest!,
      runtimeAttestationDigest: authorizationAttestation.digest ?? undefined,
      runtimeAttestationSourceDigest: authorizationAttestation.attestation
        ? sha256(canonicalJson(authorizationAttestation.attestation.source))
        : undefined,
      continuityToken: authorizationAttestation.attestation?.continuityToken
    });
    return {
      status: 'allowed',
      reason: policy.reason,
      authorizedRequest: {
        ...request,
        action: JSON.parse(actionCanonical) as TAction,
        state: JSON.parse(stateCanonical) as TState,
        now: authorizationNow,
        permit
      }
    };
  }

  async execute(request: AuthorizedExecutionRequest<TAction, TState>): Promise<TResult> {
    const suppliedNowMs = request.now?.getTime();
    const permit = request.permit as object;
    const record = this.permits.get(permit);
    this.permits.delete(permit);
    const executedAtMonotonic = this.monotonicNow();
    let preparedAction: TAction | undefined;
    let preparedState: TState | undefined;
    let observedStateHash: string | undefined;
    let observedReleaseHash: string | undefined;
    try {
      // Capture the exact JSON value synchronously, before the first await. A
      // caller-owned object must not be able to change adapter-visible bytes
      // while Evidence preflight or final authority refreshes are in progress.
      preparedAction = JSON.parse(canonicalJson(request.action)) as TAction;
      const stateCanonical = canonicalJson(request.state);
      preparedState = JSON.parse(stateCanonical) as TState;
      observedStateHash = sha256(stateCanonical);
      observedReleaseHash = executablePolicyHash(request.release);
    } catch {
      // The consumed permit will fail closed below with a diagnosable reason.
    }
    const suppliedNowValid = suppliedNowMs === undefined || Number.isFinite(suppliedNowMs);
    const entryNow = record
      ? monotonicProjectedNow(
        record.authorizedAt,
        record.issuedAtMonotonic,
        executedAtMonotonic,
        suppliedNowValid ? suppliedNowMs : undefined
      )
      : null;
    let preliminaryReason: string | null = null;
    if (!record) preliminaryReason = 'permit_unknown_or_reused';
    else if (!suppliedNowValid) preliminaryReason = 'current_time_invalid';
    else if (!entryNow) preliminaryReason = 'permit_clock_invalid';
    else if (executedAtMonotonic >= record.expiresAtMonotonic) {
      preliminaryReason = 'permit_expired';
    } else if (suppliedNowMs !== undefined && suppliedNowMs < record.evaluatedAt) {
      preliminaryReason = 'execution_clock_rollback';
    }
    const entryRequest = {
      ...request,
      action: preparedAction ?? request.action,
      state: preparedState ?? request.state,
      now: entryNow ?? (suppliedNowValid && suppliedNowMs !== undefined
        ? new Date(suppliedNowMs)
        : new Date())
    };
    if (preliminaryReason) {
      await this.evidence.append(this.evidenceFor(
        entryRequest,
        'failed',
        preliminaryReason,
        ['single_use_permit']
      ));
      throw new Error(`execution_permit_invalid:${preliminaryReason}`);
    }
    if (!record) throw new Error('execution_permit_invalid:permit_unknown_or_reused');
    const refreshRequest = {
      ...entryRequest,
      action: preparedAction === undefined
        ? request.action
        : JSON.parse(canonicalJson(preparedAction)) as TAction,
      state: preparedState === undefined
        ? request.state
        : JSON.parse(canonicalJson(preparedState)) as TState
    };
    await this.evidence.assertWritableBeforeDispatch?.();
    let currentReleaseRecord = request.releaseRecord;
    let currentExecutionConfiguration = request.executionConfiguration;
    let currentRuntimeAttestation = request.runtimeAttestation;
    try {
      currentReleaseRecord = this.refreshReleaseRecord
        ? await this.refreshReleaseRecord(refreshRequest)
        : request.releaseRecord;
    } catch {
      const failedAtMonotonic = this.monotonicNow();
      const failedAt = monotonicProjectedNow(
        record!.authorizedAt,
        record!.issuedAtMonotonic,
        failedAtMonotonic,
        suppliedNowValid ? suppliedNowMs : undefined
      ) ?? entryRequest.now;
      await this.evidence.append(this.evidenceFor(
        {
          ...entryRequest,
          now: failedAt
        },
        'failed',
        'release_record_refresh_failed',
        ['release_eligibility', 'single_use_permit']
      ));
      throw new Error('execution_permit_invalid');
    }
    if (this.refreshExecutionConfiguration) {
      try {
        currentExecutionConfiguration = await this.refreshExecutionConfiguration(refreshRequest);
      } catch {
        currentExecutionConfiguration = undefined;
      }
    }
    if (
      (request.release.runtimePolicy.requiredCapabilities?.length ?? 0) > 0
      && this.refreshRuntimeAttestation
    ) {
      try {
        currentRuntimeAttestation = await this.refreshRuntimeAttestation(refreshRequest);
      } catch {
        currentRuntimeAttestation = undefined;
      }
    }
    // Date is mutable. Use the synchronously captured scalar so refresh and
    // dispatch code cannot rewrite authorization or Evidence time in place.
    const checkedAtMonotonic = this.monotonicNow();
    const projectedNow = monotonicProjectedNow(
      record!.authorizedAt,
      record!.issuedAtMonotonic,
      checkedAtMonotonic,
      suppliedNowValid ? suppliedNowMs : undefined
    );
    const now = projectedNow ?? entryRequest.now;
    const currentRequest = {
      ...request,
      action: preparedAction ?? request.action,
      executionConfiguration: currentExecutionConfiguration,
      runtimeAttestation: currentRuntimeAttestation,
      // Freeze the final authorization time before dispatch. Evidence must not
      // acquire a later decision time after an asynchronous dispatch returns.
      now
    };
    const configuration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: currentExecutionConfiguration,
      mode: 'run',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now
    });
    const eligible = executionEligibility(request.release, currentReleaseRecord, request.deviceId, now);
    const attestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: currentRuntimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now
    });
    const issuedAttestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: request.runtimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now
    });
    // The full issuance digest protects the authorized request from mutation.
    // A refreshed observation is intentionally not compared by full digest:
    // observedAt and non-required capabilities may legitimately change.
    const stateAgeMs = request.stateObservedAt
      ? now.getTime() - Date.parse(request.stateObservedAt)
      : Number.NaN;
    let invalidReason: string | null = null;
    if (!projectedNow) invalidReason = 'permit_clock_invalid';
    else if (checkedAtMonotonic >= record!.expiresAtMonotonic) invalidReason = 'permit_expired';
    else if (request.state === undefined || !request.stateObservedAt) invalidReason = 'state_missing';
    else if (
      !Number.isFinite(stateAgeMs)
      || stateAgeMs < 0
      || stateAgeMs > request.release.runtimePolicy.maxStateAgeMs
    ) invalidReason = 'state_stale_or_invalid';
    else if (preparedAction === undefined || observedStateHash === undefined || observedReleaseHash === undefined) {
      invalidReason = 'permit_bound_input_invalid';
    }
    else if (record.actionHash !== request.actionHash) invalidReason = 'permit_action_binding_mismatch';
    else if (record.stateHash !== observedStateHash) invalidReason = 'permit_state_binding_mismatch';
    else if (record.stateObservedAt !== request.stateObservedAt) invalidReason = 'permit_state_time_binding_mismatch';
    else if (record.proposalId !== request.proposalId) invalidReason = 'permit_proposal_binding_mismatch';
    else if (record.executablePolicyHash !== observedReleaseHash) {
      invalidReason = 'permit_release_content_binding_mismatch';
    }
    else if (record.releaseId !== request.release.metadata.releaseId) invalidReason = 'permit_release_binding_mismatch';
    else if (record.deviceId !== request.deviceId) invalidReason = 'permit_device_binding_mismatch';
    else if (record.controllerIdentity !== (request.controllerIdentity ?? request.release.robot.controllerConfigSha256)) {
      invalidReason = 'permit_controller_binding_mismatch';
    } else if (!configuration.allowed) {
      invalidReason = configuration.reason ?? 'configuration_mismatch';
    } else if (record.configurationDigest !== configuration.observedDigest) {
      invalidReason = 'configuration_mismatch';
    }
    else if (this.hashAction(preparedAction) !== request.actionHash) invalidReason = 'action_hash_mismatch';
    else if (!eligible.allowed) invalidReason = eligible.reason;
    else if (!attestation.allowed) {
      invalidReason = attestation.reason ?? 'runtime_attestation_stale';
    } else if (record.runtimeAttestationDigest !== (issuedAttestation.digest ?? undefined)) {
      invalidReason = 'runtime_attestation_changed';
    } else if (
      record.runtimeAttestationSourceDigest !== (attestation.attestation
        ? sha256(canonicalJson(attestation.attestation.source))
        : undefined)
    ) {
      invalidReason = 'runtime_attestation_changed';
    } else if (record.continuityToken !== attestation.attestation?.continuityToken) {
      invalidReason = 'runtime_continuity_changed';
    }
    if (invalidReason) {
      const configurationBlocked = invalidReason.startsWith('configuration_');
      const attestationBlocked = invalidReason.startsWith('runtime_');
      const stateBlocked = invalidReason.startsWith('state_');
      await this.evidence.append(this.evidenceFor(
        currentRequest,
        configurationBlocked || attestationBlocked || stateBlocked ? 'blocked' : 'failed',
        invalidReason,
        configurationBlocked
          ? ['configuration_binding', 'single_use_permit']
          : attestationBlocked
            ? ['runtime_attestation', 'single_use_permit']
            : stateBlocked
              ? ['state_freshness', 'single_use_permit']
            : ['single_use_permit']
      ));
      throw new Error(`execution_permit_invalid:${invalidReason}`);
    }
    // Refreshes and Evidence preflight are asynchronous. Recheck the
    // crash-local deadline at the last possible point before crossing the
    // controller boundary; entering execute just before expiry must not buy an
    // unbounded authorization window while those checks wait.
    const preDispatchMonotonic = this.monotonicNow();
    const preDispatchNow = monotonicProjectedNow(
      record!.authorizedAt,
      record!.issuedAtMonotonic,
      preDispatchMonotonic,
      suppliedNowValid ? suppliedNowMs : undefined
    );
    if (
      !preDispatchNow
      || preDispatchMonotonic >= record!.expiresAtMonotonic
    ) {
      const reason = !preDispatchNow
        ? 'permit_clock_invalid'
        : 'permit_expired';
      await this.evidence.append(this.evidenceFor(
        currentRequest,
        'failed',
        reason,
        ['single_use_permit']
      ));
      throw new Error(`execution_permit_invalid:${reason}`);
    }
    const preDispatchRequest = { ...currentRequest, now: preDispatchNow };
    const preDispatchConfiguration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: currentExecutionConfiguration,
      mode: 'run',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now: preDispatchNow
    });
    const preDispatchEligible = executionEligibility(
      request.release,
      currentReleaseRecord,
      request.deviceId,
      preDispatchNow
    );
    const preDispatchAttestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: currentRuntimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now: preDispatchNow
    });
    const preDispatchIssuedAttestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: request.runtimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now: preDispatchNow
    });
    const preDispatchStateAgeMs = preDispatchNow.getTime() - Date.parse(record!.stateObservedAt);
    let preDispatchInvalidReason: string | null = null;
    if (
      !Number.isFinite(preDispatchStateAgeMs)
      || preDispatchStateAgeMs < 0
      || preDispatchStateAgeMs > request.release.runtimePolicy.maxStateAgeMs
    ) preDispatchInvalidReason = 'state_stale_or_invalid';
    else if (!preDispatchConfiguration.allowed) {
      preDispatchInvalidReason = preDispatchConfiguration.reason ?? 'configuration_mismatch';
    } else if (!preDispatchEligible.allowed) preDispatchInvalidReason = preDispatchEligible.reason;
    else if (!preDispatchAttestation.allowed) {
      preDispatchInvalidReason = preDispatchAttestation.reason ?? 'runtime_attestation_stale';
    } else if (!preDispatchIssuedAttestation.allowed) {
      preDispatchInvalidReason = preDispatchIssuedAttestation.reason ?? 'runtime_attestation_stale';
    }
    if (preDispatchInvalidReason) {
      const configurationBlocked = preDispatchInvalidReason.startsWith('configuration_');
      const attestationBlocked = preDispatchInvalidReason.startsWith('runtime_');
      const stateBlocked = preDispatchInvalidReason.startsWith('state_');
      await this.evidence.append(this.evidenceFor(
        preDispatchRequest,
        configurationBlocked || attestationBlocked || stateBlocked ? 'blocked' : 'failed',
        preDispatchInvalidReason,
        configurationBlocked
          ? ['configuration_binding', 'single_use_permit']
          : attestationBlocked
            ? ['runtime_attestation', 'single_use_permit']
            : stateBlocked
              ? ['state_freshness', 'single_use_permit']
              : ['single_use_permit']
      ));
      throw new Error(`execution_permit_invalid:${preDispatchInvalidReason}`);
    }
    const dispatchedAt = preDispatchNow.toISOString();
    // The adapter and caller must not be able to rewrite the audit truth after
    // the final boundary has been crossed. In particular, some adapters
    // normalize actions in place. Preserve the exact pre-dispatch values for
    // both success and uncertain/failure Evidence.
    const dispatchEvidenceRequest = {
      ...preDispatchRequest,
      release: JSON.parse(canonicalJson(preDispatchRequest.release)) as ExecutablePolicySpec,
      action: JSON.parse(canonicalJson(preparedAction)) as TAction,
      state: preparedState === undefined
        ? request.state
        : JSON.parse(canonicalJson(preparedState)) as TState,
      executionConfiguration: currentExecutionConfiguration === undefined
        ? undefined
        : JSON.parse(canonicalJson(currentExecutionConfiguration)) as ExecutionConfiguration,
      runtimeAttestation: currentRuntimeAttestation === undefined
        ? undefined
        : JSON.parse(canonicalJson(currentRuntimeAttestation)) as RuntimeAttestation,
      now: new Date(preDispatchNow.getTime())
    };
    let result: TResult;
    try {
      result = await this.dispatcher.dispatch(preparedAction as TAction, request.permit);
    } catch (error) {
      await this.evidence.append(this.evidenceFor(
        dispatchEvidenceRequest,
        'failed',
        error instanceof Error ? error.message : 'dispatch_failed',
        ['dispatch'],
        'attempted_unconfirmed',
        'dispatch_failed',
        dispatchedAt
      ));
      throw error;
    }
    const terminal = result && typeof result === 'object'
      && 'completed' in result
      && (result as { completed?: unknown }).completed === true;
    await this.evidence.append(this.evidenceFor(
      dispatchEvidenceRequest,
      'allowed',
      'dispatched',
      [
        'release_eligibility',
        ...(request.release.runtimePolicy.requiredCapabilities?.length
          ? ['runtime_attestation']
          : []),
        'state_freshness',
        'action_identity'
      ],
      'attempted_unconfirmed',
      terminal ? 'controller_result_recorded' : 'dispatch_attempted',
      dispatchedAt,
      result
    ));
    return result;
  }
}

export class ShadowExecutionGate<TAction, TState> {
  constructor(
    private readonly evidence: EvidenceSink,
    private readonly policy: ActionPolicy<TAction, TState>,
    private readonly hashAction: (action: TAction) => string
  ) {}

  async evaluate(request: ExecutionRequest<TAction, TState>): Promise<ExecutionDecision<TAction, TState>> {
    const suppliedNow = snapshotNow(request.now);
    const clockValid = Number.isFinite(suppliedNow.getTime());
    const now = clockValid ? suppliedNow : new Date();
    let status: 'allowed' | 'blocked' = 'blocked';
    const identity = executablePolicyHash(request.release);
    const configuration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: request.executionConfiguration,
      mode: 'shadow',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now
    });
    const attestation = evaluateRuntimeAttestation({
      requiredCapabilities: request.release.runtimePolicy.requiredCapabilities,
      attestation: request.runtimeAttestation,
      maxAgeMs: attestationMaxAgeMs(request.release),
      now
    });
    let reason =
      !clockValid
        ? 'current_time_invalid'
      : !configuration.allowed
        ? configuration.reason!
      : request.releaseRecord.state === 'revoked' || request.release.evidence.status === 'revoked'
        ? 'release_revoked'
        : request.releaseRecord.state !== 'shadow'
        ? 'release_not_in_shadow_state'
        : request.releaseRecord.releaseId !== request.release.metadata.releaseId
          ? 'release_id_mismatch'
        : request.releaseRecord.executablePolicyHash !== identity
          || request.releaseRecord.approvedIdentityHash !== identity
          ? 'release_identity_changed_reapproval_required'
          : request.release.approvedConfigurationDigest
            && !request.releaseRecord.approvedConfigurationDigest
              ? 'configuration_unbound'
            : request.release.approvedConfigurationDigest
              && request.releaseRecord.approvedConfigurationDigest
                !== request.release.approvedConfigurationDigest
                ? 'configuration_mismatch'
          : request.release.evidence.status !== 'approved'
            ? 'release_not_approved'
            : request.release.deployment.mode !== 'shadow'
              ? 'release_deployment_mode_mismatch'
          : !request.release.deployment.allowedDeviceIds.includes(request.deviceId)
            ? 'device_not_allowed'
            : Date.parse(request.release.deployment.expiresAt) <= now.getTime()
              ? 'release_expired'
              : 'state_missing';
    let matchedRuleIds = reason === 'state_missing'
      ? ['state_freshness']
      : ['shadow_release_eligibility'];
    let proposedAction = request.action;
    if (reason === 'state_missing' && !attestation.allowed) {
      reason = attestation.reason!;
      matchedRuleIds = ['runtime_attestation'];
    }
    if (reason === 'state_missing' && request.state !== undefined && request.stateObservedAt) {
      const age = now.getTime() - Date.parse(request.stateObservedAt);
      if (age >= 0 && age <= request.release.runtimePolicy.maxStateAgeMs) {
        try {
          const actionCanonical = canonicalJson(request.action);
          const stateCanonical = canonicalJson(request.state);
          const policyAction = JSON.parse(actionCanonical) as TAction;
          const policyState = JSON.parse(stateCanonical) as TState;
          proposedAction = JSON.parse(actionCanonical) as TAction;
          const observedActionHash = this.hashAction(policyAction);
          const observedStateHash = sha256(stateCanonical);
          if (observedActionHash === request.actionHash) {
            const result = await this.policy(policyAction, policyState);
            let inputsChanged = false;
            try {
              inputsChanged = this.hashAction(request.action) !== observedActionHash
                || sha256(canonicalJson(request.state)) !== observedStateHash
                || this.hashAction(policyAction) !== observedActionHash
                || sha256(canonicalJson(policyState)) !== observedStateHash;
            } catch {
              inputsChanged = true;
            }
            if (result.allowed && inputsChanged) {
              reason = 'authorization_input_changed_during_evaluation';
              matchedRuleIds = ['action_identity', 'state_identity'];
            } else {
              status = result.allowed ? 'allowed' : 'blocked';
              reason = result.allowed && configuration.legacyUnbound
                ? 'configuration_unbound'
                : result.reason;
              matchedRuleIds = result.matchedRuleIds;
            }
          } else {
            reason = 'action_hash_mismatch';
            matchedRuleIds = ['action_identity'];
          }
        } catch {
          reason = 'authorization_input_invalid';
          matchedRuleIds = ['action_identity', 'state_identity'];
        }
      } else {
        reason = 'state_stale_or_invalid';
      }
    }
    await this.evidence.append({
      releaseId: request.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(request.release),
      modelHash: request.release.model.sha256,
      actionContractHash: sha256(canonicalJson(request.release.actionContract)),
      robotProfileHash: request.release.robot.profileSha256,
      controllerProfileHash: request.release.robot.controllerConfigSha256,
      expectedConfigurationDigest: configuration.expectedDigest,
      observedConfigurationDigest: configuration.observedDigest,
      expectedConfigurationSchemaVersion:
        request.release.executionConfiguration?.schemaVersion ?? null,
      observedConfigurationSchemaVersion:
        request.executionConfiguration?.schemaVersion ?? null,
      ...attestationEvidence(request.release, request.runtimeAttestation),
      runtimePolicyHash: request.release.runtimePolicy.policySha256,
      deviceId: request.deviceId,
      proposalId: request.proposalId,
      proposedAction,
      decision: status,
      decisionReason: `shadow:${reason}`,
      matchedRuleIds,
      stateObservedAt: request.stateObservedAt,
      decisionMadeAt: now.toISOString(),
      hardwareSignalSent: false,
      hardwareSignalState: 'not_sent',
      executionEvidence: 'shadow_not_dispatched'
    });
    return status === 'allowed'
      ? { status: 'blocked', reason: `shadow_observation_only:${reason}` }
      : { status: 'blocked', reason };
  }
}
