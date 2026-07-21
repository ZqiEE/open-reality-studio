'use client';

/**
 * DecisionStream — the adjudication feed (v0.7 UI direction, step 1).
 *
 * Renders the runtime audit log as the product's main story: each entry is a
 * decision card — what was proposed, what the gate decided, what evidence it
 * carried — ending in the receipt CTA. Refusals are presented as the gate
 * doing its job, never as errors to hide (docs/POSITIONING.md).
 *
 * Read-only: this component displays recorded evidence verbatim and can
 * trigger the existing export path. It has no execution authority.
 */

import type { RuntimeAuditEntry } from '@/lib/runtime/RuntimeAuditLog';

const MAX_VISIBLE = 20;

function levelBadge(level: RuntimeAuditEntry['level'], zh: boolean): { label: string; className: string } {
  if (level === 'info') {
    return { label: zh ? '记录' : 'RECORDED', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  }
  if (level === 'warn') {
    return { label: zh ? '拦截' : 'BLOCKED', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  return { label: zh ? '拦截/失败' : 'BLOCKED/FAILED', className: 'border-rose-200 bg-rose-50 text-rose-700' };
}

function clockTime(iso: string): string {
  const t = iso.indexOf('T');
  return t >= 0 ? iso.slice(t + 1, t + 9) : iso;
}

export function DecisionStream({
  language,
  entries,
  onExportReceipt
}: {
  language: 'zh' | 'en';
  entries: RuntimeAuditEntry[];
  onExportReceipt?: () => void;
}) {
  const zh = language === 'zh';
  const visible = entries.slice(-MAX_VISIBLE);
  const hidden = entries.length - visible.length;

  if (entries.length === 0) {
    return (
      <div className="border border-[#E5E5EA] bg-white px-3 py-3 text-xs text-[#86868B]">
        {zh
          ? '运行一条指令后，这里按时间显示每一次裁决：意图 → 判定 → 证据。放行与拦截都会入账，随时可导出回执。'
          : 'Run a command and every adjudication appears here in order: intent → verdict → evidence. Approvals and refusals are both recorded and exportable as a receipt.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] leading-relaxed text-[#86868B]">
        {zh
          ? '拦截是安全门在履约，不是故障。以下每条裁决都已入账，可导出为防篡改回执。'
          : 'A refusal is the gate doing its job, not a malfunction. Every verdict below is on the record and exportable as a tamper-evident receipt.'}
      </div>
      {hidden > 0 && (
        <div className="text-[10px] text-[#86868B]">
          {zh ? `另有 ${hidden} 条较早裁决在完整回执中` : `${hidden} earlier verdicts are in the full receipt`}
        </div>
      )}
      <ol className="flex flex-col gap-1.5" aria-label={zh ? '裁决流' : 'Decision stream'}>
        {visible.map((entry) => {
          const badge = levelBadge(entry.level, zh);
          return (
            <li key={entry.id} className="border border-[#E5E5EA] bg-white px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${badge.className}`}>{badge.label}</span>
                <span className="font-mono text-[10px] text-[#86868B]">{clockTime(entry.timestamp)}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-[#6E6E73]">{entry.stage} / {entry.code}</div>
              <div className="mt-0.5 break-words text-[11px] leading-4 text-[#1D1D1F]">{entry.message}</div>
              <div className="mt-1 font-mono text-[10px] text-[#6E6E73]">
                signal: {entry.hardwareSignalState}
              </div>
            </li>
          );
        })}
      </ol>
      {onExportReceipt && (
        <button
          type="button"
          data-decision-stream-export-receipt
          onClick={onExportReceipt}
          className="h-8 w-full border border-[#E5E5EA] bg-white px-3 text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
        >
          {zh ? '导出审计回执（JSON + Markdown + 可打印 HTML）' : 'Export audit receipt (JSON + Markdown + printable HTML)'}
        </button>
      )}
    </div>
  );
}
