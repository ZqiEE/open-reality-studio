/**
 * End-to-end test for the developer on-ramp — the exact journey documented in
 * docs/ADAPTER_SDK.md, run as one continuous flow:
 *
 *     scaffold  ->  conformance  ->  submit
 *
 * This proves the documented path actually works start to finish for a brand
 * new adapter a developer just generated — not just each command in isolation.
 * Writes only into an OS temp directory; profiles/ is never touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldAdapter } from '../../scripts/sdkScaffold';
import { runSdkConformance, loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';

const repoRoot = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-onramp-'));

try {
  // 1. Scaffold: a developer generates a new adapter from zero.
  const scaffold = scaffoldAdapter({
    type: 'smart_light',
    name: 'onramp-lamp',
    display: 'On-ramp Lamp',
    vendor: 'Acme',
    repoRoot,
    outRoot: tmpRoot
  });
  assert.equal(scaffold.conformance.ok, true, 'freshly scaffolded adapter must be green.');
  assert(fs.existsSync(path.join(scaffold.profileDir, 'device.meta.json')), 'scaffold must write device.meta.json.');

  // 2. Conformance: re-load from disk (as the CLI does) and self-certify.
  const profile = loadProfileFromDirectory(scaffold.profileDir);
  const conformance = runSdkConformance(profile);
  assert.equal(conformance.ok, true, 'reloaded scaffold must pass conformance.');
  assert(
    conformance.checks.find((c) => c.id === 'platform_safety_gate')?.ok,
    'on-ramp adapter must clear the authoritative platform gate.'
  );

  // 3. Submit: produce a governance-locked submission draft.
  const submission = buildSubmissionForProfile(profile, { now: '2026-07-19T00:00:00.000Z' });
  assert.equal(submission.ok, true, `submission must succeed: ${submission.ok ? '' : submission.detail}`);
  if (!submission.ok) throw new Error('unreachable');
  const draft = JSON.parse(submission.serialized);
  assert.equal(draft.execution_authority_granted, false, 'end-to-end draft must carry zero execution authority.');
  assert.equal(draft.real_adapter_enabled, false, 'end-to-end draft must never enable a real adapter.');
  assert.equal(draft.trust_tier_granted, null, 'end-to-end draft must start with no trust tier.');
  assert.match(submission.assetDigestSha256, /^[a-f0-9]{64}$/, 'end-to-end draft must have a real asset digest.');

  console.log('sdk on-ramp end-to-end (scaffold -> conformance -> submit) passed.');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
