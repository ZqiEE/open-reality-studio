/**
 * Behavior test for sdk:publish — platform-side grant + sign.
 *
 * Positive: a reviewed draft becomes a signed package that verifies under a
 * trust store.
 *
 * CORE INVARIANT: trust is not execution authority. A verified package keeps
 * realAdapterEnabled=false at EVERY trust tier (community and official). No
 * marketplace grant can open real actuation.
 *
 * Negative: a draft that fails review cannot be published.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { publishSubmission } from '../../scripts/sdkPublish';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';
import { loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { verifyMarketplacePackage } from '../../lib/marketplace/MarketplacePackage';
import type { MarketplaceTrustEntry, MarketplaceTrustTier } from '../../lib/marketplace/MarketplacePackage';

const repoRoot = process.cwd();
const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const KEY_ID = 'acme.publisher.v1';
const PUBLISHER = 'Acme Robotics';

// Build an accepted submission draft.
const profile = loadProfileFromDirectory(path.join(repoRoot, 'profiles', 'virtual-robot-arm'));
const built = buildSubmissionForProfile(profile, { now: '2026-07-19T00:00:00.000Z', vendor: PUBLISHER });
assert.equal(built.ok, true, 'setup: submission must build.');
if (!built.ok) throw new Error('unreachable');
const draft = JSON.parse(built.serialized);

// --- Positive: publish -> signed package that keeps real disabled ---
const published = publishSubmission(draft, {
  publisherKeyId: KEY_ID,
  publisherName: PUBLISHER,
  packageId: draft.asset.assetId,
  packageVersion: draft.asset.version,
  privateKeyPem,
  now: '2026-07-19T00:00:00.000Z'
});
assert.equal(published.ok, true, `publish must succeed: ${published.ok ? '' : published.detail}`);
if (!published.ok) throw new Error('unreachable');
assert.equal(published.package.asset.adapterBoundary.realAdapterEnabled, false, 'published package must keep realAdapterEnabled false.');

// --- CORE INVARIANT: trust tier is not execution authority ---
function trustStoreAt(tier: MarketplaceTrustTier): MarketplaceTrustEntry[] {
  return [{ keyId: KEY_ID, displayName: PUBLISHER, publicKeyPem, trustTier: tier, revoked: false }];
}
for (const tier of ['community', 'verified', 'official'] as MarketplaceTrustTier[]) {
  const verified = verifyMarketplacePackage(published.package, trustStoreAt(tier));
  assert.equal(verified.ok, true, `signed package must verify at ${tier} tier.`);
  if (!verified.ok) throw new Error('unreachable');
  assert.equal(verified.verified.trustTier, tier, `trust tier must come from the trust store (${tier}).`);
  assert.equal(
    verified.verified.package.asset.adapterBoundary.realAdapterEnabled,
    false,
    `INVARIANT: even at ${tier} tier, a published package must NOT enable a real adapter.`
  );
}

// --- Negative: a rejected (tampered) draft cannot be published ---
const tampered = JSON.parse(JSON.stringify(draft));
tampered.asset.name = `${tampered.asset.name} (evil edit)`; // breaks the asset digest
const refused = publishSubmission(tampered, {
  publisherKeyId: KEY_ID,
  publisherName: PUBLISHER,
  packageId: tampered.asset.assetId,
  packageVersion: tampered.asset.version,
  privateKeyPem,
  now: '2026-07-19T00:00:00.000Z'
});
assert.equal(refused.ok, false, 'a tampered/rejected draft must not be publishable.');

// --- Negative: self-granted execution authority cannot be published ---
const authGrab = JSON.parse(JSON.stringify(draft));
authGrab.execution_authority_granted = true;
assert.equal(
  publishSubmission(authGrab, { publisherKeyId: KEY_ID, publisherName: PUBLISHER, packageId: authGrab.asset.assetId, packageVersion: authGrab.asset.version, privateKeyPem }).ok,
  false,
  'a draft claiming execution authority must not be publishable.'
);

console.log('sdk:publish tests passed (publish + verify + trust-is-not-execution invariant + negatives).');
