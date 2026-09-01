import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  configurationDigest,
  evaluateConfigurationBinding,
  executionConfigurationSchema,
  executionConfigurationV2Schema,
  type ExecutionConfigurationV2
} from '../../packages/core/execution-configuration';
import {
  diffExecutablePolicies,
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  appendEvidence,
  canonicalJson,
  sha256,
  verifyEvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate
} from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const H = (character: string) => character.repeat(64);
const action = { jointNames: ['shoulder', 'elbow'], positions: [0, 0] };
const actionHash = sha256(canonicalJson(action));

function configurationV2(): ExecutionConfigurationV2 {
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: 'cell-a',
      robot: 'robot-a'
    },
    semanticContract: {
      command: {
        interfaceType: 'control_msgs/action/FollowJointTrajectory',
        endpoint: '/scaled_joint_trajectory_controller/follow_joint_trajectory'
      },
      controller: {
        implementation: 'joint_trajectory_controller/JointTrajectoryController',
        version: '4.20.0'
      },
      jointCommandMapping: [
        { joint: 'shoulder', commandIndex: 0 },
        { joint: 'elbow', commandIndex: 1 }
      ],
      limitsDigest: H('4'),
      frameContractDigest: H('5')
    },
    provenance: [
      {
        kind: 'content',
        sourceIdentity: 'calibration/main',
        purpose: 'calibration',
        contentSha256: H('6')
      },
      {
        kind: 'generated',
        sourceIdentity: 'controller/generated',
        purpose: 'controller_configuration',
        inputSha256: H('7'),
        generator: {
          identity: '@robot/controller-config-generator',
          version: '2.1.0'
        }
      },
      {
        kind: 'software',
        sourceIdentity: 'controller/package',
        purpose: 'controller_configuration',
        version: '4.20.0'
      }
    ],
    observation: {
      observedAt: NOW.toISOString(),
      environment: {
        rosDistro: 'jazzy',
        rmwImplementation: 'rmw_fastrtps_cpp'
      },
      discovery: [{ name: 'rosDomainId', value: '17' }],
      diagnostics: [{ name: 'controllerState', value: 'active' }]
    },
    display: {
      friendlyName: 'Cell A',
      description: 'Reference cell',
      ui: [{ name: 'color', value: 'blue' }]
    }
  });
}

function mutateConfiguration(
  source: ExecutionConfigurationV2,
  mutate: (draft: any) => void
): ExecutionConfigurationV2 {
  const draft = structuredClone(source);
  mutate(draft);
  return executionConfigurationV2Schema.parse(draft);
}

function release(configuration = configurationV2()): ExecutablePolicySpec {
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'configuration-provenance-test',
      releaseId: 'configuration-provenance-release',
      createdAt: NOW.toISOString()
    },
    model: {
      artifact: 'artifacts/configuration-provenance',
      sha256: H('a'),
      framework: 'ros2',
      policyType: 'joint-trajectory',
      codeRevision: 'configuration-provenance'
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
      maxStateAgeMs: 1_000,
      maxConfigurationAgeMs: 60_000,
      failClosed: true
    },
    executionConfiguration: configuration,
    approvedConfigurationDigest: configurationDigest(configuration),
    evidence: {
      scenarioPackId: 'configuration-provenance',
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'approver',
      approvedAt: NOW.toISOString()
    },
    deployment: {
      allowedDeviceIds: ['cell-a'],
      mode: 'released',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  });
}

function record(spec: ExecutablePolicySpec, state: ReleaseRecord['state'] = 'released'): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: 'approver',
    approvedAt: NOW.toISOString()
  };
}

test('existing v1 cloud fixture retains its exact digest and policy hash', () => {
  const fixture = JSON.parse(
    readFileSync('fixtures/cloud-contract/v1/release.json', 'utf8')
  ) as {
    execSpec: unknown;
    expected: { contentHash: string };
  };
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  assert.equal(spec.executionConfiguration?.schemaVersion, 1);
  assert.equal(
    configurationDigest(spec.executionConfiguration!),
    'a0813bd26e47d0fdddbc1e116606650c3356c26833bd663a38b0b250773fdc15'
  );
  assert.equal(executablePolicyHash(spec), fixture.expected.contentHash);
});

