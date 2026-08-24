import assert from 'node:assert/strict';
import { canonicalJson, sha256, type ExecutionEvidence } from '../../packages/core/evidence';
import { executablePolicyHash, executablePolicySpecSchema, type ExecutablePolicySpec } from '../../packages/core/exec-spec';
import { ReleaseExecutionGate, ShadowExecutionGate, type ExecutionRequest } from '../../packages/core/execution-gate';
import { executionEligibility, transitionRelease, type ReleaseRecord, type ReleaseState } from '../../packages/core/release-policy';
import {
  configurationDigest,
  executionConfigurationSchema
} from '../../packages/core/execution-configuration';

const H = (value: string) => value.repeat(64);
const NOW = new Date('2026-08-09T00:00:00.000Z');
const states: ReleaseState[] = ['draft', 'tested', 'approved', 'shadow', 'canary', 'released', 'revoked'];
const allowedTransitions: Record<ReleaseState, ReleaseState[]> = {
  draft: ['tested', 'revoked'],
  tested: ['approved', 'revoked'],
  approved: ['shadow', 'revoked'],
  shadow: ['canary', 'revoked'],
  canary: ['released', 'revoked'],
  released: ['revoked'],
  revoked: []
};

function makeSpec(): ExecutablePolicySpec {
  const executionConfiguration = executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: 'reference-device',
    robotIdentity: 'reference-sandbox',
    rosDistro: 'test',
    rmwImplementation: 'rmw_test_cpp',
    jointState: { topic: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
    controller: {
      name: 'reference_controller',
      followJointTrajectoryAction: '/reference_controller/follow_joint_trajectory',
      actionType: 'control_msgs/action/FollowJointTrajectory'
    },
    jointOrder: ['a', 'b'],
    adapter: { identity: 'decision-oracle', version: '1.0.0' },
    observedAt: NOW.toISOString()
  });
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1', kind: 'ExecutablePolicy',
    metadata: { name: 'oracle-reference', releaseId: 'oracle-release', createdAt: '2026-08-08T00:00:00.000Z' },
    model: { artifact: 'reference', sha256: H('a'), framework: 'custom', policyType: 'shadow', codeRevision: 'oracle' },
    actionContract: { representation: 'joint_position', dimension: 2, jointOrder: ['a', 'b'], units: { position: 'radian', velocity: 'radian_per_second' }, normalizerSha256: H('b'), preprocessorSha256: H('c'), postprocessorSha256: H('d') },
    robot: { profileId: 'reference-sandbox', profileSha256: H('e'), urdfSha256: H('f'), controllerType: 'reference_only', controllerConfigSha256: H('1') },
    runtimePolicy: { policySha256: H('2'), maxStateAgeMs: 1000, maxConfigurationAgeMs: 1000, failClosed: true },
    executionConfiguration,
    approvedConfigurationDigest: configurationDigest(executionConfiguration),
    evidence: { scenarioPackId: 'oracle', testReportSha256: H('3'), status: 'approved', approvedBy: 'oracle', approvedAt: '2026-08-08T01:00:00.000Z' },
    deployment: { allowedDeviceIds: ['reference-device'], mode: 'released', expiresAt: '2099-01-01T00:00:00.000Z' }
  });
}

function recordFor(release: ExecutablePolicySpec, state: ReleaseState = 'released'): ReleaseRecord {
  const identity = executablePolicyHash(release);
  return { releaseId: release.metadata.releaseId, state, executablePolicyHash: identity, approvedIdentityHash: identity, approvedConfigurationDigest: release.approvedConfigurationDigest };
}

function transitionEvidence(release: ExecutablePolicySpec): ExecutionEvidence {
  return {
    releaseId: release.metadata.releaseId, executablePolicyHash: executablePolicyHash(release), modelHash: release.model.sha256,
    actionContractHash: H('4'), robotProfileHash: release.robot.profileSha256, controllerProfileHash: release.robot.controllerConfigSha256,
    runtimePolicyHash: release.runtimePolicy.policySha256, deviceId: 'reference-device', proposalId: 'transition', proposedAction: {},
    decision: 'blocked', decisionReason: 'transition_evidence', matchedRuleIds: ['oracle'], decisionMadeAt: NOW.toISOString(),
    hardwareSignalSent: false, hardwareSignalState: 'not_sent', executionEvidence: 'not_executed'
  };
}

