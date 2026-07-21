/**
 * sdk:review — platform-side independent verification of a submission draft.
 *
 * The other half of the trust handshake: `sdk:submit` produces a draft on the
 * developer's machine; `sdk:review` verifies it the way the platform must —
 * trusting NOTHING the submitter claims and recomputing everything (invariant
 * 5: untrusted proposer). A developer can also run it to pre-flight their draft.
 *
 * It independently:
 *  - recomputes the asset digest from canonical JSON (tamper detection),
 *  - re-runs the authoritative asset governance validator,
 *  - checks each governance literal the schema forces (zero execution
 *    authority, no real adapter, no self-granted trust tier, unsubmitted).
 *
 * Reused platform authorities: `validateMarketplaceDraftAsset` and
 * `canonicalMarketplaceJson`. No parallel weaker copy of the rules.
 *
 * Usage:  npm run sdk:review -- profiles/<device>/submission.draft.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateMarketplaceDraftAsset,
  canonicalMarketplaceJson
} from '../lib/marketplace/MarketplacePackage';

export interface ReviewCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ReviewResult {
  ok: boolean;
  checks: ReviewCheck[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Independently verify a submission draft. Returns a checklist; `ok` is true
 * only when every check passes. Never trusts the submitter's own assertions.
 */
export function reviewSubmission(raw: unknown): ReviewResult {
  const checks: ReviewCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const finalize = (): ReviewResult => ({ ok: checks.every((c) => c.ok), checks });

  if (!isRecord(raw)) {
    add('parses_as_object', false, 'submission must be a JSON object');
    return finalize();
  }
  add('parses_as_object', true, 'submission is an object');

  add(
    'schema_tag',
    raw.schema === 'realitywarden.marketplace-submission-draft' && raw.schema_version === 1,
    `schema=${String(raw.schema)} version=${String(raw.schema_version)}`
  );
  add('zero_execution_authority', raw.execution_authority_granted === false, `execution_authority_granted=${String(raw.execution_authority_granted)}`);
  add('real_adapter_disabled', raw.real_adapter_enabled === false, `real_adapter_enabled=${String(raw.real_adapter_enabled)}`);
  add('no_self_granted_trust', raw.trust_tier_granted === null, `trust_tier_granted=${String(raw.trust_tier_granted)} (only the platform grants trust)`);
  add(
    'unsubmitted_unsigned',
    raw.review_state === 'local_draft_unsubmitted' && raw.signature_present === false,
    `review_state=${String(raw.review_state)} signature_present=${String(raw.signature_present)}`
  );

  // Independent asset governance re-check (also enforces realAdapterEnabled=false
  // on both the asset adapter boundary and its device manifest).
  const assetCheck = validateMarketplaceDraftAsset(raw.asset);
  add('asset_passes_governance', assetCheck.ok, assetCheck.ok ? 'asset re-validated' : assetCheck.detail);

  // Recompute the asset digest from canonical JSON — tamper detection.
  if (typeof raw.asset_digest_sha256 !== 'string') {
    add('asset_digest_matches', false, 'asset_digest_sha256 missing or not a string');
  } else {
    try {
      const recomputed = createHash('sha256').update(canonicalMarketplaceJson(raw.asset)).digest('hex');
      add(
        'asset_digest_matches',
        recomputed === raw.asset_digest_sha256,
        recomputed === raw.asset_digest_sha256 ? 'digest matches' : `digest mismatch — asset was tampered (claimed ${raw.asset_digest_sha256.slice(0, 12)}…, actual ${recomputed.slice(0, 12)}…)`
      );
    } catch (error) {
      add('asset_digest_matches', false, `could not canonicalize asset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return finalize();
}

function formatResult(result: ReviewResult): string {
  const lines = result.checks.map((c) => `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(26)} ${c.detail}`);
  lines.push('');
  lines.push(
    result.ok
      ? 'RESULT: ACCEPTED — submission is authentic and governance-valid; eligible for trust review.'
      : 'RESULT: REJECTED — do not grant trust. See the FAIL items above.'
  );
  return lines.join('\n');
}

// CLI: node scripts/sdkReview.js <submission-file.json>
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('Usage: node scripts/sdkReview.js <submission-draft.json>\n');
    process.exit(2);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
    const result = reviewSubmission(raw);
    process.stdout.write(`${formatResult(result)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`sdk:review failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
