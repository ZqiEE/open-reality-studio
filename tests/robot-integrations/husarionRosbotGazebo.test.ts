import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  appendEvidence,
  verifyEvidenceBundle,
  type ChainedEvidence,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  configurationDigest,
  executionConfigurationV2Schema,
  type ExecutionConfiguration,
  type ExecutionConfigurationV2
} from '../../packages/core/execution-configuration';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  HUSARION_ROSBOT_COMMAND_TOPIC,
  HUSARION_ROSBOT_MESSAGE_TYPE,
  HUSARION_ROSBOT_ODOMETRY_TYPE,
  HUSARION_ROSBOT_STATE_TOPIC,
  HUSARION_ROSBOT_VELOCITY_UNITS,
  HusarionRosbotGazeboGateway,
  normalizeRosNamespace,
  resolveRosbotTopic,
  rosbotTwistActionHash,
  rosbotTwistActionSchema,
  type HusarionRosbotTransport,
  type RosbotOdometryObservation,
  type RosbotTwistAction
} from '../../packages/husarion-rosbot-gazebo';
import {
  HUSARION_ROSBOT_CONTROLLERS_SOURCE,
  observeTrustedHusarionConfiguration
} from '../../packages/husarion-rosbot-gazebo/trusted-observation';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const H = (character: string) => character.repeat(64);

function action(overrides: Partial<RosbotTwistAction> = {}): RosbotTwistAction {
  return rosbotTwistActionSchema.parse({
    representation: 'twist',
    messageType: HUSARION_ROSBOT_MESSAGE_TYPE,
    targetTopic: HUSARION_ROSBOT_COMMAND_TOPIC,
    frameId: 'base_link',
    linear: { x: 0.2 },
    angular: { z: -0.1 },
    units: {
      linear: 'meter_per_second',
      angular: 'radian_per_second'
    },
    ...overrides
  });
}

function configuration(): ExecutionConfigurationV2 {
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: 'rosbot-gazebo-01',
      robot: 'husarion-rosbot-gazebo'
    },
    semanticContract: {
      command: {
        interfaceType: HUSARION_ROSBOT_MESSAGE_TYPE,
        endpoint: HUSARION_ROSBOT_COMMAND_TOPIC
      },
      controller: {
        implementation: 'twist_mux_controller/TwistMuxController',
        version: 'jazzy@7c7bfa449011'
      },
      jointCommandMapping: [
        { joint: 'linear.x', commandIndex: 0 },
        { joint: 'angular.z', commandIndex: 1 }
      ]
    },
    provenance: [{
      kind: 'content',
      sourceIdentity: HUSARION_ROSBOT_CONTROLLERS_SOURCE,
      purpose: 'controller_configuration',
      contentSha256: H('1')
    }],
    observation: {
      observedAt: NOW.toISOString(),
      environment: {
        rosDistro: 'jazzy',
        rmwImplementation: 'rmw_fastrtps_cpp'
      },
      discovery: [{ name: 'simulation', value: 'gazebo' }]
    }
  });
}

function release(mode: 'shadow' | 'released'): ExecutablePolicySpec {
  const bound = configuration();
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'husarion-rosbot-gazebo-cmd-vel',
      releaseId: `husarion-rosbot-${mode}`,
      createdAt: NOW.toISOString()
    },
    model: {
      artifact: 'examples/husarion-rosbot-gazebo/learned-policy.json',
      sha256: H('a'),
      framework: 'ros2',
      policyType: 'velocity-command',
      codeRevision: 'reference-v1'
    },
    actionContract: {
      representation: 'twist',
      dimension: 2,
      jointOrder: ['linear.x', 'angular.z'],
      units: {
        position: 'meter',
        velocity: HUSARION_ROSBOT_VELOCITY_UNITS
      },
      normalizerSha256: H('b'),
      preprocessorSha256: H('c'),
      postprocessorSha256: H('d')
    },
    robot: {
      profileId: 'husarion-rosbot-gazebo',
      profileSha256: H('e'),
      urdfSha256: H('f'),
      controllerType: 'twist_mux_controller/TwistMuxController',
      controllerConfigSha256: H('1')
    },
    runtimePolicy: {
      policySha256: H('2'),
      maxStateAgeMs: 500,
      maxConfigurationAgeMs: 5_000,
      failClosed: true
    },
    executionConfiguration: bound,
    approvedConfigurationDigest: configurationDigest(bound),
    evidence: {
      scenarioPackId: 'husarion-rosbot-gazebo-v1',
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'reference-reviewer@example.test',
      approvedAt: NOW.toISOString()
    },
    deployment: {
      allowedDeviceIds: ['rosbot-gazebo-01'],
      mode,
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  });
}

