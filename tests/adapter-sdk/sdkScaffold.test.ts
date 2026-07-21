/**
 * Behavior test for sdk:scaffold.
 *
 * Positive: every scaffoldable device type produces a skeleton that passes
 * sdk:conformance out of the box, with identity fields rewritten.
 *
 * Negative: invalid type, invalid slug, and an existing directory are all
 * rejected — scaffolding never overwrites authored work or emits junk.
 *
 * Writes only into an OS temp directory; profiles/ is never touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldAdapter, SCAFFOLDABLE_TYPES, type ScaffoldableType } from '../../scripts/sdkScaffold';

const repoRoot = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-scaffold-'));

try {
  // Positive: each scaffoldable type is green on generation.
  for (const type of SCAFFOLDABLE_TYPES) {
    const name = `test-${type.replace(/_/g, '-')}`;
    const result = scaffoldAdapter({ type, name, display: `Test ${type}`, repoRoot, outRoot: tmpRoot });
    assert.equal(
      result.conformance.ok,
      true,
      `scaffolded ${type} must pass sdk:conformance; failing: ${result.conformance.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`
    );
    // Identity fields rewritten to the new name.
    assert.equal(result.profile.deviceMeta.profile_id, name, 'profile_id must be rewritten to the slug.');
    assert.equal(result.profile.deviceMeta.device_id, `${name}-001`, 'device_id must be rewritten.');
    assert.equal(result.profile.deviceMeta.display_name, `Test ${type}`, 'display_name must be rewritten.');
    // Files actually written.
    assert(fs.existsSync(path.join(result.profileDir, 'device.meta.json')), 'device.meta.json must exist.');
    assert(fs.existsSync(path.join(result.profileDir, 'geometry.json')), 'geometry.json must exist.');
    // Still zero real execution authority.
    const authority = result.conformance.checks.find((c) => c.id === 'zero_real_execution_authority');
    assert(authority && authority.ok, `scaffolded ${type} must keep zero real execution authority.`);
  }

  // Negative: invalid device type.
  assert.throws(
    () => scaffoldAdapter({ type: 'nonsense' as ScaffoldableType, name: 'bad-type', repoRoot, outRoot: tmpRoot }),
    /type must be one of/,
    'invalid --type must be rejected.'
  );

  // Negative: invalid slug.
  assert.throws(
    () => scaffoldAdapter({ type: 'smart_light', name: 'Not A Slug', repoRoot, outRoot: tmpRoot }),
    /kebab-case slug/,
    'invalid --name must be rejected.'
  );

  // Negative: existing directory is never overwritten.
  scaffoldAdapter({ type: 'smart_light', name: 'dup-lamp', repoRoot, outRoot: tmpRoot });
  assert.throws(
    () => scaffoldAdapter({ type: 'smart_light', name: 'dup-lamp', repoRoot, outRoot: tmpRoot }),
    /refusing to overwrite/,
    'an existing profile directory must not be overwritten.'
  );

  console.log('sdk:scaffold tests passed (positive + negative).');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
