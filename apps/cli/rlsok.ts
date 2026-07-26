#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  checkExecutablePolicySpec,
  diffExecutablePolicies,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  verifyEvidenceBundle,
  type EvidenceBundle
} from '../../packages/core/evidence';
import { ros2Usage, runRos2Command } from './ros2';

function fail(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
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
    'RLSOK ReleaseGate CLI\n' +
    'Release control for executable robot policies.\n\n' +
    'usage: rlsok check <release> | rlsok diff <old> <new> | rlsok verify-evidence <bundle> | rlsok ros2 ...\n'
  );
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') usage(0);
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
