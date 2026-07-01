import type { ReactNode } from 'react';
import type { OpenRealityRuntimeResult } from '@/lib/open-reality-runtime/types';
import { localizeCapability, localizeDeviceType } from '@/lib/i18n';
import type { UiLanguage } from './LabConfigurator';

interface AutonomyDecisionPanelProps {
  language: UiLanguage;
  prompt: string;
  targetDeviceLabel: string;
  targetDeviceType: string;
  decision: OpenRealityRuntimeResult | null;
}

const text = {
  zh: {
    title: '运行时决策',
    empty: '点击运行后，这里会显示 Runtime Kernel 如何理解你的任务，以及为什么执行、拦截或拒绝。',
    latest: '最新一次 Run 尝试',
    userPrompt: '用户指令',
    targetDevice: '目标设备',
    runtimeStatus: '运行时状态',
    goal: '目标',
    requiredCapabilities: '所需能力',
    missingCapabilities: '缺失能力',
    safetyDecision: '安全决策',
    executionMode: '执行模式',
    reason: '原因',
    message: '用户提示',
    none: '无',
    compiled: '已编译',
    blocked: '已拦截',
    unsupported: '不支持',
    ambiguous: '不明确',
    notRunnable: '不可运行',
    askHuman: '需要人工确认',
    simulationOnly: '仅仿真',
    readOnly: '只读',
    approvalRequired: '需要人工确认后继续',
    blockedMode: '已阻止',
    compiledRule: '只有 compiled 才会继续进入仿真执行链路。',
    askHumanRule: 'ask_human 当前只提示人工确认，不执行设备动作。'
  },
  en: {
    title: 'Autonomy Decision',
    empty: 'After you click Run, this panel shows how the Runtime Kernel understood the task and why it executed, blocked, or rejected it.',
    latest: 'Latest Run Attempt',
    userPrompt: 'User Prompt',
    targetDevice: 'Target Device',
    runtimeStatus: 'Runtime Status',
    goal: 'Goal',
    requiredCapabilities: 'Required Capabilities',
    missingCapabilities: 'Missing Capabilities',
    safetyDecision: 'Safety Decision',
    executionMode: 'Execution Mode',
    reason: 'Reason',
    message: 'User-facing Message',
    none: 'None',
    compiled: 'Compiled',
    blocked: 'Blocked',
    unsupported: 'Unsupported',
    ambiguous: 'Ambiguous',
    notRunnable: 'Not Runnable',
    askHuman: 'Ask Human',
    simulationOnly: 'Simulation Only',
    readOnly: 'Read Only',
    approvalRequired: 'Human Approval Required',
    blockedMode: 'Blocked',
    compiledRule: 'Only compiled decisions continue into the simulation flow.',
    askHumanRule: 'ask_human only asks for confirmation in v0.2; it does not execute the device.'
  }
} as const;

function localStatus(language: UiLanguage, status: OpenRealityRuntimeResult['status']) {
  const t = text[language];
  if (status === 'compiled') return t.compiled;
  if (status === 'blocked') return t.blocked;
  if (status === 'unsupported') return t.unsupported;
  if (status === 'ambiguous') return t.ambiguous;
  if (status === 'not_runnable') return t.notRunnable;
  return t.askHuman;
}

function localGoal(language: UiLanguage, goal: string) {
  const zh: Record<string, string> = {
    pick_and_place: '抓取并放置',
    precision_place: '精确放置',
    insert_object: '插入目标',
    align_object: '对齐目标',
    assemble_object: '组装目标',
    capture_image: '采集图像',
    scan_area: '扫描区域',
    read_state: '读取状态',
    inspect: '检查',
    turn_on: '打开',
    turn_off: '关闭',
    set_color: '设置颜色',
    set_brightness: '设置亮度',
    set_speed: '设置速度',
    set_temperature: '设置温度',
    set_value: '设置值',
    convey_item: '输送物料',
    sort_item: '分拣物料',
    route_item: '路由物料',
    measure: '测量',
    dispense: '分配',
    heat: '加热',
    cool: '冷却',
    test: '测试',
    return_home: '回到原点',
    stop: '停止',
    emergency_stop: '急停',
    throw_object: '抛掷物体',
    smash_object: '破坏物体',
    move_outside_workspace: '移出工作区',
    destructive_action: '破坏性动作',
    unsafe_speed: '危险速度',
    ambiguous_action: '不明确动作',
    unsupported_goal: '不支持目标'
  };

  if (language === 'zh') return zh[goal] ?? goal;
  return goal.replaceAll('_', ' ');
}

