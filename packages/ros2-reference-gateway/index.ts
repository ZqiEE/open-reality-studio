import { z } from 'zod';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate,
  type ActionPolicy,
  type EvidenceSink
} from '../core/execution-gate';
import {
  canonicalJson,
  sha256
} from '../core/evidence';
import {
  executablePolicyHash,
  type ExecutablePolicySpec
} from '../core/exec-spec';
import type { ReleaseRecord } from '../core/release-policy';
import type { ExecutionConfiguration } from '../core/execution-configuration';
import type { RuntimeAttestation } from '../core/runtime-attestation';

const isoTimestamp = z.string().datetime({ offset: true });
function isUnicodeScalarText(value: string): boolean {
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
const safeInteger = z.number().int().refine(Number.isSafeInteger, 'integer must be safe');

const jointTrajectoryActionSchema = z.object({
  representation: z.literal('trajectory'),
  jointNames: z.array(z.string().min(1)).min(1).max(64),
  points: z.array(z.object({
    positions: z.array(z.number().finite()).min(1).max(64),
    velocities: z.array(z.number().finite()).max(64).optional(),
    timeFromStartMs: z.number().int().positive().max(3_600_000)
  }).strict()).min(1).max(1_000),
  units: z.object({
    position: z.literal('radian'),
    velocity: z.literal('radian_per_second')
  }).strict()
}).strict();

export type JointTrajectoryAction = z.infer<typeof jointTrajectoryActionSchema>;

export const ros2ProposalEnvelopeSchema = z.object({
  proposalId: z.string().min(1).max(128),
  releaseId: z.string().min(1).max(256),
  deviceId: z.string().min(1).max(256),
  proposerIdentity: z.string().min(1).max(256),
  actionRepresentation: z.literal('trajectory'),
  actionPayload: jointTrajectoryActionSchema,
  createdAt: isoTimestamp
}).strict();

type Ros2ProposalEnvelope = z.infer<typeof ros2ProposalEnvelopeSchema>;

export interface Ros2ProposalReplayIdentity {
  releaseId: string;
  executablePolicyHash: string;
  deviceId: string;
  proposerIdentity: string;
  proposalId: string;
}

export interface Ros2ProposalReplayRegistry {
  claim(identity: Ros2ProposalReplayIdentity):
    | 'claimed'
    | 'duplicate'
    | 'capacity_exceeded'
    | 'unavailable';
}

export const jointStateSnapshotSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(256),
  positions: z.array(z.number().finite()).min(1).max(256),
  observedAt: isoTimestamp,
  sourceTimestamp: isoTimestamp.optional()
}).strict().superRefine((state, context) => {
  if (state.names.length !== state.positions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['positions'],
      message: 'JointState names and positions must have equal length'
    });
  }
  if (new Set(state.names).size !== state.names.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['names'],
      message: 'JointState names must be unique'
    });
  }
});

export type JointStateSnapshot = z.infer<typeof jointStateSnapshotSchema>;

export const ros2ControllerResultSchema = z.object({
  accepted: z.boolean(),
  detail: z.string().min(1).max(500).refine(
    isUnicodeScalarText,
    'detail must contain only Unicode scalar values'
  ),
  completed: z.boolean().optional(),
  succeeded: z.boolean().optional(),
  status: safeInteger.optional(),
  errorCode: safeInteger.optional(),
  errorString: z.string().max(500).refine(
    isUnicodeScalarText,
    'errorString must contain only Unicode scalar values'
  ).optional()
}).strict();

export type Ros2ControllerResult = z.infer<typeof ros2ControllerResultSchema>;

export interface Ros2DoctorReport {
  rosAvailable: boolean;
  rosDistro: string | null;
  rmwImplementation: string | null;
  rosDomainId: string;
  proposalTopic: string;
  jointStateTopic: string;
  controllerAction: string;
  discoveryTimeoutSeconds?: number;
  jointStateFresh: boolean;
  actionServerAvailable: boolean;
  sros2Enabled: boolean;
  limitations: string[];
  detail?: string;
}

export interface Ros2ReferenceTransport {
  subscribeProposals(handler: (payload: string) => Promise<void>): Promise<void>;
  getFreshJointState(maxAgeMs: number): Promise<JointStateSnapshot>;
  dispatchTrajectory(
    action: JointTrajectoryAction,
    controllerIdentity: string
  ): Promise<Ros2ControllerResult>;
  doctor(): Promise<Ros2DoctorReport>;
  close(): Promise<void>;
}

export class InMemoryReleaseResolver {
  private readonly releases = new Map<string, ExecutablePolicySpec>();

  bind(deviceId: string, proposerIdentity: string, release: ExecutablePolicySpec): void {
    this.releases.set(`${deviceId}\0${proposerIdentity}`, release);
  }

