/**
 * sdk:publish — platform-side "grant + sign": turn a reviewed submission draft
 * into a signed marketplace package.
 *
 * This is the step after `sdk:review` ACCEPTS a draft. It:
 *  1. re-runs the review gate and REFUSES to publish anything that fails it,
 *  2. builds a marketplace package envelope from the draft's asset,
 *  3. signs it with the platform's Ed25519 key via the authoritative
 *     `signMarketplacePackage` (which itself re-validates asset governance).
 *
 * CORE INVARIANT (checked here and by the test): **publishing never grants
 * execution authority.** A signed, published package — at ANY trust tier —
 * still carries `realAdapterEnabled: false`. Trust tier governs distribution
 * and visibility, not the ability to actuate real hardware. Real execution is
 * a separate, per-device gated path that the marketplace can never open.
 *
 * Usage:
 *   npm run sdk:publish -- <submission.json> --key <ed25519.pem> \
 *     --publisher-id acme.publisher.v1 --publisher-name "Acme" [--out <file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { reviewSubmission } from './sdkReview';
import { signMarketplacePackage } from '../lib/marketplace/MarketplacePackage';
import type { MarketplacePackage } from '../lib/marketplace/MarketplacePackage';

export interface PublishOptions {
  publisherKeyId: string;
  publisherName: string;
  packageId: string;
  packageVersion: string;
  privateKeyPem: string;
  now?: string;
}

export type PublishResult =
  | { ok: true; package: MarketplacePackage; digestSha256: string }
  | { ok: false; detail: string; reviewFailures?: string[] };

/**
 * Publish a reviewed submission draft as a signed marketplace package.
 * Refuses drafts that fail platform review, and refuses to emit a package that
 * would carry real execution authority.
 */
export function publishSubmission(draft: unknown, options: PublishOptions): PublishResult {
  // GATE: never publish a draft that fails independent platform review.
  const review = reviewSubmission(draft);
  if (!review.ok) {
    return {
      ok: false,
      detail: 'submission failed platform review; cannot publish',
      reviewFailures: review.checks.filter((c) => !c.ok).map((c) => c.id)
    };
  }

  const raw = draft as Record<string, unknown>;
  const unsigned = {
    schema: 'realitywarden.marketplace-package' as const,
    schema_version: 1 as const,
    package_id: options.packageId,
    package_version: options.packageVersion,
    published_at: options.now ?? new Date().toISOString(),
    publisher: { key_id: options.publisherKeyId, display_name: options.publisherName },
    asset: raw.asset
  };

  const signed = signMarketplacePackage(unsigned, options.privateKeyPem);
  if (!signed.ok) {
    return { ok: false, detail: `signing rejected (${signed.code}): ${signed.detail}` };
  }

  // Invariant belt-and-suspenders: a published package can never enable a real
  // adapter, regardless of publisher or (future) trust tier.
  const pkg = signed.signed.package;
  if (pkg.asset.adapterBoundary.realAdapterEnabled !== false || pkg.asset.deviceManifest.adapter.realAdapterEnabled !== false) {
    return { ok: false, detail: 'refused: a published package must keep realAdapterEnabled false (trust is not execution authority)' };
  }

  return { ok: true, package: pkg, digestSha256: signed.signed.digestSha256 };
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      flags[token.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

// CLI
if (require.main === module) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const draftPath = positional[0];
  if (!draftPath || !flags.key || !flags['publisher-id'] || !flags['publisher-name']) {
    process.stderr.write('Usage: node scripts/sdkPublish.js <submission.json> --key <ed25519.pem> --publisher-id <id> --publisher-name <name> [--package-id <id>] [--version <semver>] [--out <file>]\n');
    process.exit(2);
  }
  try {
    const draft = JSON.parse(fs.readFileSync(path.resolve(draftPath), 'utf8'));
    const asset = (draft && typeof draft === 'object' ? (draft as Record<string, unknown>).asset : undefined) as Record<string, unknown> | undefined;
    const result = publishSubmission(draft, {
      publisherKeyId: flags['publisher-id'],
      publisherName: flags['publisher-name'],
      packageId: flags['package-id'] ?? String(asset?.assetId ?? ''),
      packageVersion: flags.version ?? String(asset?.version ?? ''),
      privateKeyPem: fs.readFileSync(path.resolve(flags.key), 'utf8')
    });
    if (!result.ok) {
      process.stderr.write(`sdk:publish REFUSED — ${result.detail}\n`);
      for (const f of result.reviewFailures ?? []) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    const outPath = flags.out ? path.resolve(flags.out) : `${path.resolve(draftPath).replace(/\.json$/, '')}.package.json`;
    fs.writeFileSync(outPath, `${JSON.stringify(result.package, null, 2)}\n`);
    process.stdout.write(`Signed package written: ${path.relative(process.cwd(), outPath)}\n`);
    process.stdout.write(`  package_id: ${result.package.package_id}\n`);
    process.stdout.write(`  digest:     ${result.digestSha256}\n`);
    process.stdout.write(`  realAdapterEnabled: ${result.package.asset.adapterBoundary.realAdapterEnabled} (trust tier is distribution, never execution)\n`);
  } catch (error) {
    process.stderr.write(`sdk:publish failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
