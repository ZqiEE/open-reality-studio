/**
 * Receipt HTML rendering tests: the printable view must be self-contained,
 * show refusals and integrity, and never let proposer-controlled text inject
 * markup (invariant 5: proposers are untrusted — including in a receipt).
 */

import { buildAuditReceipt } from '../../lib/receipt/AuditReceipt';
import { renderReceiptHtml, escapeHtml } from '../../lib/receipt/ReceiptHtml';
import type { RuntimeAuditEntry } from '../../lib/runtime/RuntimeAuditLog';

const assert = require('node:assert/strict');

/* 1. Escaping: proposer-controlled text cannot inject HTML. */
assert.equal(
  escapeHtml(`<script>alert("x")</script>&'`),
  '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'
);

const entries: RuntimeAuditEntry[] = [
  {
    id: 'e1',
    timestamp: '2026-07-21T10:00:00.000Z',
    stage: 'execution_gate',
    level: 'error',
    code: 'blocked_min_safe_distance',
    message: 'Blocked: <img src=x onerror=alert(1)> obstacle at 4cm',
    hardwareSignalSent: false,
    hardwareSignalState: 'not_sent'
  },
  {
    id: 'e2',
    timestamp: '2026-07-21T10:00:01.000Z',
    stage: 'hardware',
    level: 'info',
    code: 'real_executed',
    message: 'move_to_angle:45 acknowledged (open loop)',
    hardwareSignalSent: true,
    hardwareSignalState: 'device_acknowledged'
  }
];

const receipt = buildAuditReceipt(
  entries,
  { appVersion: '0.5.1', deviceProfileId: 'esp32_servo_reference_rig', note: '<b>note</b>' },
  '2026-07-21T12:00:00.000Z'
);
const html = renderReceiptHtml(receipt);

/* 2. Self-contained document, no scripts, no external references. */
assert(html.startsWith('<!DOCTYPE html>'));
assert(!html.includes('<script'), 'printable receipt must contain no scripts');
assert(!/src=["']https?:/.test(html) && !/href=["']https?:/.test(html), 'printable receipt must not reference the network');

/* 3. Injection attempts arrive escaped, never as markup. */
assert(!html.includes('<img src=x'), 'raw injected markup must not survive');
assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'injected markup must appear escaped');
assert(html.includes('&lt;b&gt;note&lt;/b&gt;'), 'meta note must be escaped too');

/* 4. The refusal, the evidence, and the integrity hash are all visible. */
assert(html.includes('blocked_min_safe_distance'), 'the refusal must be visible');
assert(html.includes('device_acknowledged') && html.includes('not_sent'), 'signal evidence must be visible');
assert(html.includes(receipt.integrity.contentHash), 'the content hash must be printed');
assert(html.includes('not a cryptographic signature'), 'the honest integrity statement must be visible');
assert(html.includes('receipt-verify') || html.includes('receipt:verify'), 'verification instructions must be included');

console.log('Receipt HTML tests passed.');
console.log('- Self-contained, script-free, network-free document.');
console.log('- Untrusted text is escaped; refusals and integrity are visible.');
