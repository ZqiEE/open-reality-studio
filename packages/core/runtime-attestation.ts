import { z } from 'zod';
import { canonicalJson, sha256 } from './evidence';

const timestamp = z.string().datetime({ offset: true });
const boundedIdentity = z.string().trim().min(1).max(512);
const capability = z.string().trim().min(1).max(256);

function uniqueSortedCapabilities(label: string) {
  return z.array(capability).max(256).superRefine((capabilities, context) => {
    if (new Set(capabilities).size !== capabilities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must contain unique values`
      });
    }
  }).transform((capabilities) => [...capabilities].sort());
}

export const requiredCapabilitiesSchema = uniqueSortedCapabilities(
  'required capabilities'
);

export const runtimeAttestationSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    identity: boundedIdentity,
    kind: boundedIdentity,
    version: boundedIdentity.optional()
  }).strict(),
  observedAt: timestamp,
  continuityToken: z.string().min(1).max(1_024),
  availableCapabilities: uniqueSortedCapabilities('available capabilities')
}).strict();

export type RuntimeAttestation = z.infer<typeof runtimeAttestationSchema>;

export type RuntimeAttestationReason =
  | 'runtime_attestation_missing'
  | 'runtime_attestation_stale'
  | 'runtime_capability_missing';

export interface RuntimeAttestationEvaluation {
  allowed: boolean;
  reason: RuntimeAttestationReason | null;
  attestation: RuntimeAttestation | null;
  digest: string | null;
}

export function runtimeAttestationDigest(attestation: RuntimeAttestation): string {
  return sha256(canonicalJson(runtimeAttestationSchema.parse(attestation)));
}

export function continuityTokenHash(continuityToken: string): string {
  return sha256(continuityToken);
}

export function evaluateRuntimeAttestation(input: {
  requiredCapabilities?: readonly string[];
  attestation?: RuntimeAttestation;
  maxAgeMs: number;
  now?: Date;
}): RuntimeAttestationEvaluation {
  const required = input.requiredCapabilities ?? [];
  if (required.length === 0) {
    return { allowed: true, reason: null, attestation: null, digest: null };
  }
  if (!input.attestation) {
    return {
      allowed: false,
      reason: 'runtime_attestation_missing',
      attestation: null,
      digest: null
    };
  }
  const parsed = runtimeAttestationSchema.safeParse(input.attestation);
  if (!parsed.success) {
    return {
      allowed: false,
      reason: 'runtime_attestation_stale',
      attestation: null,
      digest: null
    };
  }
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(parsed.data.observedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > input.maxAgeMs) {
    return {
      allowed: false,
      reason: 'runtime_attestation_stale',
      attestation: parsed.data,
      digest: runtimeAttestationDigest(parsed.data)
    };
  }
  const available = new Set(parsed.data.availableCapabilities);
  if (!required.every((requiredCapability) => available.has(requiredCapability))) {
    return {
      allowed: false,
      reason: 'runtime_capability_missing',
      attestation: parsed.data,
      digest: runtimeAttestationDigest(parsed.data)
    };
  }
  return {
    allowed: true,
    reason: null,
    attestation: parsed.data,
    digest: runtimeAttestationDigest(parsed.data)
  };
}
