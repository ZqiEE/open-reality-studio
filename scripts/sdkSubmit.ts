/**
 * sdk:submit — turn a governance-green adapter profile into a signed-shaped,
 * ready-to-submit marketplace submission draft.
 *
 * This closes the self-serve on-ramp: scaffold -> conformance -> SUBMIT, all
 * without a human review round-trip to discover a governance problem.
 *
 * SAFETY / governance (reused, not re-implemented):
 * - It first runs the authoritative `sdk:conformance` self-check as a GATE and
 *   REFUSES to produce a submission unless the adapter is green. You cannot
 *   submit an ungoverned adapter through this path.
 * - It builds the submission via the platform's own
 *   `createMarketplaceSubmissionDraft`, which forces (by schema literal)
 *   execution_authority_granted=false, real_adapter_enabled=false,
 *   trust_tier_granted=null, signature_present=false, and
 *   review_state='local_draft_unsubmitted'. A submitted asset is a proposal
 *   with zero execution authority until the platform grants trust.
 * - The asset base is a known-good built-in Reality Asset for the device type
 *   (realAdapterEnabled=false), with only identity fields rewritten.
 *
 * Usage:  npm run sdk:submit -- profiles/<your-device>
 *         (optional: --out <file> --version 0.1.0 --vendor "Acme" --summary "...")
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSdkConformance, loadProfileFromDirectory } from './sdkConformance';
import { getRealityAssetByDeviceType } from '../lib/reality-assets/assetRegistry';
import {
  createMarketplaceSubmissionDraft,
  serializeMarketplaceSubmissionDraft
} from '../lib/marketplace/MarketplaceSubmission';
import type { RuntimeDeviceType } from '../lib/open-reality-runtime/types';
import type { DeviceProfile } from '../types/deviceMeta';

export interface SubmitOptions {
  version?: string;
  vendor?: string;
  summary?: string;
  now?: string;
  /** Representative prompt for the conformance gate (for custom world models). */
  prompt?: string;
}

export type SubmitResult =
  | { ok: true; serialized: string; assetId: string; assetDigestSha256: string }
  | { ok: false; detail: string; conformanceFailures?: string[] };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'adapter';
}

/**
 * Build a marketplace submission draft from a governance-green profile.
 * Returns the serialized draft string, or a structured refusal.
 */
export function buildSubmissionForProfile(profile: DeviceProfile, options: SubmitOptions = {}): SubmitResult {
  // GATE: refuse unless the adapter passes the authoritative governance check.
  const conformance = runSdkConformance(profile, { prompt: options.prompt });
  if (!conformance.ok) {
    return {
      ok: false,
      detail: 'adapter is not governance-green; run sdk:conformance and fix the FAIL items before submitting',
      conformanceFailures: conformance.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
    };
  }

  const deviceType = profile.deviceMeta.device_type as RuntimeDeviceType;
  const base = getRealityAssetByDeviceType(deviceType);
  if (!base) {
    return { ok: false, detail: `no reference reality asset for device type ${deviceType}` };
  }

  // Deep clone so the shared built-in asset is never mutated; rewrite identity.
  const asset = JSON.parse(JSON.stringify(base));
  const vendor = options.vendor ?? (typeof profile.deviceMeta.manufacturer === 'string' ? profile.deviceMeta.manufacturer : 'community');
  const nameSlug = slug(profile.id);
  asset.assetId = `${slug(vendor)}.${nameSlug}`;
  asset.name = profile.label || profile.id;
  asset.vendor = vendor;
  asset.version = options.version
    ?? (typeof profile.deviceMeta.profile_version === 'string' ? profile.deviceMeta.profile_version : '0.1.0');
  asset.description = `${asset.name} — simulation-only governed device adapter submitted via sdk:submit.`;

  const changeSummary = options.summary
    ?? `Initial simulation-only submission of ${asset.name} (${deviceType}). Zero real execution authority; awaiting platform trust review.`;

  const draft = createMarketplaceSubmissionDraft({
    rawAsset: asset,
    source: { kind: 'new_asset' },
    changeSummary,
    confirmed: true,
    now: options.now
  });
  if (!draft.ok) {
    return { ok: false, detail: `submission draft rejected: ${draft.detail}` };
  }

  return {
    ok: true,
    serialized: serializeMarketplaceSubmissionDraft(draft.draft),
    assetId: asset.assetId,
    assetDigestSha256: draft.draft.asset_digest_sha256
  };
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

// CLI: node scripts/sdkSubmit.js profiles/<device> [--out file] [--version x] [--vendor v] [--summary s]
if (require.main === module) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  if (!target) {
    process.stderr.write('Usage: node scripts/sdkSubmit.js <profile-directory> [--out <file>] [--version <semver>] [--vendor <name>] [--summary <text>]\n');
    process.exit(2);
  }
  try {
    const profileDir = path.resolve(target);
    const profile = loadProfileFromDirectory(profileDir);
    const result = buildSubmissionForProfile(profile, {
      version: flags.version,
      vendor: flags.vendor,
      summary: flags.summary,
      prompt: flags.prompt
    });
    if (!result.ok) {
      process.stderr.write(`sdk:submit BLOCKED — ${result.detail}\n`);
      for (const failure of result.conformanceFailures ?? []) process.stderr.write(`  - ${failure}\n`);
      process.exit(1);
    }
    const outPath = flags.out ? path.resolve(flags.out) : path.join(profileDir, 'submission.draft.json');
    fs.writeFileSync(outPath, result.serialized);
    process.stdout.write(`Wrote ${path.relative(process.cwd(), outPath)}\n\n`);
    process.stdout.write('Governance guarantees baked into this draft (schema-enforced):\n');
    process.stdout.write('  execution_authority_granted = false\n');
    process.stdout.write('  real_adapter_enabled        = false\n');
    process.stdout.write('  trust_tier_granted          = null (granted only by platform review)\n');
    process.stdout.write('  signature_present           = false\n');
    process.stdout.write('  review_state                = local_draft_unsubmitted\n\n');
    process.stdout.write(`asset id:     ${result.assetId}\n`);
    process.stdout.write(`asset digest: ${result.assetDigestSha256}\n`);
    process.stdout.write('\nThis is a simulation-only proposal. Submit it to the marketplace for trust review.\n');
  } catch (error) {
    process.stderr.write(`sdk:submit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