function record(spec: ExecutablePolicySpec): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state: spec.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: 'reference-reviewer@example.test',
    approvedAt: NOW.toISOString()
  };
}

function proposal(spec: ExecutablePolicySpec, overrides: Record<string, unknown> = {}) {
  return {
    proposalId: 'rosbot-proposal-1',
    releaseId: spec.metadata.releaseId,
    deviceId: 'rosbot-gazebo-01',
    proposerIdentity: 'learned-policy@example.test',
    actionRepresentation: 'twist',
    actionPayload: action(),
    createdAt: NOW.toISOString(),
    ...overrides
  };
}

class FakeTransport implements HusarionRosbotTransport {
  state: unknown = {
    topic: HUSARION_ROSBOT_STATE_TOPIC,
    messageType: HUSARION_ROSBOT_ODOMETRY_TYPE,
    linearX: 0,
    angularZ: 0,
    observedAt: NOW.toISOString()
  } satisfies RosbotOdometryObservation;
  publications: RosbotTwistAction[] = [];

  async getOdometryObservation(): Promise<unknown | undefined> {
    return this.state;
  }

  async publishVelocity(candidate: RosbotTwistAction) {
    this.publications.push(candidate);
    return {
      published: true as const,
      topic: '/cmd_vel',
      messageType: HUSARION_ROSBOT_MESSAGE_TYPE as typeof HUSARION_ROSBOT_MESSAGE_TYPE
    };
  }

  async close(): Promise<void> {}
}

function setup(mode: 'shadow' | 'run', options: {
  configurations?: Array<ExecutionConfiguration | Error>;
  releaseRecords?: Array<ReleaseRecord | Error>;
  state?: unknown;
  controllerIdentity?: string;
} = {}) {
  const spec = release(mode === 'shadow' ? 'shadow' : 'released');
  const transport = new FakeTransport();
  if ('state' in options) transport.state = options.state;
  const entries: ExecutionEvidence[] = [];
  let observations = options.configurations ?? [configuration()];
  let records = options.releaseRecords ?? [record(spec)];
  const gateway = new HusarionRosbotGazeboGateway({
    mode,
    release: spec,
    expectedProposerIdentity: 'learned-policy@example.test',
    controllerIdentity: options.controllerIdentity ?? spec.robot.controllerConfigSha256,
    releaseRecord: async () => {
      const observed = records.length > 1 ? records.shift() : records[0];
      if (observed instanceof Error) throw observed;
      if (!observed) throw new Error('release_record_missing');
      return observed;
    },
    executionConfiguration: async () => {
      const observed = observations.length > 1 ? observations.shift() : observations[0];
      if (observed instanceof Error) throw observed;
      return observed;
    },
    transport,
    evidence: { append: (entry) => { entries.push(entry); } },
    now: () => currentNow
  });
  let currentNow = NOW;
  return {
    spec,
    transport,
    entries,
    gateway,
    setConfigurations: (...values: ExecutionConfiguration[]) => { observations = values; },
    setNow: (value: Date) => { currentNow = value; }
  };
}

test('velocity action schema is strict, finite, and deterministically hashed', () => {
  const valid = action();
  assert.equal(rosbotTwistActionSchema.parse(valid).linear.x, 0.2);
  assert.equal(rosbotTwistActionHash(valid), rosbotTwistActionHash(structuredClone(valid)));
  assert.equal(rosbotTwistActionSchema.safeParse({ ...valid, unexpected: true }).success, false);
  assert.equal(rosbotTwistActionSchema.safeParse({ ...valid, linear: { x: Number.NaN } }).success, false);
  assert.equal(rosbotTwistActionSchema.safeParse({ ...valid, angular: { z: Infinity } }).success, false);
  assert.equal(rosbotTwistActionSchema.safeParse({ ...valid, linear: {} }).success, false);
});

test('malformed proposal payloads are rejected with zero publications', async () => {
  const cases = [
    { actionPayload: { ...action(), extra: true } },
    { actionPayload: { ...action(), linear: { x: Number.NaN } } },
    { actionPayload: { ...action(), angular: {} } }
  ];
  for (const override of cases) {
    const current = setup('run');
    await assert.rejects(
      current.gateway.handleProposal(proposal(current.spec, override)),
      /proposal_schema_invalid/
    );
    assert.equal(current.transport.publications.length, 0);
  }
});

