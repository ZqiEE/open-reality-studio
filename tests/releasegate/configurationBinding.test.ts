import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configurationDigest,
  evaluateConfigurationBinding,
  executionConfigurationSchema,
  executionConfigurationV1Schema,
  type ExecutionConfigurationV1
} from '../../packages/core/execution-configuration';
import { appendEvidence, canonicalJson, sha256, verifyEvidenceBundle, type ExecutionEvidence } from '../../packages/core/evidence';
import { executablePolicyHash, executablePolicySpecSchema } from '../../packages/core/exec-spec';
import { ReleaseExecutionGate, ShadowExecutionGate } from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';

const H = (character: string) => character.repeat(64);
const NOW = new Date('2026-08-16T00:00:00.000Z');

function configuration(overrides: Partial<ExecutionConfigurationV1> = {}): ExecutionConfigurationV1 {
  return executionConfigurationV1Schema.parse({
    schemaVersion: 1,
    deviceIdentity: 'robot-cell-a',
    robotIdentity: H('e'),
    rosDistro: 'jazzy',
    rmwImplementation: 'rmw_fastrtps_cpp',
    jointState: {
      topic: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState'
    },
    controller: {
      name: 'scaled_joint_trajectory_controller',
      followJointTrajectoryAction: '/scaled_joint_trajectory_controller/follow_joint_trajectory',
      actionType: 'control_msgs/action/FollowJointTrajectory'
    },
    jointOrder: ['shoulder', 'elbow'],
    adapter: { identity: 'rlsok-ros2-sidecar', version: '1.3.1' },
    observedAt: NOW.toISOString(),
    ...overrides
  });
}

function release(current = configuration()) {
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'configuration-binding-test',
      releaseId: 'configuration-binding-release',
      createdAt: NOW.toISOString()
    },
    model: {
      artifact: 'artifacts/test',
      sha256: H('a'),
      framework: 'ros2',
      policyType: 'joint-trajectory',
      codeRevision: 'test'
    },
    actionContract: {
      representation: 'trajectory',
      dimension: 2,
      jointOrder: ['shoulder', 'elbow'],
      units: { position: 'radian', velocity: 'radian_per_second' },
      normalizerSha256: H('b'),
      preprocessorSha256: H('c'),
      postprocessorSha256: H('d')
    },
    robot: {
      profileId: 'test-robot',
      profileSha256: H('e'),
      urdfSha256: H('f'),
      controllerType: 'joint_trajectory_controller',
      controllerConfigSha256: H('1')
    },
    runtimePolicy: {
      policySha256: H('2'),
      maxStateAgeMs: 1000,
      maxConfigurationAgeMs: 60_000,
      failClosed: true
    },
    executionConfiguration: current,
    approvedConfigurationDigest: configurationDigest(current),
    evidence: {
      scenarioPackId: 'configuration-binding',
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'approver',
      approvedAt: NOW.toISOString()
    },
    deployment: {
      allowedDeviceIds: ['robot-cell-a'],
      mode: 'released',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  });
}

function record(spec: ReturnType<typeof release>): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state: 'released',
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: 'approver',
    approvedAt: NOW.toISOString()
  };
}

test('configuration digest is canonical and excludes friendly metadata', () => {
  const original = configuration({
    metadata: { friendlyName: 'Cell A', description: 'first description', ui: { color: 'blue' } }
  });
  const reordered = executionConfigurationSchema.parse({
    metadata: { ui: { color: 'red' }, description: 'changed', friendlyName: 'Renamed' },
    observedAt: new Date(NOW.getTime() + 1000).toISOString(),
    adapter: { version: '1.3.1', identity: 'rlsok-ros2-sidecar' },
    jointOrder: ['shoulder', 'elbow'],
    controller: {
      actionType: 'control_msgs/action/FollowJointTrajectory',
      followJointTrajectoryAction: '/scaled_joint_trajectory_controller/follow_joint_trajectory',
      name: 'scaled_joint_trajectory_controller'
    },
    jointState: { messageType: 'sensor_msgs/msg/JointState', topic: '/joint_states' },
    rmwImplementation: 'rmw_fastrtps_cpp',
    rosDistro: 'jazzy',
    robotIdentity: H('e'),
    deviceIdentity: 'robot-cell-a',
    schemaVersion: 1
  });
  assert.equal(configurationDigest(original), configurationDigest(reordered));
});

test('security-critical configuration changes produce different digests', () => {
  const original = configuration();
  const cases = [
    configuration({ deviceIdentity: 'robot-cell-b' }),
    configuration({
      controller: {
        ...original.controller,
        followJointTrajectoryAction: '/other_controller/follow_joint_trajectory'
      }
    }),
    configuration({ jointOrder: ['elbow', 'shoulder'] })
  ];
  for (const changed of cases) {
    assert.notEqual(configurationDigest(original), configurationDigest(changed));
  }
});