  async resolveActiveRelease(
    deviceId: string,
    proposerIdentity: string
  ): Promise<ExecutablePolicySpec> {
    const release = this.releases.get(`${deviceId}\0${proposerIdentity}`);
    if (!release) throw new Error('active_release_not_found');
    return release;
  }
}

export class InMemoryReleaseRecordStore {
  constructor(private readonly records: Map<string, ReleaseRecord>) {}

  async get(releaseId: string): Promise<ReleaseRecord> {
    const record = this.records.get(releaseId);
    if (!record) throw new Error('release_record_not_found');
    return record;
  }

  async revoke(releaseId: string, reason: string, at: string): Promise<ReleaseRecord> {
    const record = await this.get(releaseId);
    const revoked = {
      ...record,
      state: 'revoked' as const,
      revokedAt: at,
      revokedReason: reason
    };
    this.records.set(releaseId, revoked);
    return revoked;
  }
}

export interface Ros2GatewayResult {
  proposalId: string;
  decision: 'allowed' | 'blocked' | 'failed';
  reason: string;
  hardwareSignalSent: boolean;
  controllerGoalCount: number;
}

interface Ros2GatewayOptions {
  mode?: 'shadow' | 'run';
  controllerIdentity: string;
  releaseResolver: InMemoryReleaseResolver;
  releaseRecords: InMemoryReleaseRecordStore;
  transport: Ros2ReferenceTransport;
  evidence: EvidenceSink;
  /** Read-only observation of the current graph/runtime binding. */
  executionConfiguration?: () => Promise<ExecutionConfiguration | undefined>;
  /** Read-only facts supplied by a trusted runtime adapter or monitor. */
  runtimeAttestation?: () => Promise<RuntimeAttestation | undefined>;
  /** Inject a crash-persistent implementation for restart-safe Run use. */
  proposalReplayRegistry?: Ros2ProposalReplayRegistry;
  now?: () => Date;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Experimental ROS 2 reference gateway. ROS 2 is a source/adapter only:
 * release admission, permits, Shadow Mode and evidence stay in Core.
 */
export class Ros2ReferenceGateway {
  private readonly mode: 'shadow' | 'run';
  private readonly seenProposalIds = new Set<string>();
  private goalCount = 0;

  constructor(private readonly options: Ros2GatewayOptions) {
    this.mode = options.mode ?? 'shadow';
    if (this.mode === 'run' && !options.proposalReplayRegistry) {
      throw new Error('proposal_replay_registry_required');
    }
  }

  private async observeExecutionConfiguration(): Promise<ExecutionConfiguration | undefined> {
    if (!this.options.executionConfiguration) return undefined;
    try {
      return await this.options.executionConfiguration();
    } catch {
      return undefined;
    }
  }

  private async observeRuntimeAttestation(): Promise<RuntimeAttestation | undefined> {
    if (!this.options.runtimeAttestation) return undefined;
    try {
      return await this.options.runtimeAttestation();
    } catch {
      return undefined;
    }
  }

  async start(onResult?: (result: Ros2GatewayResult) => void): Promise<void> {
    let processing = false;
    await this.options.transport.subscribeProposals(async (payload) => {
      if (processing) throw new Error('proposal_backpressure');
      processing = true;
      try {
        const result = await this.handlePayload(payload);
        onResult?.(result);
      } finally {
        processing = false;
      }
    });
  }