test('representation, message type, and topic mismatches block before publication', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ actionRepresentation: 'trajectory' }, 'action_representation_mismatch'],
    [{ actionPayload: { ...action(), representation: 'trajectory' } }, 'action_representation_mismatch'],
    [{ actionPayload: { ...action(), messageType: 'geometry_msgs/msg/Twist' } }, 'action_type_mismatch'],
    [{ actionPayload: { ...action(), targetTopic: 'wheel_commands' } }, 'command_topic_mismatch']
  ];
  for (const [override, reason] of cases) {
    const current = setup('run');
    const result = await current.gateway.handleProposal(proposal(current.spec, override));
    assert.equal(result.decision, 'blocked');
    assert.equal(result.reason, reason);
    assert.equal(current.transport.publications.length, 0);
  }
});

test('missing, stale, future, and malformed odometry fail closed with zero publications', async () => {
  const states: Array<[unknown, string]> = [
    [undefined, 'state_missing'],
    [{
      topic: HUSARION_ROSBOT_STATE_TOPIC,
      messageType: HUSARION_ROSBOT_ODOMETRY_TYPE,
      linearX: 0,
      angularZ: 0,
      observedAt: new Date(NOW.getTime() - 501).toISOString()
    }, 'state_stale_or_invalid'],
    [{
      topic: HUSARION_ROSBOT_STATE_TOPIC,
      messageType: HUSARION_ROSBOT_ODOMETRY_TYPE,
      linearX: 0,
      angularZ: 0,
      observedAt: new Date(NOW.getTime() + 1).toISOString()
    }, 'state_stale_or_invalid'],
    [{ observedAt: NOW.toISOString() }, 'state_missing']
  ];
  for (const [state, reason] of states) {
    const current = setup('run', { state });
    const result = await current.gateway.handleProposal(proposal(current.spec));
    assert.equal(result.reason, reason);
    assert.equal(result.hardwareSignalSent, false);
    assert.equal(current.transport.publications.length, 0);
  }
});

test('configuration mismatch and execute-time drift block before publication', async () => {
  const changed = structuredClone(configuration());
  changed.provenance[0] = {
    ...changed.provenance[0],
    contentSha256: H('9')
  } as typeof changed.provenance[number];

  const mismatch = setup('run', { configurations: [changed] });
  const mismatchResult = await mismatch.gateway.handleProposal(proposal(mismatch.spec));
  assert.equal(mismatchResult.reason, 'configuration_mismatch');
  assert.equal(mismatch.transport.publications.length, 0);

  const drift = setup('run', { configurations: [configuration(), changed] });
  const prepared = await drift.gateway.prepareProposal(proposal(drift.spec));
  assert('execute' in prepared && prepared.execute);
  const driftResult = await prepared.execute();
  assert.equal(driftResult.decision, 'failed');
  assert.match(driftResult.reason, /configuration_mismatch/);
  assert.equal(drift.transport.publications.length, 0);

  const refreshFailure = setup('run', {
    configurations: [configuration(), new Error('trusted_monitor_unavailable')]
  });
  const refreshPrepared = await refreshFailure.gateway.prepareProposal(
    proposal(refreshFailure.spec)
  );
  assert('execute' in refreshPrepared && refreshPrepared.execute);
  const refreshResult = await refreshPrepared.execute();
  assert.match(refreshResult.reason, /configuration_missing/);
  assert.equal(refreshFailure.transport.publications.length, 0);
});

test('stale trusted configuration and independently observed controller drift fail closed', async () => {
  const stale = structuredClone(configuration());
  stale.observation.observedAt = new Date(NOW.getTime() - 5_001).toISOString();
  const staleObservation = setup('run', { configurations: [stale] });
  const staleResult = await staleObservation.gateway.handleProposal(proposal(staleObservation.spec));
  assert.equal(staleResult.reason, 'configuration_stale');
  assert.equal(staleResult.hardwareSignalSent, false);
  assert.equal(staleObservation.transport.publications.length, 0);

  const controllerDrift = setup('run', { controllerIdentity: H('9') });
  const driftResult = await controllerDrift.gateway.handleProposal(proposal(controllerDrift.spec));
  assert.equal(driftResult.reason, 'controller_identity_mismatch');
  assert.equal(driftResult.hardwareSignalSent, false);
  assert.equal(controllerDrift.transport.publications.length, 0);
});