test('binding evaluation distinguishes matching, missing, stale, mismatch, and legacy', () => {
  const current = configuration();
  const approvedConfigurationDigest = configurationDigest(current);
  assert.deepEqual(
    evaluateConfigurationBinding({
      approvedConfigurationDigest,
      observedConfiguration: current,
      mode: 'run',
      maxAgeMs: 60_000,
      now: NOW
    }).reason,
    null
  );
  const missing = evaluateConfigurationBinding({ approvedConfigurationDigest, mode: 'run', maxAgeMs: 60_000, now: NOW });
  assert.equal(missing.reason, 'configuration_missing');
  assert.equal(missing.legacyUnbound, false);
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest,
    observedConfiguration: configuration({ observedAt: new Date(NOW.getTime() - 60_001).toISOString() }),
    mode: 'run', maxAgeMs: 60_000, now: NOW
  }).reason, 'configuration_stale');
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest,
    observedConfiguration: configuration({ observedAt: new Date(NOW.getTime() + 1).toISOString() }),
    mode: 'run', maxAgeMs: 60_000, now: NOW
  }).reason, 'configuration_stale');
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest,
    observedConfiguration: configuration({ deviceIdentity: 'robot-cell-b' }),
    mode: 'run', maxAgeMs: 60_000, now: NOW
  }).reason, 'configuration_mismatch');
  assert.equal(evaluateConfigurationBinding({ mode: 'run', maxAgeMs: 60_000, now: NOW }).reason, 'configuration_unbound');
  assert.equal(evaluateConfigurationBinding({ mode: 'shadow', maxAgeMs: 60_000, now: NOW }).allowed, true);
});

test('configuration drift invalidates an issued permit before zero dispatch and is recorded in Evidence', async () => {
  const approved = configuration();
  let observed = approved;
  const spec = release(approved);
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const action = { jointNames: ['shoulder', 'elbow'], positions: [0, 0] };
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value)),
    async () => record(spec),
    async () => observed
  );
  const evaluated = await gate.evaluate({
    release: spec,
    releaseRecord: record(spec),
    deviceId: 'robot-cell-a',
    proposalId: 'proposal-1',
    action,
    actionHash: sha256(canonicalJson(action)),
    state: { positions: [0, 0] },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: observed,
    now: NOW
  });
  assert.equal(evaluated.status, 'allowed');
  if (evaluated.status !== 'allowed') throw new Error('permit missing');
  observed = configuration({
    controller: {
      ...approved.controller,
      followJointTrajectoryAction: '/changed/follow_joint_trajectory'
    }
  });
  await assert.rejects(gate.execute(evaluated.authorizedRequest), /execution_permit_invalid/);
  assert.equal(dispatches, 0);
  const evidence = entries.at(-1)!;
  assert.equal(evidence.decision, 'blocked');
  assert.equal(evidence.decisionReason, 'configuration_mismatch');
  assert.equal(evidence.expectedConfigurationDigest, configurationDigest(approved));
  assert.equal(evidence.observedConfigurationDigest, configurationDigest(observed));
  const chained = appendEvidence([], evidence);
  assert.deepEqual(verifyEvidenceBundle({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: spec.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(spec),
    createdAt: NOW.toISOString(),
    entries: [chained]
  }), { ok: true });
});

test('issued permit retains its configuration binding if the request is mutated', async () => {
  const spec = release();
  const action = { jointNames: ['shoulder', 'elbow'], positions: [0, 0] };
  const actionHash = sha256(canonicalJson(action));
  let dispatches = 0;
  const entries: ExecutionEvidence[] = [];
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const decision = await gate.evaluate({
    release: spec,
    releaseRecord: record(spec),
    deviceId: 'robot-cell-a',
    proposalId: 'configuration-permit-binding',
    action,
    actionHash,
    state: { positions: [0, 0] },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: spec.executionConfiguration,
    now: NOW
  });
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('permit missing');

  const changed = configuration({ robotIdentity: H('9') });
  decision.authorizedRequest.release.executionConfiguration = changed;
  decision.authorizedRequest.release.approvedConfigurationDigest = configurationDigest(changed);
  decision.authorizedRequest.executionConfiguration = changed;

  await assert.rejects(
    gate.execute(decision.authorizedRequest),
    /execution_permit_invalid:configuration_mismatch/
  );
  assert.equal(dispatches, 0);
  assert.equal(entries.at(-1)?.decisionReason, 'configuration_mismatch');
});

