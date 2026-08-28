import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalJson, sha256 } from '../../packages/core/evidence';
import {
  EdgeAuthorizedDispatchBoundary,
  signEdgeAuthorization,
  verifyEdgeAuthorization,
  type EdgeAuthorizationBinding,
  type EdgeAuthorizationPayload
} from '../../packages/edge-authorization/snapshot';

const keys = generateKeyPairSync('ed25519');
const hash = (value: string) => sha256(value);
const dispatchAction = { velocity: 0.2 };
const binding: EdgeAuthorizationBinding = {
  releaseId: 'release-1',
  contentHash: hash('release'),
  actionHash: sha256(canonicalJson(dispatchAction)),
  configurationDigest: hash('configuration'),
  deviceId: 'robot-1',
  controllerIdentity: 'controller-1'
};
const payload: EdgeAuthorizationPayload = {
  schemaVersion: 1,
  snapshotId: 'snapshot-7',
  keyId: 'edge-key-1',
  ...binding,
  issuedAt: '2026-08-24T13:00:00.000Z',
  expiresAt: '2026-08-24T13:05:00.000Z',
  revocationEpoch: 7
};
const publicKeys = new Map([['edge-key-1', keys.publicKey]]);

test('signed snapshot binds release, action, configuration, device, freshness and revocation epoch', () => {
  const snapshot = signEdgeAuthorization(payload, keys.privateKey);
  const valid = verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  });
  assert.equal(valid.allowed, true);
  if (valid.allowed) {
    assert.equal(valid.evidence.snapshotId, 'snapshot-7');
    assert.equal(valid.evidence.revocationEpoch, 7);
  }
  assert.equal(verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding: { ...binding, deviceId: 'robot-2' },
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).reason, 'edge_authorization_binding_mismatch');
  assert.equal(verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding: {} as EdgeAuthorizationBinding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).reason, 'edge_authorization_binding_mismatch');
  assert.equal(verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 8,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).reason, 'edge_authorization_revoked');
  assert.equal(verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:05:00.000Z')
  }).reason, 'edge_authorization_expired');
  assert.equal(verifyEdgeAuthorization({
    snapshot: signEdgeAuthorization({
      ...payload,
      expiresAt: '2026-08-24T14:00:00.000Z'
    }, keys.privateKey),
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).reason, 'edge_authorization_invalid');
});

test('snapshot verification rejects invalid clocks and non-canonical option values', () => {
  const snapshot = signEdgeAuthorization(payload, keys.privateKey);
  const verifyAt = (now: Date, overrides: Partial<{
    minimumRevocationEpoch: number;
    maximumClockSkewMs: number;
    maximumLifetimeMs: number;
  }> = {}) => verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now,
    ...overrides
  });

  assert.equal(verifyAt(new Date(Number.NaN)).reason, 'edge_authorization_invalid');
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      verifyAt(new Date('2026-08-24T13:01:00.000Z'), { maximumClockSkewMs: invalid }).reason,
      'edge_authorization_invalid',
      `clock skew ${String(invalid)}`
    );
    assert.equal(
      verifyAt(new Date('2026-08-24T13:01:00.000Z'), { maximumLifetimeMs: invalid }).reason,
      'edge_authorization_invalid',
      `maximum lifetime ${String(invalid)}`
    );
    assert.equal(
      verifyAt(new Date('2026-08-24T13:01:00.000Z'), { minimumRevocationEpoch: invalid }).reason,
      'edge_authorization_invalid',
      `minimum epoch ${String(invalid)}`
    );
  }
});

test('snapshot timestamps enforce exact skew, expiry and lifetime boundaries', () => {
  const snapshot = signEdgeAuthorization(payload, keys.privateKey);
  const verifyAt = (now: string, maximumLifetimeMs = 300_000) => verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    maximumClockSkewMs: 5_000,
    maximumLifetimeMs,
    now: new Date(now)
  });

  assert.equal(verifyAt('2026-08-24T12:59:55.000Z').allowed, true);
  assert.equal(
    verifyAt('2026-08-24T12:59:54.999Z').reason,
    'edge_authorization_not_yet_valid'
  );
  assert.equal(verifyAt('2026-08-24T13:04:59.999Z').allowed, true);
  assert.equal(verifyAt('2026-08-24T13:05:00.000Z').reason, 'edge_authorization_expired');
  assert.equal(verifyAt('2026-08-24T13:01:00.000Z', 300_000).allowed, true);
  assert.equal(
    verifyAt('2026-08-24T13:01:00.000Z', 299_999).reason,
    'edge_authorization_invalid'
  );
});

