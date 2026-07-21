/**
 * Audit Receipt v1 tests — proves the receipt layer is honest and
 * tamper-evident before any UI/IPC wiring lands on top of it.
 *
 * Run via `npm run test:receipt` (compile-to-tmp pattern like the other
 * suites).
 */

import {
  buildAuditReceipt,
  canonicalStringify,
  renderReceiptMarkdown,
  sha256Hex,
  verifyAuditReceipt,
  RECEIPT_SCHEMA
} from '../../lib/receipt/AuditReceipt';
import type { RuntimeAuditEntry } from '../../lib/runtime/RuntimeAuditLog';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');

function entry(partial: Partial<RuntimeAuditEntry>): RuntimeAuditEntry {
  return {
    id: partial.id ?? 'runtime-audit-test-1',
    timestamp: partial.timestamp ?? '2026-07-21T10:00:00.000Z',
    stage: partial.stage ?? 'execution_gate',
    level: partial.level ?? 'info',
    code: partial.code ?? 'allowed',
    message: partial.message ?? 'test entry',
    hardwareSignalSent: partial.hardwareSignalSent ?? false,
    hardwareSignalState: partial.hardwareSignalState ?? 'not_sent',
    data: partial.data
  };
}

/* 1. SHA-256 correctness: NIST test vectors + agreement with node:crypto. */
assert.equal(
  sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'sha256("abc") must match the NIST vector'
);
assert.equal(
  sha256Hex(''),
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'sha256("") must match the NIST vector'
);
const unicodeSample = '传感器拔掉，它拒绝执行 — no data = no motion. €✓';
assert.equal(
  sha256Hex(unicodeSample),
  nodeCrypto.createHash('sha256').update(unicodeSample, 'utf8').digest('hex'),
  'pure sha256 must agree with node:crypto on multibyte UTF-8'
);

/* 2. Canonical stringify: key order must not matter; arrays keep order. */
assert.equal(
  canonicalStringify({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } }),
  canonicalStringify({ a: { c: [3, { y: 5, z: 4 }], d: 2 }, b: 1 }),
  'canonical form must be independent of object key insertion order'
);
assert.notEqual(
  canonicalStringify({ a: [1, 2] }),
  canonicalStringify({ a: [2, 1] }),
  'array order is meaningful and must be preserved'
);
assert.throws(
  () => canonicalStringify({ a: Number.NaN }),
  /canonical_stringify_non_finite_number/,
  'non-finite numbers must fail loudly, never serialize silently'
);

/* 3. Receipt build: deterministic hash for identical evidence. */
const sampleEntries: RuntimeAuditEntry[] = [
  entry({ id: 'e1', code: 'proposal_received', stage: 'input' }),
  entry({
    id: 'e2',
    code: 'blocked_min_safe_distance',
    stage: 'execution_gate',
    level: 'error',
    message: 'Blocked: obstacle at 4cm, min safe distance 10cm'
  }),
  entry({
    id: 'e3',
    code: 'command_acknowledged',
    stage: 'hardware',
    hardwareSignalSent: true,
    hardwareSignalState: 'device_acknowledged',
    message: 'move_to_angle acknowledged (open loop)'
  })
];
const meta = { appVersion: '0.5.1', deviceProfileId: 'esp32-servo-rig', operator: 'test', note: null };
const generatedAt = '2026-07-21T12:00:00.000Z';

const receiptA = buildAuditReceipt(sampleEntries, meta, generatedAt);
const receiptB = buildAuditReceipt(sampleEntries, meta, generatedAt);
assert.equal(receiptA.schema, RECEIPT_SCHEMA);
assert.equal(
  receiptA.integrity.contentHash,
  receiptB.integrity.contentHash,
  'identical evidence must produce an identical content hash'
);

/* 4. Summary must reflect the evidence exactly. */
assert.equal(receiptA.summary.totalEntries, 3);
assert.equal(receiptA.summary.byLevel.error, 1);
assert.equal(receiptA.summary.byHardwareSignalState.device_acknowledged, 1);
assert.equal(receiptA.summary.byHardwareSignalState.not_sent, 2);
assert.equal(receiptA.summary.entriesWithHardwareSignal, 1);
assert.equal(receiptA.timeRange.from, '2026-07-21T10:00:00.000Z');
assert.deepEqual(
  receiptA.entries.map((e) => e.id),
  ['e1', 'e2', 'e3'],
  'entries must keep original recording order'
);
assert(
  receiptA.governanceInvariantIds.includes('honest_audit'),
  'receipt must reference the governance invariant registry'
);

/* 5. Verification: valid receipt passes; any tampering is detected. */
assert.deepEqual(verifyAuditReceipt(receiptA), { ok: true });

const tamperedMessage = JSON.parse(JSON.stringify(receiptA));
tamperedMessage.entries[1].message = 'Allowed';
assert.equal(verifyAuditReceipt(tamperedMessage).ok, false, 'edited message must fail verification');

const tamperedRemoval = JSON.parse(JSON.stringify(receiptA));
tamperedRemoval.entries.splice(1, 1); // remove the refusal
tamperedRemoval.summary.totalEntries = 2;
assert.equal(verifyAuditReceipt(tamperedRemoval).ok, false, 'deleting a refusal must fail verification');

const tamperedEvidence = JSON.parse(JSON.stringify(receiptA));
tamperedEvidence.entries[0].hardwareSignalSent = true; // lie: flag without state
const evidenceResult = verifyAuditReceipt(tamperedEvidence);
assert.equal(evidenceResult.ok, false);
assert.match(
  (evidenceResult as { ok: false; reason: string }).reason,
  /inconsistent_hardware_evidence/,
  'dishonest hardware evidence must be named explicitly'
);

/* 6. Building from dishonest evidence must throw, never notarize. */
assert.throws(
  () =>
    buildAuditReceipt(
      [entry({ hardwareSignalSent: true, hardwareSignalState: 'not_sent' })],
      meta,
      generatedAt
    ),
  /receipt_inconsistent_hardware_evidence/,
  'the receipt layer must refuse internally inconsistent evidence'
);

/* 7. Markdown rendering: refusals and integrity are visible. */
const markdown = renderReceiptMarkdown(receiptA);
assert(markdown.includes('RealityWarden Audit Receipt'));
assert(markdown.includes('blocked_min_safe_distance'), 'the refusal must be visible in the rendering');
assert(markdown.includes(receiptA.integrity.contentHash), 'the content hash must be printed');
assert(
  markdown.includes('not a cryptographic signature'),
  'the honest integrity statement must be visible to the consumer'
);

/* 8. Empty log is a valid (empty) receipt, honestly ranged. */
const emptyReceipt = buildAuditReceipt([], meta, generatedAt);
assert.equal(emptyReceipt.summary.totalEntries, 0);
assert.equal(emptyReceipt.timeRange.from, null);
assert.deepEqual(verifyAuditReceipt(emptyReceipt), { ok: true });

console.log('Audit Receipt tests passed.');
console.log('- sha256 matches NIST vectors and node:crypto on UTF-8.');
console.log('- Canonical form is key-order independent; hash is deterministic.');
console.log('- Tampering (edit, delete, dishonest evidence) is detected.');
console.log('- Dishonest evidence is refused at build time.');
