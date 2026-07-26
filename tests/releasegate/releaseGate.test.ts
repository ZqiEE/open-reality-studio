import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { actionContractSchema } from '../../packages/action-contract';
import {
  appendEvidence,
  canonicalJson,
  sha256,
  verifyEvidenceBundle,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/evidence';
import {
  checkExecutablePolicySpec,
  diffExecutablePolicies,
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/exec-spec';
import {
  ReleaseExecutionGate,
  ShadowExecutionGate,
  type ExecutionRequest
} from '../../packages/execution-gate';
import {
  executionEligibility,
  transitionRelease,
  type ReleaseRecord
} from '../../packages/release-policy';
import { InMemoryReleaseResolver } from '../../packages/ros2-gateway';

const H = (character: string) => character.repeat(64);
const NOW = new Date('2026-07-26T00:00:00.000Z');

function spec(overrides: Partial<ExecutablePolicySpec> = {}): ExecutablePolicySpec {
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
      maxActionRateHz: 20,
      maxStateAgeMs: 1000,
      failClosed: true
    },
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

  assert.equal(actionContractSchema.safeParse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ActionContract',
    metadata: { name: 'bad', version: '1' },
    representation: 'joint_position',
    dimension: 2,
    jointOrder: ['only-one'],
    units: { position: 'degree', velocity: 'degree_per_second' },
    parameterRanges: {},
    requiredState: [],
    executionMode: 'single',
    constraints: []
  }).success, false);
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
  }).record;
  record = transitionRelease(record, 'approved', {
    actor: 'approver',
    occurredAt: NOW.toISOString(),
    reason: 'approved',
    spec: release,
    evidence: [evidenceFor(release)]
  }).record;
  assert.equal(record.approvedIdentityHash, identity);
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
  assert.deepEqual(verifyEvidenceBundle(bundle), { ok: true });
  const tampered = structuredClone(bundle);
  tampered.entries[0].evidence.decisionReason = 'edited';
  assert.match((verifyEvidenceBundle(tampered) as { ok: false; reason: string }).reason, /content_hash_mismatch/);
}

async function testGateAndShadow(): Promise<void> {
  const release = spec();
  const entries: ExecutionEvidence[] = [];
  let dispatches = 0;
  const hashAction = (action: unknown) => sha256(canonicalJson(action));
  const gate = new ReleaseExecutionGate(
    {
      async dispatch() {
        dispatches += 1;
        return { accepted: true };
      }
    },
    { append(entry) { entries.push(entry); } },
    async (action: { safe: boolean }) => ({
      allowed: action.safe,
      reason: action.safe ? 'policy_allowed' : 'policy_blocked',
      matchedRuleIds: ['safe-only']
    }),
    hashAction
  );

  const action = { safe: false };
  const base: ExecutionRequest<typeof action, { ready: boolean }> = {
    release,
    releaseRecord: releasedRecord(release),
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
  another.authorizedRequest.action.safe = false;
  await assert.rejects(gate.execute(another.authorizedRequest), /execution_permit_invalid/);
  assert.equal(dispatches, 1);

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
}

async function testAdapterContracts(): Promise<void> {
  const resolver = new InMemoryReleaseResolver();
  const release = spec();
  resolver.bind('arm-03', 'proposer-a', release);
  assert.equal((await resolver.resolveActiveRelease('arm-03', 'proposer-a')).metadata.releaseId, release.metadata.releaseId);
  await assert.rejects(resolver.resolveActiveRelease('arm-03', 'proposer-b'), /active_release_not_found/);
}

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? sourceFiles(child) : /\.(?:ts|tsx|js|cjs|mjs)$/.test(name) ? [child] : [];
  });
}

async function testProductBoundaries(): Promise<void> {
  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    bin: Record<string, string>;
    scripts: Record<string, string>;
  };
  const trackedFiles = new Set(
    execFileSync(
      'git',
      ['ls-files'],
      { cwd: root, encoding: 'utf8' }
    ).trim().split(/\r?\n/)
  );
  assert.deepEqual(Object.keys(packageJson.bin), ['rlsok'], 'rlsok must be the only public binary');
  assert.equal(packageJson.bin.rlsok, 'scripts/run-rlsok.cjs');
  assert(!('rw' in packageJson.scripts), 'the retired CLI alias must not remain');

  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert(readme.startsWith('# RLSOK\n'), 'README must lead with the current product name');
  for (const statement of [
    'release-control and execution-gating system for learned robot policies',
    'Shadow is the default',
    'Live DDS, SROS2, controller and physical-robot validation require an appropriate ROS 2 environment'
  ]) assert(readme.includes(statement), `README is missing required boundary statement: ${statement}`);

  for (const removed of [
    'app',
    'components',
    'electron',
    'firmware',
    'lib',
    'marketplace'
  ]) assert(
    !Array.from(trackedFiles).some((file) => file === removed || file.startsWith(`${removed}/`)),
    `${removed} must not remain as a tracked product surface`
  );

  const trustedRoots = [
    'packages/exec-spec',
    'packages/release-policy',
    'packages/execution-gate',
    'packages/evidence',
    'packages/action-contract',
    'packages/robot-profile',
    'packages/ros2-gateway',
    'packages/ros2-reference-gateway',
    'apps/cli'
  ];
  const forbiddenImport = /(?:from\s+['"]|require\(['"])[^'"]*(?:react|next|electron|marketplace|manual-import|compiler|virtual-lab|hardware)/i;
  for (const path of trustedRoots.flatMap((entry) => sourceFiles(join(root, entry)))) {
    assert(!forbiddenImport.test(readFileSync(path, 'utf8')), `${path} imports outside the trusted RLSOK boundary`);
  }
}

const suites: Record<string, () => Promise<void>> = {
  'exec-spec': testExecSpec,
  'release-policy': testReleasePolicyAndDiff,
  'release-diff': testReleasePolicyAndDiff,
  'release-revocation': testReleasePolicyAndDiff,
  evidence: testEvidence,
  'execution-gate': testGateAndShadow,
  'shadow-mode': testGateAndShadow,
  'fail-closed': testGateAndShadow,
  'no-bypass': testGateAndShadow,
  'adapter-contract': testAdapterContracts,
  'product-boundary': testProductBoundaries
};

async function main(): Promise<void> {
  const requested = process.argv[2];
  const selected = requested ? [[requested, suites[requested]] as const] : Object.entries(suites);
  if (selected.some(([, run]) => !run)) throw new Error(`unknown suite: ${requested}`);
  const completed = new Set<() => Promise<void>>();
  for (const [name, run] of selected) {
    if (!completed.has(run)) await run();
    completed.add(run);
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`ReleaseGate tests passed (${selected.length} categories).\n`);
}

void main();
