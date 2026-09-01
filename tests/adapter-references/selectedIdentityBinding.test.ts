import assert from 'node:assert/strict';
import test from 'node:test';
import selectedIdentityReferences from '../../examples/adapter-references/selected-identity-references.json';
import { selectedIdentityReferenceSchema } from '../../packages/adapter-references';
import {
  configurationDigest,
  evaluateConfigurationBinding,
  executionConfigurationV2Schema,
  type ExecutionConfigurationV2
} from '../../packages/core/execution-configuration';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  canonicalJson,
  sha256,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import { ReleaseExecutionGate } from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  runtimeAttestationSchema,
  type RuntimeAttestation
} from '../../packages/core/runtime-attestation';

const NOW = new Date('2026-08-31T00:00:00.000Z');
const H = (character: string) => character.repeat(64);
const references = selectedIdentityReferences.map((reference) =>
  selectedIdentityReferenceSchema.parse(reference)
);

function reference(integration: string) {
  const found = references.find((candidate) => candidate.integration === integration);
  assert(found, `missing reference contract: ${integration}`);
  return found;
}

function eliteConfiguration(input: {
  model?: 'CS63' | 'CS66';
  driverIdentity?: string;
  driverVersion?: string;
  unselectedSerial?: string;
  unselectedControllerSoftware?: string;
} = {}): ExecutionConfigurationV2 {
  const model = input.model ?? 'CS63';
  const driverIdentity = input.driverIdentity ?? 'elite-robots/ros2-driver-sdk';
  const driverVersion = input.driverVersion ?? 'fixture-driver-1.0.0';
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: 'disposable-elite-cell',
      robot: `elite:${model}`
    },
    semanticContract: {
      command: {
        interfaceType: 'control_msgs/action/FollowJointTrajectory',
        endpoint: '/elite_controller/follow_joint_trajectory'
      },
      controller: {
        implementation: driverIdentity,
        version: driverVersion
      },
      jointCommandMapping: [
        { joint: 'joint_1', commandIndex: 0 },
        { joint: 'joint_2', commandIndex: 1 }
      ]
    },
    provenance: [{
      kind: 'software',
      sourceIdentity: driverIdentity,
      purpose: 'controller_configuration',
      version: driverVersion
    }],
    observation: {
      observedAt: NOW.toISOString(),
      discovery: input.unselectedSerial === undefined
        ? undefined
        : [{ name: 'unselectedPhysicalSerial', value: input.unselectedSerial }],
      diagnostics: input.unselectedControllerSoftware === undefined
        ? undefined
        : [{
            name: 'unselectedControllerSoftwareVersion',
            value: input.unselectedControllerSoftware
          }]
    }
  });
}

const svhJoints = [
  'Right_Hand_Thumb_Flexion',
  'Right_Hand_Thumb_Opposition',
  'Right_Hand_Index_Finger_Distal',
  'Right_Hand_Index_Finger_Proximal',
  'Right_Hand_Middle_Finger_Distal',
  'Right_Hand_Middle_Finger_Proximal',
  'Right_Hand_Ring_Finger',
  'Right_Hand_Pinky',
  'Right_Hand_Finger_Spread'
];

