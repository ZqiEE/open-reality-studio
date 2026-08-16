import {
  appendEvidence,
  verifyEvidenceBundle,
  type ChainedEvidence,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  configurationDigest,
  executionConfigurationSchema,
  type ExecutionConfiguration
} from '../../packages/core/execution-configuration';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  InMemoryReleaseRecordStore,
  InMemoryReleaseResolver,
  Ros2ReferenceGateway,
  type JointStateSnapshot,
  type JointTrajectoryAction,
  type Ros2DoctorReport,
  type Ros2ReferenceTransport
} from '../../packages/ros2-reference-gateway';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const HASH = (value: string): string => value.repeat(64);

export const DEPLOYMENT_EXECUTION_OUTPUT = [
  'Deployment PASS',
  'Initial authorization ALLOW',
  'Configuration changed BLOCK',
  'Configuration restored ALLOW',
  'Release revoked BLOCK',
  'Evidence verification PASS',
  'The software remained deployed. Only execution authorization changed.'
] as const;

export interface DeploymentExecutionDemoResult {
  lines: string[];
  evidenceBundle: EvidenceBundle;
  dispatchCount: number;
  deployedBefore: string;
  deployedAfter: string;
}

function requireCondition(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`demo_invariant_failed:${reason}`);
}

function configuration(): ExecutionConfiguration {
  return executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: 'arm-demo-01',
    robotIdentity: 'reference-arm',
    rosDistro: 'jazzy',
    rmwImplementation: 'rmw_fastrtps_cpp',
    jointState: {
      topic: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState'
    },
    controller: {
      name: 'joint_trajectory_controller',
      followJointTrajectoryAction: '/joint_trajectory_controller/follow_joint_trajectory',
      actionType: 'control_msgs/action/FollowJointTrajectory'
    },
    jointOrder: ['joint_a', 'joint_b'],
    adapter: { identity: 'ros2-reference-gateway', version: '1.3.1' },
    observedAt: NOW.toISOString()
  });
}

function release(bound: ExecutionConfiguration): ExecutablePolicySpec {
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'deployment-execution-demo',
      releaseId: 'release-a',
      createdAt: '2026-08-01T10:00:00.000Z'
    },
    model: {
      artifact: 'artifacts/artifact-a',
      sha256: HASH('a'),
      framework: 'ros2',
      policyType: 'joint-trajectory',
      codeRevision: 'release-a'
    },
    actionContract: {
      representation: 'trajectory',
      dimension: 2,
      jointOrder: ['joint_a', 'joint_b'],
      units: { position: 'radian', velocity: 'radian_per_second' },
      normalizerSha256: HASH('b'),
      preprocessorSha256: HASH('c'),
      postprocessorSha256: HASH('d')
    },
    robot: {
      profileId: 'reference-arm',
      profileSha256: HASH('e'),
      urdfSha256: HASH('f'),
      controllerType: 'joint_trajectory_controller',
      controllerConfigSha256: HASH('1')
    },
    runtimePolicy: {
      policySha256: HASH('2'),
      maxStateAgeMs: 1_000,
      maxConfigurationAgeMs: 1_000,
      failClosed: true
    },
    executionConfiguration: bound,
    approvedConfigurationDigest: configurationDigest(bound),
    evidence: {
      scenarioPackId: 'deployment-execution-demo-v1',
      testReportSha256: HASH('3'),
      status: 'approved',
      approvedBy: 'release-approver@example.test',
      approvedAt: '2026-08-01T11:00:00.000Z'
    },
    deployment: {
      allowedDeviceIds: ['arm-demo-01'],
      mode: 'shadow',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  });
}

function action(): JointTrajectoryAction {
  return {
    representation: 'trajectory',
    jointNames: ['joint_a', 'joint_b'],
    points: [{ positions: [0.1, -0.1], velocities: [0, 0], timeFromStartMs: 250 }],
    units: { position: 'radian', velocity: 'radian_per_second' }
  };
}

function proposal(spec: ExecutablePolicySpec, proposalId: string): string {
  return JSON.stringify({
    proposalId,
    releaseId: spec.metadata.releaseId,
    deviceId: 'arm-demo-01',
    proposerIdentity: 'demo-planner',
    actionRepresentation: 'trajectory',
    actionPayload: action(),
    createdAt: NOW.toISOString()
  });
}

class DemoTransport implements Ros2ReferenceTransport {
  dispatchCount = 0;

  async subscribeProposals(): Promise<void> {}

  async getFreshJointState(): Promise<JointStateSnapshot> {
    return {
      names: ['joint_a', 'joint_b'],
      positions: [0, 0],
      observedAt: NOW.toISOString()
    };
  }

  async dispatchTrajectory(): Promise<never> {
    this.dispatchCount += 1;
    throw new Error('shadow_demo_dispatch_forbidden');
  }