function testLifecycleMatrix(): number {
  const release = makeSpec();
  let covered = 0;
  for (const from of states) {
    for (const to of states) {
      const context = { actor: 'oracle', occurredAt: NOW.toISOString(), reason: 'oracle-transition', spec: release, evidence: [transitionEvidence(release)] };
      if (allowedTransitions[from].includes(to)) {
        const prior = {
          ...recordFor(release, from),
          approvedBy: 'prior-approver',
          approvedAt: '2026-08-07T00:00:00.000Z',
          approvedIdentityHash: H('7'),
          revokedAt: '2026-08-07T01:00:00.000Z',
          revokedReason: 'prior-revocation'
        };
        const next = transitionRelease(prior, to, context);
        assert.equal(next.state, to, `${from}->${to}`);
        if (to === 'approved') {
          assert.equal(next.approvedBy, 'oracle');
          assert.equal(next.approvedAt, NOW.toISOString());
          assert.equal(next.approvedIdentityHash, executablePolicyHash(release));
        } else {
          assert.equal(next.approvedBy, prior.approvedBy);
          assert.equal(next.approvedAt, prior.approvedAt);
          assert.equal(next.approvedIdentityHash, prior.approvedIdentityHash);
        }
        if (to === 'revoked') {
          assert.equal(next.revokedAt, NOW.toISOString());
          assert.equal(next.revokedReason, 'oracle-transition');
        } else {
          assert.equal(next.revokedAt, prior.revokedAt);
          assert.equal(next.revokedReason, prior.revokedReason);
        }
      } else {
        assert.throws(() => transitionRelease(recordFor(release, from), to, context), new RegExp(`invalid_release_transition:${from}->${to}`));
      }
      covered += 1;
    }
  }
  assert.throws(() => transitionRelease(recordFor(release, 'draft'), 'tested', { actor: 'oracle', occurredAt: NOW.toISOString(), reason: 'changed', spec: { ...release, model: { ...release.model, sha256: H('9') } }, evidence: [transitionEvidence(release)] }), /release_identity_changed_reapproval_required/);
  for (const invalid of [{ actor: '', evidence: [transitionEvidence(release)] }, { actor: 'oracle', evidence: [] }]) {
    assert.throws(() => transitionRelease(recordFor(release, 'tested'), 'approved', { ...invalid, occurredAt: NOW.toISOString(), reason: 'approve', spec: release }), /approval_requires_identity_and_evidence/);
  }
  assert.equal(transitionRelease(recordFor(release, 'draft'), 'tested', {
    actor: '', occurredAt: NOW.toISOString(), reason: '', spec: release, evidence: []
  }).state, 'tested');
  return covered + 4;
}

