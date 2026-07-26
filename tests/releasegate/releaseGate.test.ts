import assert from 'node:assert/strict';
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
import {
  InMemoryActionProposalSource,
  InMemoryControllerSink,
  InMemoryReleaseResolver,
  InMemoryRobotStateSource
} from '../../packages/ros2-gateway';

const H = (character: string) => character.repeat(64);
const NOW = new Date('2026-07-26T00:00:00.000Z');

function spec(overrides: Partial<ExecutablePolicySpec> = {}): ExecutablePolicySpec {
  return executablePolicySpecSchema.parse({
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: 'warehouse-pick-v27',
      releaseId: 'rw-release-2026-0042',
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
  const source = new InMemoryActionProposalSource<{ value: number }>();
  let observed = 0;
  await source.subscribe(async (proposal) => { observed = proposal.action.value; });
  await source.publish({
    proposalId: 'p1',
    proposerIdentity: 'untrusted',
    deviceId: 'arm-03',
    action: { value: 7 },
    proposedAt: NOW.toISOString()
  });
  assert.equal(observed, 7);
  const states = new InMemoryRobotStateSource<{ ready: boolean }>();
  await assert.rejects(states.getFreshState(100), /robot_state_missing/);
  states.update({ ready: true });
  assert.deepEqual(await states.getFreshState(100), { ready: true });

  const resolver = new InMemoryReleaseResolver();
  const release = spec();
  resolver.bind('arm-03', 'proposer-a', release);
  assert.equal((await resolver.resolveActiveRelease('arm-03', 'proposer-a')).metadata.releaseId, release.metadata.releaseId);
  await assert.rejects(resolver.resolveActiveRelease('arm-03', 'proposer-b'), /active_release_not_found/);

  const sink = new InMemoryControllerSink<{ value: number }>();
  await sink.cancel('test cancel');
  assert.deepEqual(sink.cancellations, ['test cancel']);
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
  assert.equal(packageJson.bin.rlsok, packageJson.bin.rw, 'rlsok and rw binaries must use one implementation');
  assert.equal(packageJson.scripts.rlsok, packageJson.scripts.rw, 'rlsok and rw scripts must use one implementation');
  assert.equal(packageJson.scripts.build, 'npm run build:core', 'default build must target the headless core');
  assert.equal(packageJson.scripts.daemon, 'node scripts/run-rlsok-daemon.cjs', 'daemon boundary must have an explicit headless entry');
  assert(packageJson.scripts.lab && packageJson.scripts['lab:build'], 'optional Lab must have explicit scripts');

  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert(readme.startsWith('# RLSOK\n'), 'README must lead with the current product name');
  for (const statement of [
    'Release control for executable robot policies.',
    'Only RLSOK releases reach the robot.',
    'Live ROS 2 / DDS / SROS 2 network integration | Not implemented'
  ]) assert(readme.includes(statement), `README is missing required boundary statement: ${statement}`);

  for (const removed of [
    'components/MarketplaceManager.tsx',
    'components/ManualImportWizard.tsx',
    'components/AssetImportWizard.tsx',
    'components/RealityAssetCatalog.tsx'
  ]) assert(!existsSync(join(root, removed)), `${removed} must not remain as a dormant product surface`);

  const trustedRoots = [
    'packages/exec-spec',
    'packages/release-policy',
    'packages/execution-gate',
    'packages/evidence',
    'packages/action-contract',
    'packages/robot-profile',
    'packages/adapter-sdk',
    'packages/ros2-gateway',
    'apps/cli',
    'apps/daemon'
  ];
  const forbiddenImport = /(?:from\s+['"]|require\(['"])[^'"]*(?:react|next|electron|marketplace|manual-import|llm-compiler|virtual-lab)/i;
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
