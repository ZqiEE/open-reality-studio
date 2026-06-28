'use client';

import { useState } from 'react';
import type { DeviceProfile } from '@/types/deviceMeta';
import type { DeviceType } from '@/types/deviceMeta';
import type { LabReport, TimelineStateSnapshot } from '@/lib/virtual-lab/LabReport';
import type { ActionFrame } from '@/lib/action-runtime/ActionState';
import { localizeDeviceType, localizeDisplayName, localizeFidelity, t } from '@/lib/i18n';
import { getSimulatorFidelity } from '@/lib/virtual-lab/SimulatorFidelity';
import type { SemanticWorkspaceDevice } from './SemanticDeviceStage';
import { SemanticDeviceStage } from './SemanticDeviceStage';
import type { UiLanguage } from './LabConfigurator';

function localBlockedReason(reason: string | undefined, language: UiLanguage) {
  if (!reason || language === 'en') return reason;
  if (reason.includes('Unsupported action')) return '\u8bbe\u5907\u4e0d\u652f\u6301\u8be5\u52a8\u4f5c\u3002';
  if (reason.includes('Forbidden zone') || reason.includes('forbidden')) return '\u547d\u4ee4\u89e6\u53d1\u4e86\u7981\u6b62\u533a\u89c4\u5219\u3002';
  if (reason.includes('outside workspace')) return '\u76ee\u6807\u8d85\u51fa\u8bbe\u5907\u5de5\u4f5c\u7a7a\u95f4\u3002';
  if (reason.includes('throw')) return '\u5b89\u5168\u7b56\u7565\u4e0d\u5141\u8bb8\u629b\u63b7\u52a8\u4f5c\u3002';
  if (reason.includes('speed')) return '\u901f\u5ea6\u8d85\u51fa\u5f53\u524d\u8bbe\u5907\u6863\u6848\u9650\u5236\u3002';
  if (reason.includes('force')) return '\u529b\u5ea6\u8d85\u51fa\u5f53\u524d\u8bbe\u5907\u6863\u6848\u9650\u5236\u3002';
  return reason;
}

