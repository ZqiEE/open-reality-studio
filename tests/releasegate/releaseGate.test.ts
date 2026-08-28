import assert from 'node:assert/strict';
import {
  appendEvidence,
  canonicalJson,
  sha256,
  verifyEvidenceBundle,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  checkExecutablePolicySpec,
  diffExecutablePolicies,
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  configurationDigest,
  executionConfigurationSchema
} from '../../packages/core/execution-configuration';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate,
  type ExecutionRequest
} from '../../packages/core/execution-gate';
import {
  executionEligibility,
  transitionRelease,
  type ReleaseRecord
} from '../../packages/core/release-policy';

const H = (character: string) => character.repeat(64);
const NOW = new Date('2026-07-26T00:00:00.000Z');

function spec(overrides: Partial<ExecutablePolicySpec> = {}): ExecutablePolicySpec {
  const executionConfiguration = executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: 'arm-03',
    robotIdentity: H('e'),
    rosDistro: 'jazzy',
    rmwImplementation: 'rmw_fastrtps_cpp',
    jointState: { topic: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
    controller: {
      name: 'joint_trajectory_controller',
      followJointTrajectoryAction: '/joint_trajectory_controller/follow_joint_trajectory',
      actionType: 'control_msgs/action/FollowJointTrajectory'
    },
    jointOrder: ['shoulder', 'elbow'],
    adapter: { identity: 'rlsok-test-adapter', version: '1' },
    observedAt: NOW.toISOString()
  });
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'warehouse-pick-v27',
      releaseId: 'rlsok-release-2026-0042',
      createdAt: '2026-07-25T00:00:00.000Z'
    },
    model: {
      artifact: 'artifacts/policy-v27',
      sha256: H('a'),
      framework: 'lerobot',
      policyType: 'pick',
      codeRevision: 'abc123'
    },
    actionContract: {
      representation: 'joint_position',
      dimension: 2,
      jointOrder: ['shoulder', 'elbow'],
      units: { position: 'radian', velocity: 'radian_per_second' },
      normalizerSha256: H('b'),
      preprocessorSha256: H('c'),
      postprocessorSha256: H('d')
    },
    robot: {
      profileId: 'ur5e-lab-arm-03',
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
    executionConfiguration,
    approvedConfigurationDigest: configurationDigest(executionConfiguration),
    evidence: {
      scenarioPackId: 'pick-v3',
      testReportSha256: H('3'),
      status: 'approved',
      approvedBy: 'release@example.test',
      approvedAt: '2026-07-25T01:00:00.000Z'
    },
    deployment: {
      allowedDeviceIds: ['arm-03'],
      mode: 'released',
      expiresAt: '2099-01-01T00:00:00.000Z'
    },
    ...overrides
  });
}

function releasedRecord(release: ExecutablePolicySpec): ReleaseRecord {
  const identity = executablePolicyHash(release);
  return {
    releaseId: release.metadata.releaseId,
    state: 'released',
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: release.approvedConfigurationDigest,
    approvedBy: 'release@example.test',
    approvedAt: '2026-07-25T01:00:00.000Z'
  };
}

function evidenceFor(release: ExecutablePolicySpec): ExecutionEvidence {
  return {
    releaseId: release.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(release),
    modelHash: release.model.sha256,
    actionContractHash: H('4'),
    robotProfileHash: release.robot.profileSha256,
    controllerProfileHash: release.robot.controllerConfigSha256,
    runtimePolicyHash: release.runtimePolicy.policySha256,
    deviceId: 'arm-03',
    proposalId: 'proposal-1',
    proposedAction: { joints: [0, 1] },
    decision: 'blocked',
    decisionReason: 'test',
    matchedRuleIds: ['test'],
    decisionMadeAt: NOW.toISOString(),
    hardwareSignalSent: false,
    hardwareSignalState: 'not_sent',
    executionEvidence: 'not_executed'
  };
}

