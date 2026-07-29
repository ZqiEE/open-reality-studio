import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import {
  appendEvidence,
  canonicalJson,
  sha256,
  type ChainedEvidence,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema
} from '../../packages/core/exec-spec';
import { ShadowExecutionGate } from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';

const proposalSchema = z.object({
  proposalId: z.string().min(1),
  deviceId: z.string().min(1),
  action: z.unknown(),
  state: z.unknown()
}).strict();

export async function runStandaloneShadow(
  releasePath: string,
  proposalPath: string,
  evidencePath: string
): Promise<number> {
  const spec = executablePolicySpecSchema.parse(
    load(readFileSync(resolve(releasePath), 'utf8'))
  );
  if (spec.deployment.mode !== 'shadow') {
    throw new Error('standalone_shadow_requires_shadow_release');
  }
  const proposal = proposalSchema.parse(
    load(readFileSync(resolve(proposalPath), 'utf8'))
  );
  const identity = executablePolicyHash(spec);
  const record: ReleaseRecord = {
    releaseId: spec.metadata.releaseId,
    state: 'shadow',
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedBy: spec.evidence.approvedBy,
    approvedAt: spec.evidence.approvedAt
  };
  const entries: ChainedEvidence[] = [];
  const now = new Date();
  const gate = new ShadowExecutionGate<unknown, unknown>(
    {
      append(evidence: ExecutionEvidence) {
        entries.push(appendEvidence(entries, evidence));
      }
    },
    async () => ({
      allowed: true,
      reason: 'standalone_shadow_policy_passed',
      matchedRuleIds: ['standalone_shadow_fixture']
    }),
    (action) => sha256(canonicalJson(action))
  );
  const result = await gate.evaluate({
    release: spec,
    releaseRecord: record,
    deviceId: proposal.deviceId,
    proposalId: proposal.proposalId,
    action: proposal.action,
    actionHash: sha256(canonicalJson(proposal.action)),
    state: proposal.state,
    stateObservedAt: now.toISOString(),
    now
  });
  const bundle: EvidenceBundle = {
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'EvidenceBundle',
    releaseId: spec.metadata.releaseId,
    executablePolicyHash: identity,
    createdAt: now.toISOString(),
    entries,
    testReportSha256: spec.evidence.testReportSha256
  };
  const output = resolve(evidencePath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  if (entries.some((entry) => entry.evidence.hardwareSignalSent)) {
    throw new Error('standalone_shadow_attempted_controller_dispatch');
  }
  process.stdout.write(`${JSON.stringify({
    mode: 'standalone',
    decision: result.status,
    reason: result.reason,
    controllerGoalsAttempted: 0,
    hardwareSignalSent: false,
    evidencePath: output
  })}\n`);
  return 0;
}
