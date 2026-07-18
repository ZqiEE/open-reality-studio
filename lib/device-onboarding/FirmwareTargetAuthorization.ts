/**
 * Ephemeral authority for a governed firmware target.
 *
 * A renderer-provided serial path is never enough. The main process must bind
 * a currently enumerated port, the reviewed image digest, and the exact
 * governed request into a short-lived, one-use authorization. This permits a
 * blank ESP32-S3 to receive its first reviewed firmware without pretending it
 * already speaks the RealityWarden protocol.
 */
import { createHash } from 'node:crypto';

export const FIRMWARE_TARGET_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

export interface FirmwarePortDescriptor {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface FirmwareTargetAuthorization {
  authorizationId: string;
  target: {
    portPath: string;
    label?: string;
    fingerprint: string;
  };
  requestSha256: string;
  imageSha256: string;
  expiresAtMs: number;
}

type AuthorizationResult =
  | { ok: true; authorization: FirmwareTargetAuthorization }
  | { ok: false; code: string; detail: string };

type ValidationResult = { ok: true } | { ok: false; code: string; detail: string };

function refusal(code: string, detail: string): AuthorizationResult {
  return { ok: false, code, detail };
}

function validationRefusal(code: string, detail: string): ValidationResult {
  return { ok: false, code, detail };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite numbers are not allowed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('cyclic values are not allowed');
    seen.add(value);
    const encoded = `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return encoded;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('only plain objects are allowed');
    if (seen.has(object)) throw new Error('cyclic values are not allowed');
    seen.add(object);
    const keys = Object.keys(object).sort();
    const entries = keys.map((key) => {
      const item = object[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new Error(`unsupported value at ${key}`);
      }
      return `${JSON.stringify(key)}:${canonicalJson(item, seen)}`;
    });
    seen.delete(object);
    return `{${entries.join(',')}}`;
  }
  throw new Error('unsupported firmware request value');
}

function normalizeOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePort(raw: FirmwarePortDescriptor): FirmwarePortDescriptor | null {
  const path = normalizeOptional(raw?.path);
  if (!path || path.length > 260) return null;
  const normalized: FirmwarePortDescriptor = { path };
  const manufacturer = normalizeOptional(raw.manufacturer);
  const serialNumber = normalizeOptional(raw.serialNumber);
  const vendorId = normalizeOptional(raw.vendorId)?.toLowerCase();
  const productId = normalizeOptional(raw.productId)?.toLowerCase();
  if (manufacturer) normalized.manufacturer = manufacturer;
  if (serialNumber) normalized.serialNumber = serialNumber;
  if (vendorId) normalized.vendorId = vendorId;
  if (productId) normalized.productId = productId;
  return normalized;
}

function portFingerprint(port: FirmwarePortDescriptor): string {
  return sha256(canonicalJson(port));
}

function requestDigest(request: unknown): string | null {
  try {
    return sha256(canonicalJson(request));
  } catch {
    return null;
  }
}

export function createFirmwareTargetAuthorization(input: {
  authorizationId: string;
  requestedPortPath: unknown;
  listedPorts: readonly FirmwarePortDescriptor[];
  request: unknown;
  imageSha256: string;
  nowMs: number;
  ttlMs?: number;
}): AuthorizationResult {
  const requestedPortPath = normalizeOptional(input.requestedPortPath);
  if (!requestedPortPath) return refusal('invalid_target_port', 'a non-empty serial port path is required');
  const authorizationId = normalizeOptional(input.authorizationId);
  if (!authorizationId) return refusal('invalid_authorization_id', 'a generated authorization id is required');
  if (!Number.isFinite(input.nowMs)) return refusal('invalid_time', 'authorization time must be finite');
  const ttlMs = input.ttlMs ?? FIRMWARE_TARGET_AUTHORIZATION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > FIRMWARE_TARGET_AUTHORIZATION_TTL_MS) {
    return refusal('invalid_ttl', 'firmware target authorization cannot exceed five minutes');
  }
  if (!/^[a-f0-9]{64}$/.test(input.imageSha256)) return refusal('invalid_image_sha256', 'a lowercase sha256 digest is required');
  const matching = input.listedPorts.map(normalizePort).find((port) => port?.path === requestedPortPath) ?? null;
  if (!matching) return refusal('target_port_not_listed', 'the selected serial port is not currently enumerated');
  const requestSha256 = requestDigest(input.request);
  if (!requestSha256) return refusal('invalid_request_binding', 'the governed firmware request cannot be bound safely');
  return {
    ok: true,
    authorization: {
      authorizationId,
      target: {
        portPath: matching.path,
        label: matching.manufacturer,
        fingerprint: portFingerprint(matching)
      },
      requestSha256,
      imageSha256: input.imageSha256,
      expiresAtMs: input.nowMs + ttlMs
    }
  };
}

export function validateFirmwareTargetAuthorization(input: {
  authorization: FirmwareTargetAuthorization;
  authorizationId: unknown;
  requestedPortPath: unknown;
  listedPorts: readonly FirmwarePortDescriptor[];
  request: unknown;
  imageSha256: unknown;
  nowMs: number;
}): ValidationResult {
  if (input.authorizationId !== input.authorization.authorizationId) {
    return validationRefusal('firmware_authorization_mismatch', 'prepare the firmware preview again');
  }
  if (!Number.isFinite(input.nowMs) || input.nowMs >= input.authorization.expiresAtMs) {
    return validationRefusal('firmware_authorization_expired', 'the five-minute preview expired; prepare and confirm it again');
  }
  if (input.requestedPortPath !== input.authorization.target.portPath) {
    return validationRefusal('firmware_target_changed', 'the selected target port changed after preview');
  }
  if (input.imageSha256 !== input.authorization.imageSha256) {
    return validationRefusal('firmware_image_changed', 'the reviewed image digest changed after preview');
  }
  const current = input.listedPorts.map(normalizePort).find((port) => port?.path === input.authorization.target.portPath) ?? null;
  if (!current || portFingerprint(current) !== input.authorization.target.fingerprint) {
    return validationRefusal('firmware_target_changed', 'the target port disappeared or its device identity changed after preview');
  }
  const currentRequestSha256 = requestDigest(input.request);
  if (!currentRequestSha256 || currentRequestSha256 !== input.authorization.requestSha256) {
    return validationRefusal('firmware_request_changed', 'the governed firmware input changed after preview');
  }
  return { ok: true };
}