test('release gate applies configuration max age and fails closed when refresh throws', async () => {
  const staleConfiguration = configuration({
    observedAt: new Date(NOW.getTime() - 120_000).toISOString()
  });
  const staleSpec = release(staleConfiguration);
  const action = { jointNames: ['shoulder', 'elbow'], positions: [0, 0] };
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const staleGate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const staleDecision = await staleGate.evaluate({
    release: staleSpec,
    releaseRecord: record(staleSpec),
    deviceId: 'robot-cell-a',
    proposalId: 'stale-configuration',
    action,
    actionHash: sha256(canonicalJson(action)),
    state: { positions: [0, 0] },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: staleConfiguration,
    now: NOW
  });
  assert.equal(staleDecision.status, 'blocked');
  assert.equal(staleDecision.reason, 'configuration_stale');

  const spec = release();
  const refreshGate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value)),
    async () => record(spec),
    async () => { throw new Error('configuration monitor unavailable'); }
  );
  const allowed = await refreshGate.evaluate({
    release: spec,
    releaseRecord: record(spec),
    deviceId: 'robot-cell-a',
    proposalId: 'configuration-refresh-failure',
    action,
    actionHash: sha256(canonicalJson(action)),
    state: { positions: [0, 0] },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: spec.executionConfiguration,
    now: NOW
  });
  assert.equal(allowed.status, 'allowed');
  if (allowed.status !== 'allowed') throw new Error('permit missing');
  await assert.rejects(
    refreshGate.execute(allowed.authorizedRequest),
    /execution_permit_invalid:configuration_missing/
  );
  assert.equal(dispatches, 0);
});

test('Shadow configuration mismatch always records zero hardware signal', async () => {
  const approved = configuration();
  const spec = release(approved);
  const entries: ExecutionEvidence[] = [];
  const action = { jointNames: ['shoulder', 'elbow'] };
  const shadow = new ShadowExecutionGate(
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const result = await shadow.evaluate({
    release: { ...spec, deployment: { ...spec.deployment, mode: 'shadow' } },
    releaseRecord: {
      ...record(spec),
      state: 'shadow',
      executablePolicyHash: executablePolicyHash({ ...spec, deployment: { ...spec.deployment, mode: 'shadow' } }),
      approvedIdentityHash: executablePolicyHash({ ...spec, deployment: { ...spec.deployment, mode: 'shadow' } })
    },
    deviceId: 'robot-cell-a', proposalId: 'shadow-1', action,
    actionHash: sha256(canonicalJson(action)), state: {}, stateObservedAt: NOW.toISOString(),
    executionConfiguration: configuration({ jointOrder: ['elbow', 'shoulder'] }), now: NOW
  });
  assert.equal(result.reason, 'configuration_mismatch');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  assert.equal(entries.at(-1)?.observedConfigurationDigest, configurationDigest(configuration({ jointOrder: ['elbow', 'shoulder'] })));
});

test('legacy unbound releases remain observable in Shadow but cannot dispatch', async () => {
  const bound = release();
  const legacySource = structuredClone(bound) as Record<string, unknown>;
  delete legacySource.executionConfiguration;
  delete legacySource.approvedConfigurationDigest;
  legacySource.deployment = {
    ...bound.deployment,
    mode: 'shadow'
  };
  const legacy = executablePolicySpecSchema.parse(legacySource);
  const identity = executablePolicyHash(legacy);
  const entries: ExecutionEvidence[] = [];
  const action = { jointNames: ['shoulder', 'elbow'] };
  const shadow = new ShadowExecutionGate(
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const decision = await shadow.evaluate({
    release: legacy,
    releaseRecord: {
      releaseId: legacy.metadata.releaseId,
      state: 'shadow',
      executablePolicyHash: identity,
      approvedIdentityHash: identity
    },
    deviceId: 'robot-cell-a',
    proposalId: 'legacy-shadow',
    action,
    actionHash: sha256(canonicalJson(action)),
    state: {},
    stateObservedAt: NOW.toISOString(),
    now: NOW
  });
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reason, 'shadow_observation_only:configuration_unbound');
  assert.equal(entries.at(-1)?.decision, 'allowed');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);

  const run = new ReleaseExecutionGate(
    { async dispatch() { throw new Error('dispatch_forbidden'); } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const runDecision = await run.evaluate({
    release: { ...legacy, deployment: { ...legacy.deployment, mode: 'released' } },
    releaseRecord: {
      releaseId: legacy.metadata.releaseId,
      state: 'released',
      executablePolicyHash: executablePolicyHash({
        ...legacy,
        deployment: { ...legacy.deployment, mode: 'released' }
      }),
      approvedIdentityHash: executablePolicyHash({
        ...legacy,
        deployment: { ...legacy.deployment, mode: 'released' }
      })
    },
    deviceId: 'robot-cell-a',
    proposalId: 'legacy-run',
    action,
    actionHash: sha256(canonicalJson(action)),
    state: {},
    stateObservedAt: NOW.toISOString(),
    now: NOW
  });
  assert.equal(runDecision.status, 'blocked');
  assert.equal(runDecision.reason, 'configuration_unbound');
});
