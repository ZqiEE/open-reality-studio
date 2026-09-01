import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import type { ReleaseRecord } from '../../packages/core/release-policy';
import {
  HusarionRosbotGazeboGateway,
  rosbotProposalSchema
} from '../../packages/husarion-rosbot-gazebo';
import { PythonHusarionRosbotTransport } from '../../packages/husarion-rosbot-gazebo/sidecar';
import { observeTrustedHusarionConfiguration } from '../../packages/husarion-rosbot-gazebo/trusted-observation';
import { FileEvidenceSink } from '../cli/ros2';

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
  const observationInput = {
    controllerConfigPath: required(options, 'controller-config'),
    deviceIdentity: required(options, 'device-identity'),
    robotIdentity: required(options, 'robot-identity')
  };
  const initialObservation = observeTrustedHusarionConfiguration(observationInput);
  const evidencePath = resolve(required(options, 'evidence'));
  const python = options.python ?? (process.platform === 'win32' ? 'python' : 'python3');
  const sidecar = resolve(
    options.sidecar
      ?? 'experimental/husarion-rosbot-gazebo/rlsok_husarion_rosbot_sidecar.py'
  );
  const useSimTimeValue = options['use-sim-time'] ?? 'false';
  if (useSimTimeValue !== 'true' && useSimTimeValue !== 'false') {
    throw new Error('use_sim_time_must_be_true_or_false');
  }
  const transport = new PythonHusarionRosbotTransport({
    pythonExecutable: python,
    sidecarPath: sidecar,
    namespace: options.namespace ?? '',
    useSimTime: useSimTimeValue === 'true',
    requiredObserverNode: options['required-observer-node']
  });
  const record = releaseRecord(release);
  const gateway = new HusarionRosbotGazeboGateway({
    mode,
    release,
    expectedProposerIdentity: required(options, 'proposer-identity'),
    controllerIdentity: initialObservation.controllerIdentity,
    releaseRecord: async () => record,
    // Each observation independently re-reads and hashes the current controller file.
    executionConfiguration: async () => (
      observeTrustedHusarionConfiguration(observationInput).configuration
    ),
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