test('trusted observation hashes the current operator-supplied controller file', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'rlsok-husarion-observation-'));
  const controllerPath = join(temporary, 'controllers.yaml');
  try {
    writeFileSync(controllerPath, 'controller_manager:\n  ros__parameters: {}\n', 'utf8');
    const first = observeTrustedHusarionConfiguration({
      controllerConfigPath: controllerPath,
      deviceIdentity: 'operator-device',
      robotIdentity: 'operator-robot',
      now: NOW
    });
    assert.equal(first.configuration.identity.device, 'operator-device');
    assert.equal(first.configuration.provenance.length, 1);
    assert.equal(first.configuration.provenance[0]?.kind, 'content');
    assert.equal(
      first.configuration.provenance[0]?.kind === 'content'
        ? first.configuration.provenance[0].contentSha256
        : undefined,
      first.controllerIdentity
    );
    assert.equal(first.configuration.observation.observedAt, NOW.toISOString());

    writeFileSync(controllerPath, 'controller_manager:\n  ros__parameters:\n    changed: true\n', 'utf8');
    const changed = observeTrustedHusarionConfiguration({
      controllerConfigPath: controllerPath,
      deviceIdentity: 'operator-device',
      robotIdentity: 'operator-robot',
      now: new Date(NOW.getTime() + 1)
    });
    assert.notEqual(changed.controllerIdentity, first.controllerIdentity);
    assert.notEqual(configurationDigest(changed.configuration), configurationDigest(first.configuration));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('state that expires after permit issuance blocks dispatch and consumes the permit', async () => {
  const current = setup('run');
  const prepared = await current.gateway.prepareProposal(proposal(current.spec));
  assert('execute' in prepared && prepared.execute);
  current.setNow(new Date(NOW.getTime() + 501));
  const expired = await prepared.execute();
  assert.equal(expired.decision, 'failed');
  assert.match(expired.reason, /state_stale_or_invalid/);
  assert.equal(expired.hardwareSignalSent, false);
  assert.equal(current.transport.publications.length, 0);
  assert.equal(current.entries.at(-1)?.decision, 'blocked');
  assert.deepEqual(current.entries.at(-1)?.matchedRuleIds, [
    'state_freshness',
    'single_use_permit'
  ]);

  const reused = await prepared.execute();
  assert.match(reused.reason, /permit_unknown_or_reused/);
  assert.equal(current.transport.publications.length, 0);
});

test('revoked release, execute-time revocation, and blocked Shadow publish nothing', async () => {
  const runSpec = release('released');
  const revoked = { ...record(runSpec), state: 'revoked' as const };
  const denied = setup('run', { releaseRecords: [revoked] });
  const deniedResult = await denied.gateway.handleProposal(proposal(denied.spec));
  assert.equal(deniedResult.reason, 'release_revoked');
  assert.equal(denied.transport.publications.length, 0);

  const refreshSpec = release('released');
  const refreshRevoked = { ...record(refreshSpec), state: 'revoked' as const };
  const refresh = setup('run', {
    releaseRecords: [record(refreshSpec), refreshRevoked]
  });
  const prepared = await refresh.gateway.prepareProposal(proposal(refresh.spec));
  assert('execute' in prepared && prepared.execute);
  const refreshedResult = await prepared.execute();
  assert.match(refreshedResult.reason, /release_revoked/);
  assert.equal(refresh.transport.publications.length, 0);

  const unavailable = setup('run', {
    releaseRecords: [record(refreshSpec), new Error('release_monitor_unavailable')]
  });
  const unavailablePrepared = await unavailable.gateway.prepareProposal(proposal(unavailable.spec));
  assert('execute' in unavailablePrepared && unavailablePrepared.execute);
  const unavailableResult = await unavailablePrepared.execute();
  assert.match(unavailableResult.reason, /execution_permit_invalid/);
  assert.equal(unavailable.transport.publications.length, 0);

  const shadow = setup('shadow');
  const blocked = await shadow.gateway.handleProposal(proposal(shadow.spec, {
    actionPayload: { ...action(), targetTopic: 'wheel_commands' }
  }));
  assert.equal(blocked.decision, 'blocked');
  assert.equal(blocked.hardwareSignalSent, false);
  assert.equal(shadow.transport.publications.length, 0);
  assert.equal(shadow.entries.at(-1)?.hardwareSignalSent, false);
});

test('allowed Shadow evaluates the contract but publishes exactly zero commands', async () => {
  const current = setup('shadow');
  const result = await current.gateway.handleProposal(proposal(current.spec));
  assert.equal(result.decision, 'allowed');
  assert.match(result.reason, /^shadow_observation_only:/);
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(result.publicationCount, 0);
  assert.equal(current.transport.publications.length, 0);
  assert.equal(current.entries.at(-1)?.hardwareSignalSent, false);
  assert.equal(current.entries.at(-1)?.executionEvidence, 'shadow_not_dispatched');
});

test('allowed Run publishes once and the single-use permit cannot publish twice', async () => {
  const current = setup('run');
  const prepared = await current.gateway.prepareProposal(proposal(current.spec));
  assert('execute' in prepared && prepared.execute);
  const first = await prepared.execute();
  assert.equal(first.decision, 'allowed');
  assert.equal(first.hardwareSignalSent, true);
  assert.equal(first.publicationCount, 1);
  assert.equal(current.transport.publications.length, 1);

  const reused = await prepared.execute();
  assert.equal(reused.decision, 'failed');
  assert.match(reused.reason, /permit_unknown_or_reused/);
  assert.equal(reused.hardwareSignalSent, false);
  assert.equal(current.transport.publications.length, 1);
});

test('Evidence binds action/configuration and verifies as a hash chain', async () => {
  const current = setup('run');
  const result = await current.gateway.handleProposal(proposal(current.spec));
  assert.equal(result.decision, 'allowed');
  const evidence = current.entries.at(-1)!;
  assert.equal(evidence.hardwareSignalSent, true);
  assert.equal(evidence.observedConfigurationSchemaVersion, 2);
  assert.equal(evidence.observedConfigurationDigest, configurationDigest(configuration()));
  assert.equal(evidence.proposedAction && typeof evidence.proposedAction, 'object');
  let chain: ChainedEvidence[] = [];
  for (const entry of current.entries) chain = [...chain, appendEvidence(chain, entry)];
  assert.deepEqual(verifyEvidenceBundle({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: current.spec.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(current.spec),
    createdAt: NOW.toISOString(),
    entries: chain
  }), { ok: true });
});

test('namespace handling resolves only the public mux input and odometry source', () => {
  assert.equal(normalizeRosNamespace('/robot1/'), 'robot1');
  assert.equal(resolveRosbotTopic('', HUSARION_ROSBOT_COMMAND_TOPIC), '/cmd_vel');
  assert.equal(resolveRosbotTopic('fleet/robot1', HUSARION_ROSBOT_COMMAND_TOPIC), '/fleet/robot1/cmd_vel');
  assert.equal(resolveRosbotTopic('robot1', HUSARION_ROSBOT_STATE_TOPIC), '/robot1/odometry/filtered');
  assert.throws(() => normalizeRosNamespace('../robot1'), /ros_namespace_invalid/);
  assert.throws(
    () => resolveRosbotTopic('', 'wheel_commands' as typeof HUSARION_ROSBOT_COMMAND_TOPIC),
    /rosbot_topic_not_allowed/
  );
});

test('Python sidecar protocol self-test does not require ROS installation', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const sidecar = join(
    process.cwd(),
    'experimental/husarion-rosbot-gazebo/rlsok_husarion_rosbot_sidecar.py'
  );
  const result = spawnSync(python, ['-S', sidecar, '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sidecar_self_test_passed/);
});

test('checked-in example fixtures retain their strict v2 approval binding', () => {
  const root = join(process.cwd(), 'examples/husarion-rosbot-gazebo');
  const trusted = executionConfigurationV2Schema.parse(
    JSON.parse(readFileSync(join(root, 'execution-configuration.v2.json'), 'utf8'))
  );
  for (const file of ['release.shadow.json', 'release.run.json']) {
    const spec = executablePolicySpecSchema.parse(
      JSON.parse(readFileSync(join(root, file), 'utf8'))
    );
    assert.equal(spec.executionConfiguration?.schemaVersion, 2);
    assert.equal(spec.approvedConfigurationDigest, configurationDigest(trusted));
    assert.equal(spec.executionConfiguration && configurationDigest(spec.executionConfiguration), configurationDigest(trusted));
  }
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert(readme.includes('7c7bfa449011905be63442b6c0ca98b35131cabc'));
  assert(/Physical ROSbot\s+validation was not performed/.test(readme));
});
