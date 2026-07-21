/**
 * Governance invariants — the single, auditable source of truth for the
 * promise that makes RealityWarden defensible: safety is enforced structurally,
 * not by policy. Each invariant names WHERE it is enforced in code and WHICH
 * test proves it, so a security-conscious buyer or certifier can verify the
 * claim themselves rather than take it on trust.
 *
 * This registry is kept honest by tests/governance-invariants/governanceMap.test.ts:
 * every `enforcedIn` file must exist and every `provenBy` test must be a real
 * npm script. The claim cannot silently drift from the code.
 *
 * Invariants 1-6 are the product's six invariants (docs/PRODUCT_VISION.md).
 * Invariant 7 extends #5 across the marketplace/distribution layer built for
 * the platform ecosystem.
 */
export interface GovernanceInvariant {
  id: string;
  name: string;
  statement: string;
  /** Repo-relative source files that structurally enforce this invariant. */
  enforcedIn: string[];
  /** npm scripts whose tests prove this invariant holds. */
  provenBy: string[];
}

export const GOVERNANCE_INVARIANTS: GovernanceInvariant[] = [
  {
    id: 'single_gated_path',
    name: 'Single gated path',
    statement:
      'The safety gate is the only code path to hardware. A blocked decision means zero frames on the wire — structurally, not by convention.',
    enforcedIn: ['lib/hardware/HardwareExecutionGate.ts', 'lib/hardware/internal/actuation.ts'],
    provenBy: ['test:real-hardware', 'test:conformance']
  },
  {
    id: 'default_block',
    name: 'Default-block',
    statement:
      'Missing, stale, or invalid information (sensors, manifests, profiles) blocks actuation. Absence of evidence is never permission.',
    enforcedIn: ['lib/runtime/SafetyMonitor.ts', 'lib/hardware/SensorConditioning.ts'],
    provenBy: ['test:real-hardware']
  },
  {
    id: 'no_silent_fallback',
    name: 'No silent fallback',
    statement:
      'Every degradation (LLM offline, driver missing, device unreachable) is explicit, logged, and visible. The system never guesses and never pretends.',
    enforcedIn: ['lib/hardware/Esp32DeviceAdapter.ts', 'lib/runtime/SafetyMonitor.ts'],
    provenBy: ['test:real-hardware', 'test:conformance']
  },
  {
    id: 'honest_audit',
    name: 'Honest audit',
    statement:
      'Every decision is recorded with truthful provenance: which compiler ran, whether a hardware signal was actually sent (hardwareSignalSent), which rules triggered.',
    enforcedIn: ['lib/runtime/RuntimeAuditLog.ts', 'lib/hardware/HardwareExecutionGate.ts'],
    provenBy: ['test:real-hardware', 'test:conformance']
  },
  {
    id: 'untrusted_proposers',
    name: 'Untrusted proposers',
    statement:
      'Models, imported manuals, marketplace assets, and user/submission manifests are proposal generators with zero execution authority. Risk is always recomputed by our rules; a proposer\'s self-assessment gets zero weight.',
    enforcedIn: ['lib/runtime/SafetyMonitor.ts', 'lib/marketplace/MarketplaceSubmission.ts', 'scripts/sdkReview.ts'],
    provenBy: ['test:marketplace', 'test:sdk-review', 'test:autonomy']
  },
  {
    id: 'sim_real_distinct',
    name: 'Simulation and reality are visibly distinct',
    statement:
      'Simulated runs are marked [SIMULATION]; real runs are marked real_hardware. A user can always tell which world they are acting in.',
    enforcedIn: ['lib/hardware/HardwareExecutionGate.ts'],
    provenBy: ['test:conformance', 'test:desktop']
  },
  {
    id: 'trust_not_execution',
    name: 'Trust is not execution authority (ecosystem)',
    statement:
      'Across submit, review, publish, and catalog, a trust tier governs distribution and visibility only. A published, verified package keeps realAdapterEnabled=false at every tier; the marketplace can never open real actuation.',
    enforcedIn: ['lib/marketplace/MarketplacePackage.ts', 'lib/marketplace/MarketplaceCatalog.ts', 'scripts/sdkPublish.ts', 'scripts/sdkCatalogBuild.ts'],
    provenBy: ['test:sdk-publish', 'test:sdk-catalog-build', 'test:ecosystem-chain']
  }
];

/** Render the auditable governance map as Markdown (source for docs/GOVERNANCE.md). */
export function renderGovernanceMap(): string {
  const lines: string[] = [];
  lines.push('# Governance Invariants — the auditable moat');
  lines.push('');
  lines.push('RealityWarden\'s promise is that safety is enforced **structurally, not by policy**.');
  lines.push('Each invariant below names where it is enforced and which test proves it. Do not');
  lines.push('trust the claim — run the tests.');
  lines.push('');
  lines.push('> This file is generated from `lib/governance/invariants.ts` and kept honest by');
  lines.push('> `tests/governance-invariants/governanceMap.test.ts` (every enforcement file must');
  lines.push('> exist; every proof test must be a real npm script). Run all proofs with');
  lines.push('> `npm run test:fast`, or the canonical `npm run verify`.');
  lines.push('');
  for (let index = 0; index < GOVERNANCE_INVARIANTS.length; index += 1) {
    const inv = GOVERNANCE_INVARIANTS[index];
    lines.push(`## ${index + 1}. ${inv.name}`);
    lines.push('');
    lines.push(inv.statement);
    lines.push('');
    lines.push(`- Enforced in: ${inv.enforcedIn.map((f: string) => `\`${f}\``).join(', ')}`);
    lines.push(`- Proven by: ${inv.provenBy.map((t: string) => `\`npm run ${t}\``).join(', ')}`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
