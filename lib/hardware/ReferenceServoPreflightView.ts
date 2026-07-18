/**
 * ReferenceServoPreflightView — pure formatting of a hardware-local preflight
 * result into operator-facing strings. Kept out of the panel so the wording and
 * the ok/blocked branching are unit-tested, and the panel only renders.
 *
 * It states the honest outcome: a passing run shows the exact angle track and
 * the authoritatively recomputed risk; a blocked run shows which span refused
 * (simulation twin vs honesty bridge) and the reason. It never invents an
 * outcome and never softens a block.
 */
import type { RealProposalResult } from './ReferenceServoPreflight';

export interface ReferenceServoPreflightView {
  ok: boolean;
  headline: string;
  detail: string;
}

export function formatReferenceServoPreflight(result: RealProposalResult, zh: boolean): ReferenceServoPreflightView {
  if (result.ok) {
    const track = result.angles.map((angle) => `${angle}°`).join(' → ');
    const steps = result.angles.length;
    return {
      ok: true,
      headline: zh
        ? `参考伺服器预检通过 · ${steps} 步 · 风险 ${result.riskLevel}`
        : `Reference-servo preflight passed · ${steps} step(s) · risk ${result.riskLevel}`,
      detail: track
    };
  }
  const stage = zh
    ? (result.stage === 'simulation' ? '参考伺服器模型' : '角度轨迹提取')
    : result.stage;
  return {
    ok: false,
    headline: zh ? `参考伺服器预检拦截 · ${stage}` : `Reference-servo preflight blocked · ${stage}`,
    detail: result.reason
  };
}
