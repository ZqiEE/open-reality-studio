import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendEvidence,
  canonicalJson,
  sha256,
  verifyEvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  diffExecutablePolicies,
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  configurationDigest,
  executionConfigurationSchema,
  type ExecutionConfiguration
} from '../../packages/core/execution-configuration';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate,
  type ExecutionRequest
} from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  continuityTokenHash,
  evaluateRuntimeAttestation,
  runtimeAttestationDigest,
  runtimeAttestationSchema,
  type RuntimeAttestation
} from '../../packages/core/runtime-attestation';

const NOW = new Date('2026-08-22T00:00:00.000Z');
const H = (character: string) => character.repeat(64);
const action = { safe: true };
const hashAction = (value: unknown) => sha256(canonicalJson(value));

function configuration(overrides: Partial<ExecutionConfiguration> = {}): ExecutionConfiguration {
  return executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: 'runtime-cell-a',
    robotIdentity: 'runtime-robot-a',
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
    jointOrder: ['shoulder', 'elbow'],
    adapter: { identity: 'trusted-runtime-monitor', version: '1' },
    observedAt: NOW.toISOString(),
    ...overrides
  });
}

function attestation(overrides: Partial<RuntimeAttestation> = {}): RuntimeAttestation {
  return runtimeAttestationSchema.parse({
    schemaVersion: 1,
    source: {
      identity: 'trusted-runtime-monitor',
      kind: 'external-monitor',
      version: '1'
    },
    observedAt: NOW.toISOString(),
    continuityToken: 'session-a',
    availableCapabilities: ['controller.available', 'state.fresh'],
    ...overrides
  });
}

