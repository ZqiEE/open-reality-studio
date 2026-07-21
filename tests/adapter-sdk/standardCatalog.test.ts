/**
 * Behavior test for the standard device profile catalog (Stage 2, demand side).
 *
 * Honesty contract: the catalog may NOT list a profile that would fail platform
 * governance. Every entry must reference a real profile that passes
 * sdk:conformance with its declared samplePrompt. Scaffolding --from an entry
 * must also produce a governance-green skeleton.
 *
 * Writes only into an OS temp directory; profiles/ is never touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listStandardProfiles, getStandardProfile } from '../../lib/adapter-sdk/standardCatalog';
import { runSdkConformance, loadProfileFromDirectory } from '../../scripts/sdkConformance';
import { scaffoldAdapter, SCAFFOLDABLE_TYPES, type ScaffoldableType } from '../../scripts/sdkScaffold';

const repoRoot = process.cwd();
const entries = listStandardProfiles();

assert(entries.length >= 3, 'catalog must offer at least the three runnable device classes.');

// Ids are unique.
const ids = entries.map((e) => e.id);
assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique.');

// Every entry references a real profile AND is governance-green with its prompt.
for (const entry of entries) {
  const dir = path.join(repoRoot, 'profiles', entry.referenceProfile);
  assert(fs.existsSync(path.join(dir, 'device.meta.json')), `${entry.id}: referenceProfile ${entry.referenceProfile} must exist.`);
  const profile = loadProfileFromDirectory(dir);
  assert.equal(profile.deviceMeta.device_type, entry.deviceType, `${entry.id}: deviceType must match its reference profile.`);
  const result = runSdkConformance(profile, { prompt: entry.samplePrompt });
  assert.equal(
    result.ok,
    true,
    `${entry.id} must be governance-green with its samplePrompt; failing: ${result.checks.filter((c) => !c.ok).map((c) => `${c.id}(${c.detail})`).join(', ')}`
  );
}

// getStandardProfile resolves and rejects.
assert(getStandardProfile(entries[0].id), 'getStandardProfile must resolve a known id.');
assert.equal(getStandardProfile('does-not-exist'), undefined, 'getStandardProfile must return undefined for unknown ids.');

// Scaffolding --from a standard produces a green skeleton.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-catalog-'));
try {
  const entry = getStandardProfile('arm-generic');
  assert(entry, 'arm-generic must exist for the scaffold-from test.');
  assert(SCAFFOLDABLE_TYPES.includes(entry.deviceType as ScaffoldableType), 'arm-generic device type must be scaffoldable.');
  const scaffold = scaffoldAdapter({
    type: entry.deviceType as ScaffoldableType,
    name: 'from-standard-arm',
    referenceProfile: entry.referenceProfile,
    prompt: entry.samplePrompt,
    repoRoot,
    outRoot: tmpRoot
  });
  assert.equal(
    scaffold.conformance.ok,
    true,
    `scaffold --from ${entry.id} must be green; failing: ${scaffold.conformance.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`
  );
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('standard catalog tests passed (every entry governance-green + scaffold-from green).');
