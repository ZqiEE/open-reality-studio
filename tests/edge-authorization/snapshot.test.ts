import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { sha256 } from '../../packages/core/evidence';
import {
  EdgeAuthorizedDispatchBoundary,
  signEdgeAuthorization,
  verifyEdgeAuthorization,
  type EdgeAuthorizationBinding,
  type EdgeAuthorizationPayload
} from '../../packages/edge-authorization/snapshot';

const keys = generateKeyPairSync('ed25519');
const hash = (value: string) => sha256(value);
const binding: EdgeAuthorizationBinding = {
  releaseId: 'release-1',
  contentHash: hash('release'),
  actionHash: hash('action'),
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
    await boundary.dispatch({ velocity: 0.2 }, new Date('2026-08-24T13:01:00.000Z')),
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
  await assert.rejects(() => boundary.dispatch({ velocity: 0.2 }), /edge_dispatch_boundary_reused/);
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
    () => boundary.dispatch({ velocity: 0.2 }, new Date('2026-08-24T13:01:00.000Z')),
    /edge_authorization_revoked/
  );
  assert.equal(publications, 0);
  assert.equal(boundary.evidence, null);
});
