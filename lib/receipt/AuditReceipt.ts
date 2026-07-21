/**
 * Audit Receipt v1 — the productized form of the positioning
 * (docs/POSITIONING.md, locked 2026-07-21):
 *
 *   "Every action is gated, refusable, and receipted — with evidence you can
 *    hand to a regulator, an insurer, or a customer."
 *
 * This module turns a runtime audit log (RuntimeAuditEntry[]) into a
 * tamper-evident, third-party-consumable receipt:
 *
 * - deterministic canonical serialization (stable key order), so the same
 *   evidence always produces the same content hash
 * - a SHA-256 content hash over the canonical payload, so any edit to the
 *   receipt after export is detectable by re-verification
 * - a verify function any external party can run without trusting us
 * - a human-readable Markdown rendering for non-technical consumers
 *
 * HONESTY BOUNDARIES (invariant 4 applies to this module too):
 * - The content hash makes a receipt TAMPER-EVIDENT, not cryptographically
 *   SIGNED. It proves the document is internally consistent; it does not
 *   prove who produced it. Key-based signing is a follow-up step and is
 *   deliberately not claimed here.
 * - The receipt summarizes exactly what the audit log recorded — it never
 *   infers, upgrades, or reinterprets evidence. Open-loop acknowledgement
 *   stays open-loop; `not_sent` stays `not_sent`.
 * - This module is pure and side-effect free: no DOM, no filesystem, no
 *   hardware imports. It can never actuate anything (invariant 1 untouched).
 *
 * Schema stability: `realitywarden.receipt/v1` is additive-only from here.
 * Consumers may rely on every field documented on AuditReceiptV1.
 */

import type { RuntimeAuditEntry, RuntimeAuditLevel, RuntimeAuditStage } from '../runtime/RuntimeAuditLog';
import type { HardwareSignalState } from '../hardware/types';
import { GOVERNANCE_INVARIANTS } from '../governance/invariants';

export const RECEIPT_SCHEMA = 'realitywarden.receipt/v1' as const;

export interface ReceiptMeta {
  /** App version producing the receipt (package.json version). */
  appVersion: string;
  /** Device profile in scope, when the receipt covers a single device. */
  deviceProfileId?: string | null;
  /** Free-form operator identity as entered by the operator. Not verified. */
  operator?: string | null;
  /** Free-form context note (e.g. "customer PoC run 3"). Not verified. */
  note?: string | null;
}

export interface ReceiptTimeRange {
  /** ISO timestamp of the earliest entry, or null when there are no entries. */
  from: string | null;
  /** ISO timestamp of the latest entry, or null when there are no entries. */
  to: string | null;
}

export interface ReceiptSummary {
  totalEntries: number;
  byLevel: Record<RuntimeAuditLevel, number>;
  byStage: Partial<Record<RuntimeAuditStage, number>>;
  byHardwareSignalState: Record<HardwareSignalState, number>;
  /** Entries that prove a signal may have left the host (state !== not_sent). */
  entriesWithHardwareSignal: number;
}

export interface ReceiptIntegrity {
  algorithm: 'sha256';
  /**
   * Hex SHA-256 over the canonical serialization of the receipt WITHOUT this
   * integrity object. Recompute via verifyAuditReceipt().
   */
  contentHash: string;
  /** Honest statement of what the hash does and does not prove. */
  statement: 'content_hash_v1: tamper-evident, not a cryptographic signature';
}

export interface AuditReceiptV1 {
  schema: typeof RECEIPT_SCHEMA;
  product: 'RealityWarden';
  generatedAt: string;
  meta: ReceiptMeta;
  timeRange: ReceiptTimeRange;
  summary: ReceiptSummary;
  /** The evidence itself, in original recording order, unmodified. */
  entries: RuntimeAuditEntry[];
  /**
   * The invariant ids this runtime enforces structurally, so a receipt
   * consumer can map evidence to docs/GOVERNANCE.md and COMPLIANCE_MAPPING.md.
   */
  governanceInvariantIds: string[];
  integrity: ReceiptIntegrity;
}