function testEligibilityBranches(): number {
  const release = makeSpec();
  const base = recordFor(release);
  const cases: Array<[string, ExecutablePolicySpec, ReleaseRecord, string, Date, true | string]> = [
    ['allowed', release, base, 'reference-device', NOW, true],
    ['allowed-canary', { ...release, deployment: { ...release.deployment, mode: 'canary' } }, { ...recordFor({ ...release, deployment: { ...release.deployment, mode: 'canary' } }), state: 'canary' }, 'reference-device', NOW, true],
    ['release-id', release, { ...base, releaseId: 'other' }, 'reference-device', NOW, 'release_id_mismatch'],
    ['record-revoked', release, { ...base, state: 'revoked' }, 'reference-device', NOW, 'release_revoked'],
    ['spec-revoked', { ...release, evidence: { ...release.evidence, status: 'revoked', approvedBy: '', approvedAt: '' } }, base, 'reference-device', NOW, 'release_revoked'],
    ...(['draft', 'tested', 'approved', 'shadow'] as ReleaseState[]).map((state) => [`state-${state}`, release, { ...base, state }, 'reference-device', NOW, `release_state_${state}_cannot_dispatch`] as [string, ExecutablePolicySpec, ReleaseRecord, string, Date, string]),
    ['identity', release, { ...base, executablePolicyHash: H('8') }, 'reference-device', NOW, 'release_identity_changed_reapproval_required'],
    ['approval-identity', release, { ...base, approvedIdentityHash: H('8') }, 'reference-device', NOW, 'release_approval_identity_mismatch'],
    ['not-approved', { ...release, evidence: { ...release.evidence, status: 'tested', approvedBy: '', approvedAt: '' } }, recordFor({ ...release, evidence: { ...release.evidence, status: 'tested', approvedBy: '', approvedAt: '' } }), 'reference-device', NOW, 'release_not_approved'],
    ['mode', { ...release, deployment: { ...release.deployment, mode: 'canary' } }, recordFor({ ...release, deployment: { ...release.deployment, mode: 'canary' } }), 'reference-device', NOW, 'release_deployment_mode_mismatch'],
    ['expiry-minus-1', { ...release, deployment: { ...release.deployment, expiresAt: new Date(NOW.getTime() + 1).toISOString() } }, recordFor({ ...release, deployment: { ...release.deployment, expiresAt: new Date(NOW.getTime() + 1).toISOString() } }), 'reference-device', NOW, true],
    ['expiry-exact', { ...release, deployment: { ...release.deployment, expiresAt: NOW.toISOString() } }, recordFor({ ...release, deployment: { ...release.deployment, expiresAt: NOW.toISOString() } }), 'reference-device', NOW, 'release_expired'],
    ['expiry-plus-1', { ...release, deployment: { ...release.deployment, expiresAt: new Date(NOW.getTime() - 1).toISOString() } }, recordFor({ ...release, deployment: { ...release.deployment, expiresAt: new Date(NOW.getTime() - 1).toISOString() } }), 'reference-device', NOW, 'release_expired'],
    ['device', release, base, 'other-device', NOW, 'device_not_allowed']
  ];
  for (const [id, candidate, record, device, now, expected] of cases) {
    const result = executionEligibility(candidate, record, device, now);
    if (expected === true) assert.deepEqual(result, { allowed: true }, id);
    else assert.deepEqual(result, { allowed: false, reason: expected }, id);
  }
  return cases.length;
}