test('v2 canonicalizes unordered provenance and explicit command mappings', () => {
  const original = configurationV2();
  const reordered = executionConfigurationV2Schema.parse({
    ...original,
    provenance: [...original.provenance].reverse(),
    semanticContract: {
      ...original.semanticContract,
      jointCommandMapping: [...original.semanticContract.jointCommandMapping].reverse()
    }
  });
  assert.deepEqual(reordered.provenance, original.provenance);
  assert.deepEqual(
    reordered.semanticContract.jointCommandMapping,
    original.semanticContract.jointCommandMapping
  );
  assert.equal(configurationDigest(reordered), configurationDigest(original));
});

test('v2 rejects ambiguous duplicate provenance and command mappings', () => {
  const original = configurationV2();
  assert.throws(() => executionConfigurationV2Schema.parse({
    ...original,
    provenance: [original.provenance[0], {
      ...original.provenance[1],
      sourceIdentity: original.provenance[0].sourceIdentity
    }]
  }), /unique sourceIdentity/);
  assert.throws(() => executionConfigurationV2Schema.parse({
    ...original,
    semanticContract: {
      ...original.semanticContract,
      jointCommandMapping: [
        { joint: 'shoulder', commandIndex: 0 },
        { joint: 'shoulder', commandIndex: 1 }
      ]
    }
  }), /unique joint names/);
});

test('every declared v2 security-critical field changes the digest', () => {
  const original = configurationV2();
  const cases: Array<[string, (draft: any) => void]> = [
    ['device identity', (draft) => { draft.identity.device = 'cell-b'; }],
    ['robot identity', (draft) => { draft.identity.robot = 'robot-b'; }],
    ['command interface', (draft) => { draft.semanticContract.command.interfaceType = 'custom/Command'; }],
    ['command endpoint', (draft) => { draft.semanticContract.command.endpoint = '/other/action'; }],
    ['controller implementation', (draft) => { draft.semanticContract.controller.implementation = 'other/controller'; }],
    ['controller version', (draft) => { draft.semanticContract.controller.version = '4.21.0'; }],
    ['joint mapping', (draft) => { draft.semanticContract.jointCommandMapping[0].commandIndex = 2; }],
    ['limits digest', (draft) => { draft.semanticContract.limitsDigest = H('8'); }],
    ['frame digest', (draft) => { draft.semanticContract.frameContractDigest = H('9'); }],
    ['content source', (draft) => { draft.provenance[0].contentSha256 = H('8'); }],
    ['generated input', (draft) => { draft.provenance[1].inputSha256 = H('8'); }],
    ['generator identity', (draft) => { draft.provenance[1].generator.identity = 'other/generator'; }],
    ['generator version', (draft) => { draft.provenance[1].generator.version = '2.2.0'; }],
    ['software version', (draft) => { draft.provenance[2].version = '4.21.0'; }]
  ];
  for (const [name, mutate] of cases) {
    assert.notEqual(
      configurationDigest(mutateConfiguration(original, mutate)),
      configurationDigest(original),
      name
    );
  }
});

test('v2 observation, display, UI, diagnostics, and discovery order do not change the digest', () => {
  const original = configurationV2();
  const changed = mutateConfiguration(original, (draft) => {
    draft.observation.observedAt = new Date(NOW.getTime() + 1_000).toISOString();
    draft.observation.environment = { rosDistro: 'rolling', rmwImplementation: 'rmw_cyclonedds_cpp' };
    draft.observation.discovery = [
      { name: 'participantCount', value: 7 },
      { name: 'rosDomainId', value: '42' }
    ];
    draft.observation.diagnostics = [{ name: 'latencyMs', value: 12 }];
    draft.display = {
      friendlyName: 'Renamed cell',
      description: 'Changed display text',
      ui: [{ name: 'color', value: 'green' }]
    };
  });
  assert.equal(configurationDigest(changed), configurationDigest(original));
});

