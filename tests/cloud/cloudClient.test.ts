import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CloudClientError,
  CloudConnectedDispatchBoundary,
  RlsokCloudClient,
  executionMode,
  loadCloudClientConfig
} from '../../packages/cloud-client';
import {
  executablePolicyHash,
  executablePolicySpecSchema
} from '../../packages/core/exec-spec';
import { canonicalJson, sha256 } from '../../packages/core/evidence';

const fixture = JSON.parse(
  readFileSync('fixtures/cloud-contract/v1/release.json', 'utf8')
) as {
  contractVersion: string;
  execSpec: unknown;
  action: unknown;
  expected: { contentHash: string; actionHash: string };
};

const config = {
  apiUrl: new URL('https://cloud.example.test'),
  apiKey: 'rlsok_test_secret_value',
  timeoutMs: 1_000,
  maxResponseBytes: 1_024,
  safeRetryCount: 1
};

function json(
  value: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

test('cross-repository fixture uses the public strict schema and canonical hashes', () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  assert.equal(fixture.contractVersion, 'rlsok-cloud/v1');
  assert.equal(executablePolicyHash(spec), fixture.expected.contentHash);
  assert.equal(
    sha256(canonicalJson(fixture.action)),
    fixture.expected.actionHash
  );
});

test('cloud-connected mode never silently falls back to standalone', () => {
  assert.equal(executionMode({}), 'standalone');
  assert.equal(
    executionMode({ RLSOK_EXECUTION_MODE: 'cloud-connected' }),
    'cloud-connected'
  );
  assert.throws(
    () => loadCloudClientConfig({ RLSOK_CLOUD_API_URL: 'https://cloud.example.test' }),
    /RLSOK_CLOUD_API_KEY_is_required/
  );
  assert.throws(
    () => loadCloudClientConfig({
      RLSOK_CLOUD_API_URL: 'http://cloud.example.test',
      RLSOK_CLOUD_API_KEY: 'secret'
    }),
    /requires_https/
  );
});

test('GET retries once but state-changing requests are never retried', async () => {
  let getAttempts = 0;
  const getClient = new RlsokCloudClient(config, async () => {
    getAttempts += 1;
    if (getAttempts === 1) throw new TypeError('temporary network failure');
    return json({
      apiVersion: 'rlsok-cloud/v1',
      releaseId: 'fixture-release-001',
      contentHash: fixture.expected.contentHash,
      state: 'approved'
    });
  });
  assert.equal((await getClient.getRelease('fixture-release-001')).state, 'approved');
  assert.equal(getAttempts, 2);

  let mutationAttempts = 0;
  const mutationClient = new RlsokCloudClient(config, async () => {
    mutationAttempts += 1;
    throw new TypeError('network failure');
  });
  await assert.rejects(
    mutationClient.approveRelease('fixture-release-001', 'operator'),
    /network failure/
  );
  assert.equal(mutationAttempts, 1);
});

test('redirects, malformed responses, oversized bodies, and non-2xx fail closed', async () => {
  const redirect = new RlsokCloudClient(config, async () => new Response(null, {
    status: 302,
    headers: { location: 'https://other.example.test/v1/releases/x' }
  }));
  await assert.rejects(
    redirect.getRelease('x'),
    (error: unknown) => (
      error instanceof CloudClientError
      && error.code === 'cloud_redirect_rejected'
    )
  );

  const malformed = new RlsokCloudClient(config, async () => new Response('{'));
  await assert.rejects(malformed.getRelease('x'), /cloud_response_malformed/);

  const oversized = new RlsokCloudClient(
    { ...config, maxResponseBytes: 10 },
    async () => new Response('x'.repeat(11))
  );
  await assert.rejects(oversized.getRelease('x'), /cloud_response_too_large/);

  const denied = new RlsokCloudClient(config, async () => (
    json({ error: 'unauthorized' }, 401)
  ));
  await assert.rejects(
    denied.getRelease('x'),
    (error: unknown) => (
      error instanceof CloudClientError
      && error.message === 'unauthorized'
      && !error.message.includes(config.apiKey)
    )
  );
});

test('cloud dispatch boundary refreshes state and consumes exactly once before dispatch', async () => {
  const calls: string[] = [];
  const permitId = '11111111-1111-4111-8111-111111111111';
  const client = new RlsokCloudClient(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method}:${path}`);
    if (init?.method === 'GET') {
      return json({
        apiVersion: 'rlsok-cloud/v1',
        releaseId: 'fixture-release-001',
        contentHash: fixture.expected.contentHash,
        state: 'approved'
      });
    }
    return json({ apiVersion: 'rlsok-cloud/v1', permitId, consumed: true });
  });
  let dispatches = 0;
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    {
      releaseId: 'fixture-release-001',
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: 'fixture-arm-01',
      controllerId: '1111111111111111111111111111111111111111111111111111111111111111'
    },
    {
      async dispatch() {
        dispatches += 1;
        calls.push('controller:dispatch');
        return 'accepted';
      }
    }
  );
  assert.equal(await boundary.dispatch(fixture.action, {}), 'accepted');
  assert.deepEqual(calls, [
    'GET:/v1/releases/fixture-release-001',
    `POST:/v1/permits/${permitId}/consume`,
    'controller:dispatch'
  ]);
  assert.equal(dispatches, 1);
  await assert.rejects(boundary.dispatch(fixture.action, {}), /boundary_reused/);
});

test('revocation refresh denies before permit consumption or controller dispatch', async () => {
  let calls = 0;
  const client = new RlsokCloudClient(config, async () => {
    calls += 1;
    return json({
      apiVersion: 'rlsok-cloud/v1',
      releaseId: 'fixture-release-001',
      contentHash: fixture.expected.contentHash,
      state: 'revoked'
    });
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    '11111111-1111-4111-8111-111111111111',
    {
      releaseId: 'fixture-release-001',
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: 'fixture-arm-01',
      controllerId: 'controller'
    },
    { async dispatch() { throw new Error('must_not_dispatch'); } }
  );
  await assert.rejects(
    boundary.dispatch(fixture.action, {}),
    /cloud_release_not_currently_approved/
  );
  assert.equal(calls, 1);
});
