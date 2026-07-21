/**
 * Behavior test for sdk:submit.
 *
 * Positive: a governance-green profile yields a submission draft whose
 * governance literals are schema-forced (zero execution authority, no real
 * adapter, no trust tier, unsubmitted), with a real asset digest.
 *
 * Negative (the gate has teeth): a non-runnable profile CANNOT produce a
 * submission — the conformance gate blocks it, returning the failing checks.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';
import { loadProfileFromDirectory } from '../../scripts/sdkConformance';

const repoRoot = process.cwd();
const profileDir = (name: string) => path.join(repoRoot, 'profiles', name);
const FIXED_NOW = '2026-07-19T00:00:00.000Z';

// --- Positive: green profile -> valid, governance-locked submission draft ---
const armProfile = loadProfileFromDirectory(profileDir('virtual-robot-arm'));
const result = buildSubmissionForProfile(armProfile, { now: FIXED_NOW, vendor: 'Acme Robotics' });
assert.equal(result.ok, true, `robot arm submission must succeed: ${result.ok ? '' : result.detail}`);
if (!result.ok) throw new Error('unreachable');

const draft = JSON.parse(result.serialized);
assert.equal(draft.schema, 'realitywarden.marketplace-submission-draft', 'draft schema tag must match.');
assert.equal(draft.execution_authority_granted, false, 'submission must carry zero execution authority.');
assert.equal(draft.real_adapter_enabled, false, 'submission must never enable a real adapter.');
assert.equal(draft.trust_tier_granted, null, 'trust tier is granted only by platform review.');
assert.equal(draft.signature_present, false, 'local draft must be unsigned.');
assert.equal(draft.review_state, 'local_draft_unsubmitted', 'draft must be an unsubmitted local draft.');
assert.equal(draft.asset.adapterBoundary.realAdapterEnabled, false, 'asset adapter boundary must keep real disabled.');
assert.match(result.assetDigestSha256, /^[a-f0-9]{64}$/, 'asset digest must be a sha256 hex string.');
assert.equal(draft.asset_digest_sha256, result.assetDigestSha256, 'reported digest must match the draft.');

// --- Negative: non-runnable profile is blocked by the conformance gate ---
const mobile = loadProfileFromDirectory(profileDir('virtual-mobile-robot'));
const blocked = buildSubmissionForProfile(mobile, { now: FIXED_NOW });
assert.equal(blocked.ok, false, 'a non-governance-green adapter must NOT produce a submission.');
if (!blocked.ok) {
  assert(
    (blocked.conformanceFailures ?? []).some((f) => f.startsWith('simulation_adapter_available')),
    'refusal must report the failing governance check.'
  );
}

console.log('sdk:submit tests passed (positive + negative).');