function svhConfiguration(input: {
  handRole?: 'right_hand' | 'left_hand';
  allowPartialJointsGoal?: boolean;
  updateRateHz?: number;
  commandInterfaces?: string[];
  stateInterfaces?: string[];
  controllerImplementation?: string;
  controllerVersion?: string;
  driverVersion?: string;
  libraryVersion?: string;
  firmwareSettingsRevision?: string;
  reverseJointOrder?: boolean;
  includeFirmwareSettings?: boolean;
  rawDeviceFile?: string;
  jointStateBroadcasterType?: string;
  livePosition?: number;
} = {}): ExecutionConfigurationV2 {
  const handRole = input.handRole ?? 'right_hand';
  const handJoints = handRole === 'right_hand'
    ? svhJoints
    : svhJoints.map((joint) => joint.replace(/^Right_Hand_/, 'Left_Hand_'));
  const selectedJoints = input.reverseJointOrder ? [...handJoints].reverse() : handJoints;
  const controllerImplementation = input.controllerImplementation
    ?? 'joint_trajectory_controller/JointTrajectoryController';
  const selectedControllerConfiguration = {
    handRole,
    controllerType: controllerImplementation,
    allowPartialJointsGoal: input.allowPartialJointsGoal ?? true,
    joints: selectedJoints,
    commandInterfaces: input.commandInterfaces ?? ['position'],
    stateInterfaces: input.stateInterfaces ?? ['position', 'velocity'],
    updateRateHz: input.updateRateHz ?? 125
  };
  const provenance: Array<Record<string, unknown>> = [
    {
      kind: 'software',
      sourceIdentity: 'schunk/svh-ros-driver',
      purpose: 'controller_configuration',
      version: input.driverVersion ?? 'd7115d099e86dd3d2de7d8f9a7295c6796ce7596'
    },
    {
      kind: 'software',
      sourceIdentity: 'schunk/svh-library',
      purpose: 'controller_configuration',
      version: input.libraryVersion ?? '9e674b2c42c7a223d120ac4e50e3ae2da47cef77'
    },
    {
      kind: 'content',
      sourceIdentity: 'schunk/svh-selected-controller-configuration',
      purpose: 'controller_configuration',
      contentSha256: sha256(canonicalJson(selectedControllerConfiguration))
    }
  ];
  if (input.includeFirmwareSettings !== false) {
    provenance.push({
      kind: 'content',
      sourceIdentity: 'schunk/svh-effective-firmware-settings',
      purpose: 'controller_configuration',
      contentSha256: sha256(canonicalJson({
        firmwareCompatibilityEnvelope: 'fixture-major-minor-2.0',
        selectedCurrentPositionAndHomingSettings:
          input.firmwareSettingsRevision ?? 'fixture-nine-channel-set-a'
      }))
    });
  }
  const diagnostics: Array<{ name: string; value: string | number }> = [];
  if (input.jointStateBroadcasterType !== undefined) {
    diagnostics.push({
      name: 'unselectedJointStateBroadcasterType',
      value: input.jointStateBroadcasterType
    });
  }
  if (input.livePosition !== undefined) {
    diagnostics.push({ name: 'livePositionSample', value: input.livePosition });
  }
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: 'disposable-svh-cell',
      robot: `schunk-svh:${handRole}`
    },
    semanticContract: {
      command: {
        interfaceType: 'control_msgs/action/FollowJointTrajectory',
        endpoint: `/${handRole}/follow_joint_trajectory`
      },
      controller: {
        implementation: controllerImplementation,
        version: input.controllerVersion ?? 'fixture-jtc-4.20.0'
      },
      jointCommandMapping: selectedJoints.map((joint, commandIndex) => ({ joint, commandIndex }))
    },
    provenance,
    observation: {
      observedAt: NOW.toISOString(),
      discovery: input.rawDeviceFile === undefined
        ? undefined
        : [{ name: 'rawDeviceFile', value: input.rawDeviceFile }],
      diagnostics: diagnostics.length === 0 ? undefined : diagnostics
    }
  });
}