test('snapshot signatures accept one canonical Ed25519 text representation only', () => {
  const snapshot = signEdgeAuthorization(payload, keys.privateKey);
  assert.match(snapshot.signature, /^[A-Za-z0-9_-]{86}$/);
  for (const signature of [
    `${snapshot.signature}=`,
    `${snapshot.signature}===`,
    `${snapshot.signature}!`,
    `${snapshot.signature} `,
    `${snapshot.signature}\n`,
    Buffer.from(snapshot.signature, 'base64url').toString('base64')
  ]) {
    assert.equal(verifyEdgeAuthorization({
      snapshot: { ...snapshot, signature },
      publicKeys,
      binding,
      minimumRevocationEpoch: 7,
      now: new Date('2026-08-24T13:01:00.000Z')
    }).reason, 'edge_authorization_invalid', JSON.stringify(signature));
  }
});

test('snapshot schema rejects timestamps outside the shared RFC3339 grammar', () => {
  for (const issuedAt of [
    '2026-08-24T13:00:00+0000',
    '2026-08-24T13:00:00+24:00',
    '2026-08-24T13:00:00+12:60'
  ]) {
    assert.throws(
      () => signEdgeAuthorization({ ...payload, issuedAt }, keys.privateKey),
      /timestamp must be a finite RFC3339 instant/
    );
  }
  assert.throws(
    () => signEdgeAuthorization({
      ...payload,
      revocationEpoch: Number.MAX_SAFE_INTEGER + 1
    }, keys.privateKey)
  );
});

test('identity trimming follows the exact ECMAScript set', () => {
  const snapshot = signEdgeAuthorization(payload, keys.privateKey);
  const wrapped = (character: string) => ({
    ...snapshot,
    payload: {
      ...snapshot.payload,
      snapshotId: `${character}${snapshot.payload.snapshotId}${character}`,
      keyId: `${character}${snapshot.payload.keyId}${character}`,
      releaseId: `${character}${snapshot.payload.releaseId}${character}`,
      deviceId: `${character}${snapshot.payload.deviceId}${character}`,
      controllerIdentity: `${character}${snapshot.payload.controllerIdentity}${character}`
    }
  });
  assert.equal(verifyEdgeAuthorization({
    snapshot: wrapped('\ufeff'),
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).allowed, true);
  assert.equal(verifyEdgeAuthorization({
    snapshot: wrapped('\u0085'),
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  }).reason, 'edge_authorization_unknown_key');
});

test('snapshot identities reject unpaired UTF-16 surrogates at the canonical boundary', () => {
  for (const snapshotId of ['\ud800', '\udfff', `valid\ud800tail`, `head\udffftail`]) {
    assert.throws(
      () => signEdgeAuthorization({ ...payload, snapshotId }, keys.privateKey),
      /identity must contain only Unicode scalar values/
    );
  }
  const maximumScalarIdentity = '😀'.repeat(256);
  const snapshot = signEdgeAuthorization({
    ...payload,
    snapshotId: maximumScalarIdentity
  }, keys.privateKey);
  const result = verifyEdgeAuthorization({
    snapshot,
    publicKeys,
    binding,
    minimumRevocationEpoch: 7,
    now: new Date('2026-08-24T13:01:00.000Z')
  });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.payload.snapshotId, maximumScalarIdentity);
  assert.throws(
    () => signEdgeAuthorization({
      ...payload,
      snapshotId: '😀'.repeat(257)
    }, keys.privateKey)
  );
});

