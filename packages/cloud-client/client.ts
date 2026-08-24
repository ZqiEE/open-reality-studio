import { canonicalJson, sha256 } from "../core/evidence";
import {
  cloudApiPathVersion,
  cloudContractVersion,
  consumePermitResponseSchema,
  evidenceResponseSchema,
  evidenceExportPageSchema,
  permitResponseSchema,
  registerReleaseResponseSchema,
  zeroToShadowDraftResponseSchema,
  releaseResponseSchema,
  revokeReleaseResponseSchema,
  type CloudEvidence,
  type ExportedCloudEvidence,
  type ConsumePermitRequest,
  type PermitRequest,
  type SubmitEvidence,
  type EvidenceExport,
  type ZeroToShadowDraft,
  consumePermitRequestSchema,
  permitRequestSchema,
  submitEvidenceSchema,
} from "./contract";
import { randomUUID } from "node:crypto";
import type { CloudClientConfig } from "./config";
import type { ExecutablePolicySpec } from "../core/exec-spec";

const encoder = new TextEncoder();

export class CloudClientError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "CloudClientError";
  }
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new CloudClientError("cloud_response_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new CloudClientError("cloud_response_malformed");
  }
}

export class RlsokCloudClient {
  constructor(
    private readonly config: CloudClientConfig,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
    options: {
      idempotencyKey?: string;
      retryIdempotentMutation?: boolean;
    } = {},
  ): Promise<unknown> {
    const target = new URL(
      `${this.config.apiUrl.pathname}/${cloudApiPathVersion}/${path}`.replace(
        /\/+/g,
        "/",
      ),
      this.config.apiUrl,
    );
    if (target.origin !== this.config.apiUrl.origin) {
      throw new CloudClientError("cloud_cross_origin_request_rejected");
    }
    const attempts =
      method === "GET"
        ? this.config.safeRetryCount + 1
        : options.retryIdempotentMutation
          ? 2
          : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs,
      );
      try {
        const response = await this.transport(target, {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
            "x-rlsok-contract-version": cloudContractVersion,
            ...(options.idempotencyKey
              ? { "idempotency-key": options.idempotencyKey }
              : {}),
          },
          body: body === undefined ? undefined : canonicalJson(body),
        });
        if (response.status >= 300 && response.status < 400) {
          throw new CloudClientError(
            "cloud_redirect_rejected",
            response.status,
          );
        }
        const text = await boundedBody(response, this.config.maxResponseBytes);
        if (!response.ok) {
          const parsed = text ? parseJson(text) : {};
          const code =
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as { error?: unknown }).error === "string"
              ? (parsed as { error: string }).error
              : "cloud_request_failed";
          throw new CloudClientError(code, response.status);
        }
        return text ? parseJson(text) : {};
      } catch (error) {
        lastError = error;
        if (error instanceof CloudClientError || attempt + 1 >= attempts) {
          if (
            method !== "GET" &&
            options.idempotencyKey &&
            !(error instanceof CloudClientError)
          ) {
            throw new CloudClientError(
              `cloud_ambiguous_result_retry_with_idempotency_key:${options.idempotencyKey}`,
            );
          }
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new CloudClientError("cloud_request_failed");
  }

  async registerRelease(
    execSpec: ExecutablePolicySpec,
    idempotencyKey: string = randomUUID(),
  ) {
    return registerReleaseResponseSchema.parse(
      await this.request(
        "POST",
        "releases",
        { execSpec },
        {
          idempotencyKey,
          retryIdempotentMutation: true,
        },
      ),
    );
  }

  async createZeroToShadowDraft(draft: ZeroToShadowDraft) {
    return zeroToShadowDraftResponseSchema.parse(
      await this.request("POST", "onboarding/shadow-drafts", draft, {
        idempotencyKey: randomUUID(),
        retryIdempotentMutation: true,
      }),
    );
  }

  async getRelease(releaseId: string) {
    return releaseResponseSchema.parse(
      await this.request("GET", `releases/${encodeURIComponent(releaseId)}`),
    );
  }

  async approveRelease(releaseId: string) {
    return registerReleaseResponseSchema.parse(
      await this.request(
        "POST",
        `releases/${encodeURIComponent(releaseId)}/approve`,
        {},
      ),
    );
  }

  async revokeRelease(releaseId: string, reason: string) {
    return revokeReleaseResponseSchema.parse(
      await this.request(
        "POST",
        `releases/${encodeURIComponent(releaseId)}/revoke`,
        { reason },
      ),
    );
  }

  async requestPermit(
    request: PermitRequest,
    idempotencyKey: string = randomUUID(),
  ) {
    return permitResponseSchema.parse(
      await this.request(
        "POST",
        "permits",
        permitRequestSchema.parse(request),
        { idempotencyKey, retryIdempotentMutation: true },
      ),
    );
  }

  async consumePermit(permitId: string, request: ConsumePermitRequest) {
    try {
      return consumePermitResponseSchema.parse(
        await this.request(
          "POST",
          `permits/${encodeURIComponent(permitId)}/consume`,
          consumePermitRequestSchema.parse(request),
        ),
      );
    } catch (error) {
      // Cloud versions predating evaluationMode accept the Permit issue request
      // but reject the strict consume request. Keep this rollout fail-closed while
      // telling the operator which component must be upgraded first.
      if (
        error instanceof CloudClientError &&
        error.status === 400 &&
        error.code === "invalid_request"
      ) {
        throw new CloudClientError(
          "cloud_runtime_incompatible:upgrade_cloud_before_runtime",
          error.status,
        );
      }
      throw error;
    }
  }

  async submitEvidence(
    evidence: SubmitEvidence,
    idempotencyKey: string = randomUUID(),
  ) {
    const response = await this.request(
      "POST",
      "evidence",
      submitEvidenceSchema.parse(evidence),
      { idempotencyKey, retryIdempotentMutation: true },
    );
    if (
      typeof response !== "object" ||
      response === null ||
      typeof (response as { evidenceId?: unknown }).evidenceId !== "string"
    ) {
      throw new CloudClientError("cloud_response_malformed");
    }
    return response as {
      evidenceId: string;
      sequence: number;
      previousHash: string | null;
      evidenceHash: string;
      createdAt: string;
    };
  }

  async getEvidence(evidenceId: string): Promise<CloudEvidence> {
    return evidenceResponseSchema.parse(
      await this.request("GET", `evidence/${encodeURIComponent(evidenceId)}`),
    );
  }

  async exportEvidence(releaseId?: string): Promise<EvidenceExport> {
    let afterSequence = -1;
    let organizationFingerprint: string | undefined;
    let firstSequence: number | null = null;
    let lastSequence: number | null = null;
    const records: ExportedCloudEvidence[] = [];
    do {
      const query = new URLSearchParams({
        afterSequence: String(afterSequence),
        pageSize: "200",
      });
      if (releaseId) query.set("releaseId", releaseId);
      const page = evidenceExportPageSchema.parse(
        await this.request("GET", `evidence/export?${query}`),
      );
      if (
        organizationFingerprint &&
        page.organizationFingerprint !== organizationFingerprint
      ) {
        throw new CloudClientError("evidence_export_organization_changed");
      }
      organizationFingerprint = page.organizationFingerprint;
      firstSequence = page.firstSequence;
      lastSequence = page.lastSequence;
      for (const record of page.records) {
        if (record.organizationFingerprint !== page.organizationFingerprint) {
          throw new CloudClientError(
            "evidence_export_record_organization_mismatch",
          );
        }
        records.push({
          ...evidenceResponseSchema.parse({
            apiVersion: cloudContractVersion,
            ...record,
          }),
          organizationFingerprint: page.organizationFingerprint,
          includedForReleaseFilter:
            record.includedForReleaseFilter === undefined
              ? !releaseId || record.releaseId === releaseId
              : Boolean(record.includedForReleaseFilter),
        });
      }
      if (page.nextAfterSequence === null) break;
      if (page.nextAfterSequence <= afterSequence) {
        throw new CloudClientError("evidence_export_cursor_not_advanced");
      }
      afterSequence = page.nextAfterSequence;
    } while (true);
    return {
      apiVersion: cloudContractVersion,
      organizationFingerprint: organizationFingerprint ?? sha256("empty"),
      releaseFilter: releaseId ?? null,
      firstSequence,
      lastSequence,
      trustedCheckpoint: null,
      records,
    };
  }
}