function releaseFor(
  configuration: ExecutionConfigurationV2,
  name: string,
  requiredCapabilities: string[] = []
): ExecutablePolicySpec {
  const joints = configuration.semanticContract.jointCommandMapping.map(({ joint }) => joint);
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name,
      releaseId: `${name}-release`,
      createdAt: NOW.toISOString()
    },
    model: {
      artifact: `artifacts/${name}`,
      sha256: H('a'),
      framework: 'ros2',
      policyType: 'joint-trajectory',
      codeRevision: 'disposable-reference-fixture'
    },
    actionContract: {
      representation: 'trajectory',
      dimension: joints.length,
      jointOrder: joints,
      units: { position: 'radian', velocity: 'radian_per_second' },
      normalizerSha256: H('b'),
      preprocessorSha256: H('c'),
      postprocessorSha256: H('d')
    },
    robot: {
      profileId: name,
      profileSha256: H('e'),
      urdfSha256: H('f'),
      controllerType: 'joint_trajectory_controller',
      controllerConfigSha256: H('1')
    },
    runtimePolicy: {
      policySha256: H('2'),
      maxStateAgeMs: 1_000,
      maxConfigurationAgeMs: 60_000,
      ...(requiredCapabilities.length > 0
        ? { requiredCapabilities, maxAttestationAgeMs: 5_000 }
        : {}),
      failClosed: true
    },
    executionConfiguration: configuration,
    approvedConfigurationDigest: configurationDigest(configuration),
    evidence: {
      scenarioPackId: name,
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'disposable-review-approver',
      approvedAt: NOW.toISOString()
    },
    deployment: {
      allowedDeviceIds: [configuration.identity.device],
      mode: 'released',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  });
}

function runtimeAttestation(capabilities: string[]): RuntimeAttestation {
  return runtimeAttestationSchema.parse({
    schemaVersion: 1,
    source: {
      identity: 'disposable-reference-observer',
      kind: 'external-monitor',
      version: 'fixture-1'
    },
    observedAt: NOW.toISOString(),
    continuityToken: 'disposable-reference-session',
    availableCapabilities: capabilities
  });
}

function releaseRecord(spec: ExecutablePolicySpec): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state: 'released',
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: 'disposable-review-approver',
    approvedAt: NOW.toISOString()
  };
}

async function assertExecuteTimeDriftBlocks(
  approved: ExecutionConfigurationV2,
  drifted: ExecutionConfigurationV2,
  proposalId: string,
  requiredCapabilities: string[] = []
) {
  let observed = approved;
  let dispatches = 0;
  const entries: ExecutionEvidence[] = [];
  const spec = releaseFor(approved, proposalId, requiredCapabilities);
  const record = releaseRecord(spec);
  const attestation = requiredCapabilities.length > 0
    ? runtimeAttestation(requiredCapabilities)
    : undefined;
  const action = {
    jointNames: approved.semanticContract.jointCommandMapping.map(({ joint }) => joint),
    positions: approved.semanticContract.jointCommandMapping.map(() => 0)
  };
  const actionHash = sha256(canonicalJson(action));
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(entry) { entries.push(entry); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['fixture'] }),
    (value) => sha256(canonicalJson(value)),
    async () => record,
    async () => observed,
    async () => attestation
  );
  const decision = await gate.evaluate({
    release: spec,
    releaseRecord: record,
    deviceId: approved.identity.device,
    proposalId,
    action,
    actionHash,
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: approved,
    runtimeAttestation: attestation,
    now: NOW
  });
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected a reference permit');
  observed = drifted;
  await assert.rejects(
    gate.execute(decision.authorizedRequest),
    /execution_permit_invalid:configuration_mismatch/
  );
  assert.equal(dispatches, 0);
  const evidence = entries.at(-1);
  assert(evidence);
  assert.equal(evidence.decisionReason, 'configuration_mismatch');
  assert.equal(evidence.hardwareSignalSent, false);
  assert.equal(evidence.expectedConfigurationDigest, configurationDigest(approved));
  assert.equal(evidence.observedConfigurationDigest, configurationDigest(drifted));
  assert.notEqual(evidence.expectedConfigurationDigest, evidence.observedConfigurationDigest);
}

