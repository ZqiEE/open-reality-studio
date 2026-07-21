/**
 * Anti-drift test for the `sdk` overview.
 *
 * The workflow map must stay in exact sync with the real `sdk:*` scripts in
 * package.json: every sdk command is documented, and every documented command
 * exists. This keeps the self-serve discoverability layer honest — you cannot
 * add a governed-adapter command without putting it on the map.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SDK_WORKFLOW, renderOverview } from '../../scripts/sdk';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const scriptCommands = Object.keys(pkg.scripts)
  .filter((name) => name.startsWith('sdk:') && name !== 'sdk')
  .sort();
const documented = SDK_WORKFLOW.map((step) => step.command).sort();

// No command missing from the map.
for (const command of scriptCommands) {
  assert(documented.includes(command), `sdk command "${command}" is not on the workflow map (scripts/sdk.ts).`);
}
// No phantom command on the map.
for (const command of documented) {
  assert(scriptCommands.includes(command), `workflow map lists "${command}" but it is not an sdk:* script in package.json.`);
}
assert.equal(documented.length, scriptCommands.length, 'workflow map and sdk:* scripts must be one-to-one.');

// Every step is well-formed and rendered.
const overview = renderOverview();
for (const step of SDK_WORKFLOW) {
  assert(step.title && step.purpose && (step.phase === 'developer' || step.phase === 'platform'), `malformed workflow step: ${step.command}`);
  assert(overview.includes(step.command), `overview output must mention ${step.command}.`);
}

console.log(`sdk overview tests passed (${documented.length} commands, map in sync with package.json).`);
