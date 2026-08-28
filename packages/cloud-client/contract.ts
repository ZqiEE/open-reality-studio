import { z } from "zod";
import {
  executablePolicySpecSchema,
  type ExecutablePolicySpec,
} from "../core/exec-spec";

export const cloudContractVersion = "rlsok-cloud/v1" as const;
export const cloudApiPathVersion = "v1" as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const releaseResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    release_id: z.string().min(1).optional(),
    releaseId: z.string().min(1).optional(),
    content_hash: hash.optional(),
    contentHash: hash.optional(),
    state: z.enum(["draft", "approved", "revoked"]),
    exec_spec: executablePolicySpecSchema.optional(),
    execSpec: executablePolicySpecSchema.optional(),
    created_at: timestamp.optional(),
    updated_at: timestamp.optional(),
  })
  .passthrough()
  .transform((value) => ({
    releaseId: value.releaseId ?? value.release_id ?? "",
    contentHash: value.contentHash ?? value.content_hash ?? "",
    state: value.state,
    execSpec: value.execSpec ?? value.exec_spec,
  }))
  .refine(
    (value) =>
      value.releaseId.length > 0 && hash.safeParse(value.contentHash).success,
  );

export const registerReleaseResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    releaseId: z.string().min(1),
    contentHash: hash,
  })
  .strict();

export const zeroToShadowDraftResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    releaseId: z.string().min(1),
    contentHash: hash,
    state: z.literal("draft"),
    approvalUrl: z.string().url(),
  })
  .strict();

export interface ZeroToShadowDraft {
  artifact: {
    name: string;
    mediaType: string;
    sha256: string;
    sizeBytes: number;
  };
  controller: {
    controllerId: string;
    displayName: string;
    profileSha256: string;
    rosActionName: string;
  };
  robot: {
    robotId: string;
    displayName: string;
    profileSha256: string;
    controllerId: string;
  };
  execSpec: ExecutablePolicySpec;
}

export const permitRequestSchema = z
  .object({
    evaluationMode: z.enum(["shadow", "reference-run"]),
    releaseId: z.string().min(1).max(200),
    contentHash: hash,
    actionHash: hash,
    deviceId: z.string().min(1).max(200),
    controllerId: z.string().min(1).max(200),
    configurationDigest: hash,
    expiresInSeconds: z.number().int().min(1).max(60).default(30),
  })
  .strict();

export const consumePermitRequestSchema = permitRequestSchema
  .omit({ expiresInSeconds: true })
  .strict();

export const permitResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    permitId: z.string().uuid(),
    expiresAt: timestamp,
  })
  .strict();

export const consumePermitResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    permitId: z.string().uuid(),
    consumed: z.literal(true),
  })
  .strict();

export const revokeReleaseResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    releaseId: z.string().min(1),
    state: z.literal("revoked"),
  })
  .strict();

export const cloudEvidenceDecisionSchema = z.enum([
  "allowed",
  "blocked",
  "failed",
]);

const submitEvidenceObjectSchema = z
  .object({
    releaseId: z.string().min(1).max(200),
    permitId: z.string().uuid().nullable().optional(),
    decision: cloudEvidenceDecisionSchema,
    hardwareSignalSent: z.boolean(),
    payload: z
      .object({
        contractVersion: z.literal(cloudContractVersion),
        evaluationMode: z.enum(["shadow", "reference-run", "denial"]),
        contentHash: hash,
        actionHash: hash,
        deviceId: z.string().min(1).max(200),
        controllerId: z.string().min(1).max(200),
        expectedConfigurationDigest: hash,
        observedConfigurationDigest: hash.nullable(),
        localPermitConsumed: z.boolean(),
        cloudPermitConsumptionState: z.enum([
          "not_consumed",
          "consumed",
          "unknown",
        ]),
        controllerGoalsAttempted: z.number().int().min(0).max(1),
        reason: z.string().min(1).max(500),
        controllerResult: z.object({
          accepted: z.boolean(),
          completed: z.boolean(),
          succeeded: z.boolean(),
          status: z.number().int().optional(),
          errorCode: z.number().int().optional(),
          errorString: z.string().max(500).optional(),
          detail: z.string().min(1).max(500),
        }).strict().optional(),
      })
      .strict(),
  })
  .strict();

export const submitEvidencePayloadSchema =
  submitEvidenceObjectSchema.shape.payload;