async function assertMatchingConfigurationDispatchesOnce(
  configuration: ExecutionConfigurationV2,
  proposalId: string,
  requiredCapabilities: string[] = []
) {
  let dispatches = 0;
  const entries: ExecutionEvidence[] = [];
  const spec = releaseFor(configuration, proposalId, requiredCapabilities);
  const record = releaseRecord(spec);
  const attestation = requiredCapabilities.length > 0
    ? runtimeAttestation(requiredCapabilities)
    : undefined;
  const action = {
    jointNames: configuration.semanticContract.jointCommandMapping.map(({ joint }) => joint),
    positions: configuration.semanticContract.jointCommandMapping.map(() => 0)
  };
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(entry) { entries.push(entry); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['fixture'] }),
    (value) => sha256(canonicalJson(value)),
    async () => record,
    async () => configuration,
    async () => attestation
  );
  const decision = await gate.evaluate({
    release: spec,
    releaseRecord: record,
    deviceId: configuration.identity.device,
    proposalId,
    action,
    actionHash: sha256(canonicalJson(action)),
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: configuration,
    runtimeAttestation: attestation,
    now: NOW
  });
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected a reference permit');
  await gate.execute(decision.authorizedRequest);
  assert.equal(dispatches, 1);
  assert.equal(entries.at(-1)?.hardwareSignalSent, true);
}

async function assertRequiredCapabilityAbsentBlocks(
  configuration: ExecutionConfigurationV2,
  proposalId: string,
  requiredCapabilities: string[]
) {
  let dispatches = 0;
  const entries: ExecutionEvidence[] = [];
  const spec = releaseFor(configuration, proposalId, requiredCapabilities);
  const record = releaseRecord(spec);
  const insufficientAttestation = runtimeAttestation([]);
  const action = {
    jointNames: configuration.semanticContract.jointCommandMapping.map(({ joint }) => joint),
    positions: configuration.semanticContract.jointCommandMapping.map(() => 0)
  };
  const gate = new ReleaseExecutionGate(
    { async dispatch() { dispatches += 1; return { completed: true }; } },
    { append(entry) { entries.push(entry); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['fixture'] }),
    (value) => sha256(canonicalJson(value))
  );
  const decision = await gate.evaluate({
    release: spec,
    releaseRecord: record,
    deviceId: configuration.identity.device,
    proposalId,
    action,
    actionHash: sha256(canonicalJson(action)),
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: configuration,
    runtimeAttestation: insufficientAttestation,
    now: NOW
  });
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reason, 'runtime_capability_missing');
  assert.equal(entries.at(-1)?.decisionReason, 'runtime_capability_missing');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  assert.equal(dispatches, 0);
}

test('Elite exact model and driver are selected independently of optional physical identity facts', async () => {
  const contract = reference('elite-cs-model');
  assert.deepEqual(contract.stableApprovedInputs, [
    'reported robot model',
    'driver/SDK identity and version'
  ]);
  assert.deepEqual(contract.runtimeCapabilities, ['elite.command_path.ready']);
  assert.equal(
    contract.stableApprovedInputs.some((input) => /controller identifier|serial|controller software/i.test(input)),
    false
  );
  assert.match(contract.externalTestGate, /Elite-owned observer/);

  const approved = eliteConfiguration({
    model: 'CS63',
    unselectedSerial: 'disposable-unit-a',
    unselectedControllerSoftware: 'fixture-controller-9.1'
  });
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest: configurationDigest(approved),
    observedConfiguration: eliteConfiguration({
      model: 'CS63',
      unselectedSerial: 'disposable-unit-b',
      unselectedControllerSoftware: 'fixture-controller-10.0'
    }),
    mode: 'run',
    maxAgeMs: 60_000,
    now: NOW
  }).allowed, true);
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest: configurationDigest(approved),
    mode: 'run',
    maxAgeMs: 60_000,
    now: NOW
  }).reason, 'configuration_missing');

  await assertMatchingConfigurationDispatchesOnce(
    approved,
    'elite-model-match',
    contract.runtimeCapabilities
  );
  await assertRequiredCapabilityAbsentBlocks(
    approved,
    'elite-readiness-missing',
    contract.runtimeCapabilities
  );

  await assertExecuteTimeDriftBlocks(
    approved,
    eliteConfiguration({ model: 'CS66' }),
    'elite-model-drift',
    contract.runtimeCapabilities
  );
  await assertExecuteTimeDriftBlocks(
    approved,
    eliteConfiguration({ model: 'CS63', driverVersion: 'fixture-driver-2.0.0' }),
    'elite-driver-version-drift',
    contract.runtimeCapabilities
  );
  await assertExecuteTimeDriftBlocks(
    approved,
    eliteConfiguration({ model: 'CS63', driverIdentity: 'fixture/replacement-driver-sdk' }),
    'elite-driver-identity-drift',
    contract.runtimeCapabilities
  );
});