  async handlePayload(payload: string): Promise<Ros2GatewayResult> {
    if (Buffer.byteLength(payload, 'utf8') > 65_536) {
      throw new Error('proposal_payload_too_large');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      throw new Error('proposal_payload_malformed_json');
    }
    const parsed = ros2ProposalEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`proposal_schema_invalid:${parsed.error.issues[0]?.message ?? 'unknown'}`);
    const proposal = parsed.data;
    const release = await this.options.releaseResolver.resolveActiveRelease(
      proposal.deviceId,
      proposal.proposerIdentity
    );
    const replayIdentity = {
      releaseId: proposal.releaseId,
      executablePolicyHash: executablePolicyHash(release),
      deviceId: proposal.deviceId,
      proposerIdentity: proposal.proposerIdentity,
      proposalId: proposal.proposalId
    };
    const replayClaim = this.options.proposalReplayRegistry
      ? this.options.proposalReplayRegistry.claim(replayIdentity)
      : this.seenProposalIds.has(proposal.proposalId)
        ? 'duplicate'
        : (() => {
            this.seenProposalIds.add(proposal.proposalId);
            return 'claimed' as const;
          })();
    if (replayClaim !== 'claimed') {
      const reason = replayClaim === 'duplicate'
        ? 'proposal_id_duplicate'
        : replayClaim === 'capacity_exceeded'
          ? 'proposal_replay_registry_capacity_exceeded'
          : 'proposal_replay_registry_unavailable';
      await this.options.evidence.append({
        releaseId: release.metadata.releaseId,
        executablePolicyHash: replayIdentity.executablePolicyHash,
        modelHash: release.model.sha256,
        actionContractHash: sha256(canonicalJson(release.actionContract)),
        robotProfileHash: release.robot.profileSha256,
        controllerProfileHash: release.robot.controllerConfigSha256,
        expectedConfigurationDigest: release.approvedConfigurationDigest ?? null,
        observedConfigurationDigest: null,
        expectedConfigurationSchemaVersion:
          release.executionConfiguration?.schemaVersion ?? null,
        observedConfigurationSchemaVersion: null,
        expectedRequiredCapabilities: [
          ...(release.runtimePolicy.requiredCapabilities ?? []),
        ],
        observedAvailableCapabilities: null,
        runtimePolicyHash: release.runtimePolicy.policySha256,
        deviceId: proposal.deviceId,
        proposalId: proposal.proposalId,
        proposedAction: proposal.actionPayload,
        decision: 'blocked',
        decisionReason: reason,
        matchedRuleIds: ['proposal_replay'],
        decisionMadeAt: (this.options.now?.() ?? new Date()).toISOString(),
        hardwareSignalSent: false,
        hardwareSignalState: 'not_sent',
        executionEvidence: 'not_executed'
      });
      return {
        proposalId: proposal.proposalId,
        decision: 'blocked',
        reason,
        hardwareSignalSent: false,
        controllerGoalCount: this.goalCount
      };
    }
    if (proposal.releaseId !== release.metadata.releaseId) {
      return this.blocked(proposal, 'release_id_mismatch');
    }
    const action = proposal.actionPayload;
    if (release.actionContract.representation !== 'trajectory') {
      return this.blocked(proposal, 'action_representation_mismatch');
    }
    if (!sameOrder(action.jointNames, release.actionContract.jointOrder)) {
      return this.blocked(proposal, 'joint_order_mismatch');
    }
    if (
      release.actionContract.units.position !== action.units.position
      || release.actionContract.units.velocity !== action.units.velocity
    ) {
      return this.blocked(proposal, 'units_mismatch');
    }
    if (this.options.controllerIdentity !== release.robot.controllerConfigSha256) {
      return this.blocked(proposal, 'controller_identity_mismatch');
    }
    if (action.points.some((point) => (
      point.positions.length !== release.actionContract.dimension
      || (point.velocities !== undefined && point.velocities.length !== release.actionContract.dimension)
    ))) {
      return this.blocked(proposal, 'trajectory_dimension_mismatch');
    }

    let state: JointStateSnapshot;
    try {
      state = jointStateSnapshotSchema.parse(
        await this.options.transport.getFreshJointState(release.runtimePolicy.maxStateAgeMs)
      );
    } catch (error) {
      return this.blocked(
        proposal,
        error instanceof Error ? error.message : 'joint_state_missing_or_invalid'
      );
    }
    if (!release.actionContract.jointOrder.every((name) => state.names.includes(name))) {
      return this.blocked(proposal, 'joint_state_order_mismatch');
    }
    const record = await this.options.releaseRecords.get(release.metadata.releaseId);
    const executionConfiguration = await this.observeExecutionConfiguration();
    const runtimeAttestation = await this.observeRuntimeAttestation();
    const now = this.options.now?.() ?? new Date();
    const actionHash = sha256(canonicalJson(action));
    const policy: ActionPolicy<JointTrajectoryAction, JointStateSnapshot> = async () => ({
      allowed: true,
      reason: 'reference_trajectory_contract_passed',
      matchedRuleIds: ['trajectory_contract', 'joint_state_freshness']
    });

    if (this.mode === 'shadow') {
      const gate = new ShadowExecutionGate(this.options.evidence, policy, (candidate) => (
        sha256(canonicalJson(candidate))
      ));
      const decision = await gate.evaluate({
        release,
        releaseRecord: record,
        deviceId: proposal.deviceId,
        proposalId: proposal.proposalId,
        action,
        actionHash,
        state,
        stateObservedAt: state.observedAt,
        controllerIdentity: this.options.controllerIdentity,
        executionConfiguration,
        runtimeAttestation,
        now
      });
      const observedAllowed = decision.reason.startsWith('shadow_observation_only:');
      return {
        proposalId: proposal.proposalId,
        decision: observedAllowed ? 'allowed' : 'blocked',
        reason: decision.reason,
        hardwareSignalSent: false,
        controllerGoalCount: this.goalCount
      };
    }

