import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  RlsokCloudClient,
  loadCloudClientConfig,
  verifyCloudEvidence
} from '../../packages/cloud-client';
import {
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';

function structured(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`input_file_missing:${path}`);
  }
  return load(readFileSync(resolved, 'utf8'));
}

function release(path: string): ExecutablePolicySpec {
  return executablePolicySpecSchema.parse(structured(path));
}

function client(): RlsokCloudClient {
  return new RlsokCloudClient(loadCloudClientConfig());
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function cloudUsage(): string {
  return [
    'usage:',
    '  rlsok cloud register <release>',
    '  rlsok cloud get-release <release-id>',
    '  rlsok cloud approve <release-id> <approval-identity>',
    '  rlsok cloud permit <request-json>',
    '  rlsok cloud consume <permit-id> <request-json>',
    '  rlsok cloud submit-evidence <evidence-json>',
    '  rlsok cloud get-evidence <evidence-id>',
    '  rlsok cloud verify-evidence <evidence-id>',
    '  rlsok cloud revoke <release-id> <reason>',
    '',
    'Cloud configuration is read only from RLSOK_CLOUD_API_URL and',
    'RLSOK_CLOUD_API_KEY or RLSOK_CLOUD_API_KEY_FILE. API keys are never',
    'accepted as command arguments.'
  ].join('\n');
}

export async function runCloudCommand(args: string[]): Promise<number> {
  const [operation, ...rest] = args;
  if (operation === 'help' || operation === '--help' || !operation) {
    process.stdout.write(`${cloudUsage()}\n`);
    return 0;
  }
  const cloud = client();
  if (operation === 'register' && rest.length === 1) {
    output(await cloud.registerRelease(release(rest[0])));
    return 0;
  }
  if (operation === 'get-release' && rest.length === 1) {
    output(await cloud.getRelease(rest[0]));
    return 0;
  }
  if (operation === 'approve' && rest.length === 2) {
    output(await cloud.approveRelease(rest[0], rest[1]));
    return 0;
  }
  if (operation === 'permit' && rest.length === 1) {
    output(await cloud.requestPermit(structured(rest[0]) as never));
    return 0;
  }
  if (operation === 'consume' && rest.length === 2) {
    output(await cloud.consumePermit(rest[0], structured(rest[1]) as never));
    return 0;
  }
  if (operation === 'submit-evidence' && rest.length === 1) {
    output(await cloud.submitEvidence(structured(rest[0]) as never));
    return 0;
  }
  if (operation === 'get-evidence' && rest.length === 1) {
    output(await cloud.getEvidence(rest[0]));
    return 0;
  }
  if (operation === 'verify-evidence' && rest.length === 1) {
    const result = verifyCloudEvidence(await cloud.getEvidence(rest[0]));
    if (!result.ok) throw new Error(result.reason);
    process.stdout.write('PASS\n');
    return 0;
  }
  if (operation === 'revoke' && rest.length >= 2) {
    output(await cloud.revokeRelease(rest[0], rest.slice(1).join(' ')));
    return 0;
  }
  throw new Error('invalid_cloud_command');
}
