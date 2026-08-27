import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  collectInferenceProvenance,
  commandPathRuntimeAttestation,
  degradationRuntimeAttestation,
  fastDdsCommandPathObservation,
  golemUpperBodyRuntimeAttestation,
  selectedObservedStateRuntimeAttestation
} from '../../packages/adapter-references';
import { selectedIdentityReferenceSchema } from '../../packages/adapter-references';
import selectedIdentityReferences from '../../examples/adapter-references/selected-identity-references.json';
import { evaluateRuntimeAttestation } from '../../packages/core/runtime-attestation';

const observedAt = '2026-08-24T13:00:00.000Z';
const now = new Date('2026-08-24T13:00:01.000Z');

test('Fast DDS reference scopes trust to the command path and never trusts names or GUIDs alone', () => {
  const trustedObservation = {
    pathIdentity: '/cmd_vel->twist_mux',
    observedAt,
    continuityToken: 'security-session-4',
    matchedCommandWriter: true,
    matchedCommandReader: true,
    participantAuthenticated: true,
    governanceEnforced: true,
    permissionsValidated: true,
    commandPathExplicitlyUntrusted: false,
    source: 'fastdds-security-listener-fixture'
  };
  const trusted = fastDdsCommandPathObservation(trustedObservation);
  const capability = 'dds.command_path.trusted:/cmd_vel->twist_mux';
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: [capability],
    attestation: commandPathRuntimeAttestation(trusted),
    maxAgeMs: 5_000,
    now
  }).allowed, true);

  const unproven = fastDdsCommandPathObservation({
    ...trustedObservation,
    matchedCommandWriter: true,
    matchedCommandReader: true,
    participantAuthenticated: false,
    governanceEnforced: false,
    permissionsValidated: false,
    commandPathExplicitlyUntrusted: false,
    source: 'raw-guid-only'
  });
  assert.equal(unproven.trust, 'unknown');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: [capability],
    attestation: commandPathRuntimeAttestation(unproven),
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');

  const explicitlyUntrusted = fastDdsCommandPathObservation({
    ...trustedObservation,
    commandPathExplicitlyUntrusted: true,
    source: 'fastdds-security-rejection'
  });
  assert.equal(explicitlyUntrusted.trust, 'untrusted');
  assert.deepEqual(explicitlyUntrusted.capabilities, []);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: [capability],
    attestation: commandPathRuntimeAttestation(explicitlyUntrusted),
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');

  const authenticationOnly = fastDdsCommandPathObservation({
    ...trustedObservation,
    governanceEnforced: false,
    permissionsValidated: false
  });
  assert.equal(authenticationOnly.trust, 'unknown');
  assert.deepEqual(authenticationOnly.capabilities, []);
});

test('fault cleared without capability restoration remains blocked', () => {
  const report = {
    schemaVersion: 1 as const,
    sourceIdentity: 'ros2-medkit-adapter',
    observedAt,
    continuityToken: 'fault-continuity-2',
    classificationRevision: 'mapping-v1',
    faultSetId: 'cleared-fault-set',
    capabilities: { 'base.motion': false }
  };
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['base.motion'],
    attestation: degradationRuntimeAttestation(report),
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['base.motion'],
    attestation: degradationRuntimeAttestation({
      ...report,
      continuityToken: 'fault-continuity-3',
      capabilities: { 'base.motion': true }
    }),
    maxAgeMs: 5_000,
    now
  }).allowed, true);
});

test('selected observed-state reference scopes continuity to one adapter-owned epoch', () => {
  const selected = {
    schemaVersion: 1 as const,
    sourceIdentity: 'cell-state-monitor',
    selectionIdentity: 'workcell-clearance-v1',
    observedAt,
    stateEpoch: 'clearance-epoch-7',
    monitorVersion: 'fixture-v1',
    selectedCapability: 'workcell.clear_for_pick',
    status: 'ready' as const
  };
  const ready = selectedObservedStateRuntimeAttestation(selected);
  assert.equal(ready.source.identity, 'cell-state-monitor');
  assert.match(ready.continuityToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(ready.availableCapabilities, ['workcell.clear_for_pick']);

  const unknown = selectedObservedStateRuntimeAttestation({
    ...selected,
    stateEpoch: 'clearance-epoch-unknown',
    status: 'unknown'
  });
  assert.deepEqual(unknown.availableCapabilities, []);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['workcell.clear_for_pick'],
    attestation: unknown,
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');
});

test('GOLEM reference consumes an external upper-body verdict without inferring contact', () => {
  const blocked = golemUpperBodyRuntimeAttestation({
    schemaVersion: 1,
    sourceIdentity: 'golem-h12-monitor',
    observedAt,
    continuityToken: 'h12-4',
    monitorVersion: 'fixture-v1',
    upperBodyMotionReady: false
  });
  assert.deepEqual(blocked.availableCapabilities, []);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['upper_body.motion_ready'],
    attestation: blocked,
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');
  const ready = golemUpperBodyRuntimeAttestation({
    schemaVersion: 1,
    sourceIdentity: 'golem-h12-monitor',
    observedAt,
    continuityToken: 'h12-5',
    monitorVersion: 'fixture-v1',
    upperBodyMotionReady: true
  });
  assert.deepEqual(ready.availableCapabilities, ['upper_body.motion_ready']);
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: ['upper_body.motion_ready'],
    attestation: ready,
    maxAgeMs: 5_000,
    now
  }).allowed, true);
});

