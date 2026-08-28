import { z } from 'zod';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate,
  type ActionPolicy,
  type EvidenceSink
} from '../core/execution-gate';
import { canonicalJson, sha256 } from '../core/evidence';
import type { ExecutablePolicySpec } from '../core/exec-spec';
import type { ExecutionConfiguration } from '../core/execution-configuration';
import type { ReleaseRecord } from '../core/release-policy';
import type { RuntimeAttestation } from '../core/runtime-attestation';

export const HUSARION_ROSBOT_MESSAGE_TYPE = 'geometry_msgs/msg/TwistStamped';
export const HUSARION_ROSBOT_ODOMETRY_TYPE = 'nav_msgs/msg/Odometry';
export const HUSARION_ROSBOT_COMMAND_TOPIC = 'cmd_vel';
export const HUSARION_ROSBOT_STATE_TOPIC = 'odometry/filtered';
export const HUSARION_ROSBOT_CONTROLLER = 'twist_mux_controller/TwistMuxController';
export const HUSARION_ROSBOT_COMMAND_CHANNELS = ['linear.x', 'angular.z'] as const;
export const HUSARION_ROSBOT_VELOCITY_UNITS =
  'linear_meter_per_second;angular_radian_per_second';

const identity = z.string().trim().min(1).max(512);
const isoTimestamp = z.string().datetime({ offset: true });

const twistCandidateSchema = z.object({
  representation: identity,
  messageType: identity,
  targetTopic: identity,
  frameId: identity,
  linear: z.object({ x: z.number().finite() }).strict(),
  angular: z.object({ z: z.number().finite() }).strict(),
  units: z.object({
    linear: identity,
    angular: identity
  }).strict()
}).strict();

export const rosbotTwistActionSchema = twistCandidateSchema.extend({
  representation: z.literal('twist'),
  messageType: z.literal(HUSARION_ROSBOT_MESSAGE_TYPE),
  targetTopic: z.literal(HUSARION_ROSBOT_COMMAND_TOPIC),
  frameId: z.literal('base_link'),
  units: z.object({
    linear: z.literal('meter_per_second'),
    angular: z.literal('radian_per_second')
  }).strict()
}).strict();

export type RosbotTwistAction = z.infer<typeof rosbotTwistActionSchema>;
type RosbotTwistCandidate = z.infer<typeof twistCandidateSchema>;

export const rosbotProposalSchema = z.object({
  proposalId: identity,
  releaseId: identity,
  deviceId: identity,
  proposerIdentity: identity,
  actionRepresentation: identity,
  actionPayload: twistCandidateSchema,
  createdAt: isoTimestamp
}).strict();

export type RosbotProposal = z.infer<typeof rosbotProposalSchema>;

export const rosbotOdometryObservationSchema = z.object({
  topic: z.literal(HUSARION_ROSBOT_STATE_TOPIC),
  messageType: z.literal(HUSARION_ROSBOT_ODOMETRY_TYPE),
  linearX: z.number().finite(),
  angularZ: z.number().finite(),
  observedAt: isoTimestamp,
  sourceTimestamp: isoTimestamp.optional()
}).strict();

export type RosbotOdometryObservation = z.infer<typeof rosbotOdometryObservationSchema>;

export interface HusarionRosbotTransport {
  getOdometryObservation(): Promise<unknown | undefined>;
  waitForCommandPathReady(): Promise<boolean>;
  publishVelocity(action: RosbotTwistAction): Promise<{
    published: true;
    topic: string;
    messageType: typeof HUSARION_ROSBOT_MESSAGE_TYPE;
  }>;
  close(): Promise<void>;
}

export interface HusarionRosbotGatewayResult {
  proposalId: string;
  decision: 'allowed' | 'blocked' | 'failed';
  reason: string;
  hardwareSignalSent: boolean;
  publicationCount: number;
}

export type PreparedRosbotProposal =
  | { result: HusarionRosbotGatewayResult; execute?: never }
  | { result?: never; execute(): Promise<HusarionRosbotGatewayResult> };

interface HusarionRosbotGatewayOptions {
  mode: 'shadow' | 'run';
  release: ExecutablePolicySpec;
  expectedProposerIdentity: string;
  controllerIdentity: string;
  releaseRecord: () => Promise<ReleaseRecord>;
  executionConfiguration: () => Promise<ExecutionConfiguration | undefined>;
  runtimeAttestation?: () => Promise<RuntimeAttestation | undefined>;
  transport: HusarionRosbotTransport;
  evidence: EvidenceSink;
  now?: () => Date;
}

export function rosbotTwistActionHash(action: RosbotTwistAction): string {
  return sha256(canonicalJson(rosbotTwistActionSchema.parse(action)));
}