test('v2 binding allows a match and execute-time provenance drift blocks before dispatch with verifiable Evidence', async () => {
  const approved = configurationV2();
  let observed = approved;
  const spec = release(approved);
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value)),
    async () => record(spec),
    async () => observed
  );
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    observedConfiguration: approved,
    mode: 'run',
    maxAgeMs: 60_000,
    now: NOW
  }).allowed, true);
  const decision = await gate.evaluate({
    release: spec,
    releaseRecord: record(spec),
    deviceId: 'cell-a',
    proposalId: 'v2-provenance-drift',
    action,
    actionHash,
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: observed,
    now: NOW
  });
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  observed = mutateConfiguration(approved, (draft) => {
    draft.provenance[0].contentSha256 = H('8');
  });
  await assert.rejects(
    gate.execute(decision.authorizedRequest),
    /execution_permit_invalid:configuration_mismatch/
  );
  assert.equal(dispatches, 0);
  const evidence = entries.at(-1)!;
  assert.equal(evidence.decisionReason, 'configuration_mismatch');
  assert.equal(evidence.hardwareSignalSent, false);
  assert.equal(evidence.expectedConfigurationSchemaVersion, 2);
  assert.equal(evidence.observedConfigurationSchemaVersion, 2);
  const chained = appendEvidence([], evidence);
  assert.deepEqual(verifyEvidenceBundle({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: spec.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(spec),
    createdAt: evidence.decisionMadeAt,
    entries: [chained]
  }), { ok: true });
});

test('v2 Shadow mismatch remains zero dispatch', async () => {
  const approved = configurationV2();
  const shadowSpec = executablePolicySpecSchema.parse({
    ...release(approved),
    deployment: { ...release(approved).deployment, mode: 'shadow' }
  });
  const observed = mutateConfiguration(approved, (draft) => {
    draft.semanticContract.command.endpoint = '/other/action';
  });
  const entries: ExecutionEvidence[] = [];
  const shadow = new ShadowExecutionGate(
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    (value) => sha256(canonicalJson(value))
  );
  const result = await shadow.evaluate({
    release: shadowSpec,
    releaseRecord: record(shadowSpec, 'shadow'),
    deviceId: 'cell-a',
    proposalId: 'v2-shadow-mismatch',
    action,
    actionHash,
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: observed,
    now: NOW
  });
  assert.equal(result.reason, 'configuration_mismatch');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  assert.equal(entries.at(-1)?.executionEvidence, 'shadow_not_dispatched');
});

test('v2 ExecutablePolicyHash and policy diff share the security-critical projection', () => {
  const baselineConfiguration = configurationV2();
  const baseline = release(baselineConfiguration);
  const observationOnly = release(mutateConfiguration(baselineConfiguration, (draft) => {
    draft.observation.observedAt = new Date(NOW.getTime() + 1_000).toISOString();
    draft.display.friendlyName = 'Observation-only rename';
  }));
  assert.equal(executablePolicyHash(observationOnly), executablePolicyHash(baseline));
  assert.deepEqual(diffExecutablePolicies(baseline, observationOnly), {
    changes: [],
    invalidatesApproval: false
  });

  const semanticChange = release(mutateConfiguration(baselineConfiguration, (draft) => {
    draft.semanticContract.controller.version = '4.21.0';
  }));
  assert.notEqual(executablePolicyHash(semanticChange), executablePolicyHash(baseline));
  assert.deepEqual(diffExecutablePolicies(baseline, semanticChange), {
    changes: ['execution configuration', 'approved configuration digest'],
    invalidatesApproval: true
  });
});

test('v2 schema stays strict and does not accept generic ignore paths', () => {
  assert.throws(() => executionConfigurationSchema.parse({
    ...configurationV2(),
    ignoredPaths: ['semanticContract.controller']
  }));
});
