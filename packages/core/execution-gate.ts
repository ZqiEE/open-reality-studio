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
    expiresAt: number;
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
    ) => Promise<RuntimeAttestation | undefined>
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
    const evidenceRequest = { ...request, now };
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
    if (this.hashAction(request.action) !== request.actionHash) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        'action_hash_mismatch',
        ['action_identity']
      ));
      return { status: 'blocked', reason: 'action_hash_mismatch' };
    }
    const policy = await this.policy(request.action, request.state);
    if (!policy.allowed) {
      await this.evidence.append(this.evidenceFor(
        evidenceRequest,
        'blocked',
        policy.reason,
        policy.matchedRuleIds
      ));
      return { status: 'blocked', reason: policy.reason };
    }
    const permit = Object.freeze({}) as ExecutionPermit;
    this.permits.set(permit as object, {
      actionHash: request.actionHash,
      expiresAt: now.getTime() + Math.min(1_000, request.release.runtimePolicy.maxStateAgeMs),
      releaseId: request.release.metadata.releaseId,
      deviceId: request.deviceId,
      controllerIdentity: request.controllerIdentity ?? request.release.robot.controllerConfigSha256,
      configurationDigest: configuration.observedDigest!,
      runtimeAttestationDigest: attestation.digest ?? undefined,
      runtimeAttestationSourceDigest: attestation.attestation
        ? sha256(canonicalJson(attestation.attestation.source))
        : undefined,
      continuityToken: attestation.attestation?.continuityToken
    });
    return {
      status: 'allowed',
      reason: policy.reason,
      authorizedRequest: { ...request, now, permit }
    };
  }

  async execute(request: AuthorizedExecutionRequest<TAction, TState>): Promise<TResult> {
    // Capture the exact JSON value synchronously, before the first await. A
    // caller-owned object must not be able to change adapter-visible bytes
    // while Evidence preflight or final authority refreshes are in progress.
    const preparedAction = JSON.parse(canonicalJson(request.action)) as TAction;
    const suppliedNowMs = request.now?.getTime();
    const permit = request.permit as object;
    const record = this.permits.get(permit);
    this.permits.delete(permit);
    await this.evidence.assertWritableBeforeDispatch?.();
    let currentReleaseRecord = request.releaseRecord;
    let currentExecutionConfiguration = request.executionConfiguration;
    let currentRuntimeAttestation = request.runtimeAttestation;
    try {
      currentReleaseRecord = this.refreshReleaseRecord
        ? await this.refreshReleaseRecord(request)
        : request.releaseRecord;
    } catch {
      await this.evidence.append(this.evidenceFor(
        {
          ...request,
          now: suppliedNowMs === undefined
            ? new Date()
            : new Date(suppliedNowMs)
        },
        'failed',
        'release_record_refresh_failed',
        ['release_eligibility', 'single_use_permit']
      ));
      throw new Error('execution_permit_invalid');
    }
    if (this.refreshExecutionConfiguration) {
      try {
        currentExecutionConfiguration = await this.refreshExecutionConfiguration(request);
      } catch {
        currentExecutionConfiguration = undefined;
      }
    }
    if (
      (request.release.runtimePolicy.requiredCapabilities?.length ?? 0) > 0
      && this.refreshRuntimeAttestation
    ) {
      try {
        currentRuntimeAttestation = await this.refreshRuntimeAttestation(request);
      } catch {
        currentRuntimeAttestation = undefined;
      }
    }
    // Date is mutable. Use the synchronously captured scalar so refresh and
    // dispatch code cannot rewrite authorization or Evidence time in place.
    const now = suppliedNowMs === undefined
      ? new Date()
      : new Date(suppliedNowMs);
    const currentRequest = {
      ...request,
      action: preparedAction,
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
    if (!record) invalidReason = 'permit_unknown_or_reused';
    else if (request.state === undefined || !request.stateObservedAt) invalidReason = 'state_missing';
    else if (
      !Number.isFinite(stateAgeMs)
      || stateAgeMs < 0
      || stateAgeMs > request.release.runtimePolicy.maxStateAgeMs
    ) invalidReason = 'state_stale_or_invalid';
    else if (record.expiresAt <= now.getTime()) invalidReason = 'permit_expired';
    else if (record.actionHash !== request.actionHash) invalidReason = 'permit_action_binding_mismatch';
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
    const dispatchedAt = now.toISOString();
    let result: TResult;
    try {
      result = await this.dispatcher.dispatch(preparedAction, request.permit);
    } catch (error) {
      await this.evidence.append(this.evidenceFor(
        currentRequest,
        'failed',
        error instanceof Error ? error.message : 'dispatch_failed',
        ['dispatch'],
        'attempted_unconfirmed',
        'dispatch_failed',
        now.toISOString()
      ));
      throw error;
    }
    const terminal = result && typeof result === 'object'
      && 'completed' in result
      && (result as { completed?: unknown }).completed === true;
    await this.evidence.append(this.evidenceFor(
      currentRequest,
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
    const now = snapshotNow(request.now);
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
      !configuration.allowed
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
    if (reason === 'state_missing' && !attestation.allowed) {
      reason = attestation.reason!;
      matchedRuleIds = ['runtime_attestation'];
    }
    if (reason === 'state_missing' && request.state !== undefined && request.stateObservedAt) {
      const age = now.getTime() - Date.parse(request.stateObservedAt);
      if (age >= 0 && age <= request.release.runtimePolicy.maxStateAgeMs) {
        if (this.hashAction(request.action) === request.actionHash) {
          const result = await this.policy(request.action, request.state);
          status = result.allowed ? 'allowed' : 'blocked';
          reason = result.allowed && configuration.legacyUnbound
            ? 'configuration_unbound'
            : result.reason;
          matchedRuleIds = result.matchedRuleIds;
        } else {
          reason = 'action_hash_mismatch';
          matchedRuleIds = ['action_identity'];
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
      proposedAction: request.action,
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
