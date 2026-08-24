import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectInferenceProvenance,
  commandPathRuntimeAttestation,
  degradationRuntimeAttestation,
  fastDdsCommandPathObservation,
  golemUpperBodyRuntimeAttestation
} from '../../packages/adapter-references';
import { selectedIdentityReferenceSchema } from '../../packages/adapter-references';
import selectedIdentityReferences from '../../examples/adapter-references/selected-identity-references.json';
import { evaluateRuntimeAttestation } from '../../packages/core/runtime-attestation';

const observedAt = '2026-08-24T13:00:00.000Z';
const now = new Date('2026-08-24T13:00:01.000Z');

test('Fast DDS reference scopes trust to the command path and never trusts names or GUIDs alone', () => {
  const trusted = fastDdsCommandPathObservation({
    pathIdentity: '/cmd_vel->twist_mux',
    observedAt,
    continuityToken: 'security-session-4',
    matchedCommandWriter: true,
    matchedCommandReader: true,
    participantAuthenticated: true,
    governanceEnforced: true,
    permissionsValidated: true,
    source: 'fastdds-security-listener-fixture'
  });
  const capability = 'dds.command_path.trusted:/cmd_vel->twist_mux';
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: [capability],
    attestation: commandPathRuntimeAttestation(trusted),
    maxAgeMs: 5_000,
    now
  }).allowed, true);

  const unproven = fastDdsCommandPathObservation({
    ...trusted,
    matchedCommandWriter: true,
    matchedCommandReader: true,
    participantAuthenticated: false,
    governanceEnforced: false,
    permissionsValidated: false,
    source: 'raw-guid-only'
  });
  assert.equal(unproven.trust, 'unknown');
  assert.equal(evaluateRuntimeAttestation({
    requiredCapabilities: [capability],
    attestation: commandPathRuntimeAttestation(unproven),
    maxAgeMs: 5_000,
    now
  }).reason, 'runtime_capability_missing');
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
  const ready = golemUpperBodyRuntimeAttestation({
    schemaVersion: 1,
    sourceIdentity: 'golem-h12-monitor',
    observedAt,
    continuityToken: 'h12-5',
    monitorVersion: 'fixture-v1',
    upperBodyMotionReady: true
  });
  assert.deepEqual(ready.availableCapabilities, ['upper_body.motion_ready']);
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
    'device-serial-calibration'
  ]);
  assert.equal(references.every(({ externalTestGate }) => externalTestGate.length > 20), true);
});