async function testExecSpec(): Promise<void> {
  const valid = spec();
  assert.equal(checkExecutablePolicySpec(valid, NOW).result, 'PASS');
  const missingHash = structuredClone(valid) as Record<string, any>;
  delete missingHash.model.sha256;
  assert.equal(checkExecutablePolicySpec(missingHash, NOW).result, 'INVALID');

  const dimension = structuredClone(valid) as Record<string, any>;
  dimension.actionContract.dimension = 3;
  assert.equal(checkExecutablePolicySpec(dimension, NOW).result, 'INVALID');

  const units = structuredClone(valid) as Record<string, any>;
  units.actionContract.units.position = 'centimeter';
  assert.equal(checkExecutablePolicySpec(units, NOW).result, 'INVALID');

  const revoked = structuredClone(valid) as Record<string, any>;
  revoked.evidence = { status: 'revoked', scenarioPackId: 'pick-v3', testReportSha256: H('3'), approvedBy: '', approvedAt: '' };
  assert.equal(checkExecutablePolicySpec(revoked, NOW).result, 'BLOCK');

}

async function testReleasePolicyAndDiff(): Promise<void> {
  const release = spec();
  const identity = executablePolicyHash(release);
  let record: ReleaseRecord = {
    releaseId: release.metadata.releaseId,
    state: 'draft',
    executablePolicyHash: identity
  };
  record = transitionRelease(record, 'tested', {
    actor: 'tester',
    occurredAt: NOW.toISOString(),
    reason: 'tests complete',
    spec: release,
    evidence: [evidenceFor(release)]
  });
  record = transitionRelease(record, 'approved', {
    actor: 'approver',
    occurredAt: NOW.toISOString(),
    reason: 'approved',
    spec: release,
    evidence: [evidenceFor(release)]
  });
  assert.equal(record.approvedIdentityHash, identity);
  assert.equal(record.approvedConfigurationDigest, release.approvedConfigurationDigest);

  const shadowRecord = transitionRelease({
    ...record,
    approvedConfigurationDigest: H('9')
  }, 'shadow', {
    actor: 'operator',
    occurredAt: NOW.toISOString(),
    reason: 'preserve approval binding',
    spec: release,
    evidence: [evidenceFor(release)]
  });
  assert.equal(shadowRecord.approvedConfigurationDigest, H('9'));

  const legacySource = structuredClone(release) as Record<string, unknown>;
  delete legacySource.executionConfiguration;
  delete legacySource.approvedConfigurationDigest;
  const legacy = executablePolicySpecSchema.parse(legacySource);
  assert.throws(() => transitionRelease({
    releaseId: legacy.metadata.releaseId,
    state: 'tested',
    executablePolicyHash: executablePolicyHash(legacy)
  }, 'approved', {
    actor: 'approver',
    occurredAt: NOW.toISOString(),
    reason: 'legacy approval',
    spec: legacy,
    evidence: [evidenceFor(legacy)]
  }), /approval_requires_configuration_binding/);

  assert.deepEqual(executionEligibility(release, {
    ...releasedRecord(release),
    approvedConfigurationDigest: H('9')
  }, 'arm-03', NOW), {
    allowed: false,
    reason: 'configuration_mismatch'
  });
  assert.deepEqual(executionEligibility(release, {
    ...releasedRecord(release),
    approvedConfigurationDigest: undefined
  }, 'arm-03', NOW), {
    allowed: false,
    reason: 'configuration_unbound'
  });
  assert.throws(() => transitionRelease(record, 'released', {
    actor: 'operator',
    occurredAt: NOW.toISOString(),
    reason: 'skip shadow and canary',
    spec: release,
    evidence: [evidenceFor(release)]
  }), /invalid_release_transition/);

  const changed = spec({
    model: { ...release.model, sha256: H('9') }
  });
  assert.equal(diffExecutablePolicies(release, changed).invalidatesApproval, true);
  assert.equal(executionEligibility(changed, releasedRecord(release), 'arm-03', NOW).allowed, false);

  const revoked: ReleaseRecord = { ...releasedRecord(release), state: 'revoked' };
  assert.deepEqual(executionEligibility(release, revoked, 'arm-03', NOW), {
    allowed: false,
    reason: 'release_revoked'
  });
  assert.deepEqual(executionEligibility(
    { ...release, deployment: { ...release.deployment, mode: 'shadow' } },
    releasedRecord(release),
    'arm-03',
    NOW
  ), { allowed: false, reason: 'release_identity_changed_reapproval_required' });
}

