/**
 * Browser-side export of an Audit Receipt (docs/POSITIONING.md: the receipt
 * is the deliverable a team hands to a customer, insurer, or auditor).
 *
 * Produces three files from the same evidence:
 * - `<base>.receipt.json` — machine-readable and authoritative; any third
 *   party can re-verify the tamper-evident content hash.
 * - `<base>.receipt.md` — human-readable rendering of the same receipt.
 * - `<base>.receipt.html` — print-friendly standalone page (open → print /
 *   save as PDF to hand to a customer, insurer, or auditor).
 *
 * DOM-only module (mirrors exportRunBundle.ts); never imported by node-run
 * test code.
 */

import { buildAuditReceipt, renderReceiptMarkdown } from '../receipt/AuditReceipt';
import { renderReceiptHtml } from '../receipt/ReceiptHtml';
import type { AuditReceiptV1, ReceiptMeta } from '../receipt/AuditReceipt';
import type { RuntimeAuditEntry } from '../runtime/RuntimeAuditLog';

function downloadBlob(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Build a receipt from audit entries and download it as JSON + Markdown.
 * Throws (never silently swallows) when the evidence is internally
 * inconsistent — the caller surfaces that honestly to the operator.
 */
export function exportAuditReceiptFiles(
  baseName: string,
  entries: RuntimeAuditEntry[],
  meta: ReceiptMeta
): AuditReceiptV1 {
  const receipt = buildAuditReceipt(entries, meta);
  downloadBlob(`${baseName}.receipt.json`, JSON.stringify(receipt, null, 2), 'application/json;charset=utf-8');
  downloadBlob(`${baseName}.receipt.md`, renderReceiptMarkdown(receipt), 'text/markdown;charset=utf-8');
  downloadBlob(`${baseName}.receipt.html`, renderReceiptHtml(receipt), 'text/html;charset=utf-8');
  return receipt;
}
