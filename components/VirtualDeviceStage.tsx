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
import { StageErrorBoundary } from './StageErrorBoundary';
import type { UiLanguage } from './LabConfigurator';
import type { RealHardwareTelemetry } from '@/types/realHardwareTelemetry';

// Structured reason codes first (safety layers emit `code:detail` strings);
// keyword matching only as a legacy fallback. Unknown codes fall through to
// the raw reason - untranslated beats mistranslated (UI audit D3).
const BLOCKED_REASON_CODES_ZH: Array<[string, string]> = [
  ['sensor_missing', '\u5b89\u5168\u4f20\u611f\u5668\u65e0\u6570\u636e\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['sensor_stale', '\u4f20\u611f\u5668\u8bfb\u6570\u8fc7\u671f\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['sensor_invalid', '\u4f20\u611f\u5668\u8bfb\u6570\u8d85\u51fa\u7269\u7406\u5408\u7406\u8303\u56f4\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['sensor_frozen', '\u4f20\u611f\u5668\u8bfb\u6570\u7591\u4f3c\u51bb\u7ed3\uff0c\u9ed8\u8ba4\u62e6\u622a\uff08\u9700\u663e\u5f0f\u590d\u4f4d\uff09\u3002'],
  ['sensor_type_mismatch', '\u4f20\u611f\u5668\u7c7b\u578b/\u5355\u4f4d\u4e0e\u5b89\u5168\u58f0\u660e\u4e0d\u7b26\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['sensor_timestamp', '\u4f20\u611f\u5668\u65f6\u95f4\u6233\u975e\u6cd5\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['device_timestamp', '\u7f3a\u5c11\u6216\u975e\u6cd5\u7684\u8bbe\u5907\u4fa7\u65f6\u95f4\u6233\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['interlock_distance', '\u8ddd\u79bb\u4e92\u9501\u89e6\u53d1\uff1a\u76ee\u6807\u8fc7\u8fd1\u3002'],
  ['invalid_interlock_override', '\u4e92\u9501\u8986\u76d6\u975e\u6cd5\uff08\u53ea\u5141\u8bb8\u6536\u7d27\uff09\u3002'],
  ['invalid_safety_clock', '\u5b89\u5168\u65f6\u949f\u975e\u6cd5\uff0c\u9ed8\u8ba4\u62e6\u622a\u3002'],
  ['actuation_requires_gate', '\u6267\u884c\u547d\u4ee4\u53ea\u80fd\u7ecf\u5b89\u5168\u95e8\u4e0b\u53d1\u3002'],
  ['unsupported_capability', '\u8bbe\u5907\u4e0d\u652f\u6301\u8be5\u80fd\u529b\u3002']
];

function localBlockedReason(reason: string | undefined, language: UiLanguage) {
  if (!reason || language === 'en') return reason;
  for (const [prefix, label] of BLOCKED_REASON_CODES_ZH) {
    if (reason.startsWith(prefix)) return `${label}\uff08${reason}\uff09`;
  }
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
  realHardwareTelemetry,
  workspaceDevices,
  selectedWorkspaceDeviceId,
  runTargetWorkspaceDeviceId,
  expanded,
  running,
  onExpandedChange,
  onDropDevice,
  onDropAsset,
  onSelectWorkspaceDevice,
  onMoveWorkspaceDevice,
  onRemoveSelectedDevice,
  onForbiddenZonesChange
}: {
  language: UiLanguage;
  profile: DeviceProfile;
  report: LabReport | null;
  replaySnapshot: TimelineStateSnapshot | null;
  currentActionFrame?: ActionFrame | null;
  scenarioPreview?: { target: [number, number, number]; path: [[number, number, number], [number, number, number]]; unsafe: boolean; passed?: boolean } | null;
  realHardwareTelemetry?: RealHardwareTelemetry;
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
  onRemoveSelectedDevice?: () => void;
  onForbiddenZonesChange?: (zones: string[]) => void;
}) {
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [forbiddenZoneEditing, setForbiddenZoneEditing] = useState(false);
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
        {/* Single top-left stack (UI audit A1/A3): each viewport corner owns
            exactly one overlay stack so absolutely-positioned layers can no
            longer collide. The badge text stays English in both locales - it
            is a safety stamp matching the Runtime Governor boundary label. */}
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[42%] flex-col items-start gap-1">
          <div className="rounded-[3px] border border-[#FACC15]/20 bg-black/30 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-status-warning/75 backdrop-blur-sm">
            {realHardwareTelemetry?.connected ? 'SIMULATION · REAL MIRROR SEPARATE' : 'SIMULATION · NO HARDWARE SIGNAL'}
          </div>
          {realHardwareTelemetry?.connected && (
            <div className="w-[min(280px,100%)] border-2 border-status-warning-edge bg-black/95 px-2 py-1.5 font-mono text-[10px] leading-4 text-status-warning [box-shadow:inset_0_0_0_1px_#FACC15]">
              <div className="flex items-center justify-between gap-2 border-b border-status-warning-edge pb-1 font-bold uppercase tracking-[0.14em]">
                <span>REAL</span>
                <span>{language === 'zh' ? '\u53ea\u8bfb\u56de\u663e\u5b6a\u751f\u4f53' : 'READ-ONLY DIGITAL TWIN'}</span>
              </div>
              <div className="mt-1 normal-case tracking-normal text-[#FDE68A]">
                {language === 'zh' ? '\u6700\u540e\u6307\u4ee4\u89d2\u5ea6\uff08\u5f00\u73af\uff0c\u672a\u5b9e\u6d4b\uff09' : 'Last command angle (open-loop, not measured)'}: {realHardwareTelemetry.lastCommandAngle === null ? '\u2014' : `${realHardwareTelemetry.lastCommandAngle.toFixed(1)}\u00b0`}
              </div>
              <div className="normal-case tracking-normal text-[#FDE68A]">
                {language === 'zh' ? '\u5b9e\u65f6\u8ddd\u79bb' : 'Live distance'}: {realHardwareTelemetry.distanceCm === null ? (language === 'zh' ? '\u5f53\u524d\u65e0\u8bfb\u6570' : 'no current reading') : `${realHardwareTelemetry.distanceCm.toFixed(1)} cm`}
              </div>
              <div className="mt-1 border-t border-status-warning-edge pt-1 normal-case tracking-normal text-[#FDE68A]">
                {language === 'zh'
                  ? '\u8fd9\u662f\u5df2\u8fde\u63a5\u7684\u53c2\u8003\u4f3a\u670d\u5668\u56de\u663e\uff0c\u4e0d\u4f1a\u81ea\u52a8\u5bf9\u5e94\u5de6\u4fa7\u4efb\u610f\u4eff\u771f\u6a21\u578b\u3002'
                  : 'Connected reference-servo mirror; it does not automatically map to the selected simulation model.'}
              </div>
            </div>
          )}
          {!compactSingleDeviceView && (
            <div className="max-w-full truncate rounded-[3px] border border-white/5 bg-black/28 px-2 py-1 text-[11px] leading-4 text-[#9AA3AF] backdrop-blur-md" title={t(language, 'workspace_drop_hint')}>
              <span className="font-semibold text-[#E6EAF0]">{language === 'zh' ? '\u5de5\u4f5c\u533a' : 'Workspace'}</span>
              <span className="mx-2 text-[#4B5563]">|</span>
              <span>{t(language, 'workspace_drop_hint')}</span>
            </div>
          )}
        </div>
        <StageErrorBoundary language={language}>
        <SemanticDeviceStage
          deviceType={profile.deviceMeta.device_type}
          state={replayState}
          blocked={blocked}
          language={language}
          blockedReason={localBlockedReason(blockedReason, language)}
          selectedSnapshot={replaySnapshot}
          currentActionFrame={currentActionFrame ?? replaySnapshot?.action_frame}
          scenarioPreview={scenarioPreview}
          realHardwareTelemetry={realHardwareTelemetry}
          workspaceDevices={workspaceDevices}
          selectedWorkspaceDeviceId={selectedWorkspaceDeviceId ?? undefined}
          runTargetWorkspaceDeviceId={runTargetWorkspaceDeviceId ?? undefined}
          dropzoneActive={dropzoneActive}
          onSelectWorkspaceDevice={onSelectWorkspaceDevice}
          onMoveWorkspaceDevice={onMoveWorkspaceDevice}
          forbiddenZones={profile.deviceMeta.constraints.forbidden_zones}
          knownTargets={profile.deviceMeta.constraints.known_targets ?? []}
          forbiddenZoneEditing={forbiddenZoneEditing}
          onToggleForbiddenZone={(zoneId) => {
            const zones = profile.deviceMeta.constraints.forbidden_zones;
            onForbiddenZonesChange?.(zones.includes(zoneId) ? zones.filter((zone) => zone !== zoneId) : [...zones, zoneId]);
          }}
        />
        </StageErrorBoundary>
        {workspaceDevices.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="border border-dashed border-[#4B5563] bg-black/45 px-5 py-4 text-center backdrop-blur-sm">
              <div className="text-[14px] font-semibold text-[#E6EAF0]">
                {language === 'zh' ? '工作区是空的' : 'The workspace is empty'}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[#9AA3AF]">
                {language === 'zh'
                  ? '从左侧资产库拖入一个设备，或直接点击资产卡片添加。'
                  : 'Drag a device in from the asset library on the left, or click an asset card to add one.'}
              </div>
            </div>
          </div>
        )}
        {/* Consolidated focus panel (UI audit A1/A2/B4): the former centered
            strip duplicated the device name and collided with this panel below
            ~1500px viewport width. Solid panel styling so it does not read as
            a stuck tooltip. */}
        {!compactSingleDeviceView && (
          <div className="pointer-events-none absolute right-3 top-12 z-20 min-w-[210px] max-w-[280px] rounded-[3px] border border-border-panel bg-[#15171A]/95 px-2 py-1.5 text-[11px] leading-4 text-[#A7B0BA]">
            <div className="truncate" title={displayName}>
              <span className="font-semibold text-[#E6EAF0]">{t(language, 'active_workspace_device')}</span>: {displayName}
            </div>
            <div className="mt-0.5 text-[#7E8791]">{t(language, 'current_run_target')} · {t(language, 'workspace_observe_here')}</div>
            <div className="mt-0.5 text-[#7E8791]">{t(language, 'workspace_drag_snap_precision')}</div>
            {scenarioPreview && !running && (
              <div className="mt-0.5 text-[#7E8791]">{t(language, 'workspace_preview_hint')}</div>
            )}
            <div className="mt-1 inline-flex rounded-[3px] border border-[#313338] bg-[#101114]/70 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#9AA3AF]">
              {running ? t(language, 'running') : t(language, 'command_ready')}
            </div>
          </div>
        )}
        <details className="pointer-events-auto absolute right-3 top-3 z-20 w-[150px] border border-border-strong bg-black/70 text-[11px] text-text-primary backdrop-blur-md">
          <summary className="cursor-pointer select-none px-2 py-1.5 font-semibold">
            {language === 'zh' ? '工作区工具' : 'Workspace tools'}
          </summary>
          <div className="grid gap-1 border-t border-border-panel p-1.5">
            <button
              type="button"
              onClick={() => setForbiddenZoneEditing((value) => !value)}
              disabled={!selectedWorkspaceDevice || !onForbiddenZonesChange}
              className={`border px-2 py-1 text-left font-semibold ${forbiddenZoneEditing ? 'border-danger bg-status-blocked-surface text-status-blocked-soft' : 'border-border-strong bg-black/45 text-text-primary'} disabled:opacity-40`}
            >
              {forbiddenZoneEditing ? (language === 'zh' ? '完成禁区编辑' : 'Finish zone edit') : (language === 'zh' ? '编辑禁区' : 'Edit forbidden zones')}
            </button>
            {onRemoveSelectedDevice && selectedWorkspaceDevice && (
              <button
                type="button"
                onClick={onRemoveSelectedDevice}
                title={language === 'zh' ? `移除当前仿真模型：${displayName}` : `Remove selected simulation model: ${displayName}`}
                className="rounded-[3px] border border-status-blocked-edge bg-black/45 px-2 py-1 text-left font-semibold text-status-blocked-soft hover:bg-status-blocked-surface"
              >
                {language === 'zh' ? '移除仿真模型' : 'Remove model'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onExpandedChange?.(!expanded)}
              className="rounded-[3px] border border-white/10 bg-black/45 px-2 py-1 text-left font-semibold text-[#DDE6EF] hover:bg-black/60"
            >
              {expanded
                ? (language === 'zh' ? '还原工作区' : 'Restore workspace')
                : (language === 'zh' ? '放大工作区' : 'Expand workspace')}
            </button>
          </div>
        </details>
        {forbiddenZoneEditing && (
          <div className="pointer-events-auto absolute right-3 top-14 z-20 w-[280px] border border-danger bg-status-blocked-surface/95 p-2 text-[12px] text-text-primary">
            <div className="font-semibold text-status-blocked-soft">{language === 'zh' ? '禁区可视化编辑' : 'Forbidden-zone visual editor'}</div>
            <div className="mt-1 text-text-secondary">{language === 'zh' ? '点击 3D 圆形区域，或使用下方开关。修改会使既有验证结果失效。' : 'Click a 3D zone marker or use the toggles below. Changes invalidate prior validation.'}</div>
            <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {Array.from(new Set([...(profile.deviceMeta.constraints.known_targets ?? []), ...profile.deviceMeta.constraints.forbidden_zones])).map((zone) => {
                const forbidden = profile.deviceMeta.constraints.forbidden_zones.includes(zone);
                return <button key={zone} type="button" onClick={() => onForbiddenZonesChange?.(forbidden ? profile.deviceMeta.constraints.forbidden_zones.filter((item) => item !== zone) : [...profile.deviceMeta.constraints.forbidden_zones, zone])} className={`border px-2 py-1 font-mono text-[11px] ${forbidden ? 'border-danger text-status-blocked-soft' : 'border-border text-text-secondary'}`}>{forbidden ? '×' : '+'} {zone}</button>;
              })}
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[360px] rounded-[3px] border border-white/5 bg-black/35 px-2 py-1 font-mono text-[11px] leading-4 text-[#8A8F98] opacity-75 backdrop-blur-md">
          <span className="text-[#E6EAF0]">{t(language, 'device')}</span>: {displayName}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'device_type')}</span>: {displayType}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'adapter')}</span>: {t(language, 'simulator_adapter_short')}
          <span className="mx-2 text-[#4B5563]">|</span>
          <span className="text-[#E6EAF0]">{t(language, 'fidelity')}</span>: {localizeFidelity(language, fidelity.level)}
        </div>
        {!compactSingleDeviceView && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-[3px] border border-white/5 bg-black/35 px-2 py-1 text-[11px] leading-4 text-[#8A8F98] opacity-80 backdrop-blur-md">
            <div>{t(language, 'workspace_legend_layout')}</div>
            <div>{t(language, 'workspace_legend_run')}</div>
          </div>
        )}
      </div>
    </main>
  );
}