    const gate = new ReleaseExecutionGate(
      {
        dispatch: async (candidate) => {
          this.goalCount += 1;
          let result;
          try {
            result = await this.options.transport.dispatchTrajectory(
              candidate,
              this.options.controllerIdentity
            );
          } catch (error) {
            throw new Error(
              `controller_dispatch_unknown:${error instanceof Error ? error.message : 'transport_failed'}`
            );
          }
          const parsedResult = ros2ControllerResultSchema.safeParse(result);
          if (!parsedResult.success) throw new Error('controller_result_invalid');
          result = parsedResult.data;
          if (!result.accepted) throw new Error(`controller_goal_rejected:${result.detail}`);
          if (result.completed !== true) {
            throw new Error(`controller_result_unconfirmed:${result.detail}`);
          }
          if (result.succeeded !== true) {
            throw new Error(`controller_goal_failed:${result.errorCode ?? 'unknown'}:${result.detail}`);
          }
          return result;
        }
      },
      this.options.evidence,
      policy,
      (candidate) => sha256(canonicalJson(candidate)),
      async () => this.options.releaseRecords.get(release.metadata.releaseId),
      this.options.executionConfiguration
        ? async () => this.observeExecutionConfiguration()
        : undefined,
      this.options.runtimeAttestation
        ? async () => this.observeRuntimeAttestation()
        : undefined
    );
    const decision = await gate.evaluate({
      release,
      releaseRecord: record,
      deviceId: proposal.deviceId,
      proposalId: proposal.proposalId,
      action,
      actionHash,
      state,
      stateObservedAt: state.observedAt,
      controllerIdentity: this.options.controllerIdentity,
      executionConfiguration,
      runtimeAttestation,
      now
    });
    if (decision.status !== 'allowed') {
      return {
        proposalId: proposal.proposalId,
        decision: 'blocked',
        reason: decision.reason,
        hardwareSignalSent: false,
        controllerGoalCount: this.goalCount
      };
    }
    const goalsBeforeExecution = this.goalCount;
    try {
      await gate.execute({
        ...decision.authorizedRequest,
        now: this.options.now ? this.options.now() : undefined
      });
      return {
        proposalId: proposal.proposalId,
        decision: 'allowed',
        reason: 'reference_goal_dispatched',
        hardwareSignalSent: true,
        controllerGoalCount: this.goalCount
      };
    } catch (error) {
      return {
        proposalId: proposal.proposalId,
        decision: 'failed',
        reason: error instanceof Error ? error.message : 'reference_dispatch_failed',
        hardwareSignalSent: this.goalCount > goalsBeforeExecution,
        controllerGoalCount: this.goalCount
      };
    }
  }

  async revoke(releaseId: string, reason: string): Promise<void> {
    const at = (this.options.now?.() ?? new Date()).toISOString();
    await this.options.releaseRecords.revoke(releaseId, reason, at);
  }

  private async blocked(
    proposal: Ros2ProposalEnvelope,
    reason: string
  ): Promise<Ros2GatewayResult> {
    const release = await this.options.releaseResolver.resolveActiveRelease(
      proposal.deviceId,
      proposal.proposerIdentity
    );
    const record = await this.options.releaseRecords.get(release.metadata.releaseId);
    const executionConfiguration = await this.observeExecutionConfiguration();
    const runtimeAttestation = await this.observeRuntimeAttestation();
    const now = this.options.now?.() ?? new Date();
    const gate = this.mode === 'shadow'
      ? new ShadowExecutionGate<JointTrajectoryAction, JointStateSnapshot>(
        this.options.evidence,
        async () => ({ allowed: false, reason, matchedRuleIds: ['ros2_contract'] }),
        (candidate) => sha256(canonicalJson(candidate))
      )
      : new ReleaseExecutionGate<JointTrajectoryAction, JointStateSnapshot, unknown>(
        { dispatch: async () => { throw new Error('blocked_path_dispatch_forbidden'); } },
        this.options.evidence,
        async () => ({ allowed: false, reason, matchedRuleIds: ['ros2_contract'] }),
        (candidate) => sha256(canonicalJson(candidate))
      );
    await gate.evaluate({
      release,
      releaseRecord: record,
      deviceId: proposal.deviceId,
      proposalId: proposal.proposalId,
      action: proposal.actionPayload,
      actionHash: sha256(canonicalJson(proposal.actionPayload)),
      state: { names: [], positions: [], observedAt: now.toISOString() },
      stateObservedAt: now.toISOString(),
      controllerIdentity: this.options.controllerIdentity,
      executionConfiguration,
      runtimeAttestation,
      now
    });
    return {
      proposalId: proposal.proposalId,
      decision: 'blocked',
      reason,
      hardwareSignalSent: false,
      controllerGoalCount: this.goalCount
    };
  }
}
