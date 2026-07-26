import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  appendEvidence,
  type ChainedEvidence,
  type EvidenceBundle,
  type ExecutionEvidence
} from '../../packages/evidence';
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/exec-spec';
import type { EvidenceSink } from '../../packages/execution-gate';
import type { ReleaseRecord } from '../../packages/release-policy';
import {
  InMemoryReleaseRecordStore,
  Ros2ReferenceGateway
} from '../../packages/ros2-reference-gateway';
import { PythonRos2SidecarTransport } from '../../packages/ros2-reference-gateway/sidecar';
import { InMemoryReleaseResolver } from '../../packages/ros2-gateway';

type Options = Record<string, string>;

function parseOptions(args: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`expected --option value, got ${name ?? 'nothing'}`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function readRelease(path: string): ExecutablePolicySpec {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`release input does not exist: ${path}`);
  const parsed = executablePolicySpecSchema.safeParse(load(readFileSync(resolved, 'utf8')));
  if (!parsed.success) throw new Error(`invalid release: ${parsed.error.message}`);
  return parsed.data;
}

function defaultSidecarPath(): string {
  return resolve('experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py');
}

function runOneShot(
  operation: 'doctor' | 'inspect',
  options: Options
): number {
  const python = options.python ?? (process.platform === 'win32' ? 'python' : 'python3');
  const sidecar = resolve(options.sidecar ?? defaultSidecarPath());
  const result = spawnSync(python, [sidecar, `--${operation}`], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 2;
}

class FileEvidenceSink implements EvidenceSink {
  private entries: ChainedEvidence[] = [];

  constructor(
    private readonly release: ExecutablePolicySpec,
    private readonly outputPath: string
  ) {}

  append(evidence: ExecutionEvidence): void {
    this.entries = [...this.entries, appendEvidence(this.entries, evidence)];
    const bundle: EvidenceBundle = {
      apiVersion: 'realitywarden.io/v1alpha1',
      kind: 'EvidenceBundle',
      releaseId: this.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(this.release),
      createdAt: new Date().toISOString(),
      entries: this.entries,
      testReportSha256: this.release.evidence.testReportSha256
    };
    mkdirSync(dirname(this.outputPath), { recursive: true });
    writeFileSync(this.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  }
}

async function runGateway(mode: 'shadow' | 'run', options: Options): Promise<number> {
  const spec = readRelease(required(options, 'release'));
  if (mode === 'shadow' && spec.deployment.mode !== 'shadow') {
    throw new Error('shadow requires a release whose deployment.mode is shadow');
  }
  if (mode === 'run') {
    if (!['canary', 'released'].includes(spec.deployment.mode)) {
      throw new Error('run requires a canary or released release');
    }
    if (options['allow-reference-run'] !== spec.metadata.releaseId) {
      throw new Error(
        `run requires --allow-reference-run ${spec.metadata.releaseId} (exact release confirmation)`
      );
    }
  }
  const deviceId = required(options, 'device');
  const proposerIdentity = required(options, 'proposer');
  if (!spec.deployment.allowedDeviceIds.includes(deviceId)) {
    throw new Error(`device ${deviceId} is not allowed by this release`);
  }
  const identity = executablePolicyHash(spec);
  const releaseRecord: ReleaseRecord = {
    releaseId: spec.metadata.releaseId,
    state: spec.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedBy: spec.evidence.approvedBy,
    approvedAt: spec.evidence.approvedAt
  };
  const resolver = new InMemoryReleaseResolver();
  resolver.bind(deviceId, proposerIdentity, spec);
  const records = new InMemoryReleaseRecordStore(
    new Map([[spec.metadata.releaseId, releaseRecord]])
  );
  const transport = new PythonRos2SidecarTransport({
    pythonExecutable: options.python ?? (process.platform === 'win32' ? 'python' : 'python3'),
    sidecarPath: resolve(options.sidecar ?? defaultSidecarPath()),
    proposalTopic: options['proposal-topic'],
    jointStateTopic: options['joint-state-topic'],
    controllerAction: options['controller-action']
  });
  const evidencePath = resolve(
    options.evidence ?? `evidence/ros2-${mode}-${spec.metadata.releaseId}.json`
  );
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity: options['controller-identity'] ?? spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: records,
    transport,
    evidence: new FileEvidenceSink(spec, evidencePath)
  });
  const report = await transport.doctor();
  process.stdout.write(`${JSON.stringify({ mode, evidencePath, doctor: report }, null, 2)}\n`);
  if (!report.rosAvailable) throw new Error('ROS 2 unavailable');
  if (mode === 'run' && !report.sros2Enabled) {
    throw new Error('reference run requires SROS2 with ROS_SECURITY_STRATEGY=Enforce');
  }
  if (mode === 'run' && !report.actionServerAvailable) {
    throw new Error('controller action server unavailable');
  }
  await gateway.start((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
  process.stdout.write(
    mode === 'shadow'
      ? 'Shadow observation active; controller dispatch is disabled. Press Ctrl+C to stop.\n'
      : 'Experimental reference execution active. Press Ctrl+C to stop.\n'
  );
  await new Promise<void>((resolveDone) => {
    const stop = () => resolveDone();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await transport.close();
  return 0;
}

export function ros2Usage(): string {
  return [
    'usage:',
    '  rlsok ros2 [shadow] --release <spec> --device <id> --proposer <identity> [--evidence <path>]',
    '  rlsok ros2 run --release <spec> --device <id> --proposer <identity> --allow-reference-run <release-id>',
    '  rlsok ros2 doctor [--python <path>] [--sidecar <path>]',
    '  rlsok ros2 inspect [<release>] [--python <path>] [--sidecar <path>]',
    '',
    'ROS 2 support is experimental/reference-only, not safety-rated, and not hard realtime.'
  ].join('\n');
}

export async function runRos2Command(args: string[]): Promise<number> {
  const operation = args[0] && !args[0].startsWith('--') ? args[0] : 'shadow';
  const inspectRelease =
    operation === 'inspect' && args[1] && !args[1].startsWith('--') ? args[1] : undefined;
  if (inspectRelease) readRelease(inspectRelease);
  const optionArgs =
    operation === 'shadow' && args[0]?.startsWith('--')
      ? args
      : args.slice(inspectRelease ? 2 : 1);
  const options = parseOptions(optionArgs);
  if (operation === 'doctor' || operation === 'inspect') return runOneShot(operation, options);
  if (operation === 'shadow' || operation === 'run') return runGateway(operation, options);
  if (operation === 'help' || operation === '--help') {
    process.stdout.write(`${ros2Usage()}\n`);
    return 0;
  }
  throw new Error(`unknown ros2 operation: ${operation}`);
}