async function testExecutionAndPermitBranches(): Promise<number> {
  const release = makeSpec();
  const action = { safe: true, joints: [0, 1] };
  const hashAction = (value: unknown) => sha256(canonicalJson(value));
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  let refreshed = recordFor(release);
  let refreshFailure = false;
  const gate = new ReleaseExecutionGate(
    { async dispatch(value: typeof action) { dispatches += 1; if ((value as any).throw) throw new Error('controller_rejected'); if ((value as any).resultMode === 'primitive') return 'accepted' as any; if ((value as any).resultMode === 'null') return null as any; return (value as any).terminal === false ? { accepted: true } : { accepted: true, completed: true }; } },
    { append(value) { entries.push(value); } },
    async (value: typeof action) => ({ allowed: value.safe, reason: value.safe ? 'policy_allowed' : 'policy_denied', matchedRuleIds: ['safe-only'] }),
    hashAction,
    async () => { if (refreshFailure) throw new Error('offline'); return refreshed; }
  );
  const base: ExecutionRequest<typeof action, { ready: true }> = { release, releaseRecord: refreshed, executionConfiguration: release.executionConfiguration, deviceId: 'reference-device', proposalId: 'oracle', action, actionHash: hashAction(action), state: { ready: true }, stateObservedAt: NOW.toISOString(), now: NOW };

  const evaluateCases: Array<[string, Partial<typeof base>, string, string]> = [
    ['state-missing', { state: undefined }, 'blocked', 'state_missing'],
    ['state-time-missing', { stateObservedAt: undefined }, 'blocked', 'state_missing'],
    ['state-invalid', { stateObservedAt: 'not-a-date' }, 'blocked', 'state_stale_or_invalid'],
    ['state-future', { stateObservedAt: new Date(NOW.getTime() + 1).toISOString() }, 'blocked', 'state_stale_or_invalid'],
    ['state-exact-max', { stateObservedAt: new Date(NOW.getTime() - 1000).toISOString() }, 'allowed', 'policy_allowed'],
    ['state-max-plus-1', { stateObservedAt: new Date(NOW.getTime() - 1001).toISOString() }, 'blocked', 'state_stale_or_invalid'],
    ['action-hash', { actionHash: H('9') }, 'blocked', 'action_hash_mismatch'],
    ['policy', { action: { ...action, safe: false }, actionHash: hashAction({ ...action, safe: false }) }, 'blocked', 'policy_denied'],
    ['approval', { releaseRecord: { ...refreshed, state: 'tested', approvedIdentityHash: undefined } }, 'approval_required', 'release_state_tested_cannot_dispatch'],
    ['approval-identity', { releaseRecord: { ...refreshed, approvedIdentityHash: H('8') } }, 'approval_required', 'release_approval_identity_mismatch'],
    ['ordinary-block', { deviceId: 'other-device' }, 'blocked', 'device_not_allowed'],
    ['revoked-block', { releaseRecord: { ...refreshed, state: 'revoked' } }, 'blocked', 'release_revoked']
  ];
  for (const [id, change, status, reason] of evaluateCases) {
    const result = await gate.evaluate({ ...base, ...change });
    assert.equal(result.status, status, id);
    assert.equal(result.reason, reason, id);
    if (status !== 'allowed') {
      assert.equal(entries.at(-1)?.decisionReason, reason, id);
      assert.equal(entries.at(-1)?.decision, status, id);
      assert.equal(entries.at(-1)?.hardwareSignalSent, false, id);
      assert.deepEqual(entries.at(-1)?.matchedRuleIds,
        id.startsWith('state-') ? ['state_freshness']
          : id === 'action-hash' ? ['action_identity']
            : id === 'policy' ? ['safe-only'] : ['release_eligibility'], id);
    }
  }

  async function issued(id: string, issuedAction: typeof action = action) {
    const result = await gate.evaluate({ ...base, proposalId: id, action: issuedAction, actionHash: hashAction(issuedAction) });
    if (result.status !== 'allowed') throw new Error(`expected permit:${id}`);
    return result.authorizedRequest;
  }
  await gate.execute({ ...(await issued('expiry-minus-1')), now: new Date(NOW.getTime() + 999) });
  assert.equal(dispatches, 1);
  await assert.rejects(gate.execute({ ...(await issued('expiry-exact')), now: new Date(NOW.getTime() + 1000) }), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'permit_expired');
  await assert.rejects(gate.execute({ ...(await issued('expiry-plus-1')), now: new Date(NOW.getTime() + 1001) }), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'state_stale_or_invalid');
  assert.equal(entries.at(-1)?.decision, 'blocked');
  assert.deepEqual(entries.at(-1)?.matchedRuleIds, ['state_freshness', 'single_use_permit']);
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  await assert.rejects(
    gate.execute({ ...(await issued('execute-state-missing')), state: undefined }),
    /execution_permit_invalid:state_missing/
  );
  assert.equal(entries.at(-1)?.decisionReason, 'state_missing');
  await assert.rejects(
    gate.execute({ ...(await issued('execute-state-time-missing')), stateObservedAt: undefined }),
    /execution_permit_invalid:state_missing/
  );
  assert.equal(entries.at(-1)?.decisionReason, 'state_missing');
  await assert.rejects(
    gate.execute({ ...(await issued('execute-state-invalid')), stateObservedAt: 'not-a-date' }),
    /execution_permit_invalid:state_stale_or_invalid/
  );
  assert.equal(entries.at(-1)?.decisionReason, 'state_stale_or_invalid');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  await assert.rejects(
    gate.execute({
      ...(await issued('execute-state-future')),
      stateObservedAt: new Date(NOW.getTime() + 1).toISOString()
    }),
    /execution_permit_invalid:state_stale_or_invalid/
  );
  assert.equal(entries.at(-1)?.decisionReason, 'state_stale_or_invalid');
  assert.equal(entries.at(-1)?.hardwareSignalSent, false);
  const longTtlRelease = { ...release, runtimePolicy: { ...release.runtimePolicy, maxStateAgeMs: 5_000 } };
  const longTtlResult = await gate.evaluate({
    ...base,
    release: longTtlRelease,
    releaseRecord: recordFor(longTtlRelease),
    proposalId: 'ttl-minimum-bound'
  });
  assert.equal(longTtlResult.status, 'allowed');
  if (longTtlResult.status !== 'allowed') throw new Error('expected long ttl permit');
  await assert.rejects(gate.execute({ ...longTtlResult.authorizedRequest, now: new Date(NOW.getTime() + 1_000) }), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'permit_expired');

  const reused = await issued('reuse');
  await gate.execute(reused);
  await assert.rejects(gate.execute(reused), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'permit_unknown_or_reused');
  await assert.rejects(gate.execute({ ...base, permit: {} } as any), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'permit_unknown_or_reused');

  for (const [id, change, reason] of [
    ['action-binding', { actionHash: H('8') }, 'permit_action_binding_mismatch'],
    ['release-binding', { release: { ...release, metadata: { ...release.metadata, releaseId: 'other' } } }, 'permit_release_binding_mismatch'],
    ['device-binding', { deviceId: 'other' }, 'permit_device_binding_mismatch'],
    ['controller-binding', { controllerIdentity: 'other-controller' }, 'permit_controller_binding_mismatch'],
    ['action-mutation', { action: { ...action, joints: [1, 0] } }, 'action_hash_mismatch']
  ] as Array<[string, Record<string, unknown>, string]>) {
    await assert.rejects(gate.execute({ ...(await issued(id)), ...change } as any), /execution_permit_invalid/, id);
    assert.equal(entries.at(-1)?.decisionReason, reason, id);
  }

  const revoked = await issued('revoke-between');
  refreshed = { ...refreshed, state: 'revoked' };
  await assert.rejects(gate.execute(revoked), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'release_revoked');
  refreshed = recordFor(release);
  refreshFailure = true;
  const refresh = await issued('refresh-failure');
  await assert.rejects(gate.execute(refresh), /execution_permit_invalid/);
  assert.equal(entries.at(-1)?.decisionReason, 'release_record_refresh_failed');
  refreshFailure = false;

  const concurrent = await issued('concurrent');
  const race = await Promise.allSettled([gate.execute(concurrent), gate.execute(concurrent)]);
  assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(race.filter((item) => item.status === 'rejected').length, 1);
  const nonterminalAction = { ...action, terminal: false };
  await gate.execute(await issued('controller-nonterminal', nonterminalAction));
  assert.equal(entries.at(-1)?.executionEvidence, 'dispatch_attempted');
  assert.equal(entries.at(-1)?.decision, 'allowed');
  assert.equal(entries.at(-1)?.decisionReason, 'dispatched');
  assert.deepEqual(entries.at(-1)?.matchedRuleIds, ['release_eligibility', 'state_freshness', 'action_identity']);
  assert.equal(entries.at(-1)?.hardwareSignalSent, true);
  assert.equal(entries.at(-1)?.hardwareSignalState, 'attempted_unconfirmed');
  const terminalAction = { ...action, terminal: true };
  await gate.execute(await issued('controller-terminal', terminalAction));
  assert.equal(entries.at(-1)?.executionEvidence, 'controller_result_recorded');
  assert.equal(entries.at(-1)?.hardwareSignalSent, true);
  const primitiveResultAction = { ...action, resultMode: 'primitive' };
  await gate.execute(await issued('controller-primitive', primitiveResultAction));
  assert.equal(entries.at(-1)?.executionEvidence, 'dispatch_attempted');
  const nullResultAction = { ...action, resultMode: 'null' };
  await gate.execute(await issued('controller-null', nullResultAction));
  assert.equal(entries.at(-1)?.executionEvidence, 'dispatch_attempted');
  const failingAction = { ...action, throw: true };
  const beforeFailure = dispatches;
  await assert.rejects(gate.execute(await issued('controller-failure', failingAction)), /controller_rejected/);
  assert.equal(dispatches, beforeFailure + 1);
  assert.equal(entries.at(-1)?.decisionReason, 'controller_rejected');
  assert.equal(entries.at(-1)?.executionEvidence, 'dispatch_failed');
  assert.equal(entries.at(-1)?.decision, 'failed');
  assert.deepEqual(entries.at(-1)?.matchedRuleIds, ['dispatch']);
  assert.equal(entries.at(-1)?.hardwareSignalState, 'attempted_unconfirmed');
  assert.ok(entries.every((entry) => entry.hardwareSignalSent === (entry.hardwareSignalState !== 'not_sent')));
  return evaluateCases.length + 22;
}