  async cancelActiveGoal(): Promise<{ requested: boolean; detail: string }> {
    return { requested: false, detail: 'shadow_has_no_active_goal' };
  }

  async doctor(): Promise<Ros2DoctorReport> {
    return {
      rosAvailable: true,
      rosDistro: 'jazzy',
      rmwImplementation: 'rmw_fastrtps_cpp',
      rosDomainId: '0',
      proposalTopic: '/rlsok/action_proposals',
      jointStateTopic: '/joint_states',
      controllerAction: '/joint_trajectory_controller/follow_joint_trajectory',
      jointStateFresh: true,
      actionServerAvailable: false,
      sros2Enabled: false,
      limitations: ['shadow_demo_no_hardware_dispatch']
    };
  }

  async close(): Promise<void> {}
}

export async function runDeploymentExecutionDemo(
  writeLine: (line: string) => void = console.log
): Promise<DeploymentExecutionDemoResult> {
  const boundConfiguration = configuration();
  let observedConfiguration = boundConfiguration;
  const spec = release(boundConfiguration);
  const identity = executablePolicyHash(spec);
  const deployedArtifacts = new Map([[spec.metadata.releaseId, spec.model.sha256]]);
  const deployedBefore = deployedArtifacts.get(spec.metadata.releaseId)!;
  const resolver = new InMemoryReleaseResolver();
  resolver.bind('arm-demo-01', 'demo-planner', spec);
  const releaseRecord: ReleaseRecord = {
    releaseId: spec.metadata.releaseId,
    state: 'shadow',
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: spec.evidence.approvedBy,
    approvedAt: spec.evidence.approvedAt
  };
  const records = new InMemoryReleaseRecordStore(new Map([[spec.metadata.releaseId, releaseRecord]]));
  const transport = new DemoTransport();
  let entries: ChainedEvidence[] = [];
  const gateway = new Ros2ReferenceGateway({
    mode: 'shadow',
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: records,
    transport,
    executionConfiguration: async () => observedConfiguration,
    evidence: {
      append: (evidence: ExecutionEvidence) => {
        entries = [...entries, appendEvidence(entries, evidence)];
      }
    },
    now: () => NOW
  });

  requireCondition(deployedBefore === spec.model.sha256, 'artifact_a_not_deployed');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[0]);

  const initial = await gateway.handlePayload(proposal(spec, 'proposal-initial'));
  requireCondition(initial.decision === 'allowed', 'initial_authorization_not_allowed');
  requireCondition(initial.hardwareSignalSent === false, 'initial_shadow_sent_hardware_signal');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[1]);

  observedConfiguration = executionConfigurationSchema.parse({
    ...boundConfiguration,
    controller: {
      ...boundConfiguration.controller,
      followJointTrajectoryAction: '/changed_controller/follow_joint_trajectory'
    }
  });
  const changed = await gateway.handlePayload(proposal(spec, 'proposal-changed'));
  requireCondition(changed.decision === 'blocked', 'changed_configuration_not_blocked');
  requireCondition(changed.reason === 'configuration_mismatch', 'changed_configuration_wrong_reason');
  requireCondition(deployedArtifacts.get(spec.metadata.releaseId) === deployedBefore, 'artifact_changed_with_configuration');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[2]);

  observedConfiguration = boundConfiguration;
  const restored = await gateway.handlePayload(proposal(spec, 'proposal-restored'));
  requireCondition(restored.decision === 'allowed', 'restored_configuration_not_allowed');
  requireCondition(restored.hardwareSignalSent === false, 'restored_shadow_sent_hardware_signal');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[3]);

  await gateway.revoke(spec.metadata.releaseId, 'demo_revocation');
  const revoked = await gateway.handlePayload(proposal(spec, 'proposal-revoked'));
  requireCondition(revoked.decision === 'blocked', 'revoked_release_not_blocked');
  requireCondition(revoked.reason === 'release_revoked', 'revoked_release_wrong_reason');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[4]);

  const bundle: EvidenceBundle = {
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: spec.metadata.releaseId,
    executablePolicyHash: identity,
    createdAt: NOW.toISOString(),
    entries
  };
  requireCondition(verifyEvidenceBundle(bundle).ok, 'evidence_verification_failed');
  requireCondition(transport.dispatchCount === 0, 'shadow_dispatch_count_nonzero');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[5]);

  const deployedAfter = deployedArtifacts.get(spec.metadata.releaseId)!;
  requireCondition(deployedAfter === deployedBefore, 'software_no_longer_deployed');
  writeLine(DEPLOYMENT_EXECUTION_OUTPUT[6]);

  return {
    lines: [...DEPLOYMENT_EXECUTION_OUTPUT],
    evidenceBundle: bundle,
    dispatchCount: transport.dispatchCount,
    deployedBefore,
    deployedAfter
  };
}

if (require.main === module) {
  void runDeploymentExecutionDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
