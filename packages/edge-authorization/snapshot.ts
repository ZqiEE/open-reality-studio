import { sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const identity = z.string().trim().min(1).max(512).refine(
  isUnicodeScalarString,
  'identity must contain only Unicode scalar values'
);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)),
  'timestamp must be a finite RFC3339 instant with a canonical offset'
);
const canonicalEd25519Signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/).refine(
  (value) => {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === 64 && decoded.toString('base64url') === value;
  },
  'signature must be canonical unpadded base64url Ed25519 bytes'
);

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
  revocationEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

export const signedEdgeAuthorizationSchema = z.object({
  payload: edgeAuthorizationPayloadSchema,
  signature: canonicalEd25519Signature
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
  const maximumLifetimeMs = input.maximumLifetimeMs ?? 300_000;
  if (
    !Number.isFinite(now)
    || !Number.isSafeInteger(skew)
    || skew < 0
    || !Number.isSafeInteger(maximumLifetimeMs)
    || maximumLifetimeMs < 0
    || !Number.isSafeInteger(input.minimumRevocationEpoch)
    || input.minimumRevocationEpoch < 0
  ) {
    return {
      allowed: false,
      reason: 'edge_authorization_invalid',
      payload: parsed.data.payload
    };
  }
  const lifetime = Date.parse(parsed.data.payload.expiresAt)
    - Date.parse(parsed.data.payload.issuedAt);
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > maximumLifetimeMs) {
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
  const bindingMatches = ([
    'releaseId',
    'contentHash',
    'actionHash',
    'configurationDigest',
    'deviceId',
    'controllerIdentity'
  ] as const).every((field) => parsed.data.payload[field] === input.binding[field]);
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
  private readonly binding: EdgeAuthorizationBinding;

  constructor(
    private readonly publicKeys: ReadonlyMap<string, KeyObject | string | Buffer>,
    binding: EdgeAuthorizationBinding,
    private readonly minimumRevocationEpoch: () => number,
    private readonly dispatcher: { dispatch(action: TAction, permit: object): Promise<TResult> }
  ) {
    this.binding = Object.freeze({ ...binding });
  }

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
    const actionCanonical = canonicalJson(action);
    if (sha256(actionCanonical) !== this.binding.actionHash) {
      throw new Error('edge_dispatch_action_binding_mismatch');
    }
    // Dispatch a detached JSON value so caller-owned references cannot mutate
    // the action after the binding check but before an asynchronous adapter
    // consumes it.
    const preparedAction = JSON.parse(actionCanonical) as TAction;
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
    const result = await this.dispatcher.dispatch(preparedAction, Object.freeze({}));
    return { result, authorizationEvidence: verification.evidence };
  }
}