async function testShadowBranches(): Promise<number> {
  const baseRelease = makeSpec();
  const shadowRelease = { ...baseRelease, deployment: { ...baseRelease.deployment, mode: 'shadow' as const } };
  const identity = executablePolicyHash(shadowRelease);
  const action = { safe: true };
  const hashAction = (value: unknown) => sha256(canonicalJson(value));
  const entries: ExecutionEvidence[] = [];
  const gate = new ShadowExecutionGate(
    { append(value) { entries.push(value); } },
    async (value: typeof action) => ({ allowed: value.safe, reason: value.safe ? 'policy_allowed' : 'policy_denied', matchedRuleIds: ['safe-only'] }),
    hashAction
  );
  const record: ReleaseRecord = { releaseId: shadowRelease.metadata.releaseId, state: 'shadow', executablePolicyHash: identity, approvedIdentityHash: identity, approvedConfigurationDigest: shadowRelease.approvedConfigurationDigest };
  const base: ExecutionRequest<typeof action, { ready: true }> = { release: shadowRelease, releaseRecord: record, executionConfiguration: shadowRelease.executionConfiguration, deviceId: 'reference-device', proposalId: 'shadow', action, actionHash: hashAction(action), state: { ready: true }, stateObservedAt: NOW.toISOString(), now: NOW };
  const cases: Array<[string, Partial<typeof base>, string]> = [
    ['revoked-record', { releaseRecord: { ...record, state: 'revoked' } }, 'release_revoked'],
    ['revoked-spec', { release: { ...shadowRelease, evidence: { ...shadowRelease.evidence, status: 'revoked', approvedBy: '', approvedAt: '' } } }, 'release_revoked'],
    ['wrong-state', { releaseRecord: { ...record, state: 'approved' } }, 'release_not_in_shadow_state'],
    ['release-id', { releaseRecord: { ...record, releaseId: 'other' } }, 'release_id_mismatch'],
    ['identity', { releaseRecord: { ...record, executablePolicyHash: H('8') } }, 'release_identity_changed_reapproval_required'],
    ['approval-identity', { releaseRecord: { ...record, approvedIdentityHash: H('8') } }, 'release_identity_changed_reapproval_required'],
    ['not-approved', { release: { ...shadowRelease, evidence: { ...shadowRelease.evidence, status: 'tested', approvedBy: '', approvedAt: '' } } }, 'release_not_approved'],
    ['mode', { release: { ...shadowRelease, deployment: { ...shadowRelease.deployment, mode: 'released' } } }, 'release_deployment_mode_mismatch'],
    ['device', { deviceId: 'other' }, 'device_not_allowed'],
    ['expired', { release: { ...shadowRelease, deployment: { ...shadowRelease.deployment, expiresAt: NOW.toISOString() } }, releaseRecord: undefined as never }, 'release_expired'],
    ['state-missing', { state: undefined }, 'state_missing'],
    ['state-time-missing', { stateObservedAt: undefined }, 'state_missing'],
    ['state-invalid', { stateObservedAt: 'invalid' }, 'state_stale_or_invalid'],
    ['state-future', { stateObservedAt: new Date(NOW.getTime() + 1).toISOString() }, 'state_stale_or_invalid'],
    ['state-old', { stateObservedAt: new Date(NOW.getTime() - 1001).toISOString() }, 'state_stale_or_invalid'],
    ['state-exact-max', { stateObservedAt: new Date(NOW.getTime() - 1000).toISOString() }, 'shadow_observation_only:policy_allowed'],
    ['action-hash', { actionHash: H('9') }, 'action_hash_mismatch'],
    ['policy-block', { action: { safe: false }, actionHash: hashAction({ safe: false }) }, 'policy_denied'],
    ['would-allow', {}, 'shadow_observation_only:policy_allowed']
  ];
  for (const [id, changes, reason] of cases) {
    let request = { ...base, ...changes } as typeof base;
    if (id === 'expired') {
      const release = changes.release!;
      request = { ...request, releaseRecord: { ...recordFor(release), state: 'shadow' } };
    }
    if (id === 'not-approved' || id === 'mode') request = { ...request, releaseRecord: { ...recordFor(request.release), state: 'shadow' } };
    const result = await gate.evaluate(request);
    assert.equal(result.status, 'blocked', id);
    assert.equal(result.reason, reason, id);
    assert.equal(entries.at(-1)?.hardwareSignalSent, false, id);
    assert.equal(entries.at(-1)?.executionEvidence, 'shadow_not_dispatched', id);
    const evidenceReason = reason.startsWith('shadow_observation_only:') ? reason.replace('shadow_observation_only:', 'shadow:') : `shadow:${reason}`;
    assert.equal(entries.at(-1)?.decisionReason, evidenceReason, id);
    assert.equal(entries.at(-1)?.decision, reason.startsWith('shadow_observation_only:') ? 'allowed' : 'blocked', id);
    assert.deepEqual(entries.at(-1)?.matchedRuleIds,
      id === 'action-hash' ? ['action_identity']
        : id === 'policy-block' || id === 'would-allow' || id === 'state-exact-max' ? ['safe-only']
          : id.startsWith('state-') ? ['state_freshness'] : ['shadow_release_eligibility'], id);
  }
  return cases.length;
}