function localExecutionMode(language: UiLanguage, decision: OpenRealityRuntimeResult) {
  const t = text[language];
  if (decision.taskDsl?.humanApprovalRequired) return t.approvalRequired;
  if (decision.taskDsl?.executionMode === 'read_only') return t.readOnly;
  if (decision.taskDsl?.executionMode === 'simulation_only') return t.simulationOnly;
  if (decision.safetyDecision.safetyEnvelope.allowedExecutionMode === 'read_only') return t.readOnly;
  if (decision.safetyDecision.safetyEnvelope.allowedExecutionMode === 'simulation_only') return t.simulationOnly;
  if (decision.safetyDecision.safetyEnvelope.allowedExecutionMode === 'ask_human') return t.approvalRequired;
  return t.blockedMode;
}

function badgeClass(status: OpenRealityRuntimeResult['status']) {
  if (status === 'compiled') return 'border-[#064E3B] bg-[#10251D] text-[#34D399]';
  if (status === 'blocked') return 'border-[#7F1D1D] bg-[#2B1116] text-[#FCA5A5]';
  if (status === 'ask_human') return 'border-[#713F12] bg-[#2A2112] text-[#FACC15]';
  return 'border-[#713F12] bg-[#2A2112] text-[#FACC15]';
}

function kv(label: string, value: ReactNode) {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-x-3 gap-y-1 border-t border-white/5 py-2 first:border-t-0 first:pt-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{label}</div>
      <div className="min-w-0 text-[11px] leading-5 text-[#E6EAF0]">{value}</div>
    </div>
  );
}

export function AutonomyDecisionPanel({
  language,
  prompt,
  targetDeviceLabel,
  targetDeviceType,
  decision
}: AutonomyDecisionPanelProps) {
  const t = text[language];

  return (
    <section className="ors-panel max-h-[260px] overflow-hidden px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{t.title}</div>
          <div className="text-[10px] text-[#6B7280]">{t.latest}</div>
        </div>
        {decision && (
          <span className={`rounded-[3px] border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badgeClass(decision.status)}`}>
            {localStatus(language, decision.status)}
          </span>
        )}
      </div>

      {!decision ? (
        <div className="rounded-[3px] border border-dashed border-[#313338] bg-[#101114]/90 px-3 py-2 text-[11px] leading-5 text-[#9AA3AF]">
          {t.empty}
        </div>
      ) : (
        <div className="custom-scrollbar max-h-[194px] overflow-y-auto rounded-[3px] border border-[#313338] bg-[#101114]/90 px-3 py-1.5">
          {kv(t.userPrompt, <span className="font-mono">{prompt || '-'}</span>)}
          {kv(t.targetDevice, (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{targetDeviceLabel}</span>
              <span className="rounded-[3px] border border-[#313338] bg-[#181A1D] px-1.5 py-0.5 text-[10px] text-[#9AA3AF]">
                {localizeDeviceType(language, targetDeviceType)}
              </span>
            </div>
          ))}
          {kv(t.runtimeStatus, (
            <span className={`inline-flex rounded-[3px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass(decision.status)}`}>
              {localStatus(language, decision.status)}
            </span>
          ))}
          {kv(t.goal, (
            <div className="flex flex-wrap items-center gap-2">
              <span>{localGoal(language, decision.goal.goalType)}</span>
              <span className="rounded-[3px] border border-[#313338] bg-[#181A1D] px-1.5 py-0.5 font-mono text-[10px] text-[#9AA3AF]">
                {decision.goal.goalType}
              </span>
            </div>
          ))}
          {kv(t.requiredCapabilities, (
            decision.plan.requiredCapabilities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {decision.plan.requiredCapabilities.map((capability) => (
                  <span key={capability} className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[10px] text-[#9BD4FF]">
                    {localizeCapability(language, capability)}
                  </span>
                ))}
              </div>
            ) : <span className="text-[#6B7280]">{t.none}</span>
          ))}
          {kv(t.missingCapabilities, (
            decision.plan.missingCapabilities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {decision.plan.missingCapabilities.map((capability) => (
                  <span key={capability} className="rounded-[3px] border border-[#7F1D1D] bg-[#2B1116] px-1.5 py-0.5 text-[10px] text-[#FCA5A5]">
                    {localizeCapability(language, capability)}
                  </span>
                ))}
              </div>
            ) : <span className="text-[#6B7280]">{t.none}</span>
          ))}
          {kv(t.safetyDecision, (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{decision.safetyDecision.status}</span>
              <span className="text-[#6B7280]">{decision.safetyDecision.reason}</span>
            </div>
          ))}
          {kv(t.executionMode, localExecutionMode(language, decision))}
          {kv(t.reason, <span className="font-mono text-[#9AA3AF]">{decision.reason}</span>)}
          {kv(t.message, decision.userFacingMessage)}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/5 pt-2 text-[10px] leading-4 text-[#8A94A0]">
            <span>{t.compiledRule}</span>
            <span>{t.askHumanRule}</span>
          </div>
        </div>
      )}
    </section>
  );
}
