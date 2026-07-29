import { canonicalJson, sha256 } from '../core/evidence';
import {
  cloudApiPathVersion,
  cloudContractVersion,
  consumePermitResponseSchema,
  evidenceResponseSchema,
  permitResponseSchema,
  registerReleaseResponseSchema,
  releaseResponseSchema,
  revokeReleaseResponseSchema,
  type CloudEvidence,
  type ConsumePermitRequest,
  type PermitRequest,
  type SubmitEvidence,
  consumePermitRequestSchema,
  permitRequestSchema,
  submitEvidenceSchema
} from './contract';
import type { CloudClientConfig } from './config';
import type { ExecutablePolicySpec } from '../core/exec-spec';

const encoder = new TextEncoder();

export class CloudClientError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number
  ) {
    super(code);
    this.name = 'CloudClientError';
  }
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new CloudClientError('cloud_response_too_large');
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
    throw new CloudClientError('cloud_response_malformed');
  }
}

export class RlsokCloudClient {
  constructor(
    private readonly config: CloudClientConfig,
    private readonly transport: typeof fetch = fetch
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const target = new URL(
      `${this.config.apiUrl.pathname}/${cloudApiPathVersion}/${path}`.replace(/\/+/g, '/'),
      this.config.apiUrl
    );
    if (target.origin !== this.config.apiUrl.origin) {
      throw new CloudClientError('cloud_cross_origin_request_rejected');
    }
    const attempts = method === 'GET' ? this.config.safeRetryCount + 1 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.transport(target, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
            'x-rlsok-contract-version': cloudContractVersion
          },
          body: body === undefined ? undefined : canonicalJson(body)
        });
        if (response.status >= 300 && response.status < 400) {
          throw new CloudClientError('cloud_redirect_rejected', response.status);
        }
        const text = await boundedBody(response, this.config.maxResponseBytes);
        if (!response.ok) {
          const parsed = text ? parseJson(text) : {};
          const code =
            typeof parsed === 'object'
            && parsed !== null
            && typeof (parsed as { error?: unknown }).error === 'string'
              ? (parsed as { error: string }).error
              : 'cloud_request_failed';
          throw new CloudClientError(code, response.status);
        }
        return text ? parseJson(text) : {};
      } catch (error) {
        lastError = error;
        if (error instanceof CloudClientError || attempt + 1 >= attempts) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new CloudClientError('cloud_request_failed');
  }

  async registerRelease(execSpec: ExecutablePolicySpec) {
    return registerReleaseResponseSchema.parse(
      await this.request('POST', 'releases', { execSpec })
    );
  }

  async getRelease(releaseId: string) {
    return releaseResponseSchema.parse(
      await this.request('GET', `releases/${encodeURIComponent(releaseId)}`)
    );
  }

  async approveRelease(releaseId: string, approvedBy: string) {
    return registerReleaseResponseSchema.parse(
      await this.request('POST', `releases/${encodeURIComponent(releaseId)}/approve`, {
        approvedBy
      })
    );
  }

  async revokeRelease(releaseId: string, reason: string) {
    return revokeReleaseResponseSchema.parse(
      await this.request(
        'POST',
        `releases/${encodeURIComponent(releaseId)}/revoke`,
        { reason }
      )
    );
  }

  async requestPermit(request: PermitRequest) {
    return permitResponseSchema.parse(
      await this.request('POST', 'permits', permitRequestSchema.parse(request))
    );
  }

  async consumePermit(permitId: string, request: ConsumePermitRequest) {
    return consumePermitResponseSchema.parse(
      await this.request(
        'POST',
        `permits/${encodeURIComponent(permitId)}/consume`,
        consumePermitRequestSchema.parse(request)
      )
    );
  }

  async submitEvidence(evidence: SubmitEvidence) {
    const response = await this.request(
      'POST',
      'evidence',
      submitEvidenceSchema.parse(evidence)
    );
    if (
      typeof response !== 'object'
      || response === null
      || typeof (response as { evidenceId?: unknown }).evidenceId !== 'string'
    ) {
      throw new CloudClientError('cloud_response_malformed');
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
      await this.request('GET', `evidence/${encodeURIComponent(evidenceId)}`)
    );
  }
}

export function verifyCloudEvidence(evidence: CloudEvidence): {
  ok: true;
} | {
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
    createdAt: evidence.createdAt
  };
  return sha256(canonicalJson(body)) === evidence.evidenceHash
    ? { ok: true }
    : { ok: false, reason: 'evidence_hash_mismatch' };
}

export function encodedRequestBytes(value: unknown): number {
  return encoder.encode(canonicalJson(value)).byteLength;
}
