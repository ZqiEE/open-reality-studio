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
}

interface ActionDispatcher<TAction, TResult> {
  dispatch(action: TAction, permit: ExecutionPermit): Promise<TResult>;
}

export type ActionPolicy<TAction, TState> = (
  action: TAction,
  state: TState
) => Promise<{ allowed: boolean; reason: string; matchedRuleIds: string[] }>;

export class ReleaseExecutionGate<TAction, TState, TResult>
{
  private readonly permits = new Map<object, {
    actionHash: string;
    expiresAt: number;
    releaseId: string;
    deviceId: string;
    controllerIdentity: string;
    configurationDigest: string;
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
    ) => Promise<ExecutionConfiguration | undefined>
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
    const now = request.now ?? new Date();
    const eligible = executionEligibility(request.release, request.releaseRecord, request.deviceId, now);
    if (!eligible.allowed) {
      const approvalRequired = eligible.reason.includes('approval') || eligible.reason.includes('state_tested');
      await this.evidence.append(this.evidenceFor(
        request,
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
        request,
        'blocked',
        configuration.reason!,
        ['configuration_binding']
      ));
      return { status: 'blocked', reason: configuration.reason! };
    }
    if (request.state === undefined || !request.stateObservedAt) {
      await this.evidence.append(this.evidenceFor(
        request,
        'blocked',
        'state_missing',
        ['state_freshness']
      ));
      return { status: 'blocked', reason: 'state_missing' };
    }
    const ageMs = now.getTime() - Date.parse(request.stateObservedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > request.release.runtimePolicy.maxStateAgeMs) {
      await this.evidence.append(this.evidenceFor(
        request,
        'blocked',
        'state_stale_or_invalid',
        ['state_freshness']
      ));
      return { status: 'blocked', reason: 'state_stale_or_invalid' };
    }
    if (this.hashAction(request.action) !== request.actionHash) {
      await this.evidence.append(this.evidenceFor(
        request,
        'blocked',
        'action_hash_mismatch',
        ['action_identity']
      ));
      return { status: 'blocked', reason: 'action_hash_mismatch' };
    }
    const policy = await this.policy(request.action, request.state);
    if (!policy.allowed) {
      await this.evidence.append(this.evidenceFor(
        request,
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
      configurationDigest: configuration.observedDigest!
    });
    return {
      status: 'allowed',
      reason: policy.reason,
      authorizedRequest: { ...request, permit }
    };
  }

  async execute(request: AuthorizedExecutionRequest<TAction, TState>): Promise<TResult> {
    const permit = request.permit as object;
    const record = this.permits.get(permit);
    this.permits.delete(permit);
    let currentReleaseRecord = request.releaseRecord;
    let currentExecutionConfiguration = request.executionConfiguration;
    try {
      currentReleaseRecord = this.refreshReleaseRecord
        ? await this.refreshReleaseRecord(request)
        : request.releaseRecord;
    } catch {
      await this.evidence.append(this.evidenceFor(
        request,
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
    const now = request.now ?? new Date();
    const currentRequest = {
      ...request,
      executionConfiguration: currentExecutionConfiguration
    };
    const configuration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: currentExecutionConfiguration,
      mode: 'run',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      now
    });
    const eligible = executionEligibility(request.release, currentReleaseRecord, request.deviceId, now);
    const invalidReason = !record
      ? 'permit_unknown_or_reused'
      : record.expiresAt <= now.getTime()
        ? 'permit_expired'
        : record.actionHash !== request.actionHash
          ? 'permit_action_binding_mismatch'
          : record.releaseId !== request.release.metadata.releaseId
            ? 'permit_release_binding_mismatch'
            : record.deviceId !== request.deviceId
              ? 'permit_device_binding_mismatch'
              : record.controllerIdentity !== (request.controllerIdentity ?? request.release.robot.controllerConfigSha256)
                ? 'permit_controller_binding_mismatch'
                : !configuration.allowed
                  ? configuration.reason
                  : record.configurationDigest !== configuration.observedDigest
                    ? 'configuration_mismatch'
                    : this.hashAction(request.action) !== request.actionHash
                      ? 'action_hash_mismatch'
                      : !eligible.allowed
                        ? eligible.reason
                        : null;
    if (invalidReason) {
      const configurationBlocked = invalidReason.startsWith('configuration_');
      await this.evidence.append(this.evidenceFor(
        currentRequest,
        configurationBlocked ? 'blocked' : 'failed',
        invalidReason,
        configurationBlocked
          ? ['configuration_binding', 'single_use_permit']
          : ['single_use_permit']
      ));
      throw new Error(`execution_permit_invalid:${invalidReason}`);
    }
    try {
      const dispatchedAt = now.toISOString();
      const result = await this.dispatcher.dispatch(request.action, request.permit);
      const terminal = result && typeof result === 'object'
        && 'completed' in result
        && (result as { completed?: unknown }).completed === true;
      await this.evidence.append(this.evidenceFor(
        request,
        'allowed',
        'dispatched',
        ['release_eligibility', 'state_freshness', 'action_identity'],
        'attempted_unconfirmed',
        terminal ? 'controller_result_recorded' : 'dispatch_attempted',
        dispatchedAt,
        result
      ));
      return result;
    } catch (error) {
      await this.evidence.append(this.evidenceFor(
        request,
        'failed',
        error instanceof Error ? error.message : 'dispatch_failed',
        ['dispatch'],
        'attempted_unconfirmed',
        'dispatch_failed',
        now.toISOString()
      ));
      throw error;
    }
  }
}

export class ShadowExecutionGate<TAction, TState> {
  constructor(
    private readonly evidence: EvidenceSink,
    private readonly policy: ActionPolicy<TAction, TState>,
    private readonly hashAction: (action: TAction) => string
  ) {}

  async evaluate(request: ExecutionRequest<TAction, TState>): Promise<ExecutionDecision<TAction, TState>> {
    const now = request.now ?? new Date();
    let status: 'allowed' | 'blocked' = 'blocked';
    const identity = executablePolicyHash(request.release);
    const configuration = evaluateConfigurationBinding({
      approvedConfigurationDigest: request.release.approvedConfigurationDigest,
      observedConfiguration: request.executionConfiguration,
      mode: 'shadow',
      maxAgeMs: request.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
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
