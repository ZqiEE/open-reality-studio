/**
 * Behavior test for sdk:catalog-build — the distribution node.
 *
 * A signed package from the chain is assembled into a signed catalog that a
 * consumer verifies. Distribution-layer invariant: a catalog entry can only be
 * simulation_only / read_only, and the cross-verified package keeps
 * realAdapterEnabled=false. Negative: tampering the served bytes is caught.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { buildSignedCatalog } from '../../scripts/sdkCatalogBuild';
import { publishSubmission } from '../../scripts/sdkPublish';
import { buildSubmissionForProfile } from '../../scripts/sdkSubmit';
import { loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { verifyMarketplaceCatalog, verifyMarketplaceCatalogPackage } from '../../lib/marketplace/MarketplaceCatalog';
import type { MarketplaceTrustEntry } from '../../lib/marketplace/MarketplacePackage';

const repoRoot = process.cwd();
const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_ID = 'realitywarden.official.v1';
const PUBLISHER = 'RealityWarden';
const trustStore: MarketplaceTrustEntry[] = [{ keyId: KEY_ID, displayName: PUBLISHER, publicKeyPem, trustTier: 'official', revoked: false }];

// Produce a signed package via the chain.
const profile = loadProfileFromDirectory(path.join(repoRoot, 'profiles', 'virtual-robot-arm'));
const built = buildSubmissionForProfile(profile, { now: '2026-07-19T00:00:00.000Z', vendor: PUBLISHER });
assert.equal(built.ok, true, 'setup: submit must succeed.');
if (!built.ok) throw new Error('unreachable');
const draft = JSON.parse(built.serialized);
const published = publishSubmission(draft, {
  publisherKeyId: KEY_ID, publisherName: PUBLISHER,
  packageId: draft.asset.assetId, packageVersion: draft.asset.version,
  privateKeyPem, now: '2026-07-19T00:00:00.000Z'
});
assert.equal(published.ok, true, 'setup: publish must succeed.');
if (!published.ok) throw new Error('unreachable');
const packageBytes = `${JSON.stringify(published.package, null, 2)}\n`;

// Build the signed catalog.
const result = buildSignedCatalog({
  catalogId: 'realitywarden.catalog.v1',
  publisherKeyId: KEY_ID,
  publisherName: PUBLISHER,
  privateKeyPem,
  generatedAt: '2026-07-19T00:00:00.000Z',
  expiresAt: '2026-08-19T00:00:00.000Z',
  packages: [{ fileBytes: packageBytes, url: 'https://marketplace.example/arm.package.json' }]
});
assert.equal(result.ok, true, `catalog build must succeed: ${result.ok ? '' : result.detail}`);
if (!result.ok) throw new Error('unreachable');

const now = '2026-07-20T00:00:00.000Z';

// Catalog verifies under the trust store.
const verifiedCatalog = verifyMarketplaceCatalog(result.catalog, trustStore, now);
assert.equal(verifiedCatalog.ok, true, 'signed catalog must verify.');

// Distribution invariant: entries can only be simulation_only / read_only.
for (const entry of result.catalog.entries) {
  assert(
    entry.support_level === 'simulation_only' || entry.support_level === 'read_only',
    `catalog entry support_level must be simulation_only/read_only, got ${entry.support_level}`
  );
}

// Cross-verify the served package against its catalog entry.
const verifiedPkg = verifyMarketplaceCatalogPackage({
  entry: result.catalog.entries[0],
  bytes: Buffer.from(packageBytes, 'utf8'),
  trustStore
});
assert.equal(verifiedPkg.ok, true, `catalog package cross-verification must pass: ${verifiedPkg.ok ? '' : verifiedPkg.detail}`);
if (!verifiedPkg.ok) throw new Error('unreachable');
assert.equal(
  verifiedPkg.package.asset.adapterBoundary.realAdapterEnabled,
  false,
  'DISTRIBUTION INVARIANT: a cataloged, verified package must NOT enable a real adapter.'
);

// Negative: tampered served bytes are rejected (file digest mismatch).
// Flip one bit so the bytes differ from the sha256 the signed catalog vouches for.
const tamperedBytes = Buffer.from(packageBytes, 'utf8');
tamperedBytes[50] = tamperedBytes[50] ^ 1;
const tampered = verifyMarketplaceCatalogPackage({ entry: result.catalog.entries[0], bytes: tamperedBytes, trustStore });
assert.equal(tampered.ok, false, 'tampered package bytes must be rejected by the catalog cross-check.');

console.log('sdk:catalog-build tests passed (signed catalog + cross-verify + distribution invariant + tamper rejection).');