export function verifyCloudEvidence(evidence: CloudEvidence):
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    } {
  const body = {
    sequence: evidence.sequence,
    previousHash: evidence.previousHash,
    releaseId: evidence.releaseId,
    permitId: evidence.permitId,
    decision: evidence.decision,
    hardwareSignalSent: evidence.hardwareSignalSent,
    payload: evidence.payload,
    createdAt: evidence.createdAt,
  };
  return sha256(canonicalJson(body)) === evidence.evidenceHash
    ? { ok: true }
    : { ok: false, reason: "evidence_hash_mismatch" };
}

export function encodedRequestBytes(value: unknown): number {
  return encoder.encode(canonicalJson(value)).byteLength;
}

export function verifyEvidenceChain(exported: EvidenceExport):
  | {
      ok: true;
      recordsVerified: number;
    }
  | {
      ok: false;
      reason: string;
    } {
  const records = exported.records;
  if (records.length === 0) {
    return exported.firstSequence === null && exported.lastSequence === null
      ? { ok: true, recordsVerified: 0 }
      : { ok: false, reason: "evidence_bounds_inconsistent" };
  }
  const checkpoint = exported.trustedCheckpoint;
  const expectedFirst = checkpoint ? checkpoint.sequence + 1 : 0;
  if (records[0]!.sequence !== expectedFirst) {
    return { ok: false, reason: "evidence_chain_truncated_without_checkpoint" };
  }
  if (
    exported.firstSequence !== records[0]!.sequence ||
    exported.lastSequence !== records.at(-1)!.sequence
  ) {
    return { ok: false, reason: "evidence_bounds_inconsistent" };
  }
  const seen = new Set<number>();
  let selectedRecords = 0;
  let previousHash = checkpoint?.evidenceHash ?? null;
  for (const record of records) {
    if (record.organizationFingerprint !== exported.organizationFingerprint) {
      return {
        ok: false,
        reason: `evidence_organization_mismatch:${record.sequence}`,
      };
    }
    if (seen.has(record.sequence)) {
      return {
        ok: false,
        reason: `evidence_sequence_duplicate:${record.sequence}`,
      };
    }
    seen.add(record.sequence);
    const expectedSequence = expectedFirst + seen.size - 1;
    if (record.sequence !== expectedSequence) {
      return {
        ok: false,
        reason: `evidence_sequence_missing:${expectedSequence}`,
      };
    }
    if (record.previousHash !== previousHash) {
      return {
        ok: false,
        reason: `evidence_previous_hash_mismatch:${record.sequence}`,
      };
    }
    const expectedIncluded =
      !exported.releaseFilter || record.releaseId === exported.releaseFilter;
    if (record.includedForReleaseFilter !== expectedIncluded) {
      return {
        ok: false,
        reason: `evidence_release_boundary_unexpected:${record.sequence}`,
      };
    }
    if (record.includedForReleaseFilter) selectedRecords += 1;
    const verified = verifyCloudEvidence(record);
    if (!verified.ok) {
      return { ok: false, reason: `${verified.reason}:${record.sequence}` };
    }
    previousHash = record.evidenceHash;
  }
  if (exported.releaseFilter && selectedRecords === 0) {
    return { ok: false, reason: "evidence_release_filter_empty" };
  }
  return { ok: true, recordsVerified: records.length };
}
