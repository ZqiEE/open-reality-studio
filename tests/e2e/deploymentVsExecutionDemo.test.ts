import assert from 'node:assert/strict';
import {
  DEPLOYMENT_EXECUTION_OUTPUT,
  runDeploymentExecutionDemo
} from '../../apps/demo/deployment-vs-execution';
import { verifyEvidenceBundle } from '../../packages/core/evidence';

async function main(): Promise<void> {
  const printed: string[] = [];
  const result = await runDeploymentExecutionDemo((line) => printed.push(line));

  assert.deepEqual(printed, [...DEPLOYMENT_EXECUTION_OUTPUT]);
  assert.deepEqual(result.lines, [...DEPLOYMENT_EXECUTION_OUTPUT]);
  assert.equal(result.deployedAfter, result.deployedBefore);
  assert.equal(result.dispatchCount, 0);
  assert.equal(result.evidenceBundle.entries.length, 4);
  assert.deepEqual(verifyEvidenceBundle(result.evidenceBundle), { ok: true });
  assert.deepEqual(
    result.evidenceBundle.entries.map((entry) => entry.evidence.decisionReason),
    [
      'shadow:reference_trajectory_contract_passed',
      'shadow:configuration_mismatch',
      'shadow:reference_trajectory_contract_passed',
      'shadow:release_revoked'
    ]
  );
  assert(result.evidenceBundle.entries.every((entry) => !entry.evidence.hardwareSignalSent));
  console.log('deployment vs execution demo tests passed');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
