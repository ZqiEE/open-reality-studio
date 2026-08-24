import { z } from 'zod';
import type { RuntimeAttestation } from '../core/runtime-attestation';

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().trim().min(1).max(512);

export const degradationCapabilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  observedAt: timestamp,
  continuityToken: identity,
  classificationRevision: identity,
  faultSetId: identity,
  capabilities: z.record(z.boolean())
}).strict();

export type DegradationCapabilityReport = z.infer<typeof degradationCapabilityReportSchema>;

export function degradationRuntimeAttestation(
  report: DegradationCapabilityReport
): RuntimeAttestation {
  const parsed = degradationCapabilityReportSchema.parse(report);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'external-degradation-classifier',
      version: parsed.classificationRevision
    },
    observedAt: parsed.observedAt,
    continuityToken: parsed.continuityToken,
    availableCapabilities: Object.entries(parsed.capabilities)
      .filter(([, available]) => available)
      .map(([capability]) => capability)
      .sort()
  };
}

export const golemUpperBodyReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  observedAt: timestamp,
  continuityToken: identity,
  monitorVersion: identity,
  upperBodyMotionReady: z.boolean()
}).strict();

export type GolemUpperBodyReport = z.infer<typeof golemUpperBodyReportSchema>;

/** RLSOK consumes the monitor verdict; it never infers contact/caught state. */
export function golemUpperBodyRuntimeAttestation(
  report: GolemUpperBodyReport
): RuntimeAttestation {
  const parsed = golemUpperBodyReportSchema.parse(report);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'golem-upper-body-monitor',
      version: parsed.monitorVersion
    },
    observedAt: parsed.observedAt,
    continuityToken: parsed.continuityToken,
    availableCapabilities: parsed.upperBodyMotionReady
      ? ['upper_body.motion_ready']
      : []
  };
}