async function testDecisionProperties(): Promise<number> {
  const release = makeSpec();
  const record = recordFor(release);
  const action = { safe: true, joints: [0, 1] };
  const hashAction = (value: unknown) => sha256(canonicalJson(value));
  const entries: ExecutionEvidence[] = [];
  const gate = new ReleaseExecutionGate(
    { async dispatch() { return { accepted: true, completed: true }; } },
    { append(value) { entries.push(value); } },
    async () => ({ allowed: true, reason: 'property_policy_allowed', matchedRuleIds: ['property'] }),
    hashAction
  );
  const base: ExecutionRequest<typeof action, { ready: true }> = {
    release, releaseRecord: record, executionConfiguration: release.executionConfiguration, deviceId: 'reference-device', proposalId: 'property', action,
    actionHash: hashAction(action), state: { ready: true }, stateObservedAt: NOW.toISOString(), now: NOW
  };
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  let samples = 0;
  for (let index = 0; index < 64; index += 1) {
    const salt = `${index}-${random()}`;
    const mutatedHash = sha256(salt);
    assert.deepEqual(
      executionEligibility(release, { ...record, executablePolicyHash: mutatedHash }, 'reference-device', NOW),
      { allowed: false, reason: 'release_identity_changed_reapproval_required' }
    );
    assert.deepEqual(executionEligibility(release, record, `device-${salt}`, NOW), {
      allowed: false, reason: 'device_not_allowed'
    });

    const ageMs = (random() % 1021) - 10;
    const stateResult = await gate.evaluate({
      ...base,
      proposalId: `state-property-${salt}`,
      stateObservedAt: new Date(NOW.getTime() - ageMs).toISOString()
    });
    assert.equal(stateResult.status, ageMs >= 0 && ageMs <= 1000 ? 'allowed' : 'blocked');

    async function propertyPermit(name: string) {
      const decision = await gate.evaluate({ ...base, proposalId: `${name}-${salt}` });
      assert.equal(decision.status, 'allowed');
      if (decision.status !== 'allowed') throw new Error('property_permit_missing');
      return decision.authorizedRequest;
    }
    await assert.rejects(gate.execute({ ...(await propertyPermit('device')), deviceId: `device-${salt}` }), /execution_permit_invalid/);
    assert.equal(entries.at(-1)?.decisionReason, 'permit_device_binding_mismatch');
    await assert.rejects(gate.execute({ ...(await propertyPermit('controller')), controllerIdentity: mutatedHash }), /execution_permit_invalid/);
    assert.equal(entries.at(-1)?.decisionReason, 'permit_controller_binding_mismatch');
    await assert.rejects(gate.execute({ ...(await propertyPermit('action')), action: { ...action, joints: [index, random()] } }), /execution_permit_invalid/);
    assert.equal(entries.at(-1)?.decisionReason, 'action_hash_mismatch');

    const expiryDelta = [999, 1000, 1001][index % 3]!;
    const expiring = await propertyPermit('expiry');
    if (expiryDelta < 1000) {
      await gate.execute({ ...expiring, now: new Date(NOW.getTime() + expiryDelta) });
    } else {
      await assert.rejects(gate.execute({ ...expiring, now: new Date(NOW.getTime() + expiryDelta) }), /execution_permit_invalid/);
      assert.equal(
        entries.at(-1)?.decisionReason,
        expiryDelta === 1000 ? 'permit_expired' : 'state_stale_or_invalid'
      );
    }
    samples += 7;
  }
  return samples;
}

async function main(): Promise<void> {
  const lifecycle = testLifecycleMatrix();
  const eligibility = testEligibilityBranches();
  const execution = await testExecutionAndPermitBranches();
  const shadow = await testShadowBranches();
  const propertySamples = await testDecisionProperties();
  process.stdout.write(`${JSON.stringify({ lifecycle, eligibility, execution, shadow, covered: lifecycle + eligibility + execution + shadow, propertySamples })}\n`);
}

void main();
