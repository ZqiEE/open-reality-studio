#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import { actionContractSchema } from '../../packages/action-contract';
import {
  checkExecutablePolicySpec,
  diffExecutablePolicies,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/exec-spec';
import { robotProfileSchema } from '../../packages/robot-profile';
import {
  verifyEvidenceBundle,
  type EvidenceBundle
} from '../../packages/evidence';
import { ros2Usage, runRos2Command } from './ros2';

type Options = Record<string, string>;

function fail(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value) fail(`expected --option value, got ${name ?? 'nothing'}`);
    options[name.slice(2)] = value;
  }
  return options;
}

function requireOption(options: Options, name: string): string {
  const value = options[name];
  if (!value) fail(`missing required option --${name}`);
  return value;
}

function readStructured(path: string): unknown {
  if (!existsSync(path)) fail(`input does not exist: ${path}`);
  if (statSync(path).isDirectory()) fail(`expected a file, got directory: ${path}`);
  try {
    return load(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(path: string): string[] {
  if (!existsSync(path)) fail(`input does not exist: ${path}`);
  if (!statSync(path).isDirectory()) return [path];
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  if (files.length === 0) fail(`artifact directory is empty: ${path}`);
  return files;
}

function hashArtifact(path: string): string {
  const root = resolve(path);
  const hash = createHash('sha256');
  for (const file of listFiles(root)) {
    const key = statSync(root).isDirectory() ? relative(root, file).replaceAll('\\', '/') : basename(file);
    hash.update(key);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, name: string, label: string): string {
  const value = input[name];
  if (typeof value !== 'string' || !value) fail(`${label}.${name} is required`);
  return value;
}

function build(args: string[]): void {
  const options = parseOptions(args);
  const modelPath = resolve(requireOption(options, 'model'));
  const robotPath = resolve(requireOption(options, 'robot-profile'));
  const controllerPath = resolve(requireOption(options, 'controller-profile'));
  const contractPath = resolve(requireOption(options, 'action-contract'));
  const policyPath = resolve(requireOption(options, 'runtime-policy'));
  const outputPath = resolve(requireOption(options, 'output'));

  const descriptorPath = statSync(modelPath).isDirectory()
    ? join(modelPath, 'model.json')
    : modelPath;
  const model = object(readStructured(descriptorPath), 'model');
  const robotResult = robotProfileSchema.safeParse(readStructured(robotPath));
  if (!robotResult.success) fail(`robot profile invalid: ${robotResult.error.message}`);
  const contractResult = actionContractSchema.safeParse(readStructured(contractPath));
  if (!contractResult.success) fail(`action contract invalid: ${contractResult.error.message}`);
  const controller = object(readStructured(controllerPath), 'controller profile');
  const policy = object(readStructured(policyPath), 'runtime policy');
  const metadata = object(policy.metadata, 'runtime policy.metadata');
  const runtimePolicy = object(policy.runtimePolicy, 'runtime policy.runtimePolicy');
  const evidence = object(policy.evidence, 'runtime policy.evidence');
  const deployment = object(policy.deployment, 'runtime policy.deployment');

  const contract = contractResult.data;
  const robot = robotResult.data;
  if (contract.representation.startsWith('joint_') && contract.jointOrder.join('\0') !== robot.jointOrder.join('\0')) {
    fail('action contract jointOrder does not match robot profile');
  }
  const controllerType = stringField(controller, 'controllerType', 'controller profile');
  if (!robot.controllerTypes.includes(controllerType)) {
    fail(`controller type ${controllerType} is not allowed by robot profile`);
  }
  const compatible = controller.compatibleRepresentations;
  if (!Array.isArray(compatible) || !compatible.includes(contract.representation)) {
    fail(`controller is not compatible with ${contract.representation}`);
  }

  const portableArtifact = `artifacts/${basename(modelPath)}`;
  if (isAbsolute(portableArtifact)) fail('internal error: generated artifact path is absolute');
  const spec: unknown = {
    apiVersion: 'realitywarden.io/v1alpha1',
    kind: 'ExecutablePolicy',
    metadata: {
      name: stringField(metadata, 'name', 'runtime policy.metadata'),
      releaseId: stringField(metadata, 'releaseId', 'runtime policy.metadata'),
      createdAt: stringField(metadata, 'createdAt', 'runtime policy.metadata')
    },
    model: {
      artifact: portableArtifact,
      sha256: hashArtifact(modelPath),
      framework: stringField(model, 'framework', 'model'),
      policyType: stringField(model, 'policyType', 'model'),
      codeRevision: stringField(model, 'codeRevision', 'model')
    },
    actionContract: {
      representation: contract.representation,
      dimension: contract.dimension,
      jointOrder: contract.jointOrder,
      units: contract.units,
      normalizerSha256: stringField(object(policy.artifacts, 'runtime policy.artifacts'), 'normalizerSha256', 'runtime policy.artifacts'),
      preprocessorSha256: stringField(object(policy.artifacts, 'runtime policy.artifacts'), 'preprocessorSha256', 'runtime policy.artifacts'),
      postprocessorSha256: stringField(object(policy.artifacts, 'runtime policy.artifacts'), 'postprocessorSha256', 'runtime policy.artifacts')
    },
    robot: {
      profileId: robot.profileId,
      profileSha256: hashFile(robotPath),
      urdfSha256: robot.urdfSha256,
      controllerType,
      controllerConfigSha256: hashFile(controllerPath)
    },
    runtimePolicy: {
      policySha256: hashFile(policyPath),
      maxActionRateHz: runtimePolicy.maxActionRateHz,
      maxStateAgeMs: runtimePolicy.maxStateAgeMs,
      failClosed: runtimePolicy.failClosed
    },
    evidence,
    deployment
  };
  const parsed = executablePolicySpecSchema.safeParse(spec);
  if (!parsed.success) fail(`cannot build ExecSpec: ${parsed.error.message}`);
  writeFileSync(outputPath, dump(parsed.data, { noRefs: true, sortKeys: true, lineWidth: 120 }), 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

function readSpec(path: string): ExecutablePolicySpec {
  const parsed = executablePolicySpecSchema.safeParse(readStructured(resolve(path)));
  if (!parsed.success) fail(`invalid ExecSpec ${path}: ${parsed.error.message}`);
  return parsed.data;
}

function check(path: string): void {
  const result = checkExecutablePolicySpec(readStructured(resolve(path)));
  process.stdout.write(`${result.result}\n`);
  for (const reason of result.reasons) process.stdout.write(`- ${reason}\n`);
  if (result.result === 'INVALID') process.exitCode = 2;
  else if (result.result !== 'PASS') process.exitCode = 1;
}

function diff(left: string, right: string): void {
  const result = diffExecutablePolicies(readSpec(left), readSpec(right));
  if (result.changes.length === 0) process.stdout.write('No release identity changes.\n');
  else for (const change of result.changes) process.stdout.write(`CHANGED: ${change}\n`);
  process.stdout.write(`APPROVAL_INVALIDATED: ${result.invalidatesApproval ? 'yes' : 'no'}\n`);
}

function verifyEvidence(path: string): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`evidence input does not exist: ${path}`);
  const bundlePath = statSync(resolved).isDirectory() ? join(resolved, 'evidence.json') : resolved;
  if (!existsSync(bundlePath)) fail(`evidence bundle does not exist: ${bundlePath}`);
  const bundle = readStructured(bundlePath) as EvidenceBundle;
  const result = verifyEvidenceBundle(bundle);
  if (!result.ok) fail(`evidence verification failed: ${result.reason}`);
  process.stdout.write('PASS\n');
}

function usage(exitCode = 1): never {
  process.stdout.write(
    'RLSOK CLI (rw)\n' +
    'Release control for executable robot policies.\n\n' +
    'usage: rlsok build ... | rlsok check <release> | rlsok diff <old> <new> | rlsok verify-evidence <bundle> | rlsok ros2 ...\n' +
    'compatibility alias: rw\n'
  );
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') usage(0);
  else if (command === 'build') build(args);
  else if (command === 'check' && args.length === 1) check(args[0]);
  else if (command === 'diff' && args.length === 2) diff(args[0], args[1]);
  else if (command === 'verify-evidence' && args.length === 1) verifyEvidence(args[0]);
  else if (command === 'ros2') process.exitCode = await runRos2Command(args);
  else usage();
}

void main().catch((error) => {
  if (process.argv[2] === 'ros2' && process.argv[3] === 'help') {
    process.stderr.write(`${ros2Usage()}\n`);
  }
  fail(error instanceof Error ? error.message : String(error));
});