export function normalizeRosNamespace(value = ''): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (!/^[A-Za-z][A-Za-z0-9_]*(\/[A-Za-z][A-Za-z0-9_]*)*$/.test(trimmed)) {
    throw new Error('ros_namespace_invalid');
  }
  return trimmed;
}

export function resolveRosbotTopic(
  namespace: string,
  logicalTopic: typeof HUSARION_ROSBOT_COMMAND_TOPIC | typeof HUSARION_ROSBOT_STATE_TOPIC
): string {
  if (![HUSARION_ROSBOT_COMMAND_TOPIC, HUSARION_ROSBOT_STATE_TOPIC].includes(logicalTopic)) {
    throw new Error('rosbot_topic_not_allowed');
  }
  const normalized = normalizeRosNamespace(namespace);
  return `/${normalized ? `${normalized}/` : ''}${logicalTopic}`;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function configurationContractReason(
  configuration: ExecutionConfiguration | undefined
): string | null {
  if (!configuration) return null;
  if (configuration.schemaVersion !== 2) return 'configuration_version_unsupported';
  if (
    configuration.semanticContract.command.interfaceType !== HUSARION_ROSBOT_MESSAGE_TYPE
    || configuration.semanticContract.command.endpoint !== HUSARION_ROSBOT_COMMAND_TOPIC
  ) {
    return 'configuration_command_mismatch';
  }
  if (configuration.semanticContract.controller.implementation !== HUSARION_ROSBOT_CONTROLLER) {
    return 'configuration_controller_mismatch';
  }
  const channels = configuration.semanticContract.jointCommandMapping
    .map((entry) => entry.joint);
  return sameValues(channels, HUSARION_ROSBOT_COMMAND_CHANNELS)
    ? null
    : 'configuration_command_mapping_mismatch';
}

function commandContractReason(
  proposal: RosbotProposal,
  release: ExecutablePolicySpec,
  configuration: ExecutionConfiguration | undefined
): string | null {
  const action = proposal.actionPayload;
  if (
    proposal.actionRepresentation !== 'twist'
    || action.representation !== 'twist'
    || release.actionContract.representation !== 'twist'
  ) return 'action_representation_mismatch';
  if (action.messageType !== HUSARION_ROSBOT_MESSAGE_TYPE) return 'action_type_mismatch';
  if (action.targetTopic !== HUSARION_ROSBOT_COMMAND_TOPIC) return 'command_topic_mismatch';
  if (action.frameId !== 'base_link') return 'command_frame_mismatch';
  if (
    action.units.linear !== 'meter_per_second'
    || action.units.angular !== 'radian_per_second'
    || release.actionContract.units.position !== 'meter'
    || release.actionContract.units.velocity !== HUSARION_ROSBOT_VELOCITY_UNITS
  ) return 'units_mismatch';
  if (
    release.actionContract.dimension !== HUSARION_ROSBOT_COMMAND_CHANNELS.length
    || !sameValues(release.actionContract.jointOrder, HUSARION_ROSBOT_COMMAND_CHANNELS)
  ) return 'action_channels_mismatch';
  return configurationContractReason(configuration);
}

/**
 * Husarion ROSbot Gazebo reference integration for RLSOK execution authorization.
 * Core owns eligibility, permits, configuration binding, Shadow, and Evidence.
 * This adapter can publish only to the public cmd_vel input of Husarion's mux.
 */
export class HusarionRosbotGazeboGateway {
  private readonly seenProposalIds = new Set<string>();
  private publicationCount = 0;

  constructor(private readonly options: HusarionRosbotGatewayOptions) {}

  private async observeConfiguration(): Promise<ExecutionConfiguration | undefined> {
    try {
      return await this.options.executionConfiguration();
    } catch {
      return undefined;
    }
  }

  private async observeAttestation(): Promise<RuntimeAttestation | undefined> {
    if (!this.options.runtimeAttestation) return undefined;
    try {
      return await this.options.runtimeAttestation();
    } catch {
      return undefined;
    }
  }

  async prepareProposal(input: unknown): Promise<PreparedRosbotProposal> {
    const parsed = rosbotProposalSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`proposal_schema_invalid:${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    const proposal = parsed.data;
    if (this.seenProposalIds.has(proposal.proposalId)) {
      throw new Error('proposal_id_duplicate');
    }
    this.seenProposalIds.add(proposal.proposalId);

    const release = this.options.release;
    const record = await this.options.releaseRecord();
    const configuration = await this.observeConfiguration();
    const runtimeAttestation = await this.observeAttestation();
    let commandPathReady = false;
    try {
      commandPathReady = await this.options.transport.waitForCommandPathReady();
    } catch {
      commandPathReady = false;
    }
    if (!commandPathReady) {
      return { result: {
        proposalId: proposal.proposalId,
        decision: 'failed',
        reason: 'command_path_unavailable',
        hardwareSignalSent: false,
        publicationCount: this.publicationCount
      } };
    }
    let state: RosbotOdometryObservation | undefined;
    try {
      const observed = await this.options.transport.getOdometryObservation();
      const stateResult = rosbotOdometryObservationSchema.safeParse(observed);
      state = stateResult.success ? stateResult.data : undefined;
    } catch {
      state = undefined;
    }
    // State acquisition can block on live ROS discovery. Evaluate freshness
    // against the time after that observation, never a pre-wait timestamp.
    const now = this.options.now?.() ?? new Date();

    let contractReason = commandContractReason(proposal, release, configuration);
    if (proposal.releaseId !== release.metadata.releaseId) {
      contractReason = 'release_id_mismatch';
    } else if (proposal.proposerIdentity !== this.options.expectedProposerIdentity) {
      contractReason = 'proposer_identity_mismatch';
    } else if (this.options.controllerIdentity !== release.robot.controllerConfigSha256) {
      contractReason = 'controller_identity_mismatch';
    }
    const actionCandidate: RosbotTwistCandidate = proposal.actionPayload;
    const actionHash = sha256(canonicalJson(actionCandidate));
    const policy: ActionPolicy<RosbotTwistCandidate, RosbotOdometryObservation> = async () => ({
      allowed: contractReason === null,
      reason: contractReason ?? 'husarion_rosbot_twist_contract_passed',
      matchedRuleIds: ['husarion_rosbot_twist_contract', 'odometry_freshness']
    });
    const request = {
      release,
      releaseRecord: record,
      deviceId: proposal.deviceId,
      proposalId: proposal.proposalId,
      action: actionCandidate,
      actionHash,
      state,
      stateObservedAt: state?.observedAt,
      controllerIdentity: this.options.controllerIdentity,
      executionConfiguration: configuration,
      runtimeAttestation,
      now
    };

    if (this.options.mode === 'shadow') {
      const gate = new ShadowExecutionGate(this.options.evidence, policy, (candidate) => (
        sha256(canonicalJson(candidate))
      ));
      const decision = await gate.evaluate(request);
      const observedAllowed = decision.reason.startsWith('shadow_observation_only:');
      return { result: {
        proposalId: proposal.proposalId,
        decision: observedAllowed ? 'allowed' : 'blocked',
        reason: decision.reason,
        hardwareSignalSent: false,
        publicationCount: this.publicationCount
      } };
    }

    const actionResult = rosbotTwistActionSchema.safeParse(actionCandidate);
    const gate = new ReleaseExecutionGate<
      RosbotTwistCandidate,
      RosbotOdometryObservation,
      Awaited<ReturnType<HusarionRosbotTransport['publishVelocity']>>
    >(
      {
        dispatch: async (candidate) => {
          if (!actionResult.success) throw new Error('invalid_twist_dispatch_forbidden');
          const published = await this.options.transport.publishVelocity(actionResult.data);
          this.publicationCount += 1;
          return published;
        }
      },
      this.options.evidence,
      policy,
      (candidate) => sha256(canonicalJson(candidate)),
      async () => this.options.releaseRecord(),
      async () => this.observeConfiguration(),
      this.options.runtimeAttestation
        ? async () => this.observeAttestation()
        : undefined
    );
    const decision = await gate.evaluate(request);
    if (decision.status !== 'allowed') {
      return { result: {
        proposalId: proposal.proposalId,
        decision: 'blocked',
        reason: decision.reason,
        hardwareSignalSent: false,
        publicationCount: this.publicationCount
      } };
    }

    return {
      execute: async () => {
        const publicationsBefore = this.publicationCount;
        try {
          await gate.execute({
            ...decision.authorizedRequest,
            now: this.options.now?.()
          });
          return {
            proposalId: proposal.proposalId,
            decision: 'allowed',
            reason: 'rosbot_velocity_published',
            hardwareSignalSent: true,
            publicationCount: this.publicationCount
          };
        } catch (error) {
          return {
            proposalId: proposal.proposalId,
            decision: 'failed',
            reason: error instanceof Error ? error.message : 'rosbot_velocity_publish_failed',
            hardwareSignalSent: this.publicationCount > publicationsBefore,
            publicationCount: this.publicationCount
          };
        }
      }
    };
  }

  async handleProposal(input: unknown): Promise<HusarionRosbotGatewayResult> {
    const prepared = await this.prepareProposal(input);
    return prepared.result ?? prepared.execute();
  }
}
