/**
 * sdk — one discoverable map of the whole governed-adapter workflow.
 *
 * Self-serve only works if the toolkit is discoverable. This prints the full
 * developer-to-platform chain so an operator sees every command and where it
 * fits, without hunting through package.json.
 *
 * `SDK_WORKFLOW` is kept in exact sync with the `sdk:*` scripts in package.json
 * by tests/adapter-sdk/sdkOverview.test.ts — a new command that isn't listed
 * here (or a listed command that no longer exists) fails the test.
 *
 * Usage:  npm run sdk
 */
export type SdkPhase = 'developer' | 'platform';

export interface SdkWorkflowStep {
  command: string; // the npm script name, e.g. 'sdk:scaffold'
  phase: SdkPhase;
  title: string;
  purpose: string;
}

export const SDK_WORKFLOW: SdkWorkflowStep[] = [
  { command: 'sdk:catalog', phase: 'developer', title: 'Discover', purpose: 'List standard device profiles to start from (covers common cases).' },
  { command: 'sdk:scaffold', phase: 'developer', title: 'Scaffold', purpose: 'Generate a governance-green adapter skeleton (--from a standard, or --type).' },
  { command: 'sdk:conformance', phase: 'developer', title: 'Self-certify', purpose: 'Run the authoritative governance checks; green == the platform will accept it.' },
  { command: 'sdk:submit', phase: 'developer', title: 'Submit', purpose: 'Produce a governance-locked submission draft (zero execution authority).' },
  { command: 'sdk:review', phase: 'platform', title: 'Review', purpose: 'Independently re-verify a draft — recompute the digest, trust nothing claimed.' },
  { command: 'sdk:publish', phase: 'platform', title: 'Publish', purpose: 'Grant + Ed25519-sign an accepted draft into a marketplace package.' },
  { command: 'sdk:catalog-build', phase: 'platform', title: 'Distribute', purpose: 'Assemble signed packages into a signed, consumer-verifiable catalog.' }
];

export function renderOverview(): string {
  const lines: string[] = [];
  lines.push('RealityWarden — governed adapter workflow');
  lines.push('');
  lines.push('  discover -> scaffold -> conformance -> submit  ||  review -> publish -> catalog-build');
  lines.push('  \\________ developer, self-serve _________/       \\______ platform ______/');
  lines.push('');

  for (const phase of ['developer', 'platform'] as SdkPhase[]) {
    lines.push(`${phase === 'developer' ? 'Developer (self-serve)' : 'Platform (trust nothing)'}:`);
    for (const step of SDK_WORKFLOW.filter((s) => s.phase === phase)) {
      lines.push(`  ${step.command.padEnd(20)} ${step.title.padEnd(13)} ${step.purpose}`);
    }
    lines.push('');
  }

  lines.push('The one rule: trust tier governs distribution, never execution. A published,');
  lines.push('verified package keeps realAdapterEnabled=false at every tier.');
  lines.push('');
  lines.push('Docs: docs/ADAPTER_QUICKSTART.md (developer)  ·  docs/PLATFORM_OPERATIONS.md (platform)');
  lines.push('Verify the tooling: npm run test:fast');
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  process.stdout.write(renderOverview());
}