function release(requiredCapabilities?: string[]): ExecutablePolicySpec {
  const executionConfiguration = configuration();
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'runtime-attestation-test',
      releaseId: 'runtime-attestation-release',
      createdAt: NOW.toISOString()
    },
    model: {
      artifact: 'artifacts/runtime-attestation',
      sha256: H('a'),
      framework: 'ros2',
      policyType: 'trajectory',
      codeRevision: 'runtime-attestation'
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
      ...(requiredCapabilities
        ? { requiredCapabilities, maxAttestationAgeMs: 5_000 }
        : {}),
      failClosed: true
    },
    executionConfiguration,
    approvedConfigurationDigest: configurationDigest(executionConfiguration),
    evidence: {
      scenarioPackId: 'runtime-attestation',
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'approver',
      approvedAt: NOW.toISOString()
    },
    deployment: {
      allowedDeviceIds: ['runtime-cell-a'],
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

function request(
  spec: ExecutablePolicySpec,
  runtimeAttestation?: RuntimeAttestation
): ExecutionRequest<typeof action, { ready: true }> {
  return {
    release: spec,
    releaseRecord: record(spec),
    deviceId: 'runtime-cell-a',
    proposalId: 'runtime-proposal',
    action,
    actionHash: hashAction(action),
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    executionConfiguration: spec.executionConfiguration,
    runtimeAttestation,
    now: NOW
  };
}

function gate(input: {
  spec: ExecutablePolicySpec;
  entries: ExecutionEvidence[];
  dispatch: () => void;
  refreshedAttestation?: () => Promise<RuntimeAttestation | undefined>;
  refreshedRecord?: () => Promise<ReleaseRecord>;
  refreshedConfiguration?: () => Promise<ExecutionConfiguration | undefined>;
}) {
  return new ReleaseExecutionGate(
    {
      async dispatch() {
        input.dispatch();
        return { completed: true };
      }
    },
    { append(value) { input.entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    hashAction,
    input.refreshedRecord ?? (async () => record(input.spec)),
    input.refreshedConfiguration ?? (async () => input.spec.executionConfiguration),
    input.refreshedAttestation
  );
}

test('capability arrays are canonical and duplicates are rejected', () => {
  const first = release(['state.fresh', 'controller.available']);
  const second = release(['controller.available', 'state.fresh']);
  assert.deepEqual(first.runtimePolicy.requiredCapabilities, [
    'controller.available',
    'state.fresh'
  ]);
  assert.equal(executablePolicyHash(first), executablePolicyHash(second));
  assert.throws(() => release(['state.fresh', 'state.fresh']), /unique values/);

  const ordered = attestation({
    availableCapabilities: ['state.fresh', 'controller.available']
  });
  const reversed = attestation({
    availableCapabilities: ['controller.available', 'state.fresh']
  });
  assert.deepEqual(ordered.availableCapabilities, [
    'controller.available',
    'state.fresh'
  ]);
  assert.equal(runtimeAttestationDigest(ordered), runtimeAttestationDigest(reversed));
  assert.throws(() => attestation({
    availableCapabilities: ['state.fresh', 'state.fresh']
  }), /unique values/);
  const trimmed = runtimeAttestationSchema.parse({
    ...attestation(),
    source: {
      identity: ' trusted-runtime-monitor ',
      kind: ' external-monitor ',
      version: ' 1 '
    },
    availableCapabilities: [' controller.available ']
  });
  assert.deepEqual(trimmed.source, {
    identity: 'trusted-runtime-monitor',
    kind: 'external-monitor',
    version: '1'
  });
  assert.deepEqual(trimmed.availableCapabilities, ['controller.available']);
});

test('runtime policy changes invalidate approval without ordering-only false diffs', () => {
  const baseline = release(['controller.available']);
  const changedCapabilities = release(['controller.available', 'state.fresh']);
  assert.notEqual(executablePolicyHash(baseline), executablePolicyHash(changedCapabilities));
  assert.deepEqual(diffExecutablePolicies(baseline, changedCapabilities), {
    changes: ['runtime policy'],
    invalidatesApproval: true
  });

  const changedMaxAge = executablePolicySpecSchema.parse({
    ...baseline,
    runtimePolicy: {
      ...baseline.runtimePolicy,
      maxAttestationAgeMs: baseline.runtimePolicy.maxAttestationAgeMs! + 1
    }
  });
  assert.notEqual(executablePolicyHash(baseline), executablePolicyHash(changedMaxAge));
  assert.deepEqual(diffExecutablePolicies(baseline, changedMaxAge), {
    changes: ['runtime policy'],
    invalidatesApproval: true
  });

  const reordered = release(['state.fresh', 'controller.available']);
  assert.equal(executablePolicyHash(changedCapabilities), executablePolicyHash(reordered));
  assert.deepEqual(diffExecutablePolicies(changedCapabilities, reordered), {
    changes: [],
    invalidatesApproval: false
  });
});

test('legacy ExecSpec without capability requirements preserves gate behavior', async () => {
  const spec = release();
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const executionGate = gate({
    spec,
    entries,
    dispatch: () => { dispatches += 1; }
  });
  const decision = await executionGate.evaluate(request(spec));
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  await executionGate.execute(decision.authorizedRequest);
  assert.equal(dispatches, 1);
  assert.equal(entries.at(-1)?.runtimeAttestationDigest, undefined);
});

test('legacy ExecSpec does not invoke an attestation refresh callback', async () => {
  const spec = release();
  const entries: ExecutionEvidence[] = [];
  let refreshes = 0;
  const executionGate = gate({
    spec,
    entries,
    dispatch: () => undefined,
    refreshedAttestation: async () => {
      refreshes += 1;
      throw new Error('legacy path must not refresh attestation');
    }
  });
  const decision = await executionGate.evaluate(request(spec));
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  await executionGate.execute(decision.authorizedRequest);
  assert.equal(refreshes, 0);
});

test('attestation evaluation allows a subset and blocks missing, stale, future, or absent capabilities', () => {
  const requiredCapabilities = ['controller.available'];
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: attestation(),
    maxAgeMs: 5_000,
    now: NOW
  }).reason, null);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: attestation({
      observedAt: new Date(NOW.getTime() - 5_000).toISOString()
    }),
    maxAgeMs: 5_000,
    now: NOW
  }).reason, null);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities,
    maxAgeMs: 5_000,
    now: NOW
  }).reason, 'runtime_attestation_missing');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: attestation({
      observedAt: new Date(NOW.getTime() - 5_001).toISOString()
    }),
    maxAgeMs: 5_000,
    now: NOW
  }).reason, 'runtime_attestation_stale');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: attestation({
      observedAt: new Date(NOW.getTime() + 1).toISOString()
    }),
    maxAgeMs: 5_000,
    now: NOW
  }).reason, 'runtime_attestation_stale');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['controller.available', 'faults.clear'],
    attestation: attestation(),
    maxAgeMs: 5_000,
    now: NOW
  }).reason, 'runtime_capability_missing');
  const invalid = evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: {
      ...attestation(),
      observedAt: 'not-a-timestamp'
    } as RuntimeAttestation,
    maxAgeMs: 5_000,
    now: NOW
  });
  assert.deepEqual(invalid, {
    allowed: false,
    reason: 'runtime_attestation_stale',
    attestation: null,
    digest: null
  });
  const missingOffset = {
    ...attestation(),
    observedAt: '2026-08-22T00:00:00.000'
  } as RuntimeAttestation;
  assert.equal(runtimeAttestationSchema.safeParse(missingOffset).success, false);
  assert.equal(runtimeAttestationSchema.safeParse({
    ...attestation(),
    observedAt: '2026-08-22T08:00:00.000+08:00'
  }).success, true);
  assert.deepEqual(evaluateRuntimeAttestation({
    requiredCapabilities,
    attestation: missingOffset,
    maxAgeMs: 5_000,
    now: NOW
  }), {
    allowed: false,
    reason: 'runtime_attestation_stale',
    attestation: null,
    digest: null
  });
});

