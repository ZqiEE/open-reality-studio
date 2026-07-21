/**
 * Behavior test for sdk:review — the platform-side independent verifier.
 *
 * Positive: an authentic submission draft is accepted.
 *
 * Negative (this is a security gate — it must reject every tamper): a mutated
 * asset (digest mismatch), a flipped execution-authority literal, a flipped
 * real-adapter literal, and a self-granted trust tier are ALL rejected. A
 * verifier that trusted the submitter's claims would be worse than none.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { reviewSubmission } from '../../scripts/sdkReview';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';
import { loadProfileFromDirectory } from '../../scripts/sdkConformance';

const repoRoot = process.cwd();
const armProfile = loadProfileFromDirectory(path.join(repoRoot, 'profiles', 'virtual-robot-arm'));
const built = buildSubmissionForProfile(armProfile, { now: '2026-07-19T00:00:00.000Z', vendor: 'Acme' });
assert.equal(built.ok, true, 'test setup: submission must build.');
if (!built.ok) throw new Error('unreachable');
const validDraft = JSON.parse(built.serialized);

const clone = () => JSON.parse(JSON.stringify(validDraft));
const failing = (raw: unknown) => reviewSubmission(raw).checks.filter((c) => !c.ok).map((c) => c.id);

// --- Positive ---
const accepted = reviewSubmission(validDraft);
assert.equal(accepted.ok, true, `authentic draft must be accepted; failing: ${accepted.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`);

// --- Negative 1: tampered asset -> digest mismatch ---
const tampered = clone();
tampered.asset.name = `${tampered.asset.name} (evil edit)`;
const t1 = reviewSubmission(tampered);
assert.equal(t1.ok, false, 'a tampered asset must be rejected.');
assert(failing(tampered).includes('asset_digest_matches'), 'tampering must trip the digest check.');

// --- Negative 2: submitter claims execution authority ---
const authGrab = clone();
authGrab.execution_authority_granted = true;
assert.equal(reviewSubmission(authGrab).ok, false, 'a self-granted execution authority must be rejected.');
assert(failing(authGrab).includes('zero_execution_authority'), 'must trip zero_execution_authority.');

// --- Negative 3: submitter enables a real adapter ---
const realOn = clone();
realOn.real_adapter_enabled = true;
assert.equal(reviewSubmission(realOn).ok, false, 'a real-adapter-enabled draft must be rejected.');
assert(failing(realOn).includes('real_adapter_disabled'), 'must trip real_adapter_disabled.');

// --- Negative 4: submitter self-grants a trust tier ---
const trustGrab = clone();
trustGrab.trust_tier_granted = 'official';
assert.equal(reviewSubmission(trustGrab).ok, false, 'a self-granted trust tier must be rejected.');
assert(failing(trustGrab).includes('no_self_granted_trust'), 'must trip no_self_granted_trust.');

// --- Negative 5: asset adapter boundary flips real on (governance + digest) ---
const realAsset = clone();
realAsset.asset.adapterBoundary.realAdapterEnabled = true;
const t5 = reviewSubmission(realAsset);
assert.equal(t5.ok, false, 'an asset that enables a real adapter must be rejected.');

console.log('sdk:review tests passed (positive + 5 negatives).');
