/**
 * Print-friendly HTML rendering of an Audit Receipt.
 *
 * Deliberately dependency-free: the output is a single self-contained HTML
 * document (inline CSS, no scripts, no network) that the operator opens and
 * prints / saves as PDF to hand to a customer, insurer, or auditor. The
 * JSON receipt remains the authoritative, verifiable artifact
 * (docs/RECEIPT_FORMAT.md); this rendering is informative.
 *
 * All dynamic content is HTML-escaped — audit messages may contain
 * proposer-controlled text (LLM output, manifest strings), which is
 * untrusted by definition (invariant 5).
 */

import type { AuditReceiptV1 } from './AuditReceipt';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 32px auto; max-width: 860px; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .sub { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  th { background: #f4f4f4; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: Consolas, 'Courier New', monospace; font-size: 11px; word-break: break-all; }
  .lvl-info { color: #14631e; }
  .lvl-warn { color: #8a5a00; font-weight: 600; }
  .lvl-error { color: #9c1f1f; font-weight: 600; }
  .note { background: #f8f8f2; border: 1px solid #ddd; padding: 10px 12px; font-size: 12px; margin-top: 10px; }
  .kv td:first-child { width: 180px; color: #555; }
  @media print { body { margin: 0; max-width: none; } .note { break-inside: avoid; } tr { break-inside: avoid; } }
`;

/** Render a receipt as a standalone, print-friendly HTML document. */
export function renderReceiptHtml(receipt: AuditReceiptV1): string {
  const s = receipt.summary;
  const rows = receipt.entries
    .map(
      (entry) => `<tr>
        <td class="mono">${escapeHtml(entry.timestamp)}</td>
        <td class="lvl-${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</td>
        <td class="mono">${escapeHtml(entry.stage)} / ${escapeHtml(entry.code)}</td>
        <td>${escapeHtml(entry.message)}</td>
        <td class="mono">${escapeHtml(entry.hardwareSignalState)}</td>
      </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RealityWarden Audit Receipt · ${escapeHtml(receipt.generatedAt)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>RealityWarden Audit Receipt</h1>
<div class="sub">${escapeHtml(receipt.schema)} · generated ${escapeHtml(receipt.generatedAt)} · app v${escapeHtml(receipt.meta.appVersion)}</div>

<h2>Scope</h2>
<table class="kv">
<tr><td>Device profile</td><td>${escapeHtml(receipt.meta.deviceProfileId ?? 'n/a')}</td></tr>
<tr><td>Operator (self-declared)</td><td>${escapeHtml(receipt.meta.operator ?? 'n/a')}</td></tr>
<tr><td>Note</td><td>${escapeHtml(receipt.meta.note ?? 'n/a')}</td></tr>
<tr><td>Time range</td><td class="mono">${escapeHtml(receipt.timeRange.from ?? 'n/a')} → ${escapeHtml(receipt.timeRange.to ?? 'n/a')}</td></tr>
<tr><td>Entries</td><td>${s.totalEntries} (info ${s.byLevel.info} · warn ${s.byLevel.warn} · error ${s.byLevel.error})</td></tr>
<tr><td>Hardware signal evidence</td><td>not_sent ${s.byHardwareSignalState.not_sent} · attempted_unconfirmed ${s.byHardwareSignalState.attempted_unconfirmed} · device_acknowledged ${s.byHardwareSignalState.device_acknowledged}</td></tr>
<tr><td>Integrity (sha256)</td><td class="mono">${escapeHtml(receipt.integrity.contentHash)}</td></tr>
</table>

<h2>Decisions and events (original order)</h2>
<table>
<tr><th>Timestamp</th><th>Level</th><th>Stage / Code</th><th>Decision</th><th>Signal</th></tr>
${rows}
</table>

<h2>How to verify</h2>
<div class="note">
This document is an informative rendering. The authoritative artifact is the accompanying
<span class="mono">.receipt.json</span> file. Verify it independently with
<span class="mono">npm run receipt:verify -- &lt;file.receipt.json&gt;</span>, or implement the
four verification steps in docs/RECEIPT_FORMAT.md in any language.
${escapeHtml(receipt.integrity.statement)}. A refusal (blocked action) recorded here is the
runtime working as designed — the absence of a record, not the presence of a refusal, is the
anomaly to question.
</div>
</body>
</html>
`;
}