test('final edge boundary dispatches exactly once and performs no Cloud operation', async () => {
  let publications = 0;
  const boundary = new EdgeAuthorizedDispatchBoundary(
    publicKeys,
    binding,
    () => 7,
    { dispatch: async () => ({ publicationCount: ++publications }) }
  );
  boundary.prepare(signEdgeAuthorization(payload, keys.privateKey));
  assert.deepEqual(
    await boundary.dispatch(dispatchAction, new Date('2026-08-24T13:01:00.000Z')),
    {
      result: { publicationCount: 1 },
      authorizationEvidence: {
        schemaVersion: 1,
        snapshotId: 'snapshot-7',
        keyId: 'edge-key-1',
        revocationEpoch: 7,
        snapshotDigest: boundary.evidence?.snapshotDigest
      }
    }
  );
  assert.equal(publications, 1);
  assert.equal(boundary.evidence?.snapshotId, 'snapshot-7');
  await assert.rejects(() => boundary.dispatch(dispatchAction), /edge_dispatch_boundary_reused/);
  assert.equal(publications, 1);
});

test('missing, stale or changed authority fails closed without stop, zero or retry publication', async () => {
  let publications = 0;
  const boundary = new EdgeAuthorizedDispatchBoundary(
    publicKeys,
    binding,
    () => 8,
    { dispatch: async () => ({ publicationCount: ++publications }) }
  );
  boundary.prepare(signEdgeAuthorization(payload, keys.privateKey));
  await assert.rejects(
    () => boundary.dispatch(dispatchAction, new Date('2026-08-24T13:01:00.000Z')),
    /edge_authorization_revoked/
  );
  assert.equal(publications, 0);
  assert.equal(boundary.evidence, null);
});

test('final edge boundary binds the exact action and consumes substitution attempts', async () => {
  let publications = 0;
  const boundary = new EdgeAuthorizedDispatchBoundary(
    publicKeys,
    binding,
    () => 7,
    { dispatch: async () => ({ publicationCount: ++publications }) }
  );
  boundary.prepare(signEdgeAuthorization(payload, keys.privateKey));
  await assert.rejects(
    () => boundary.dispatch({ velocity: 0.200_001 }, new Date('2026-08-24T13:01:00.000Z')),
    /edge_dispatch_action_binding_mismatch/
  );
  await assert.rejects(
    () => boundary.dispatch(dispatchAction, new Date('2026-08-24T13:01:00.000Z')),
    /edge_dispatch_boundary_reused/
  );
  assert.equal(publications, 0);
});

test('final edge boundary dispatches a detached canonical action snapshot', async () => {
  const action = { command: { velocity: 0.2 } };
  const actionBinding = {
    ...binding,
    actionHash: sha256(canonicalJson(action))
  };
  const actionPayload = { ...payload, ...actionBinding };
  let releaseDispatch: (() => void) | undefined;
  const dispatchMayFinish = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  let observedVelocity = Number.NaN;
  const boundary = new EdgeAuthorizedDispatchBoundary(
    publicKeys,
    actionBinding,
    () => 7,
    {
      async dispatch(candidate: typeof action) {
        await dispatchMayFinish;
        observedVelocity = candidate.command.velocity;
        return { accepted: true };
      }
    }
  );
  boundary.prepare(signEdgeAuthorization(actionPayload, keys.privateKey));
  const pending = boundary.dispatch(action, new Date('2026-08-24T13:01:00.000Z'));
  action.command.velocity = 9.9;
  releaseDispatch?.();
  await pending;
  assert.equal(observedVelocity, 0.2);
});

test('final edge boundary snapshots caller-owned binding metadata', async () => {
  const mutableBinding = { ...binding };
  let publications = 0;
  const boundary = new EdgeAuthorizedDispatchBoundary(
    publicKeys,
    mutableBinding,
    () => 7,
    { dispatch: async () => ({ publicationCount: ++publications }) }
  );
  mutableBinding.actionHash = sha256(canonicalJson({ substituted: true }));
  mutableBinding.deviceId = 'substituted-device';
  boundary.prepare(signEdgeAuthorization(payload, keys.privateKey));
  await boundary.dispatch(dispatchAction, new Date('2026-08-24T13:01:00.000Z'));
  assert.equal(publications, 1);
});