async function testEvidence(): Promise<void> {
  const release = spec();
  const first = appendEvidence([], evidenceFor(release));
  const second = appendEvidence([first], {
    ...evidenceFor(release),
    proposalId: 'proposal-2',
    decision: 'allowed'
  });
  const bundle: EvidenceBundle = {
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: release.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(release),
    createdAt: NOW.toISOString(),
    entries: [first, second]
  };
  assert.throws(
    () => canonicalJson({ value: '\ud800' }),
    /canonical_json_rejects_unpaired_surrogate/
  );
  assert.throws(
    () => canonicalJson({ ['\udfff']: 'value' }),
    /canonical_json_rejects_unpaired_surrogate/
  );
  for (const unsupported of [undefined, () => undefined, Symbol('unsupported')]) {
    assert.throws(
      () => canonicalJson(unsupported),
      /canonical_json_rejects_unsupported_value/
    );
  }
  for (const unsupported of [
    { nested: () => undefined },
    { nested: Symbol('unsupported') },
    [() => undefined],
    [Symbol('unsupported')],
    [undefined],
    new Date('2026-01-01T00:00:00.000Z'),
  ]) {
    assert.throws(
      () => canonicalJson(unsupported),
      /canonical_json_rejects_unsupported_value/
    );
  }
  const sparse = new Array(1);
  assert.throws(
    () => canonicalJson(sparse),
    /canonical_json_rejects_unsupported_value/
  );
  assert.equal(
    canonicalJson({ 'é': 5, e: 4, aa: 3, aA: 2, _: 1 }),
    '{"_":1,"aA":2,"aa":3,"e":4,"é":5}'
  );
  let tooDeep: unknown = 'leaf';
  for (let depth = 0; depth < 130; depth += 1) {
    tooDeep = { value: tooDeep };
  }
  assert.throws(() => canonicalJson(tooDeep), /canonical_json_depth_exceeded/);
  assert.deepEqual(
    verifyEvidenceBundle({ ...bundle, entries: Array(10_001).fill(first) }),
    { ok: false, reason: 'bundle_missing_or_malformed' }
  );
  assert.deepEqual(verifyEvidenceBundle(bundle), { ok: true });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expectedReleaseId: ''
  }), { ok: false, reason: 'release_id_mismatch' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expectedExecutablePolicyHash: ''
  }), { ok: false, reason: 'executable_policy_hash_mismatch' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: new Date(NOW.getTime() + 1).toISOString(),
    now: new Date(Number.NaN)
  }), { ok: false, reason: 'verification_time_invalid' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: 'not-a-timestamp',
    now: NOW
  }), { ok: false, reason: 'release_expiry_invalid' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: '2026-02-30T00:00:00.000Z',
    now: NOW
  }), { ok: false, reason: 'release_expiry_invalid' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: '',
    now: NOW
  }), { ok: false, reason: 'release_expiry_invalid' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: NOW.toISOString(),
    now: NOW
  }), { ok: false, reason: 'release_expired' });
  assert.deepEqual(verifyEvidenceBundle(bundle, {
    expiresAt: new Date(NOW.getTime() + 1).toISOString(),
    now: NOW
  }), { ok: true });
  assert.deepEqual(verifyEvidenceBundle({
    ...bundle,
    createdAt: '2026-02-30T00:00:00.000Z'
  }), { ok: false, reason: 'bundle_missing_or_malformed' });
  const invalidCalendarEvidence = appendEvidence([], {
    ...evidenceFor(release),
    decisionMadeAt: '2026-02-30T00:00:00.000Z'
  });
  assert.deepEqual(verifyEvidenceBundle({
    ...bundle,
    entries: [invalidCalendarEvidence]
  }), { ok: false, reason: 'entry_missing_or_malformed:0' });
  for (const proposedAction of [undefined, () => undefined, Symbol('action'), 1n]) {
    assert.deepEqual(verifyEvidenceBundle({
      ...bundle,
      entries: [{
        ...first,
        evidence: { ...first.evidence, proposedAction }
      }]
    }), { ok: false, reason: 'entry_missing_or_malformed:0' });
  }
  const cyclicAction: { self?: unknown } = {};
  cyclicAction.self = cyclicAction;
  for (const proposedAction of [
    { nested: 1n },
    { nonFinite: Number.POSITIVE_INFINITY },
    cyclicAction
  ]) {
    assert.deepEqual(verifyEvidenceBundle({
      ...bundle,
      entries: [{
        ...first,
        evidence: { ...first.evidence, proposedAction }
      }]
    }), { ok: false, reason: 'entry_missing_or_malformed:0' });
  }
  const inconsistentHardwareEntries: ExecutionEvidence[] = [
    {
      ...evidenceFor(release),
      decision: 'blocked',
      hardwareSignalSent: true,
      hardwareSignalState: 'attempted_unconfirmed',
      dispatchedAt: NOW.toISOString()
    },
    {
      ...evidenceFor(release),
      decision: 'allowed',
      hardwareSignalSent: true,
      hardwareSignalState: 'attempted_unconfirmed'
    },
    {
      ...evidenceFor(release),
      hardwareSignalSent: false,
      hardwareSignalState: 'not_sent',
      dispatchedAt: NOW.toISOString()
    },
    {
      ...evidenceFor(release),
      hardwareSignalSent: false,
      hardwareSignalState: 'not_sent',
      controllerResult: { completed: true }
    },
    {
      ...evidenceFor(release),
      decision: 'failed',
      decisionMadeAt: new Date(NOW.getTime() + 1).toISOString(),
      hardwareSignalSent: true,
      hardwareSignalState: 'attempted_unconfirmed',
      dispatchedAt: NOW.toISOString()
    }
  ];
  for (const inconsistent of inconsistentHardwareEntries) {
    assert.deepEqual(verifyEvidenceBundle({
      ...bundle,
      entries: [appendEvidence([], inconsistent)]
    }), { ok: false, reason: 'hardware_evidence_inconsistent:0' });
  }
  const tampered = structuredClone(bundle);
  tampered.entries[0].evidence.decisionReason = 'edited';
  assert.match((verifyEvidenceBundle(tampered) as { ok: false; reason: string }).reason, /content_hash_mismatch/);
}

