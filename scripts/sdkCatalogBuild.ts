/**
 * sdk:catalog-build — assemble signed marketplace packages into a signed,
 * consumer-verifiable catalog. The distribution node of the chain:
 *
 *   ... publish (signed package)  →  catalog-build (signed catalog)  →  consumer verifies
 *
 * A catalog entry can only carry `support_level` of `simulation_only` or
 * `read_only` (enforced by the catalog schema) — so the "trust is not
 * execution authority" guarantee extends to the distribution layer: nothing a
 * catalog lists can be a real-actuation package.
 *
 * Reused platform authorities: `signMarketplaceCatalog` and
 * `marketplaceSigningPayload`. No parallel copy of the signing rules.
 *
 * Usage:
 *   npm run sdk:catalog-build -- <pkg1.package.json[:url]> [pkg2...] \
 *     --key <ed25519.pem> --catalog-id realitywarden.catalog.v1 \
 *     --publisher-id realitywarden.official.v1 --publisher-name "RealityWarden" \
 *     --out catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { signMarketplaceCatalog } from '../lib/marketplace/MarketplaceCatalog';
import { marketplaceSigningPayload } from '../lib/marketplace/MarketplacePackage';
import type { MarketplaceCatalog, MarketplaceCatalogEntry } from '../lib/marketplace/MarketplaceCatalog';
import type { MarketplacePackage } from '../lib/marketplace/MarketplacePackage';

export interface CatalogPackageInput {
  /** Exact file bytes of the signed package (what a consumer will download). */
  fileBytes: string | Buffer;
  /** URL the package will be served from. */
  url: string;
}

export interface BuildCatalogOptions {
  catalogId: string;
  publisherKeyId: string;
  publisherName: string;
  privateKeyPem: string;
  generatedAt: string;
  expiresAt: string;
  packages: CatalogPackageInput[];
}

export type BuildCatalogResult =
  | { ok: true; catalog: MarketplaceCatalog; digestSha256: string }
  | { ok: false; detail: string };

/** Assemble + sign a catalog from already-signed package files. */
export function buildSignedCatalog(options: BuildCatalogOptions): BuildCatalogResult {
  const entries: MarketplaceCatalogEntry[] = [];
  for (const input of options.packages) {
    const bytes = Buffer.isBuffer(input.fileBytes) ? input.fileBytes : Buffer.from(input.fileBytes, 'utf8');
    let pkg: MarketplacePackage;
    try {
      pkg = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')) as MarketplacePackage;
    } catch (error) {
      return { ok: false, detail: `package is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
    entries.push({
      package_id: pkg.package_id,
      package_version: pkg.package_version,
      asset_id: pkg.asset.assetId,
      asset_name: pkg.asset.name,
      device_type: pkg.asset.deviceType,
      support_level: pkg.asset.supportLevel as MarketplaceCatalogEntry['support_level'],
      package_url: input.url,
      package_file_sha256: createHash('sha256').update(bytes).digest('hex'),
      package_digest_sha256: createHash('sha256').update(marketplaceSigningPayload(pkg)).digest('hex')
    });
  }

  const unsigned = {
    schema: 'realitywarden.marketplace-catalog' as const,
    schema_version: 1 as const,
    catalog_id: options.catalogId,
    generated_at: options.generatedAt,
    expires_at: options.expiresAt,
    publisher: { key_id: options.publisherKeyId, display_name: options.publisherName },
    entries
  };

  const signed = signMarketplaceCatalog(unsigned, options.privateKeyPem);
  if (!signed.ok) return { ok: false, detail: `catalog signing rejected (${signed.code}): ${signed.detail}` };
  return { ok: true, catalog: signed.catalog, digestSha256: signed.digestSha256 };
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) flags[token.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
    else positional.push(token);
  }
  return { positional, flags };
}

// CLI
if (require.main === module) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length === 0 || !flags.key || !flags['catalog-id'] || !flags['publisher-id'] || !flags['publisher-name']) {
    process.stderr.write('Usage: node scripts/sdkCatalogBuild.js <pkg.json[:url]> [...] --key <pem> --catalog-id <id> --publisher-id <id> --publisher-name <name> [--out <file>] [--ttl-days <n>]\n');
    process.exit(2);
  }
  try {
    const now = new Date();
    const ttlDays = Number(flags['ttl-days'] ?? '30');
    const packages: CatalogPackageInput[] = positional.map((token) => {
      const sep = token.lastIndexOf(':');
      const hasUrl = sep > 1 && /^https?:/.test(token.slice(sep + 1)) === false && token.slice(sep + 1).length > 0 && token.includes('.json:');
      const filePart = hasUrl ? token.slice(0, sep) : token;
      const url = hasUrl ? token.slice(sep + 1) : `https://marketplace.example/${path.basename(filePart)}`;
      return { fileBytes: fs.readFileSync(path.resolve(filePart)), url };
    });
    const result = buildSignedCatalog({
      catalogId: flags['catalog-id'],
      publisherKeyId: flags['publisher-id'],
      publisherName: flags['publisher-name'],
      privateKeyPem: fs.readFileSync(path.resolve(flags.key), 'utf8'),
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
      packages
    });
    if (!result.ok) {
      process.stderr.write(`sdk:catalog-build failed — ${result.detail}\n`);
      process.exit(1);
    }
    const outPath = flags.out ? path.resolve(flags.out) : 'catalog.json';
    fs.writeFileSync(outPath, `${JSON.stringify(result.catalog, null, 2)}\n`);
    process.stdout.write(`Signed catalog written: ${path.relative(process.cwd(), outPath)} (${result.catalog.entries.length} entr${result.catalog.entries.length === 1 ? 'y' : 'ies'})\n`);
    for (const entry of result.catalog.entries) {
      process.stdout.write(`  ${entry.package_id}  ${entry.device_type}  support_level=${entry.support_level}\n`);
    }
  } catch (error) {
    process.stderr.write(`sdk:catalog-build failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
