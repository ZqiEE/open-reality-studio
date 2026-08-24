import { sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';

const identity = z.string().trim().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const edgeAuthorizationPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: identity,
  keyId: identity,
  releaseId: identity,
  contentHash: digest,
  actionHash: digest,
  configurationDigest: digest,
  deviceId: identity,
  controllerIdentity: identity,
  issuedAt: timestamp,
  expiresAt: timestamp,
  revocationEpoch: z.number().int().nonnegative()
}).strict();

export const signedEdgeAuthorizationSchema = z.object({
  payload: edgeAuthorizationPayloadSchema,
  signature: z.string().min(1).max(2_048)
}).strict();

export type EdgeAuthorizationPayload = z.infer<typeof edgeAuthorizationPayloadSchema>;
export type SignedEdgeAuthorization = z.infer<typeof signedEdgeAuthorizationSchema>;

export interface EdgeAuthorizationBinding {
  releaseId: string;
  contentHash: string;
  actionHash: string;
  configurationDigest: string;
  deviceId: string;
  controllerIdentity: string;
}

export type EdgeAuthorizationFailureReason =
  | 'edge_authorization_invalid'
  | 'edge_authorization_unknown_key'
  | 'edge_authorization_not_yet_valid'
  | 'edge_authorization_expired'
  | 'edge_authorization_revoked'
  | 'edge_authorization_binding_mismatch';

export type EdgeAuthorizationVerification =
  | {
      allowed: true;
      reason: null;
      payload: EdgeAuthorizationPayload;
      evidence: {
        schemaVersion: 1;
        snapshotId: string;
        keyId: string;
        revocationEpoch: number;
        snapshotDigest: string;
      };
    }
  | {
      allowed: false;
      reason: EdgeAuthorizationFailureReason;
      payload: EdgeAuthorizationPayload | null;
    };

export interface EdgeAuthorizationEvidence {
  schemaVersion: 1;
  snapshotId: string;
  keyId: string;
  revocationEpoch: number;
  snapshotDigest: string;
}

function encodedPayload(payload: EdgeAuthorizationPayload): Buffer {
  return Buffer.from(canonicalJson(edgeAuthorizationPayloadSchema.parse(payload)));
}

export function signEdgeAuthorization(
  payload: EdgeAuthorizationPayload,
  privateKey: KeyObject | string | Buffer
): SignedEdgeAuthorization {
  const parsed = edgeAuthorizationPayloadSchema.parse(payload);
  if (Date.parse(parsed.expiresAt) <= Date.parse(parsed.issuedAt)) {
    throw new Error('edge_authorization_invalid_lifetime');
  }
  return {
    payload: parsed,
    signature: sign(null, encodedPayload(parsed), privateKey).toString('base64url')
  };
}

export function verifyEdgeAuthorization(input: {
  snapshot: unknown;
  publicKeys: ReadonlyMap<string, KeyObject | string | Buffer>;
  binding: EdgeAuthorizationBinding;
  minimumRevocationEpoch: number;
  now?: Date;
  maximumClockSkewMs?: number;
  maximumLifetimeMs?: number;
}): EdgeAuthorizationVerification {
  const parsed = signedEdgeAuthorizationSchema.safeParse(input.snapshot);
  if (!parsed.success) {
    return { allowed: false, reason: 'edge_authorization_invalid', payload: null };
  }
  const key = input.publicKeys.get(parsed.data.payload.keyId);
  if (!key) {
    return {
      allowed: false,
      reason: 'edge_authorization_unknown_key',
      payload: parsed.data.payload
    };
  }
  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      encodedPayload(parsed.data.payload),
      key,
      Buffer.from(parsed.data.signature, 'base64url')
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return {
      allowed: false,
      reason: 'edge_authorization_invalid',
      payload: parsed.data.payload
    };
  }
  const now = (input.now ?? new Date()).getTime();
  const skew = input.maximumClockSkewMs ?? 5_000;
  const lifetime = Date.parse(parsed.data.payload.expiresAt)
    - Date.parse(parsed.data.payload.issuedAt);
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > (input.maximumLifetimeMs ?? 300_000)) {
    return {
      allowed: false,
      reason: 'edge_authorization_invalid',
      payload: parsed.data.payload
    };
  }
  if (Date.parse(parsed.data.payload.issuedAt) > now + skew) {
    return {
      allowed: false,
      reason: 'edge_authorization_not_yet_valid',
      payload: parsed.data.payload
    };
  }
  if (Date.parse(parsed.data.payload.expiresAt) <= now) {
    return {
      allowed: false,
      reason: 'edge_authorization_expired',
      payload: parsed.data.payload
    };
  }
  if (parsed.data.payload.revocationEpoch < input.minimumRevocationEpoch) {
    return {
      allowed: false,
      reason: 'edge_authorization_revoked',
      payload: parsed.data.payload
    };
  }
  const bindingMatches = (Object.keys(input.binding) as (keyof EdgeAuthorizationBinding)[])
    .every((field) => parsed.data.payload[field] === input.binding[field]);
  if (!bindingMatches) {
    return {
      allowed: false,
      reason: 'edge_authorization_binding_mismatch',
      payload: parsed.data.payload
    };
  }
  return {
    allowed: true,
    reason: null,
    payload: parsed.data.payload,
    evidence: {
      schemaVersion: 1,
      snapshotId: parsed.data.payload.snapshotId,
      keyId: parsed.data.payload.keyId,
      revocationEpoch: parsed.data.payload.revocationEpoch,
      snapshotDigest: sha256(canonicalJson(parsed.data))
    }
  };
}

/**
 * Robot-side, network-free final write boundary. Snapshot refresh belongs in a
 * separate non-critical task. This class performs only bounded local parsing,
 * Ed25519 verification and binding checks immediately before one dispatch.
 */
export class EdgeAuthorizedDispatchBoundary<TAction, TResult> {
  private consumed = false;
  private prepared: SignedEdgeAuthorization | null = null;
  private authorizationEvidence: EdgeAuthorizationEvidence | null = null;

  constructor(
    private readonly publicKeys: ReadonlyMap<string, KeyObject | string | Buffer>,
    private readonly binding: EdgeAuthorizationBinding,
    private readonly minimumRevocationEpoch: () => number,
    private readonly dispatcher: { dispatch(action: TAction, permit: object): Promise<TResult> }
  ) {}

  prepare(snapshot: SignedEdgeAuthorization): void {
    if (this.consumed) throw new Error('edge_dispatch_boundary_reused');
    this.prepared = signedEdgeAuthorizationSchema.parse(snapshot);
  }

  get evidence(): typeof this.authorizationEvidence {
    return this.authorizationEvidence;
  }

  async dispatch(action: TAction, now = new Date()): Promise<{
    result: TResult;
    authorizationEvidence: EdgeAuthorizationEvidence;
  }> {
    if (this.consumed) throw new Error('edge_dispatch_boundary_reused');
    this.consumed = true;
    const snapshot = this.prepared;
    this.prepared = null;
    const verification = verifyEdgeAuthorization({
      snapshot,
      publicKeys: this.publicKeys,
      binding: this.binding,
      minimumRevocationEpoch: this.minimumRevocationEpoch(),
      now
    });
    if (!verification.allowed) {
      throw new Error(verification.reason);
    }
    this.authorizationEvidence = verification.evidence;
    const result = await this.dispatcher.dispatch(action, Object.freeze({}));
    return { result, authorizationEvidence: verification.evidence };
  }
}
