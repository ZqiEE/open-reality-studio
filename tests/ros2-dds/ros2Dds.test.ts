import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  InMemoryReleaseResolver,
  InMemoryReleaseRecordStore,
  Ros2ReferenceGateway
} from '../../packages/ros2-reference-gateway';
import { PythonRos2SidecarTransport } from '../../packages/ros2-reference-gateway/sidecar';
import type { EvidenceSink } from '../../packages/core/execution-gate';
import type { ExecutionEvidence } from '../../packages/core/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  configurationDigest,
  executionConfigurationSchema
} from '../../packages/core/execution-configuration';

const fixture = JSON.parse(
  readFileSync('fixtures/cloud-contract/v1/release.json', 'utf8')
);

class CollectingEvidence implements EvidenceSink {
  readonly entries: ExecutionEvidence[] = [];
  append(evidence: ExecutionEvidence): void {
    this.entries.push(evidence);
  }
}

class RevokeOnRefreshStore extends InMemoryReleaseRecordStore {
  private reads = 0;
  override async get(releaseId: string): Promise<ReleaseRecord> {
    const record = await super.get(releaseId);
    this.reads += 1;
    return this.reads >= 2 ? { ...record, state: 'revoked' } : record;
  }
}

async function runCase(
  name: string,
  mode: 'shadow' | 'run',
  revokeOnRefresh = false,
  configurationDrift = false
) {
  const source = structuredClone(fixture.execSpec);
  const topicPrefix = `/rlsok_ci/${name}`;
  source.metadata.releaseId = `dds-${name}`;
  source.deployment.mode = mode === 'shadow' ? 'shadow' : 'canary';
  const boundConfiguration = executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: 'fixture-arm-01',
    robotIdentity: 'fixture-arm',
    rosDistro: 'jazzy',
    rmwImplementation: 'rmw_fastrtps_cpp',
    jointState: {
      topic: `${topicPrefix}/joint_states`,
      messageType: 'sensor_msgs/msg/JointState'
    },
    controller: {
      name: `${name}_controller`,
      followJointTrajectoryAction: `${topicPrefix}/follow_joint_trajectory`,
      actionType: 'control_msgs/action/FollowJointTrajectory'
    },
    jointOrder: ['joint_a', 'joint_b'],
    adapter: { identity: 'ros2-reference-gateway', version: '1.3.1' },
    observedAt: new Date().toISOString()
  });
  source.runtimePolicy.maxConfigurationAgeMs = 60_000;
  source.executionConfiguration = boundConfiguration;
  source.approvedConfigurationDigest = configurationDigest(boundConfiguration);
  const spec = executablePolicySpecSchema.parse(source);
  const identity = executablePolicyHash(spec);
  const record: ReleaseRecord = {
    releaseId: spec.metadata.releaseId,
    state: source.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: 'dds-ci',
    approvedAt: '2026-01-01T00:01:00.000Z'
  };
  const records = revokeOnRefresh
    ? new RevokeOnRefreshStore(new Map([[record.releaseId, record]]))
    : new InMemoryReleaseRecordStore(new Map([[record.releaseId, record]]));
  const resolver = new InMemoryReleaseResolver();
  resolver.bind('fixture-arm-01', 'dds-proposer', spec);
  const transport = new PythonRos2SidecarTransport({
    pythonExecutable: 'python3',
    sidecarPath: resolve('experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py'),
    proposalTopic: `${topicPrefix}/proposal`,
    jointStateTopic: `${topicPrefix}/joint_states`,
    controllerAction: `${topicPrefix}/follow_joint_trajectory`
  });
  const evidence = new CollectingEvidence();
  let configurationReads = 0;
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: records,
    transport,
    evidence,
    executionConfiguration: async () => {
      configurationReads += 1;
      const observed = configurationDrift && configurationReads >= 2
        ? {
            ...boundConfiguration,
            controller: {
              ...boundConfiguration.controller,
              followJointTrajectoryAction: `${topicPrefix}/changed_follow_joint_trajectory`
            }
          }
        : boundConfiguration;
      return executionConfigurationSchema.parse({
        ...observed,
        observedAt: new Date().toISOString()
      });
    }
  });
  const proposal = {
    proposalId: `proposal-${name}`,
    releaseId: spec.metadata.releaseId,
    deviceId: 'fixture-arm-01',
    proposerIdentity: 'dds-proposer',
    actionRepresentation: 'trajectory',
    actionPayload: fixture.action,
    createdAt: new Date().toISOString()
  };
  const fixtureNode = spawn(
    'python3',
    [
      resolve('tests/ros2-dds/fake_ros_graph.py'),
      '--proposal-topic', `${topicPrefix}/proposal`,
      '--joint-state-topic', `${topicPrefix}/joint_states`,
      '--controller-action', `${topicPrefix}/follow_joint_trajectory`,
      '--proposal-base64', Buffer.from(JSON.stringify(proposal)).toString('base64')
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  try {
    const result = await Promise.race([
      new Promise<{
        decision: string;
        hardwareSignalSent: boolean;
        controllerGoalCount: number;
      }>(async (resolveResult) => {
        await gateway.start(resolveResult);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`dds_${name}_timeout`)), 20_000)
      )
    ]);
    const sanitizedEvidence = evidence.entries.map((entry) => ({
      ...entry,
      proposedAction: '[sanitized fixture action]'
    }));
    await mkdir('artifacts/ros2-dds', { recursive: true });
    await writeFile(
      `artifacts/ros2-dds/${name}.json`,
      `${JSON.stringify({ case: name, result, evidence: sanitizedEvidence }, null, 2)}\n`,
      'utf8'
    );
    return { result, evidence: evidence.entries };
  } finally {
    fixtureNode.kill('SIGTERM');
    await transport.close();
  }
}

test('real DDS Shadow case writes zero-dispatch Evidence', async () => {
  const { result, evidence } = await runCase('shadow', 'shadow');
  assert.equal(result.decision, 'allowed');
  assert.equal(result.controllerGoalCount, 0);
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(evidence.at(-1)?.hardwareSignalSent, false);
  assert.equal(evidence.at(-1)?.executionEvidence, 'shadow_not_dispatched');
});

test('real DDS eligible reference run reaches one fake controller goal', async () => {
  const { result, evidence } = await runCase('reference', 'run');
  assert.equal(result.decision, 'allowed');
  assert.equal(result.controllerGoalCount, 1);
  assert.equal(result.hardwareSignalSent, true);
  assert.equal(evidence.at(-1)?.executionEvidence, 'controller_result_recorded');
  assert.deepEqual(evidence.at(-1)?.controllerResult, {
    accepted: true,
    completed: true,
    succeeded: true,
    status: 4,
    errorCode: 0,
    errorString: '',
    detail: 'controller_succeeded'
  });
});

test('real DDS revocation refresh wins the final dispatch race', async () => {
  const { result, evidence } = await runCase('revocation', 'run', true);
  assert.equal(result.decision, 'failed');
  assert.equal(result.controllerGoalCount, 0);
  assert.equal(result.hardwareSignalSent, false);
  assert.match(
    evidence.at(-1)?.decisionReason ?? '',
    /^(?:release_revoked|permit_invalid)$/
  );
});

test('real DDS configuration drift blocks before the fake controller goal', async () => {
  const { result, evidence } = await runCase('configuration_drift', 'run', false, true);
  assert.equal(result.decision, 'failed');
  assert.equal(result.controllerGoalCount, 0);
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(evidence.at(-1)?.decisionReason, 'configuration_mismatch');
  assert.equal(evidence.at(-1)?.hardwareSignalSent, false);
});
