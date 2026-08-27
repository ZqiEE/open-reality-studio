import { z } from 'zod';
import type { RuntimeAttestation } from '../core/runtime-attestation';

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().trim().min(1).max(512);

export const commandPathAttestationSchema = z.object({
  schemaVersion: z.literal(1),
  pathIdentity: identity,
  ready: z.boolean(),
  trust: z.enum(['authenticated', 'untrusted', 'unknown']),
  observedAt: timestamp,
  continuityToken: identity,
  middleware: identity,
  source: identity,
  capabilities: z.array(identity).max(128)
}).strict();

export type CommandPathAttestation = z.infer<typeof commandPathAttestationSchema>;

export interface FastDdsSecurityObservation {
  pathIdentity: string;
  observedAt: string;
  continuityToken: string;
  matchedCommandWriter: boolean;
  matchedCommandReader: boolean;
  participantAuthenticated: boolean;
  governanceEnforced: boolean;
  permissionsValidated: boolean;
  commandPathExplicitlyUntrusted?: boolean;
  source: string;
}

/**
 * Adapter-owned Fast DDS normalization. The booleans must come from a local
 * DDS Security-aware monitor; GUIDs/names alone are deliberately insufficient.
 * Unrelated participants are not inputs, so they cannot globally deny this
 * scoped path.
 */
export function fastDdsCommandPathObservation(
  observation: FastDdsSecurityObservation
): CommandPathAttestation {
  const ready = observation.matchedCommandWriter && observation.matchedCommandReader;
  const authenticated = !observation.commandPathExplicitlyUntrusted
    && observation.participantAuthenticated
    && observation.governanceEnforced
    && observation.permissionsValidated;
  return commandPathAttestationSchema.parse({
    schemaVersion: 1,
    pathIdentity: observation.pathIdentity,
    ready,
    trust: authenticated
      ? 'authenticated'
      : observation.commandPathExplicitlyUntrusted ? 'untrusted' : 'unknown',
    observedAt: observation.observedAt,
    continuityToken: observation.continuityToken,
    middleware: 'fastdds-security',
    source: observation.source,
    capabilities: ready && authenticated
      ? [`dds.command_path.trusted:${observation.pathIdentity}`]
      : []
  });
}

export function commandPathRuntimeAttestation(
  attestation: CommandPathAttestation
): RuntimeAttestation {
  const parsed = commandPathAttestationSchema.parse(attestation);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.pathIdentity,
      kind: 'dds-command-path',
      version: parsed.middleware
    },
    observedAt: parsed.observedAt,
    continuityToken: parsed.continuityToken,
    availableCapabilities: parsed.ready && parsed.trust === 'authenticated'
      ? [...parsed.capabilities]
      : []
  };
}
