/**
 * Anti-drift test for the governance moat.
 *
 * The claim "safety is enforced structurally, and every guarantee is proven by
 * a test" must stay TRUE as the code evolves. This test asserts that, for every
 * named invariant:
 *   - each `enforcedIn` source file actually exists,
 *   - each `provenBy` test is a real npm script, AND is wired into the canonical
 *     `verify` chain (so the proof actually runs before release),
 * and that docs/GOVERNANCE.md is exactly what the registry renders (the public
 * governance map can never silently diverge from the source of truth).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GOVERNANCE_INVARIANTS, renderGovernanceMap } from '../../lib/governance/invariants';

const repoRoot = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const verifyChain = String(pkg.scripts.verify ?? '');

assert(GOVERNANCE_INVARIANTS.length >= 6, 'the six product invariants (plus ecosystem) must be registered.');

const ids = new Set<string>();
for (const inv of GOVERNANCE_INVARIANTS) {
  assert(inv.id && !ids.has(inv.id), `invariant id must be present and unique: ${inv.id}`);
  ids.add(inv.id);
  assert(inv.name && inv.statement && inv.statement.length > 20, `invariant ${inv.id} must have a name and a real statement.`);
  assert(inv.enforcedIn.length > 0 && inv.provenBy.length > 0, `invariant ${inv.id} must name enforcement and proof.`);

  // Every enforcement file exists on disk.
  for (const file of inv.enforcedIn) {
    assert(fs.existsSync(path.join(repoRoot, file)), `invariant ${inv.id}: enforcement file missing: ${file}`);
  }
  // Every proof is a real script AND runs in the canonical verify chain.
  for (const script of inv.provenBy) {
    assert(typeof pkg.scripts[script] === 'string', `invariant ${inv.id}: proof "${script}" is not an npm script.`);
    assert(verifyChain.includes(script), `invariant ${inv.id}: proof "${script}" is not wired into "npm run verify".`);
  }
}

// The public governance map is exactly what the registry renders (no drift).
const docPath = path.join(repoRoot, 'docs', 'GOVERNANCE.md');
assert(fs.existsSync(docPath), 'docs/GOVERNANCE.md must exist.');
const onDisk = fs.readFileSync(docPath, 'utf8');
assert.equal(
  onDisk.trimEnd(),
  renderGovernanceMap().trimEnd(),
  'docs/GOVERNANCE.md is out of sync with lib/governance/invariants.ts — regenerate it from the registry.'
);

console.log(`governance map verified (${GOVERNANCE_INVARIANTS.length} invariants; enforcement files exist; every proof runs in verify; doc in sync).`);