export const submitEvidenceSchema = submitEvidenceObjectSchema.superRefine(
  (value, context) => {
    const consumption = value.payload.cloudPermitConsumptionState;
    if (
      consumption !== "not_consumed" &&
      (value.permitId == null || !value.payload.localPermitConsumed)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "cloudPermitConsumptionState"],
        message: "initiated Cloud consumption requires a bound Permit and consumed local Permit",
      });
    }
    if (
      (value.decision === "allowed" || value.hardwareSignalSent) &&
      consumption !== "consumed"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "cloudPermitConsumptionState"],
        message: "allowed or hardware-attempted Evidence requires confirmed Cloud consumption",
      });
    }
    if (
      value.hardwareSignalSent !== (value.payload.controllerGoalsAttempted > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hardwareSignalSent"],
        message: "hardware signal state must match controller goal attempts",
      });
    }
    if (
      value.payload.controllerResult !== undefined &&
      value.payload.controllerGoalsAttempted !== 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "controllerResult"],
        message: "controller result requires exactly one controller goal attempt",
      });
    }
  },
);

export const evidenceResponseSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    id: z.string().uuid(),
    sequence: z.union([
      z.number().int().nonnegative(),
      z.string().regex(/^\d+$/),
    ]),
    release_id: z.string().min(1).optional(),
    releaseId: z.string().min(1).optional(),
    permit_id: z.string().uuid().nullable().optional(),
    permitId: z.string().uuid().nullable().optional(),
    decision: cloudEvidenceDecisionSchema,
    hardware_signal_sent: z.boolean().optional(),
    hardwareSignalSent: z.boolean().optional(),
    payload: z.record(z.string(), z.unknown()),
    previous_hash: hash.nullable().optional(),
    previousHash: hash.nullable().optional(),
    evidence_hash: hash.optional(),
    evidenceHash: hash.optional(),
    created_at: timestamp.optional(),
    createdAt: timestamp.optional(),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    sequence: Number(value.sequence),
    releaseId: value.releaseId ?? value.release_id ?? "",
    permitId: value.permitId ?? value.permit_id ?? null,
    decision: value.decision,
    hardwareSignalSent:
      value.hardwareSignalSent ?? value.hardware_signal_sent ?? false,
    payload: value.payload,
    previousHash: value.previousHash ?? value.previous_hash ?? null,
    evidenceHash: value.evidenceHash ?? value.evidence_hash ?? "",
    createdAt: value.createdAt ?? value.created_at ?? "",
  }))
  .refine(
    (value) =>
      value.releaseId.length > 0 &&
      hash.safeParse(value.evidenceHash).success &&
      timestamp.safeParse(value.createdAt).success,
  );

export type PermitRequest = z.infer<typeof permitRequestSchema>;
export type ConsumePermitRequest = z.infer<typeof consumePermitRequestSchema>;
export type SubmitEvidence = z.infer<typeof submitEvidenceSchema>;
export type CloudEvidence = z.infer<typeof evidenceResponseSchema>;
export type ExportedCloudEvidence = CloudEvidence & {
  organizationFingerprint: string;
  includedForReleaseFilter: boolean;
};

export const evidenceExportPageSchema = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    organizationFingerprint: hash,
    releaseFilter: z.string().min(1).nullable(),
    firstSequence: z.number().int().nonnegative().nullable(),
    lastSequence: z.number().int().nonnegative().nullable(),
    nextAfterSequence: z.number().int().nonnegative().nullable(),
    records: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

export type EvidenceExport = {
  apiVersion: typeof cloudContractVersion;
  organizationFingerprint: string;
  releaseFilter: string | null;
  firstSequence: number | null;
  lastSequence: number | null;
  trustedCheckpoint: {
    sequence: number;
    evidenceHash: string;
  } | null;
  records: ExportedCloudEvidence[];
};

const normalizedEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    releaseId: z.string().min(1),
    permitId: z.string().uuid().nullable(),
    decision: cloudEvidenceDecisionSchema,
    hardwareSignalSent: z.boolean(),
    payload: submitEvidencePayloadSchema,
    previousHash: hash.nullable(),
    evidenceHash: hash,
    createdAt: timestamp,
    organizationFingerprint: hash,
    includedForReleaseFilter: z.boolean(),
  })
  .strict();

export const evidenceExportSchema: z.ZodType<EvidenceExport> = z
  .object({
    apiVersion: z.literal(cloudContractVersion),
    organizationFingerprint: hash,
    releaseFilter: z.string().min(1).nullable(),
    firstSequence: z.number().int().nonnegative().nullable(),
    lastSequence: z.number().int().nonnegative().nullable(),
    trustedCheckpoint: z
      .object({
        sequence: z.number().int().nonnegative(),
        evidenceHash: hash,
      })
      .strict()
      .nullable(),
    records: z.array(normalizedEvidenceSchema),
  })
  .strict();