export type ReceiptVerification =
  | { ok: true }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/* Canonical serialization                                             */
/* ------------------------------------------------------------------ */

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Deterministic JSON: object keys sorted lexicographically at every depth,
 * arrays in original order. Undefined object members are omitted (JSON
 * semantics); non-finite numbers are rejected loudly (invariant 3 — no
 * silent correction).
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value as JsonValue);
}

function serialize(value: JsonValue): string {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonical_stringify_non_finite_number');
    }
    return JSON.stringify(value);
  }
  if (kind === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item === undefined ? null : item)).join(',')}]`;
  }
  if (kind === 'object') {
    const record = value as { [key: string]: JsonValue };
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(',');
    return `{${body}}`;
  }
  throw new Error(`canonical_stringify_unsupported_type:${kind}`);
}

/* ------------------------------------------------------------------ */
/* SHA-256 (pure, dependency-free, sync — works in browser and node)   */
/* ------------------------------------------------------------------ */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

/** Pure SHA-256 of a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length (JS numbers are safe far beyond any realistic log size)
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const i = offset + t * 4;
      w[t] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/* ------------------------------------------------------------------ */
/* Receipt building                                                    */
/* ------------------------------------------------------------------ */

function assertEntryConsistency(entry: RuntimeAuditEntry, index: number): void {
  const expected = entry.hardwareSignalState !== 'not_sent';
  if (entry.hardwareSignalSent !== expected) {
    // Invariant 4: a receipt must refuse to notarize dishonest evidence.
    throw new Error(`receipt_inconsistent_hardware_evidence_at_${index}`);
  }
}

function buildSummary(entries: RuntimeAuditEntry[]): ReceiptSummary {
  const byLevel: Record<RuntimeAuditLevel, number> = { info: 0, warn: 0, error: 0 };
  const byStage: Partial<Record<RuntimeAuditStage, number>> = {};
  const byHardwareSignalState: Record<HardwareSignalState, number> = {
    not_sent: 0,
    attempted_unconfirmed: 0,
    device_acknowledged: 0
  };
  let entriesWithHardwareSignal = 0;

  for (const entry of entries) {
    byLevel[entry.level] += 1;
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
    byHardwareSignalState[entry.hardwareSignalState] += 1;
    if (entry.hardwareSignalState !== 'not_sent') entriesWithHardwareSignal += 1;
  }

  return {
    totalEntries: entries.length,
    byLevel,
    byStage,
    byHardwareSignalState,
    entriesWithHardwareSignal
  };
}

function computeTimeRange(entries: RuntimeAuditEntry[]): ReceiptTimeRange {
  if (entries.length === 0) return { from: null, to: null };
  let from = entries[0].timestamp;
  let to = entries[0].timestamp;
  for (const entry of entries) {
    if (entry.timestamp < from) from = entry.timestamp;
    if (entry.timestamp > to) to = entry.timestamp;
  }
  return { from, to };
}

function hashReceiptBody(body: Omit<AuditReceiptV1, 'integrity'>): string {
  return sha256Hex(canonicalStringify(body));
}

/**
 * Build a tamper-evident receipt from audit entries. Entries are included in
 * their original recording order and are never modified, filtered, or
 * reinterpreted. Throws on internally inconsistent evidence rather than
 * notarizing it.
 */
export function buildAuditReceipt(
  entries: RuntimeAuditEntry[],
  meta: ReceiptMeta,
  generatedAt: string = new Date().toISOString()
): AuditReceiptV1 {
  entries.forEach(assertEntryConsistency);

  const body: Omit<AuditReceiptV1, 'integrity'> = {
    schema: RECEIPT_SCHEMA,
    product: 'RealityWarden',
    generatedAt,
    meta: {
      appVersion: meta.appVersion,
      deviceProfileId: meta.deviceProfileId ?? null,
      operator: meta.operator ?? null,
      note: meta.note ?? null
    },
    timeRange: computeTimeRange(entries),
    summary: buildSummary(entries),
    entries: entries.map((entry) => ({ ...entry })),
    governanceInvariantIds: GOVERNANCE_INVARIANTS.map((invariant) => invariant.id)
  };

  return {
    ...body,
    integrity: {
      algorithm: 'sha256',
      contentHash: hashReceiptBody(body),
      statement: 'content_hash_v1: tamper-evident, not a cryptographic signature'
    }
  };
}

/**
 * Re-verify a receipt: recompute the content hash over the canonical body and
 * re-check evidence consistency. Any external party can run this without
 * trusting the producer.
 */
export function verifyAuditReceipt(receipt: AuditReceiptV1): ReceiptVerification {
  if (receipt.schema !== RECEIPT_SCHEMA) {
    return { ok: false, reason: `unsupported_schema:${String(receipt.schema)}` };
  }
  if (receipt.integrity?.algorithm !== 'sha256' || typeof receipt.integrity.contentHash !== 'string') {
    return { ok: false, reason: 'missing_or_malformed_integrity' };
  }
  for (let index = 0; index < receipt.entries.length; index += 1) {
    const entry = receipt.entries[index];
    if (entry.hardwareSignalSent !== (entry.hardwareSignalState !== 'not_sent')) {
      return { ok: false, reason: `inconsistent_hardware_evidence_at_${index}` };
    }
  }
  const { integrity, ...body } = receipt;
  const recomputed = hashReceiptBody(body);
  if (recomputed !== integrity.contentHash) {
    return { ok: false, reason: 'content_hash_mismatch' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Human-readable rendering                                            */
/* ------------------------------------------------------------------ */

/** Render a receipt as Markdown for non-technical consumers. */
export function renderReceiptMarkdown(receipt: AuditReceiptV1): string {
  const lines: string[] = [];
  lines.push('# RealityWarden Audit Receipt');
  lines.push('');
  lines.push(`- Schema: \`${receipt.schema}\``);
  lines.push(`- Generated: ${receipt.generatedAt}`);
  lines.push(`- App version: ${receipt.meta.appVersion}`);
  if (receipt.meta.deviceProfileId) lines.push(`- Device profile: ${receipt.meta.deviceProfileId}`);
  if (receipt.meta.operator) lines.push(`- Operator (self-declared): ${receipt.meta.operator}`);
  if (receipt.meta.note) lines.push(`- Note: ${receipt.meta.note}`);
  lines.push(
    `- Time range: ${receipt.timeRange.from ?? 'n/a'} → ${receipt.timeRange.to ?? 'n/a'}`
  );
  lines.push(`- Integrity: sha256 \`${receipt.integrity.contentHash}\``);
  lines.push(`  (${receipt.integrity.statement})`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const s = receipt.summary;
  lines.push(`- Entries: ${s.totalEntries} (info ${s.byLevel.info}, warn ${s.byLevel.warn}, error ${s.byLevel.error})`);
  lines.push(
    `- Hardware signal evidence: not_sent ${s.byHardwareSignalState.not_sent}, ` +
      `attempted_unconfirmed ${s.byHardwareSignalState.attempted_unconfirmed}, ` +
      `device_acknowledged ${s.byHardwareSignalState.device_acknowledged}`
  );
  lines.push(`- Entries where a signal may have left the host: ${s.entriesWithHardwareSignal}`);
  lines.push('');
  lines.push('## Decisions and events (original order)');
  lines.push('');
  for (const entry of receipt.entries) {
    lines.push(
      `- \`${entry.timestamp}\` **[${entry.level}]** ${entry.stage} / ${entry.code} — ${entry.message} ` +
        `(signal: ${entry.hardwareSignalState})`
    );
  }
  lines.push('');
  lines.push('## Governance invariants in force');
  lines.push('');
  for (const id of receipt.governanceInvariantIds) {
    lines.push(`- \`${id}\` (see docs/GOVERNANCE.md)`);
  }
  lines.push('');
  lines.push(
    '> Verification: recompute the sha256 over the canonical receipt body ' +
      '(all fields except `integrity`, object keys sorted) and compare with ' +
      '`integrity.contentHash`. See `lib/receipt/AuditReceipt.ts` — ' +
      '`verifyAuditReceipt()`.'
  );
  lines.push('');
  return lines.join('\n');
}