async function testGateAndShadow(): Promise<void> {
  const release = spec();
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const dispatchedActions: unknown[] = [];
  let currentRecord = releasedRecord(release);
  const hashAction = (action: unknown) => sha256(canonicalJson(action));
  const gate = new ReleaseExecutionGate(
    {
      async dispatch(action) {
        dispatches += 1;
        dispatchedActions.push(action);
        return { accepted: true };
      }
    },
    { append(entry) { entries.push(entry); } },
    async (action: { safe: boolean }) => ({
      allowed: action.safe,
      reason: action.safe ? 'policy_allowed' : 'policy_blocked',
      matchedRuleIds: ['safe-only']
    }),
    hashAction,
    async () => currentRecord
  );

  const action = { safe: false };
  const base: ExecutionRequest<typeof action, { ready: boolean }> = {
    release,
    releaseRecord: currentRecord,
    executionConfiguration: release.executionConfiguration,
    deviceId: 'arm-03',
    proposalId: 'proposal-gate',
    action,
    actionHash: hashAction(action),
    state: { ready: true },
    stateObservedAt: NOW.toISOString(),
    now: NOW
  };
  assert.equal((await gate.evaluate(base)).status, 'blocked');
  assert.equal(dispatches, 0);
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);

  assert.equal((await gate.evaluate({
    ...base,
    releaseRecord: { ...currentRecord, state: 'tested', approvedIdentityHash: undefined }
  })).status, 'approval_required');
  assert.equal(dispatches, 0);

  assert.equal((await gate.evaluate({ ...base, action: { safe: true }, state: undefined })).status, 'blocked');
  assert.equal(dispatches, 0);

  const safeAction = { safe: true };
  const allowed = await gate.evaluate({
    ...base,
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  assert.equal(allowed.status, 'allowed');
  if (allowed.status !== 'allowed') throw new Error('expected allowed');
  await gate.execute(allowed.authorizedRequest);
  assert.equal(dispatches, 1);
  await assert.rejects(gate.execute(allowed.authorizedRequest), /execution_permit_invalid/);
  assert.equal(dispatches, 1);

  const expiring = await gate.evaluate({
    ...base,
    proposalId: 'proposal-expiring',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (expiring.status !== 'allowed') throw new Error('expected allowed');
  await assert.rejects(gate.execute({
    ...expiring.authorizedRequest,
    now: new Date(NOW.getTime() + 1_001)
  }), /execution_permit_invalid/);
  assert.equal(dispatches, 1);

  const another = await gate.evaluate({
    ...base,
    proposalId: 'proposal-changed',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (another.status !== 'allowed') throw new Error('expected allowed');
  another.authorizedRequest.action = { safe: false };
  await assert.rejects(gate.execute(another.authorizedRequest), /execution_permit_invalid/);
  assert.equal(dispatches, 1);

  const wrongDevice = await gate.evaluate({
    ...base,
    proposalId: 'proposal-wrong-device',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (wrongDevice.status !== 'allowed') throw new Error('expected allowed');
  await assert.rejects(gate.execute({
    ...wrongDevice.authorizedRequest,
    deviceId: 'arm-99'
  }), /execution_permit_invalid/);

  const wrongController = await gate.evaluate({
    ...base,
    proposalId: 'proposal-wrong-controller',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (wrongController.status !== 'allowed') throw new Error('expected allowed');
  await assert.rejects(gate.execute({
    ...wrongController.authorizedRequest,
    controllerIdentity: 'controller-b'
  }), /execution_permit_invalid/);

  const wrongRelease = await gate.evaluate({
    ...base,
    proposalId: 'proposal-wrong-release',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (wrongRelease.status !== 'allowed') throw new Error('expected allowed');
  await assert.rejects(gate.execute({
    ...wrongRelease.authorizedRequest,
    release: {
      ...wrongRelease.authorizedRequest.release,
      metadata: {
        ...wrongRelease.authorizedRequest.release.metadata,
        releaseId: 'other-release'
      }
    }
  }), /execution_permit_invalid/);

  const revokedBeforeDispatch = await gate.evaluate({
    ...base,
    proposalId: 'proposal-revoked-before-dispatch',
    action: safeAction,
    actionHash: hashAction(safeAction)
  });
  if (revokedBeforeDispatch.status !== 'allowed') throw new Error('expected allowed');
  currentRecord = { ...currentRecord, state: 'revoked' };
  await assert.rejects(
    gate.execute(revokedBeforeDispatch.authorizedRequest),
    /execution_permit_invalid/
  );
  currentRecord = releasedRecord(release);

  await assert.rejects(gate.execute({ ...base, permit: {} } as any), /execution_permit_invalid/);
  assert.equal(dispatches, 1);

  const shadowEntries: ExecutionEvidence[] = [];
  const shadow = new ShadowExecutionGate(
    { append(entry) { shadowEntries.push(entry); } },
    async () => ({ allowed: true, reason: 'would_allow', matchedRuleIds: ['shadow'] }),
    hashAction
  );
  assert.equal((await shadow.evaluate({
    ...base,
    releaseRecord: { ...releasedRecord(release), state: 'shadow' },
    action: safeAction,
    actionHash: hashAction(safeAction)
  })).status, 'blocked');
  assert.equal(dispatches, 1);
  assert.equal(shadowEntries[0].hardwareSignalSent, false);
  assert.equal(shadowEntries[0].hardwareSignalState, 'not_sent');

  const callerOwnedAction = { safe: true };
  const mutationSafe = await gate.evaluate({
    ...base,
    proposalId: 'proposal-action-toctou',
    action: callerOwnedAction,
    actionHash: hashAction(callerOwnedAction)
  });
  if (mutationSafe.status !== 'allowed') throw new Error('expected allowed');
  const execution = gate.execute(mutationSafe.authorizedRequest);
  callerOwnedAction.safe = false;
  await execution;
  assert.deepEqual(dispatchedActions.at(-1), { safe: true });
  assert.deepEqual(entries.at(-1)?.proposedAction, { safe: true });
  assert.equal(dispatches, 2);
}

async function testDispatchEvidenceFreezesDecisionTimeBeforeAsyncDispatch(): Promise<void> {
  const expectedAuthorizationTime = '2026-07-26T00:00:00.000Z';
  const authorizationTime = new Date(expectedAuthorizationTime);
  let mutableExecutionClock: Date | undefined;
  const initial = spec();
  const executionConfiguration = executionConfigurationSchema.parse({
    ...initial.executionConfiguration,
    observedAt: authorizationTime.toISOString()
  });
  const release = spec({
    executionConfiguration,
    approvedConfigurationDigest: configurationDigest(executionConfiguration)
  });
  const action = { safe: true };
  const hashAction = (candidate: unknown) => sha256(canonicalJson(candidate));
  const entries: ExecutionEvidence[] = [];
  const gate = new ReleaseExecutionGate(
    {
      async dispatch() {
        mutableExecutionClock?.setTime(mutableExecutionClock.getTime() + 10_000);
        return { accepted: true };
      }
    },
    { append(entry) { entries.push(entry); } },
    async () => {
      authorizationTime.setTime(authorizationTime.getTime() + 10_000);
      return {
        allowed: true,
        reason: 'policy_allowed',
        matchedRuleIds: ['safe-only']
      };
    },
    hashAction,
    async () => {
      mutableExecutionClock?.setTime(mutableExecutionClock.getTime() + 10_000);
      return releasedRecord(release);
    }
  );
  const decision = await gate.evaluate({
    release,
    releaseRecord: releasedRecord(release),
    executionConfiguration,
    deviceId: 'arm-03',
    proposalId: 'proposal-async-dispatch-timing',
    action,
    actionHash: hashAction(action),
    state: { ready: true },
    stateObservedAt: authorizationTime.toISOString(),
    now: authorizationTime
  });
  assert.equal(decision.status, 'allowed');
  if (decision.status !== 'allowed') throw new Error('expected allowed');
  assert.equal(decision.authorizedRequest.now?.toISOString(), expectedAuthorizationTime);
  const executionClock = new Date(expectedAuthorizationTime);
  decision.authorizedRequest.now = executionClock;
  mutableExecutionClock = executionClock;
  await gate.execute(decision.authorizedRequest);

  const dispatched = entries.at(-1);
  assert.ok(dispatched?.dispatchedAt);
  assert.equal(dispatched.decisionMadeAt, dispatched.dispatchedAt);
  const entry = appendEvidence([], dispatched);
  assert.deepEqual(verifyEvidenceBundle({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: release.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(release),
    createdAt: dispatched.decisionMadeAt,
    entries: [entry]
  }), { ok: true });
}

const suites: Record<string, () => Promise<void>> = {
  'exec-spec': testExecSpec,
  'release-policy': testReleasePolicyAndDiff,
  evidence: testEvidence,
  'execution-gate': testGateAndShadow,
  'dispatch-evidence-time': testDispatchEvidenceFreezesDecisionTimeBeforeAsyncDispatch
};

async function main(): Promise<void> {
  const requested = process.argv[2];
  const selected = requested ? [[requested, suites[requested]] as const] : Object.entries(suites);
  if (selected.some(([, run]) => !run)) throw new Error(`unknown suite: ${requested}`);
  for (const [name, run] of selected) {
    await run();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`ReleaseGate tests passed (${selected.length} categories).\n`);
}

void main();