test('Release gate blocks missing, stale, future, and insufficient attestations', async () => {
  const spec = release(['controller.available']);
  const cases: Array<[string, RuntimeAttestation | undefined, string]> = [
    ['missing', undefined, 'runtime_attestation_missing'],
    ['stale', attestation({
      observedAt: new Date(NOW.getTime() - 5_001).toISOString()
    }), 'runtime_attestation_stale'],
    ['future', attestation({
      observedAt: new Date(NOW.getTime() + 1).toISOString()
    }), 'runtime_attestation_stale'],
    ['capability', attestation({
      availableCapabilities: ['state.fresh']
    }), 'runtime_capability_missing']
  ];
  for (const [name, observed, reason] of cases) {
    const entries: ExecutionEvidence[] = [];
    let dispatches = 0;
    const executionGate = gate({
      spec,
      entries,
      dispatch: () => { dispatches += 1; }
    });
    const decision = await executionGate.evaluate(request(spec, observed));
    assert.equal(decision.status, 'blocked', name);
    assert.equal(decision.reason, reason, name);
    assert.equal(entries.at(-1)?.decisionReason, reason, name);
    assert.equal(entries.at(-1)?.hardwareSignalSent, false, name);
    assert.equal(dispatches, 0, name);
  }
});

test('gate records deterministic attestation evidence and verifies its hash chain', async () => {
  const spec = release(['controller.available']);
  const observed = attestation();
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const executionGate = gate({
    spec,
    entries,
    dispatch: () => { dispatches += 1; },
    refreshedAttestation: async () => observed
  });
  const decision = await executionGate.evaluate(request(spec, observed));
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  await executionGate.execute(decision.authorizedRequest);
  assert.equal(dispatches, 1);
  const evidence = entries.at(-1)!;
  assert.equal(evidence.attestationSourceIdentity, observed.source.identity);
  assert.equal(evidence.attestationObservedAt, observed.observedAt);
  assert.deepEqual(evidence.expectedRequiredCapabilities, ['controller.available']);
  assert.deepEqual(evidence.observedAvailableCapabilities, observed.availableCapabilities);
  assert.equal(evidence.runtimeAttestationDigest, runtimeAttestationDigest(observed));
  assert.equal(evidence.runtimeContinuityTokenHash, sha256('session-a'));
  assert.equal(continuityTokenHash('session-a'), sha256('session-a'));
  assert.equal('continuityToken' in evidence, false);
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

test('permit refresh allows a newer observation and irrelevant capability changes', async () => {
  const spec = release(['controller.available']);
  const issued = attestation({
    observedAt: new Date(NOW.getTime() - 1_000).toISOString()
  });
  const refreshed = attestation({
    observedAt: NOW.toISOString(),
    availableCapabilities: ['controller.available', 'faults.clear']
  });
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const executionGate = gate({
    spec,
    entries,
    dispatch: () => { dispatches += 1; },
    refreshedAttestation: async () => refreshed
  });
  const decision = await executionGate.evaluate(request(spec, issued));
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  await executionGate.execute(decision.authorizedRequest);
  assert.equal(dispatches, 1);
  assert.equal(entries.at(-1)?.attestationObservedAt, refreshed.observedAt);
  assert.deepEqual(
    entries.at(-1)?.observedAvailableCapabilities,
    refreshed.availableCapabilities
  );
});

test('queued authority dies before dispatch when release, configuration, policy, or selected state changes', async () => {
  const spec = release(['workcell.clear_for_pick']);
  const issued = attestation({
    observedAt: new Date(NOW.getTime() - 500).toISOString(),
    continuityToken: 'selected-state-epoch-7',
    availableCapabilities: ['workcell.clear_for_pick']
  });
  const changedConfiguration = configuration({ robotIdentity: 'runtime-robot-b' });
  const changedPolicy = executablePolicySpecSchema.parse({
    ...spec,
    runtimePolicy: {
      ...spec.runtimePolicy,
      policySha256: H('9')
    }
  });
  const cases: Array<{
    name: string;
    expectedReason: string;
    refreshedRecord?: () => Promise<ReleaseRecord>;
    refreshedConfiguration?: () => Promise<ExecutionConfiguration | undefined>;
    refreshedAttestation?: () => Promise<RuntimeAttestation | undefined>;
  }> = [
    {
      name: 'revocation epoch',
      expectedReason: 'release_revoked',
      refreshedRecord: async () => record(spec, 'revoked')
    },
    {
      name: 'configuration epoch',
      expectedReason: 'configuration_mismatch',
      refreshedConfiguration: async () => changedConfiguration
    },
    {
      name: 'policy epoch',
      expectedReason: 'release_identity_changed_reapproval_required',
      refreshedRecord: async () => record(changedPolicy)
    },
    {
      name: 'selected observed-state epoch',
      expectedReason: 'runtime_continuity_changed',
      refreshedAttestation: async () => attestation({
        continuityToken: 'selected-state-epoch-8',
        availableCapabilities: ['workcell.clear_for_pick']
      })
    }
  ];

  for (const current of cases) {
    const entries: ExecutionEvidence[] = [];
    let dispatches = 0;
    const executionGate = gate({
      spec,
      entries,
      dispatch: () => { dispatches += 1; },
      refreshedRecord: current.refreshedRecord,
      refreshedConfiguration: current.refreshedConfiguration,
      refreshedAttestation: current.refreshedAttestation ?? (async () => issued)
    });
    const decision = await executionGate.evaluate(request(spec, issued));
    assert.equal(decision.status, 'allowed', current.name);
    if (decision.status !== 'allowed') throw new Error('expected permit');
    await assert.rejects(
      executionGate.execute(decision.authorizedRequest),
      new RegExp(current.expectedReason),
      current.name
    );
    assert.equal(dispatches, 0, current.name);
    assert.equal(entries.at(-1)?.decisionReason, current.expectedReason, current.name);
    assert.equal(entries.at(-1)?.hardwareSignalSent, false, current.name);
  }
});

test('selected state refresh ignores unselected observation noise and consumes the permit once', async () => {
  const spec = release(['workcell.clear_for_pick']);
  const issued = attestation({
    continuityToken: 'selected-state-epoch-7',
    availableCapabilities: ['workcell.clear_for_pick']
  });
  const refreshed = attestation({
    observedAt: NOW.toISOString(),
    continuityToken: 'selected-state-epoch-7',
    availableCapabilities: ['camera.unselected_noise', 'workcell.clear_for_pick']
  });
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const executionGate = gate({
    spec,
    entries,
    dispatch: () => { dispatches += 1; },
    refreshedAttestation: async () => refreshed
  });
  const decision = await executionGate.evaluate(request(spec, issued));
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected permit');
  await executionGate.execute(decision.authorizedRequest);
  await assert.rejects(
    executionGate.execute(decision.authorizedRequest),
    /permit_unknown_or_reused/
  );
  assert.equal(dispatches, 1);
  assert.equal(entries.at(-1)?.decisionReason, 'permit_unknown_or_reused');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
});

test('permit refresh fails closed on continuity, capability, refresh, or attestation mutation', async () => {
  const spec = release(['controller.available']);
  const cases: Array<{
    name: string;
    mutateAuthorized?: (value: RuntimeAttestation) => RuntimeAttestation;
    refresh: () => Promise<RuntimeAttestation | undefined>;
    reason: string;
  }> = [
    {
      name: 'continuity',
      refresh: async () => attestation({ continuityToken: 'session-b' }),
      reason: 'runtime_continuity_changed'
    },
    {
      name: 'capability',
      refresh: async () => attestation({ availableCapabilities: ['state.fresh'] }),
      reason: 'runtime_capability_missing'
    },
    {
      name: 'source identity',
      refresh: async () => attestation({
        source: { identity: 'replacement-monitor', kind: 'external-monitor', version: '1' }
      }),
      reason: 'runtime_attestation_changed'
    },
    {
      name: 'source kind',
      refresh: async () => attestation({
        source: { identity: 'trusted-runtime-monitor', kind: 'replacement-kind', version: '1' }
      }),
      reason: 'runtime_attestation_changed'
    },
    {
      name: 'source version',
      refresh: async () => attestation({
        source: { identity: 'trusted-runtime-monitor', kind: 'external-monitor', version: '2' }
      }),
      reason: 'runtime_attestation_changed'
    },
    {
      name: 'refresh failure',
      refresh: async () => { throw new Error('monitor unavailable'); },
      reason: 'runtime_attestation_missing'
    },
    {
      name: 'permit digest',
      mutateAuthorized: (value) => attestation({
        ...value,
        observedAt: new Date(NOW.getTime() - 1).toISOString()
      }),
      refresh: async () => attestation(),
      reason: 'runtime_attestation_changed'
    }
  ];
  for (const current of cases) {
    const entries: ExecutionEvidence[] = [];
    let dispatches = 0;
    const executionGate = gate({
      spec,
      entries,
      dispatch: () => { dispatches += 1; },
      refreshedAttestation: current.refresh
    });
    const decision = await executionGate.evaluate(request(spec, attestation()));
    assert.equal(decision.status, 'allowed', current.name);
    if (decision.status !== 'allowed') throw new Error('expected permit');
    const authorized = current.mutateAuthorized
      ? {
          ...decision.authorizedRequest,
          runtimeAttestation: current.mutateAuthorized(
            decision.authorizedRequest.runtimeAttestation!
          )
        }
      : decision.authorizedRequest;
    await assert.rejects(
      executionGate.execute(authorized),
      new RegExp(current.reason),
      current.name
    );
    assert.equal(dispatches, 0, current.name);
    assert.equal(entries.at(-1)?.decisionReason, current.reason, current.name);
    assert.equal(entries.at(-1)?.decision, 'blocked', current.name);
    assert.deepEqual(
      entries.at(-1)?.matchedRuleIds,
      ['runtime_attestation', 'single_use_permit'],
      current.name
    );
    assert.equal(entries.at(-1)?.hardwareSignalSent, false, current.name);
  }
});

test('revocation and configuration mismatch take precedence over attestation failure', async () => {
  const spec = release(['controller.available']);
  const entries: ExecutionEvidence[] = [];
  const executionGate = gate({ spec, entries, dispatch: () => undefined });
  const revoked = await executionGate.evaluate({
    ...request(spec),
    releaseRecord: record(spec, 'revoked')
  });
  assert.equal(revoked.reason, 'release_revoked');

  const changedConfiguration = configuration({ deviceIdentity: 'runtime-cell-b' });
  const mismatched = await executionGate.evaluate({
    ...request(spec),
    executionConfiguration: changedConfiguration
  });
  assert.equal(mismatched.reason, 'configuration_mismatch');
});

test('Shadow evaluates attestation with zero dispatch and records the decision', async () => {
  const runSpec = release(['controller.available']);
  const shadowSpec = executablePolicySpecSchema.parse({
    ...runSpec,
    deployment: { ...runSpec.deployment, mode: 'shadow' }
  });
  const entries: ExecutionEvidence[] = [];
  const shadow = new ShadowExecutionGate(
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'policy_passed', matchedRuleIds: ['policy'] }),
    hashAction
  );
  const missing = await shadow.evaluate({
    ...request(shadowSpec),
    releaseRecord: record(shadowSpec, 'shadow')
  });
  assert.equal(missing.reason, 'runtime_attestation_missing');
  assert.equal(entries.at(-1)?.decisionReason, 'shadow:runtime_attestation_missing');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  assert.equal(entries.at(-1)?.hardwareSignalState, 'not_sent');
  assert.equal(entries.at(-1)?.executionEvidence, 'shadow_not_dispatched');

  const allowed = await shadow.evaluate({
    ...request(shadowSpec, attestation()),
    releaseRecord: record(shadowSpec, 'shadow')
  });
  assert.equal(allowed.reason, 'shadow_observation_only:policy_passed');
  assert.equal(entries.at(-1)?.decision, 'allowed');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
});
