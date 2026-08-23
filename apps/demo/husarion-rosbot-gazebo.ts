import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  appendEvidence,
  type ChainedEvidence,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/core/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  executionConfigurationV2Schema,
  type ExecutionConfigurationV2
} from '../../packages/core/execution-configuration';
import type { EvidenceSink } from '../../packages/core/execution-gate';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  HusarionRosbotGazeboGateway,
  rosbotProposalSchema
} from '../../packages/husarion-rosbot-gazebo';
import { PythonHusarionRosbotTransport } from '../../packages/husarion-rosbot-gazebo/sidecar';

type Options = Record<string, string>;

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`expected --option value, got ${name ?? 'nothing'}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function readStructured(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`input_not_found:${path}`);
  return load(readFileSync(resolved, 'utf8'));
}

class FileEvidenceSink implements EvidenceSink {
  private entries: ChainedEvidence[] = [];

  constructor(
    private readonly release: ExecutablePolicySpec,
    private readonly path: string
  ) {}

  append(evidence: ExecutionEvidence): void {
    this.entries.push(appendEvidence(this.entries, evidence));
    const bundle: EvidenceBundle = {
      apiVersion: 'realitywarden.io/v1alpha1',
      kind: 'EvidenceBundle',
      releaseId: this.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(this.release),
      createdAt: new Date().toISOString(),
      entries: this.entries
    };
    writeFileSync(this.path, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  }
}

function currentTrustedConfiguration(path: string): ExecutionConfigurationV2 {
  const configured = executionConfigurationV2Schema.parse(readStructured(path));
  return executionConfigurationV2Schema.parse({
    ...configured,
    observation: {
      ...configured.observation,
      observedAt: new Date().toISOString()
    }
  });
}

function releaseRecord(spec: ExecutablePolicySpec): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state: spec.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: spec.evidence.approvedBy,
    approvedAt: spec.evidence.approvedAt
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const mode = required(options, 'mode');
  if (mode !== 'shadow' && mode !== 'run') throw new Error('mode_must_be_shadow_or_run');
  const release = executablePolicySpecSchema.parse(readStructured(required(options, 'release')));
  if (
    (mode === 'shadow' && release.deployment.mode !== 'shadow')
    || (mode === 'run' && release.deployment.mode !== 'released')
  ) throw new Error('release_mode_mismatch');
  const proposal = rosbotProposalSchema.parse(readStructured(required(options, 'proposal')));
  const configurationPath = required(options, 'configuration');
  const evidencePath = resolve(required(options, 'evidence'));
  const python = options.python ?? (process.platform === 'win32' ? 'python' : 'python3');
  const sidecar = resolve(
    options.sidecar
      ?? 'experimental/husarion-rosbot-gazebo/rlsok_husarion_rosbot_sidecar.py'
  );
  const transport = new PythonHusarionRosbotTransport({
    pythonExecutable: python,
    sidecarPath: sidecar,
    namespace: options.namespace ?? ''
  });
  const record = releaseRecord(release);
  const gateway = new HusarionRosbotGazeboGateway({
    mode,
    release,
    expectedProposerIdentity: required(options, 'proposer-identity'),
    controllerIdentity: release.robot.controllerConfigSha256,
    releaseRecord: async () => record,
    // This separate operator-supplied file is the explicit trusted v2 path.
    executionConfiguration: async () => currentTrustedConfiguration(configurationPath),
    transport,
    evidence: new FileEvidenceSink(release, evidencePath)
  });
  try {
    const result = await gateway.handleProposal(proposal);
    process.stdout.write(`${JSON.stringify({
      integration: 'Husarion ROSbot Gazebo reference integration for RLSOK execution authorization',
      mode,
      ...result,
      evidencePath
    })}\n`);
    process.exitCode = result.decision === 'allowed' ? 0 : 2;
  } finally {
    await transport.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
