import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertImmutablePolicy,
  assertPublishedImmutable,
} from '../../scripts/release-platform-gates.mjs';
import {
  assertCloudProof,
  assertMinimumCommit,
} from '../../scripts/verify-production-cloud.mjs';

const proof = () => ({
  health: { status: 'ok' },
  readiness: {
    status: 'ready',
    executionPolicy: 'shadow-only',
    sourceCommit: 'c'.repeat(40),
  },
  manifest: {
    cloudVersion: '1.3.0',
    runtimeSourceCommit: 'a'.repeat(40),
    releaseTag: 'v1.5.0',
    minimumCloudSourceCommit: 'b'.repeat(40),
  },
  deployment: { cloudVersion: '1.3.0', sourceCommit: 'c'.repeat(40) },
  candidateSource: 'a'.repeat(40),
  candidateTag: 'v1.5.0',
});

test('future immutable release policy and published release must both be enforced', () => {
  assert.doesNotThrow(() => assertImmutablePolicy({ enabled: true }));
  assert.throws(() => assertImmutablePolicy({ enabled: false }), /not_enabled/);
  assert.doesNotThrow(() => assertPublishedImmutable({
    tag_name: 'v1.5.0', draft: false, immutable: true,
  }, 'v1.5.0'));
  assert.throws(() => assertPublishedImmutable({
    tag_name: 'v1.5.0', draft: false, immutable: false,
  }, 'v1.5.0'), /not_immutable/);
});

test('Cloud-first proof binds the exact runtime and production Shadow-only state', () => {
  assert.doesNotThrow(() => assertCloudProof(proof()));
  assert.doesNotThrow(() => assertMinimumCommit({ status: 'ahead' }));
  assert.doesNotThrow(() => assertMinimumCommit({ status: 'identical' }));
});

test('old or mismatched Cloud cannot be bypassed by a new runtime candidate', () => {
  const oldCloud = proof();
  oldCloud.manifest.runtimeSourceCommit = 'd'.repeat(40);
  assert.throws(() => assertCloudProof(oldCloud), /rejects_runtime_source/);

  const runEnabled = proof();
  runEnabled.readiness.executionPolicy = 'reference-run-enabled';
  assert.throws(() => assertCloudProof(runEnabled), /not_shadow_only/);

  assert.throws(() => assertMinimumCommit({ status: 'behind' }), /before_minimum/);
});