test('inference provenance is explicit, stable and rejects missing or changed allowlisted dependencies', () => {
  const declarations = [
    { kind: 'numpy', name: 'numpy', expectedVersion: '2.1.0' },
    { kind: 'python-runtime', name: 'cpython', expectedVersion: '3.12.5' },
    { kind: 'custom-package', name: 'policy-runtime', expectedVersion: '7.2.1' }
  ];
  const versions = new Map([
    ['numpy:numpy', '2.1.0'],
    ['python-runtime:cpython', '3.12.5'],
    ['custom-package:policy-runtime', '7.2.1'],
    ['custom-package:unrelated', '99.0.0']
  ]);
  const manifest = collectInferenceProvenance({
    declarations,
    resolve: (kind, name) => versions.get(`${kind}:${name}`) ?? null
  });
  assert.equal(manifest.dependencies.length, 3);
  assert.equal(manifest.dependencies.some(({ name }) => name === 'unrelated'), false);
  assert.throws(() => collectInferenceProvenance({
    declarations,
    resolve: (kind, name) => `${kind}:${name}` === 'numpy:numpy' ? '2.2.0' : versions.get(`${kind}:${name}`) ?? null
  }), /inference_dependency_version_mismatch:numpy:numpy/);
});

test('remaining integration references declare selected identity, volatile exclusions and an external gate', () => {
  const references = selectedIdentityReferences.map((reference) =>
    selectedIdentityReferenceSchema.parse(reference)
  );
  assert.deepEqual(references.map(({ integration }) => integration), [
    'clearpath-generator',
    'ros2-canopen-command-path',
    'nav2-velocity-smoother',
    'elite-cs-model',
    'crane-x7-selected-limits',
    'device-serial-calibration',
    'physical-execution-identity',
    'ros2-control-runtime-compatibility'
  ]);
  assert.equal(references.every(({ externalTestGate }) => externalTestGate.length > 20), true);

  const craneX7 = references.find(({ integration }) =>
    integration === 'crane-x7-selected-limits'
  )!;
  assert.equal(
    craneX7.stableApprovedInputs.includes(
      'selected MoveIt planning-constraints digest only when approved command semantics depend on planner output'
    ),
    true
  );
  assert.equal(
    craneX7.excludedVolatileInputs.some((input) =>
      input.startsWith('live encoder/controller posture')
    ),
    true
  );
  assert.equal(
    craneX7.excludedVolatileInputs.includes('unselected MoveIt planning constraints'),
    true
  );
  assert.match(craneX7.externalTestGate, /missing, stale or unknown selected posture fails closed/);

  const physicalIdentity = references.find(({ integration }) =>
    integration === 'physical-execution-identity'
  )!;
  assert.equal(
    physicalIdentity.stableApprovedInputs.includes('controller interface and command-semantics digests'),
    true
  );
  assert.equal(physicalIdentity.excludedVolatileInputs.includes('simulator world'), true);
  assert.equal(physicalIdentity.excludedVolatileInputs.includes('unselected interfaces and sensors'), true);

  const runtimeCompatibility = references.find(({ integration }) =>
    integration === 'ros2-control-runtime-compatibility'
  )!;
  assert.equal(
    runtimeCompatibility.stableApprovedInputs.includes('integration-qualified compatibility-envelope identity when one exists'),
    true
  );
  assert.match(runtimeCompatibility.externalTestGate, /lifecycle, resource, timing or failure semantics/);
});

test('technical contributor attribution is opt-in, factual and does not imply endorsement', () => {
  const document = JSON.parse(
    readFileSync('docs/technical-contributors.json', 'utf8')
  ) as { contributors: Array<Record<string, unknown>> };
  const contributors = document.contributors;
  assert.deepEqual(contributors.map(({ displayName }) => displayName), [
    'Xiaoyang',
    'Laurentiu Popa',
    'Ruddrho Mollik',
    'Aditya Jindal',
    'Bartosz Burda',
    'Dr. Denis Stogl',
    'Atsushi Kuwagata'
  ]);
  assert.equal(contributors.every(({ optInConfirmed }) => optInConfirmed === true), true);
  assert.equal(contributors[0]?.preferredUrl, 'https://github.com/xiao-yang25');
  assert.equal('preferredUrl' in contributors[1]!, false);
  assert.equal(
    contributors[2]?.preferredUrl,
    'https://github.com/ruddrho/ros2-vision-guided-robot-arm-color-sorting-robot'
  );
  assert.equal(contributors[2]?.project, 'A ROS 2 Vision-Guided Pick-and-Place Robotic Arm');
  assert.equal(contributors[3]?.preferredUrl, 'https://github.com/AdityaJindal07');
  assert.equal(contributors[3]?.project, 'Independent contributor');
  assert.equal(contributors[4]?.preferredUrl, 'https://github.com/selfpatch/ros2_medkit');
  assert.equal(contributors[4]?.project, 'selfpatch.ai / ros2_medkit');
  assert.equal('preferredUrl' in contributors[5]!, false);
  assert.equal(contributors[6]?.organization, 'RT Corporation');
  assert.equal(contributors[6]?.preferredUrl, 'https://rt-net.jp');
  for (const contributor of contributors) {
    assert.equal('title' in contributor, false);
    assert.equal('logo' in contributor, false);
    assert.equal('supportedIntegration' in contributor, false);
  }
  assert.equal(
    contributors.slice(0, 6).every((contributor) => !('organization' in contributor)),
    true
  );
  assert.equal(
    contributors.some(({ displayName }) => displayName === 'Max Conway'),
    false
  );
});