export function VirtualDeviceStage({
  language,
  profile,
  report,
  replaySnapshot,
  currentActionFrame,
  scenarioPreview,
  workspaceDevices,
  selectedWorkspaceDeviceId,
  runTargetWorkspaceDeviceId,
  expanded,
  running,
  onExpandedChange,
  onDropDevice,
  onDropAsset,
  onSelectWorkspaceDevice,
  onMoveWorkspaceDevice
}: {
  language: UiLanguage;
  profile: DeviceProfile;
  report: LabReport | null;
  replaySnapshot: TimelineStateSnapshot | null;
  currentActionFrame?: ActionFrame | null;
  scenarioPreview?: { target: [number, number, number]; path: [[number, number, number], [number, number, number]]; unsafe: boolean; passed?: boolean } | null;
  workspaceDevices: SemanticWorkspaceDevice[];
  selectedWorkspaceDeviceId: string | null;
  runTargetWorkspaceDeviceId?: string | null;
  expanded?: boolean;
  running: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onDropDevice: (deviceType: DeviceType) => void;
  onDropAsset?: (assetId: string) => void;
  onSelectWorkspaceDevice: (deviceId: string) => void;
  onMoveWorkspaceDevice?: (deviceId: string, position: [number, number, number]) => void;
}) {
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const fidelity = getSimulatorFidelity(profile.deviceMeta);
  const compactSingleDeviceView = workspaceDevices.length <= 1 && !dropzoneActive && !running && !report;
  const replayState = {
    ...(replaySnapshot?.device_state ?? report?.device_state_after ?? profile.deviceMeta.runtime_state),
    ...(currentActionFrame?.device_state ?? replaySnapshot?.action_frame?.device_state ?? {}),
    visual_state: currentActionFrame?.visual_state ?? replaySnapshot?.action_frame?.visual_state
  };
  const blocked = replaySnapshot?.safety_status === 'blocked' || report?.result === 'blocked';
  const blockedReason = replaySnapshot?.safety_report.blocked_reasons[0] ?? report?.safety_report.blocked_reasons[0];
  const selectedWorkspaceDevice = workspaceDevices.find((device) => device.id === selectedWorkspaceDeviceId) ?? workspaceDevices[0];
  const displayName = selectedWorkspaceDevice ? localizeDisplayName(language, selectedWorkspaceDevice.label) : localizeDeviceType(language, profile.deviceMeta.device_type);
  const displayType = localizeDeviceType(language, selectedWorkspaceDevice?.deviceType ?? profile.deviceMeta.device_type);

  return (
    <main
      className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden border-r border-border-panel bg-bg-workspace"
      onDragEnter={(event) => {
        event.preventDefault();
        setDropzoneActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDropzoneActive(true);
      }}
      onDragLeave={() => setDropzoneActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropzoneActive(false);
        const droppedAsset = event.dataTransfer.getData('application/open-reality-asset-id');
        if (droppedAsset && onDropAsset) {
          onDropAsset(droppedAsset);
          return;
        }
        const droppedType = event.dataTransfer.getData('application/open-reality-device-type') as DeviceType;
        if (droppedType) onDropDevice(droppedType);
      }}
    >
      <div className="relative min-h-0 flex-1">
        <SemanticDeviceStage
          deviceType={profile.deviceMeta.device_type}
          state={replayState}
          blocked={blocked}
          language={language}
          blockedReason={localBlockedReason(blockedReason, language)}
          selectedSnapshot={replaySnapshot}
          currentActionFrame={currentActionFrame ?? replaySnapshot?.action_frame}
          scenarioPreview={scenarioPreview}
          workspaceDevices={workspaceDevices}
          selectedWorkspaceDeviceId={selectedWorkspaceDeviceId ?? undefined}
          runTargetWorkspaceDeviceId={runTargetWorkspaceDeviceId ?? undefined}
          dropzoneActive={dropzoneActive}
          onSelectWorkspaceDevice={onSelectWorkspaceDevice}
          onMoveWorkspaceDevice={onMoveWorkspaceDevice}
        />
        {!compactSingleDeviceView && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-[3px] border border-white/5 bg-black/28 px-2 py-1 text-[10px] leading-4 text-[#9AA3AF] backdrop-blur-md">
            <span className="font-semibold text-[#E6EAF0]">{language === 'zh' ? '\u5de5\u4f5c\u533a' : 'Workspace'}</span>
            <span className="mx-2 text-[#4B5563]">|</span>
            <span>{t(language, 'workspace_drop_hint')}</span>
          </div>
        )}
        {compactSingleDeviceView && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[3px] border border-white/5 bg-black/26 px-2.5 py-1 text-[10px] leading-4 text-[#9AA3AF] backdrop-blur-md">
            <div>{t(language, 'workspace_drop_hint')}</div>
            <div className="text-[#7E8791]">{t(language, 'workspace_drag_hint')}</div>
          </div>
        )}
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-[3px] border border-white/5 bg-black/24 px-2 py-1 text-[9px] leading-4 text-[#A7B0BA] backdrop-blur-md">
          <span className="font-semibold text-[#E6EAF0]">{t(language, 'active_workspace_device')}</span>
          <span className="mx-1 text-[#4B5563]">-&gt;</span>
          <span>{displayName}</span>
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="font-semibold text-[#E6EAF0]">{t(language, 'current_run_target')}</span>
          <span className="mx-1 text-[#4B5563]">-&gt;</span>
          <span>{displayName}</span>
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="font-semibold text-[#E6EAF0]">{t(language, 'workspace_observe_here')}</span>
        </div>
        {!compactSingleDeviceView && (
          <div className="pointer-events-none absolute right-3 top-12 min-w-[210px] max-w-[280px] rounded-[3px] border border-white/5 bg-black/32 px-2 py-1 text-[10px] leading-4 text-[#A7B0BA] backdrop-blur-md">
            <div>
              <span className="font-semibold text-[#E6EAF0]">{t(language, 'active_workspace_device')}</span>: {displayName}
            </div>
            <div className="mt-0.5 text-[#7E8791]">{t(language, 'workspace_drag_snap_precision')}</div>
            {scenarioPreview && !running && (
              <div className="mt-0.5 text-[#7E8791]">{t(language, 'workspace_preview_hint')}</div>
            )}
            <div className="mt-1 inline-flex rounded-[3px] border border-[#313338] bg-[#101114]/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9AA3AF]">
              {running ? t(language, 'running') : t(language, 'command_ready')}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => onExpandedChange?.(!expanded)}
          className="pointer-events-auto absolute right-3 top-3 rounded-[3px] border border-white/10 bg-black/45 px-2 py-1 text-[10px] font-semibold text-[#DDE6EF] backdrop-blur-md hover:bg-black/60"
        >
          {expanded
            ? (language === 'zh' ? '还原工作区' : 'Restore workspace')
            : (language === 'zh' ? '放大工作区' : 'Expand workspace')}
        </button>
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[360px] rounded-[3px] border border-white/5 bg-black/35 px-2 py-1 font-mono text-[10px] leading-4 text-[#8A8F98] opacity-75 backdrop-blur-md">
          <span className="text-[#E6EAF0]">{t(language, 'device')}</span>: {displayName}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'device_type')}</span>: {displayType}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'adapter')}</span>: {t(language, 'simulator_adapter_short')}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'fidelity')}</span>: {localizeFidelity(language, fidelity.level)}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'simulation_only')}</span>
        </div>
        {!compactSingleDeviceView && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-[3px] border border-white/5 bg-black/35 px-2 py-1 text-[9px] leading-4 text-[#8A8F98] opacity-80 backdrop-blur-md">
            <div>{t(language, 'workspace_legend_layout')}</div>
            <div>{t(language, 'workspace_legend_run')}</div>
          </div>
        )}
      </div>
    </main>
  );
}