test('SCHUNK SVH selects the command path without mirroring volatile discovery or the whole YAML', async () => {
  const contract = reference('schunk-svh-selected-command-path');
  assert.equal(
    contract.stableApprovedInputs.some((input) => input.includes('ordered joint-to-channel mapping')),
    true
  );
  assert.equal(
    contract.stableApprovedInputs.some((input) => input.includes('partial-goal policy')),
    true
  );
  assert.equal(
    contract.stableApprovedInputs.some((input) => input.includes('effective firmware-selected')),
    true
  );
  assert.equal(contract.excludedVolatileInputs.includes('raw device_file path and USB enumeration order'), true);
  assert.match(contract.externalTestGate, /zero dispatch/);
  assert.match(contract.externalTestGate, /No SVH support is claimed/);

  const approved = svhConfiguration({
    rawDeviceFile: '/dev/ttyUSB0',
    jointStateBroadcasterType: 'joint_state_broadcaster/JointStateBroadcaster',
    livePosition: 0.1
  });
  const discoveryOnlyChange = svhConfiguration({
    rawDeviceFile: '/dev/ttyUSB7',
    jointStateBroadcasterType: 'fixture/ReplacementStatePublisher',
    livePosition: 0.9
  });
  const missingNonRequiredObservation = svhConfiguration();
  assert.equal(configurationDigest(discoveryOnlyChange), configurationDigest(approved));
  assert.equal(configurationDigest(missingNonRequiredObservation), configurationDigest(approved));
  assert.equal(evaluateConfigurationBinding({
    approvedConfigurationDigest: configurationDigest(approved),
    observedConfiguration: missingNonRequiredObservation,
    mode: 'run',
    maxAgeMs: 60_000,
    now: NOW
  }).allowed, true);
  const selectedFactChanges = [
    svhConfiguration({ handRole: 'left_hand' }),
    svhConfiguration({ reverseJointOrder: true }),
    svhConfiguration({ allowPartialJointsGoal: false }),
    svhConfiguration({ commandInterfaces: ['velocity'] }),
    svhConfiguration({ stateInterfaces: ['position'] }),
    svhConfiguration({ updateRateHz: 100 }),
    svhConfiguration({ controllerImplementation: 'fixture/ReplacementTrajectoryController' }),
    svhConfiguration({ controllerVersion: 'fixture-jtc-5.0.0' }),
    svhConfiguration({ driverVersion: 'fixture-driver-replacement' }),
    svhConfiguration({ libraryVersion: 'fixture-library-replacement' }),
    svhConfiguration({ firmwareSettingsRevision: 'fixture-nine-channel-set-b' })
  ];
  for (const changed of selectedFactChanges) {
    assert.notEqual(configurationDigest(changed), configurationDigest(approved));
  }

  await assertMatchingConfigurationDispatchesOnce(
    approved,
    'svh-selected-command-path-match'
  );

  await assertExecuteTimeDriftBlocks(
    approved,
    svhConfiguration({ allowPartialJointsGoal: false }),
    'svh-selected-yaml-drift'
  );
  await assertExecuteTimeDriftBlocks(
    approved,
    svhConfiguration({ includeFirmwareSettings: false }),
    'svh-required-firmware-settings-missing'
  );
});
