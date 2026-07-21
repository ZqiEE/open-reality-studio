/**
 * Full ecosystem chain end-to-end test — the entire documented journey run as
 * ONE continuous flow, developer side through platform side:
 *
 *   catalog -> scaffold --from -> conformance -> submit -> review -> publish -> verify
 *
 * This proves the six steps actually connect into one path, and locks the core
 * promise end to end: at the very end, a signed, verified, published package —
 * at ANY trust tier — still carries realAdapterEnabled=false. Trust is never
 * execution authority; the marketplace can never open real actuation.
 *
 * Uses a generated Ed25519 key and an OS temp directory; profiles/ untouched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { getStandardProfile } from '../../lib/adapter-sdk/standardCatalog';
import { scaffoldAdapter, type ScaffoldableType } from '../../scripts/sdkScaffold';
import { runSdkConformance, loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';
import { reviewSubmission } from '../../scripts/sdkReview';
import { publishSubmission } from '../../scripts/sdkPublish';
import { verifyMarketplacePackage } from '../../lib/marketplace/MarketplacePackage';
import type { MarketplaceTrustEntry, MarketplaceTrustTier } from '../../lib/marketplace/MarketplacePackage';

const repoRoot = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-chain-'));
const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_ID = 'acme.publisher.v1';
const PUBLISHER = 'Acme Robotics';

try {
  // 1. DISCOVER: pick a standard from the catalog.
  const standard = getStandardProfile('arm-generic');
  assert(standard, 'catalog must offer arm-generic.');

  // 2. SCAFFOLD: clone the standard into a new adapter.
  const scaffold = scaffoldAdapter({
    type: standard.deviceType as ScaffoldableType,
    name: 'chain-arm',
    display: 'Chain Arm',
    vendor: PUBLISHER,
    referenceProfile: standard.referenceProfile,
    prompt: standard.samplePrompt,
    repoRoot,
    outRoot: tmpRoot
  });
  assert.equal(scaffold.conformance.ok, true, 'scaffolded adapter must be green.');

  // 3. CONFORMANCE: self-certify from disk with the standard's prompt.
  const profile = loadProfileFromDirectory(scaffold.profileDir);
  assert.equal(runSdkConformance(profile, { prompt: standard.samplePrompt }).ok, true, 'conformance must pass.');

  // 4. SUBMIT: produce a governance-locked draft.
  const built = buildSubmissionForProfile(profile, { now: '2026-07-19T00:00:00.000Z', vendor: PUBLISHER, prompt: standard.samplePrompt });
  assert.equal(built.ok, true, 'submit must succeed.');
  if (!built.ok) throw new Error('unreachable');
  const draft = JSON.parse(built.serialized);

  // 5. REVIEW: platform re-verifies independently.
  assert.equal(reviewSubmission(draft).ok, true, 'platform review must accept the authentic draft.');

  // 6. PUBLISH: grant + sign into a marketplace package.
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

  // 7. VERIFY + the end-to-end invariant: trust tier is never execution authority.
  for (const tier of ['community', 'verified', 'official'] as MarketplaceTrustTier[]) {
    const store: MarketplaceTrustEntry[] = [{ keyId: KEY_ID, displayName: PUBLISHER, publicKeyPem, trustTier: tier, revoked: false }];
    const verified = verifyMarketplacePackage(published.package, store);
    assert.equal(verified.ok, true, `published package must verify at ${tier}.`);
    if (!verified.ok) throw new Error('unreachable');
    assert.equal(verified.verified.trustTier, tier, `tier must come from the trust store (${tier}).`);
    assert.equal(
      verified.verified.package.asset.adapterBoundary.realAdapterEnabled,
      false,
      `END-TO-END INVARIANT: even a verified ${tier} package must NOT enable a real adapter.`
    );
  }

  console.log('ecosystem chain end-to-end passed (catalog -> scaffold -> conformance -> submit -> review -> publish -> verify; trust is not execution).');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
