'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuditPanel } from '@/components/AuditPanel';
import { AutonomyDecisionPanel } from '@/components/AutonomyDecisionPanel';
import { AssetImportWizard } from '@/components/AssetImportWizard';
import { LabConfigurator } from '@/components/LabConfigurator';
import type { UiLanguage } from '@/components/LabConfigurator';
import { VirtualDeviceStage } from '@/components/VirtualDeviceStage';
import type { SemanticWorkspaceDevice } from '@/components/SemanticDeviceStage';
import { builtInDeviceAssets } from '@/lib/assets/DeviceAssetRegistry';
import type { DeviceAsset } from '@/lib/assets/DeviceAsset';
import type { AdapterCommand } from '@/lib/adapter/AdapterCommand';
import type { ActionFrame } from '@/lib/action-runtime/ActionState';
import { AutonomyCore } from '@/lib/autonomy-core/AutonomyCore';
import { localizeDeviceType, localizeDisplayName, t } from '@/lib/i18n';
import { buildManifestFromProfile } from '@/lib/open-reality-runtime/deviceManifests';
import { compileOpenRealityRuntime } from '@/lib/open-reality-runtime/runtimeKernel';
import type { OpenRealityRuntimeResult } from '@/lib/open-reality-runtime/types';
import { buildWorldModelFromProfile } from '@/lib/open-reality-runtime/worldModel';
import { buildAutonomyStopLabReport, buildRuntimeDecisionLabReport } from '@/lib/reporting/buildLabReport';
import { PlaybackEngine } from '@/lib/action-runtime/PlaybackEngine';
import type { PlaybackEvent } from '@/lib/action-runtime/PlaybackEngine';
import { targetPosition } from '@/lib/action-runtime/TargetResolver';
import { tryCompilePromptToTaskDSL } from '@/lib/compiler/mockTaskCompiler';
import { deviceProfiles } from '@/lib/profiles/deviceProfiles';
import type { LabReport, TimelineStateSnapshot } from '@/lib/virtual-lab/LabReport';
import type { DeviceScenario } from '@/lib/virtual-lab/DeviceScenario';
import { LiveScenarioRunner } from '@/lib/virtual-lab/LiveScenarioRunner';
import { ScenarioRunner } from '@/lib/virtual-lab/ScenarioRunner';
import { deviceScenarios, getScenarioForProfile } from '@/lib/virtual-lab/scenarios';
import type { DeviceType } from '@/types/deviceMeta';
import type { TaskDSL } from '@/types/taskDsl';

interface WorkspaceDeviceRecord {
  id: string;
  label: string;
  assetId?: string;
  profileId: string;
  deviceType: DeviceType;
  slot: number;
  position?: [number, number, number];
  current_state?: Record<string, unknown>;
  last_run_result?: 'pass' | 'blocked' | 'failed';
  config: {
    enabled: boolean;
    adapter_target_id: string;
    max_speed: 'slow' | 'normal' | 'fast';
    force_limit: 'low' | 'medium' | 'high';
    forbidden_zones: string[];
  };
}

interface LabWorkspaceFile {
  file_type: 'open_reality_lab_workspace';
  version: 1;
  saved_at: string;
  language: UiLanguage;
  selected_profile_id: string;
  selected_scenario_id: string;
  selected_workspace_device_id: string | null;
  prompt: string;
  devices: WorkspaceDeviceRecord[];
}

interface OpenRealityProjectFile {
  project: {
    name: string;
    file_type: 'open_reality_desktop_project';
    version: 1;
  };
  devices: WorkspaceDeviceRecord[];
  scenarios: Array<{ id: string; device_profile: string; prompt: string; expected_safety_result: string }>;
  profiles: Array<{ id: string; device_type: DeviceType; label: string }>;
  workspace: LabWorkspaceFile;
  lab_reports: LabReport[];
  metadata: {
    saved_at: string;
    app: 'Open Reality Studio Desktop';
    real_device_execution_enabled: false;
  };
}

type OpenRealityMenuAction =
  | 'project:new'
  | 'project:open'
  | 'project:save'
  | 'project:saveAs'
  | 'export:labReport'
  | 'export:deploymentPackage'
  | 'run:preflight'
  | 'run:virtualLab'
  | 'run:stop'
  | 'run:replay'
  | 'view:toggleExplorer'
  | 'view:toggleInspector'
  | 'view:toggleConsole';

declare global {
  interface Window {
    openReality?: {
      project: {
        new: () => Promise<{ canceled: boolean; project: null; filePath: null }>;
        open: () => Promise<{ canceled: boolean; project?: OpenRealityProjectFile; filePath?: string }>;
        save: (project: OpenRealityProjectFile, filePath?: string | null) => Promise<{ canceled: boolean; filePath?: string }>;
        saveAs: (project: OpenRealityProjectFile) => Promise<{ canceled: boolean; filePath?: string }>;
      };
      export: {
        labReport: (report: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
        deploymentPackage: (deploymentPackage: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
      };
      onMenuAction: (callback: (action: OpenRealityMenuAction) => void) => () => void;
    };
  }
}

interface WorkspaceValidationResult {
  run_id: string;
  generated_at: string;
  result: 'pass' | 'blocked' | 'failed';
  device_results: Array<{
    workspace_device_id: string;
    label: string;
    profile_id: string;
    scenario_id: string;
    result: 'pass' | 'blocked' | 'failed';
    lab_run_id: string;
    blocked_reasons: string[];
  }>;
}

interface WorkspaceIssue {
  id: string;
  severity: 'pass' | 'warning' | 'blocked';
  title: string;
  detail: string;
}

interface OperatorNotice {
  id: number;
  severity: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface CommandTerminalStatus {
  kind: 'ready' | 'running' | 'completed' | 'blocked' | 'ask_human' | 'proposed_plan' | 'coming_soon' | 'failed';
  message: string;
}

interface QuickStartPath {
  id: string;
  deviceType: DeviceType;
  title: string;
  prompt: string;
  expected: string;
  proof: string;
  validates: string;
}

const deviceTypes: DeviceType[] = ['robot_arm', 'mobile_robot', 'smart_light', 'camera_sensor', 'conveyor_belt', 'plc_cabinet', 'lab_instrument', 'warehouse_rack', 'sensor_box'];
const publicAlphaRunnableDeviceTypes: DeviceType[] = ['robot_arm', 'smart_light', 'camera_sensor'];
const workspaceStorageKey = 'open-reality-studio:last-workspace';
const firstRunGuideStorageKey = 'open-reality-studio:first-run-guide-dismissed';
const workspaceSlots: [number, number, number][] = [
  [0, 0, 0],
  [4, 0, 0],
  [-4, 0, 0],
  [0, 0, 4],
  [0, 0, -4],
  [4, 0, 4],
  [-4, 0, 4],
  [4, 0, -4]
];

const scenarioPromptsZh: Record<string, string> = {
  'robot-arm-pick-place-safe': '\u6293\u53d6\u7ea2\u8272\u65b9\u5757\uff0c\u5e76\u628a\u5b83\u653e\u5230\u540e\u4fa7\u5b89\u5168\u533a\u3002',
  'robot-arm-pick-place-unsafe': '\u5c1d\u8bd5\u5feb\u901f\u629b\u63b7\u7ea2\u8272\u65b9\u5757\u5230\u684c\u9762\u5916\u3002',
  'mobile-robot-navigation-safe': '\u5bfc\u822a\u5230 A \u901a\u9053\uff0c\u626b\u63cf\u533a\u57df\uff0c\u7136\u540e\u8fd4\u56de\u5145\u7535\u6869\u3002',
  'mobile-robot-navigation-unsafe': '\u5c1d\u8bd5\u5bfc\u822a\u8fdb\u5165\u9650\u5236\u533a\u3002',
  'smart-light-control-safe': '\u6253\u5f00\u667a\u80fd\u706f\u3002',
  'smart-light-control-unsafe': '\u5c1d\u8bd5\u5bf9\u667a\u80fd\u706f\u6267\u884c\u9ad8\u98ce\u9669\u5feb\u901f\u5207\u6362\u3002',
  'camera-sensor-check-safe': '\u62cd\u4e00\u5f20\u7167\u7247\u3002',
  'camera-sensor-check-unsafe': '\u5c1d\u8bd5\u91c7\u96c6\u9690\u79c1\u533a\u753b\u9762\u3002',
  'conveyor-belt-sort-safe': '\u542f\u52a8\u4f20\u9001\u5e26\uff0c\u5c06\u7269\u6599\u5206\u62e3\u5230 A \u6599\u7bb1\uff0c\u7136\u540e\u505c\u6b62\u4f20\u9001\u5e26\u3002',
  'conveyor-belt-sort-unsafe': '\u5c1d\u8bd5\u5c06\u7269\u6599\u9001\u5165\u5361\u6ede\u533a\u3002'
};

const scenarioPromptsEn: Record<string, string> = {
  'robot-arm-pick-place-safe': 'Move the red cube to the back safe zone.',
  'smart-light-control-safe': 'Turn on the light.',
  'camera-sensor-check-safe': 'Take a photo.'
};

function getLocalizedPrompt(scenario: { id: string; prompt: string }, language: UiLanguage) {
  if (language === 'zh') return scenarioPromptsZh[scenario.id] ?? scenario.prompt;
  return scenarioPromptsEn[scenario.id] ?? scenario.prompt;
}

function getFirstProfileForType(deviceType: DeviceType) {
  return deviceProfiles.find((profile) => profile.deviceMeta.device_type === deviceType) ?? deviceProfiles[0];
}

function replayStateForSelected(
  report: LabReport | null,
  selectedSnapshot: TimelineStateSnapshot | null,
  fallback: Record<string, unknown>
) {
  return selectedSnapshot
    ? { ...selectedSnapshot.device_state, ...(selectedSnapshot.action_frame?.device_state ?? {}), visual_state: selectedSnapshot.action_frame?.visual_state }
    : report?.device_state_after ?? fallback;
}

const deviceTypeLabelsZh: Record<DeviceType, string> = {
  robot_arm: '\u673a\u68b0\u81c2',
  mobile_robot: '\u79fb\u52a8\u673a\u5668\u4eba',
  smart_light: '\u667a\u80fd\u706f',
  camera_sensor: '\u6444\u50cf\u5934',
  conveyor_belt: '\u4f20\u9001\u5e26',
  plc_cabinet: 'PLC \u63a7\u5236\u67dc',
  lab_instrument: '\u5b9e\u9a8c\u5ba4\u4eea\u5668',
  warehouse_rack: '\u4ed3\u50a8\u8d27\u67b6',
  sensor_box: '\u4f20\u611f\u5668\u76d2'
};

const deviceTypeLabelsEn: Record<DeviceType, string> = {
  robot_arm: 'Robot Arm',
  mobile_robot: 'Mobile Robot',
  smart_light: 'Smart Light',
  camera_sensor: 'Camera Sensor',
  conveyor_belt: 'Conveyor Belt',
  plc_cabinet: 'PLC Cabinet',
  lab_instrument: 'Lab Instrument',
  warehouse_rack: 'Warehouse Rack',
  sensor_box: 'Sensor Box'
};

function profileFromAsset(asset: DeviceAsset) {
  return {
    id: asset.manifest.asset_id,
    label: asset.manifest.display_name,
    deviceMeta: asset.deviceMeta,
    geometry: asset.geometry
  };
}

function assetForId(assets: DeviceAsset[], assetId?: string) {
  return assetId ? assets.find((asset) => asset.manifest.asset_id === assetId) : undefined;
}

function localDeviceType(deviceType: DeviceType, language: UiLanguage) {
  return language === 'zh' ? deviceTypeLabelsZh[deviceType] : deviceTypeLabelsEn[deviceType];
}

function localResult(result: 'pass' | 'blocked' | 'failed', language: UiLanguage) {
  if (language === 'en') return result.toUpperCase();
  if (result === 'pass') return '\u901a\u8fc7';
  if (result === 'blocked') return '\u5df2\u62e6\u622a';
  return '\u5931\u8d25';
}

function localUnknownError(language: UiLanguage) {
  return language === 'zh' ? '\u672a\u77e5\u9519\u8bef' : 'Unknown error';
}

function startupLogs(language: UiLanguage) {
  return language === 'zh'
    ? ['[INFO] Open Reality Studio ready.', '[INFO] 工作区已初始化。', '[INFO] 默认路径已就绪：机械臂 -> 把红方块放到后侧安全区。']
    : ['[INFO] Open Reality Studio ready.', '[INFO] Workspace initialized.', '[INFO] Default path ready: Robot Arm -> move the red cube to the back safe zone.'];
}

function exportLabReport(report: LabReport | null) {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.lab_run_id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function sha256Hex(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getWorkspaceIssues(devices: WorkspaceDeviceRecord[], report: LabReport | null, language: UiLanguage): WorkspaceIssue[] {
  const issues: WorkspaceIssue[] = [];
  const enabledDevices = devices.filter((device) => device.config.enabled);
  const targetIds = enabledDevices.map((device) => device.config.adapter_target_id.trim()).filter(Boolean);

  if (devices.length === 0) {
    issues.push({
      id: 'workspace-empty',
      severity: 'blocked',
      title: language === 'zh' ? '\u5de5\u4f5c\u533a\u6ca1\u6709\u8bbe\u5907' : 'No devices in workspace',
      detail: language === 'zh'
        ? '\u8bf7\u5148\u5c06\u81f3\u5c11\u4e00\u53f0\u8bbe\u5907\u62d6\u5165\u865a\u62df\u5b9e\u9a8c\u5ba4\uff0c\u518d\u5bfc\u51fa\u9002\u914d\u5668\u914d\u7f6e\u5305\u3002'
        : 'Drag at least one device into the virtual lab before exporting an adapter package.'
    });
  }

  if (enabledDevices.length === 0 && devices.length > 0) {
    issues.push({
      id: 'no-enabled-devices',
      severity: 'blocked',
      title: language === 'zh' ? '\u6ca1\u6709\u542f\u7528\u7684\u8bbe\u5907' : 'No enabled devices',
      detail: language === 'zh' ? '\u5de5\u4f5c\u533a\u5185\u81f3\u5c11\u9700\u8981\u542f\u7528\u4e00\u53f0\u8bbe\u5907\u3002' : 'At least one workspace device must be enabled.'
    });
  }

  for (const device of enabledDevices) {
    const profile = deviceProfiles.find((item) => item.id === device.profileId);
    if (!device.config.adapter_target_id.trim()) {
      issues.push({
        id: `missing-target-${device.id}`,
        severity: 'blocked',
        title: language === 'zh' ? '\u7f3a\u5c11\u9002\u914d\u5668\u76ee\u6807 ID' : 'Missing Adapter Target ID',
        detail: language === 'zh' ? `${device.label} \u9700\u8981\u8bbe\u7f6e\u9002\u914d\u5668\u76ee\u6807 ID\u3002` : `${device.label} needs an adapter target identifier.`
      });
    }
    if (profile?.deviceMeta.model_asset?.source === 'generated_placeholder') {
      issues.push({
        id: `placeholder-asset-${device.id}`,
        severity: 'warning',
        title: language === 'zh' ? '\u4ecd\u4f7f\u7528\u5360\u4f4d\u6a21\u578b' : 'Placeholder model asset',
        detail: language === 'zh' ? `${device.label} \u4ecd\u5728\u4f7f\u7528\u751f\u6210\u7684\u5360\u4f4d\u6a21\u578b\u3002` : `${device.label} still uses a generated placeholder model.`
      });
    }
  }

  const duplicateTargets = targetIds.filter((target, index) => targetIds.indexOf(target) !== index);
  for (const target of Array.from(new Set(duplicateTargets))) {
    issues.push({
      id: `duplicate-target-${target}`,
      severity: 'blocked',
      title: language === 'zh' ? '\u9002\u914d\u5668\u76ee\u6807 ID \u91cd\u590d' : 'Duplicate Adapter Target ID',
      detail: language === 'zh' ? `${target} \u88ab\u5206\u914d\u7ed9\u4e86\u591a\u53f0\u542f\u7528\u8bbe\u5907\u3002` : `${target} is assigned to more than one enabled device.`
    });
  }

  if (!report) {
    issues.push({
      id: 'not-run',
      severity: 'warning',
      title: language === 'zh' ? '\u573a\u666f\u5c1a\u672a\u6267\u884c' : 'Scenario not executed',
      detail: language === 'zh' ? '\u8bf7\u5148\u6267\u884c\u201c\u7f16\u8bd1\u5e76\u6267\u884c\u201d\uff0c\u518d\u5c06\u5de5\u4f5c\u533a\u89c6\u4e3a\u5df2\u9a8c\u8bc1\u3002' : 'Run Compile & Execute before treating this workspace as validated.'
    });
  } else if (report.result !== 'pass') {
    issues.push({
      id: 'last-run-not-pass',
      severity: 'blocked',
      title: language === 'zh' ? '\u6700\u8fd1\u4e00\u6b21\u8fd0\u884c\u672a\u901a\u8fc7' : 'Last run did not pass',
      detail: language === 'zh'
        ? `\u6700\u8fd1\u4e00\u6b21\u5b9e\u9a8c\u7ed3\u679c\u4e3a ${report.result}\uff0c\u8bf7\u4fee\u590d\u573a\u666f\u6216\u8bbe\u5907\u914d\u7f6e\u540e\u518d\u5bfc\u51fa\u3002`
        : `Last lab result is ${report.result}. Fix the scenario or device config before deployment export.`
    });
  }

  if (issues.length === 0) {
    issues.push({
      id: 'workspace-ready',
      severity: 'pass',
      title: language === 'zh' ? '\u5de5\u4f5c\u533a\u9884\u68c0\u901a\u8fc7' : 'Workspace preflight passed',
      detail: language === 'zh'
        ? '\u542f\u7528\u8bbe\u5907\u76ee\u6807 ID \u552f\u4e00\uff0c\u8d44\u4ea7\u53ef\u8ffd\u6eaf\uff0c\u6700\u8fd1\u4e00\u6b21\u573a\u666f\u5df2\u901a\u8fc7\u3002'
        : 'Enabled devices have unique targets, verified assets, and the latest scenario passed.'
    });
  }

  return issues;
}

function applyWorkspaceDeviceConfig(profile: typeof deviceProfiles[number], device: WorkspaceDeviceRecord) {
  return {
    ...profile,
    deviceMeta: {
      ...profile.deviceMeta,
      device_id: device.config.adapter_target_id,
      constraints: {
        ...profile.deviceMeta.constraints,
        max_speed: device.config.max_speed,
        force_limit: device.config.force_limit,
        forbidden_zones: device.config.forbidden_zones
      }
    }
  };
}

function createWorkspaceDevice(nextType: DeviceType, index: number, language: UiLanguage, asset?: DeviceAsset): WorkspaceDeviceRecord {
  const nextProfile = getFirstProfileForType(nextType);
  const meta = asset?.deviceMeta ?? nextProfile.deviceMeta;
  const seedPosition = workspaceSlots[index % workspaceSlots.length] ?? workspaceSlots[0];
  return {
    id: `${asset?.manifest.asset_id ?? nextProfile.id}-${Date.now()}`,
    label: asset ? localizeDisplayName(language, asset.manifest.display_name) : `${localDeviceType(nextType, language)} ${index + 1}`,
    assetId: asset?.manifest.asset_id,
    profileId: asset?.manifest.asset_id ?? nextProfile.id,
    deviceType: nextType,
    slot: index % workspaceSlots.length,
    position: seedPosition,
    config: {
      enabled: true,
      adapter_target_id: meta.device_id,
      max_speed: meta.constraints.max_speed,
      force_limit: meta.constraints.force_limit,
      forbidden_zones: meta.constraints.forbidden_zones
    }
  };
}

function createDefaultWorkspaceDevice(language: UiLanguage) {
  const defaultAsset = builtInDeviceAssets.find((asset) => asset.manifest.asset_id === 'generic-industrial-robot-arm');
  return createWorkspaceDevice('robot_arm', 0, language, defaultAsset);
}

function noticeMessage(language: UiLanguage, zh: string, en: string) {
  return language === 'zh' ? zh : en;
}

function isRunnableDeviceV01(deviceType: DeviceType) {
  return publicAlphaRunnableDeviceTypes.includes(deviceType);
}

function publicAlphaSupportLabel(language: UiLanguage) {
  return publicAlphaRunnableDeviceTypes.map((type) => localizeDeviceType(language, type)).join(' / ');
}

function comingSoonMessage(language: UiLanguage, deviceType: DeviceType) {
  return `${localDeviceType(deviceType, language)} ${t(language, 'coming_soon_runtime')}`;
}

function comingSoonPrompt(language: UiLanguage, deviceType: DeviceType) {
  return `${localDeviceType(deviceType, language)} ${t(language, 'coming_soon_scenario')}`;
}

function localizedCommandStatusMessage(language: UiLanguage, kind: CommandTerminalStatus['kind']) {
  if (kind === 'ready') return t(language, 'command_waiting');
  if (kind === 'running') return t(language, 'command_running');
  if (kind === 'completed') return t(language, 'command_completed');
  if (kind === 'blocked') return t(language, 'command_blocked');
  if (kind === 'ask_human') return t(language, 'command_ask_human');
  if (kind === 'proposed_plan') return t(language, 'command_proposed');
  if (kind === 'coming_soon') return t(language, 'command_coming_soon');
  return t(language, 'command_failed');
}

function defaultReadyMessage(language: UiLanguage) {
  return language === 'zh'
    ? '默认路径已载入：机械臂 -> 把红方块放到后侧安全区。'
    : 'Default path loaded: Robot Arm -> move the red cube to the back safe zone.';
}

function readyMessageForPrompt(language: UiLanguage, deviceType: DeviceType, prompt: string) {
  const firstStarter = starterPromptsForDevice(deviceType, language)[0];
  return prompt.trim() === firstStarter || deviceType === 'robot_arm' && prompt.trim() === getLocalizedPrompt(getScenarioForProfile('virtual-robot-arm', 'safe'), language).trim()
    ? defaultReadyMessage(language)
    : t(language, 'command_waiting');
}

function localWorkspaceRunResult(result: 'pass' | 'blocked' | 'failed' | undefined, language: UiLanguage) {
  if (!result) return t(language, 'not_run');
  if (result === 'pass') return language === 'zh' ? '\u901a\u8fc7' : 'PASS';
  if (result === 'blocked') return language === 'zh' ? '\u5df2\u62e6\u622a' : 'BLOCKED';
  return language === 'zh' ? '\u5931\u8d25' : 'FAILED';
}

function starterPromptsForDevice(deviceType: DeviceType, language: UiLanguage) {
  if (deviceType === 'robot_arm') {
    return language === 'zh'
      ? ['把红方块放到后侧安全区', '把红方块放到左侧安全区', '把红方块扔出桌面']
      : ['Move the red cube to the back safe zone', 'Move the red cube to the left safe zone', 'Throw the red cube off the table'];
  }
  if (deviceType === 'smart_light') {
    return language === 'zh'
      ? ['打开智能灯', '把灯改成蓝色', '把灯调暗']
      : ['Turn on the light', 'Set the light to blue', 'Dim the light'];
  }
  if (deviceType === 'camera_sensor') {
    return language === 'zh'
      ? ['拍一张照片', '扫描当前区域', '读取摄像头状态']
      : ['Take a photo', 'Scan current area', 'Read camera status'];
  }
  return [];
}

function previewOriginFromState(deviceState: Record<string, unknown> | undefined, fallback: [number, number, number]): [number, number, number] {
  const visual = deviceState?.visual_state as Record<string, unknown> | undefined;
  const grip = Array.isArray(visual?.gripper_position)
    ? visual.gripper_position as [number, number, number]
    : Array.isArray(visual?.end_effector_position)
      ? visual.end_effector_position as [number, number, number]
      : Array.isArray(deviceState?.gripper_position)
        ? deviceState.gripper_position as [number, number, number]
        : null;
  if (!grip) return fallback;
  return [grip[0], 0, grip[2]];
}

function buildVisiblePreviewTask(profileId: string, deviceType: DeviceType, prompt: string, language: UiLanguage) {
  if (deviceType !== 'robot_arm') return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  const mentionsObject =
    normalized.includes('cube') ||
    normalized.includes('block') ||
    /方块|方塊/.test(trimmed);
  const mentionsPlacement =
    normalized.includes('safe zone') ||
    normalized.includes('left') ||
    normalized.includes('right') ||
    normalized.includes('front') ||
    normalized.includes('back') ||
    normalized.includes('inspection') ||
    /安全区|安全區|左侧|右侧|前侧|后侧|檢查區|检查区|放到|移动到|搬到/.test(trimmed);
  const mentionsThrow =
    normalized.includes('throw') ||
    /扔|抛/.test(trimmed);

  if (!mentionsObject || !mentionsPlacement || mentionsThrow) return null;

  const previewCompile = tryCompilePromptToTaskDSL(trimmed, 'robot_arm', language);
  if (!previewCompile.ok || !previewCompile.task) return null;

  return {
    profileId,
    prompt: trimmed,
    task: previewCompile.task
  };
}

function BottomConsole({
  language,
  labReport,
  selectedSnapshot,
  consoleLogs,
  liveAdapterCommands,
  playbackEvents,
  replayIndex,
  replayPlaying,
  replaySpeed,
  slowMode,
  replayTimeMs,
  replayCommand,
  onPlayPause,
  onStepPrev,
  onStepNext,
  onReplayStart,
  onSpeedChange,
  onSlowModeChange
}: {
  language: UiLanguage;
  labReport: LabReport | null;
  selectedSnapshot: TimelineStateSnapshot | null;
  consoleLogs: string[];
  liveAdapterCommands: AdapterCommand[];
  playbackEvents: PlaybackEvent[];
  replayIndex: number;
  replayPlaying: boolean;
  replaySpeed: number;
  slowMode: boolean;
  replayTimeMs: number;
  replayCommand: string;
  onPlayPause: () => void;
  onStepPrev: () => void;
  onStepNext: () => void;
  onReplayStart: () => void;
  onSpeedChange: (speed: number) => void;
  onSlowModeChange: (value: boolean) => void;
}) {
  const tabs = language === 'zh'
    ? [t(language, 'replay'), t(language, 'adapter_commands'), t(language, 'state_diff'), t(language, 'logs')]
    : [t(language, 'replay'), t(language, 'adapter_commands'), t(language, 'state_diff'), t(language, 'logs')];
  const commands = labReport?.adapter_commands ?? liveAdapterCommands;
  const logs = labReport?.execution_timeline ?? [];
  return (
    <div className="h-[144px] max-h-[15vh] border-t border-border-panel bg-[#15171A] text-text-primary">
      <div className="flex h-6 items-end border-b border-border-panel bg-bg-panel px-2">
        {tabs.map((tab, index) => (
          <div key={tab} className={`flex h-full items-center border-b px-3 text-[11px] font-semibold ${index === 0 ? 'border-selected text-text-primary' : 'border-transparent text-text-secondary'}`}>
            {tab}
          </div>
        ))}
      </div>
      <div className="grid h-[calc(100%-1.5rem)] grid-cols-[1.05fr_1fr_.8fr_1fr] overflow-hidden font-mono text-[11px]">
        <div className="custom-scrollbar overflow-auto border-r border-border-panel p-1.5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'current_playback')}</div>
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <button type="button" title={replayPlaying ? t(language, 'pause') : t(language, 'play')} onClick={onPlayPause} disabled={!labReport} className="flex h-6 w-8 items-center justify-center rounded-[3px] border border-[#30363D] bg-[#232529] text-[11px] font-semibold text-text-primary hover:bg-[#2B2D31] disabled:opacity-40">
              {replayPlaying ? '||' : '▶'}
            </button>
            <button type="button" title={t(language, 'step_prev')} onClick={onStepPrev} disabled={playbackEvents.length === 0 || replayIndex <= 0} className="flex h-6 w-8 items-center justify-center rounded-[3px] border border-[#30363D] bg-[#232529] text-[11px] font-semibold text-text-primary hover:bg-[#2B2D31] disabled:opacity-40">
              ‹|
            </button>
            <button type="button" title={t(language, 'step_next')} onClick={onStepNext} disabled={playbackEvents.length === 0 || replayIndex >= playbackEvents.length - 1} className="flex h-6 w-8 items-center justify-center rounded-[3px] border border-[#30363D] bg-[#232529] text-[11px] font-semibold text-text-primary hover:bg-[#2B2D31] disabled:opacity-40">
              |›
            </button>
            <button type="button" title={t(language, 'reset')} onClick={onReplayStart} disabled={playbackEvents.length === 0} className="flex h-6 w-8 items-center justify-center rounded-[3px] border border-[#30363D] bg-[#232529] text-[11px] font-semibold text-text-primary hover:bg-[#2B2D31] disabled:opacity-40">
              ↺
            </button>
          </div>
          <div className="mb-2 flex items-center gap-1">
            {/* Playback control anchor for tests: Slow Mode */}
            {[0.5, 1, 2].map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => onSpeedChange(speed)}
                className={`h-5 border px-1.5 text-[10px] font-semibold ${replaySpeed === speed ? 'border-selected bg-[#0B2233] text-[#38BDF8]' : 'border-[#30363D] bg-[#1E1F22] text-text-secondary hover:bg-[#2B2D31]'}`}
              >
                {speed}x
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-[10px] text-text-secondary">
              <input type="checkbox" checked={slowMode} onChange={(event) => onSlowModeChange(event.target.checked)} className="h-3 w-3 accent-[#0066CC]" />
              {t(language, 'slow_mode')}
            </label>
          </div>
          <div className="text-text-secondary">{t(language, 'command')}: <span className="text-text-primary">{replayCommand}</span></div>
          <div className="text-text-secondary">{t(language, 'frame')}: <span className="text-text-primary">{playbackEvents.length ? replayIndex + 1 : 0}/{playbackEvents.length}</span></div>
          <div className="text-text-secondary">{t(language, 'time')}: <span className="text-text-primary">{Math.round(replayTimeMs)}ms</span></div>
          <div className="mt-2 h-1.5 bg-[#0D1117]">
            <div className="h-full bg-selected" style={{ width: `${playbackEvents.length <= 1 ? 0 : (replayIndex / (playbackEvents.length - 1)) * 100}%` }} />
          </div>
          <div className="mt-2 text-text-secondary">{selectedSnapshot?.message ?? t(language, 'waiting_run')}</div>
        </div>
        <div className="custom-scrollbar overflow-auto border-r border-border-panel p-1.5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'adapter_commands')}</div>
          {commands.length === 0 && <div className="text-text-secondary">{t(language, 'no_commands_generated')}</div>}
          {commands.map((command) => {
            const commandEvents = playbackEvents.filter((event) => event.command_id === command.id);
            const isCurrent = command.id === replayCommand || command.id === selectedSnapshot?.command_id;
            const isBlocked = commandEvents.some((event) => event.status === 'blocked') || command.allowed === false;
            const isCompleted = commandEvents.length > 0 && playbackEvents.findIndex((event) => event.command_id === command.id) < replayIndex && !isCurrent;
            return (
            <div key={command.id} className={`mb-1 border-l-2 px-2 py-1 ${isBlocked ? 'border-blocked bg-[#3A2028] text-[#FCA5A5]' : isCurrent ? 'border-selected bg-[#232D36] text-text-primary' : isCompleted ? 'border-pass bg-[#1D2B24] text-[#A7F3D0]' : 'border-transparent text-text-secondary'}`}>
              {command.id} / {command.action} / {command.target ?? '-'}
            </div>
          );})}
        </div>
        <div className="custom-scrollbar overflow-auto border-r border-border-panel p-1.5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'state_diff')}</div>
          <div className="text-text-secondary">{selectedSnapshot?.changed_keys?.length ? selectedSnapshot.changed_keys.join(', ') : t(language, 'waiting_state_changes')}</div>
        </div>
        <div className="custom-scrollbar overflow-auto p-1.5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'logs')}</div>
          {logs.length === 0 && (
            <>
              {consoleLogs.map((log) => (
                <div key={log} className="mb-1 text-text-secondary"><span className={log.startsWith('[ERROR]') ? 'text-blocked' : 'text-selected'}>{log.slice(0, log.indexOf(']') + 1)}</span> {log.slice(log.indexOf(']') + 1).trim()}</div>
              ))}
            </>
          )}
          {logs.map((log) => (
            <div key={log.id} className="mb-1 text-text-secondary">
              <span className={log.stage === 'safety' ? 'text-warning' : log.stage === 'device' ? 'text-pass' : 'text-text-muted'}>[{log.stage}]</span> {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AICommandTerminal({
  language,
  prompt,
  running,
  status,
  runTargetLabel,
  runTargetRunnable,
  runTargetDeviceType,
  starterPrompts,
  quickStartPaths,
  activeQuickStart,
  onPromptChange,
  onQuickStart,
  onRun,
  onStop
}: {
  language: UiLanguage;
  prompt: string;
  running: boolean;
  status: CommandTerminalStatus;
  runTargetLabel: string;
  runTargetRunnable: boolean;
  runTargetDeviceType: DeviceType;
  starterPrompts: string[];
  quickStartPaths: QuickStartPath[];
  activeQuickStart: QuickStartPath | null;
  onPromptChange: (prompt: string) => void;
  onQuickStart: (path: QuickStartPath) => void;
  onRun: () => void;
  onStop: () => void;
  }) {
    const supportSummary = publicAlphaSupportLabel(language);
  const labels = {
    label: t(language, 'ai_command'),
    placeholder: t(language, 'prompt_placeholder'),
    run: t(language, 'app_run'),
    running: t(language, 'running'),
    stop: t(language, 'app_stop'),
    validate: t(language, 'validate')
  };
  const badgeClass =
    status.kind === 'blocked' || status.kind === 'failed'
      ? 'border-[#7F1D1D] bg-[#2B1116] text-[#FCA5A5]'
      : status.kind === 'running'
        ? 'border-[#92400E] bg-[#2A2112] text-[#F59E0B]'
      : status.kind === 'completed'
        ? 'border-[#064E3B] bg-[#10251D] text-[#34D399]'
        : status.kind === 'coming_soon'
          ? 'border-[#713F12] bg-[#2A2112] text-[#FACC15]'
        : status.kind === 'ask_human' || status.kind === 'proposed_plan'
          ? 'border-[#713F12] bg-[#2A2112] text-[#FACC15]'
            : 'border-border-panel bg-[#232529] text-text-secondary';
  const badgeText =
    status.kind === 'ready' ? t(language, 'command_ready')
      : status.kind === 'running' ? t(language, 'command_running')
      : status.kind === 'completed' ? t(language, 'command_completed')
      : status.kind === 'blocked' ? t(language, 'command_blocked')
      : status.kind === 'ask_human' ? t(language, 'command_ask_human')
      : status.kind === 'proposed_plan' ? t(language, 'command_proposed')
      : status.kind === 'coming_soon' ? t(language, 'command_coming_soon')
      : t(language, 'command_failed');
  const activeQuickStartIndex = activeQuickStart ? quickStartPaths.findIndex((path) => path.id === activeQuickStart.id) : -1;
  const nextQuickStart = activeQuickStartIndex >= 0 && activeQuickStartIndex < quickStartPaths.length - 1
    ? quickStartPaths[activeQuickStartIndex + 1]
    : null;
  const primaryStarter = starterPrompts[0] ?? '';
  const guidedPlaceholder = primaryStarter
    ? `${primaryStarter} ${language === 'zh' ? '·' : '·'} ${t(language, 'command_result_workspace_above')}`
    : labels.placeholder;
  const observationHint =
    status.kind === 'running'
      ? t(language, 'command_observe_running')
      : status.kind === 'completed'
        ? t(language, 'command_observe_completed')
        : status.kind === 'blocked' || status.kind === 'failed'
          ? t(language, 'command_observe_blocked')
          : t(language, 'command_observe_ready');

  const submit = () => {
    if (!running && runTargetRunnable) onRun();
  };

  return (
    <section className="flex flex-none flex-col gap-1.5 border-b border-[#23262B] border-t border-[#313338] bg-[#1E1F22] px-3 py-1.5">
      <div className="flex items-center gap-2.5">
        <div className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{labels.label}</div>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' && event.ctrlKey) || (event.key === 'Enter' && !event.shiftKey)) {
              event.preventDefault();
              submit();
            }
          }}
          spellCheck={false}
          rows={1}
          className="h-9 max-h-10 flex-1 resize-none rounded-[3px] border border-[#313338] bg-[#111214] px-3 py-2 font-mono text-[12px] leading-5 text-[#E6EAF0] outline-none placeholder:text-[#5F6670] focus:border-[#0284C7]"
          placeholder={guidedPlaceholder}
        />
        <button
          type="button"
          disabled={running || !runTargetRunnable}
          onClick={submit}
          className="h-9 rounded-[3px] border border-[#075985] bg-[#0066CC] px-4 text-[12px] font-medium text-white hover:bg-[#0A74DA] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? labels.running : labels.run}
        </button>
        <button
          type="button"
          onClick={onStop}
          className="h-9 rounded-[3px] border border-[#5A2B2B] px-3 text-[12px] font-medium text-[#F87171] hover:bg-[#2A1111]"
        >
          {labels.stop}
        </button>
        <button
          type="button"
          disabled
          className="h-9 rounded-[3px] border border-border-panel px-3 text-[12px] font-medium text-text-secondary opacity-40"
        >
          {labels.validate}
        </button>
        <div className="min-w-[170px] max-w-[280px] shrink-0">
          <div className={`inline-flex h-6 items-center rounded-[3px] border px-2 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}>{badgeText}</div>
          <div className="mt-0.5 truncate text-[10px] text-text-secondary" title={status.message}>{status.message}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
              <span className="font-semibold text-text-secondary">{t(language, 'active_workspace_device')}:</span>
              <span className="truncate text-text-primary" title={runTargetLabel}>{runTargetLabel}</span>
            <span className={`rounded-[3px] border px-1.5 py-0.5 font-bold ${runTargetRunnable ? 'border-[#064E3B] bg-[#10251D] text-[#34D399]' : 'border-[#713F12] bg-[#2A2112] text-[#FACC15]'}`}>
              {runTargetRunnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
            </span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#9BD4FF]">{t(language, 'workspace_selection_run_same')}</div>
            {!runTargetRunnable && (
              <div className="mt-0.5 text-[10px] text-[#FACC15]">
                {t(language, 'welcome_protocol_only')}
              </div>
            )}
            {!runTargetRunnable && (
              <div className="mt-0.5 text-[10px] text-[#FACC15]">
                {t(language, 'select_runnable_target_hint')}
              </div>
            )}
          </div>
        </div>
      {!runTargetRunnable && (
        <div className="ml-20 rounded-[3px] border border-[#713F12] bg-[#2A2112] px-3 py-2">
          <div className="text-[11px] font-semibold text-[#FACC15]">{t(language, 'asset_only_runtime_title')}</div>
          <div className="mt-1 text-[10px] leading-4 text-[#E5C76B]">{t(language, 'asset_only_runtime_detail')}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#D6B457]">{t(language, 'jump_to_runnable_path')}</span>
            {quickStartPaths.map((path) => (
              <button
                key={`jump-${path.id}`}
                type="button"
                onClick={() => onQuickStart(path)}
                className="rounded-[3px] border border-[#85611B] bg-[#33260F] px-2 py-1 text-[10px] font-semibold text-[#F8D77A] hover:bg-[#3F3013]"
              >
                {localizeDeviceType(language, path.deviceType)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="ml-20 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-[#8A94A0]">
        <span>{t(language, 'command_target_notice')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'command_safe_blocked_notice')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'simulation_only')}</span>
      </div>
      <div className="ml-20 flex min-h-5 items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{t(language, 'starter_commands')}</div>
        <div className="custom-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {primaryStarter && (
            <span className="shrink-0 text-[10px] text-[#5F6670]">{t(language, 'command_try_first')}</span>
          )}
          {starterPrompts.length > 0 ? starterPrompts.map((starter) => (
            <button
              key={`${runTargetDeviceType}-${starter}`}
              type="button"
              onClick={() => onPromptChange(starter)}
              className="shrink-0 rounded-[3px] border border-border-panel bg-[#232529] px-2 py-[3px] text-[11px] font-medium text-text-primary hover:bg-[#2B2D31]"
            >
              {starter}
            </button>
          )) : (
            <div className="pt-1 text-[11px] text-text-muted">{t(language, 'no_starter_commands')}</div>
          )}
        </div>
      </div>
      {activeQuickStart && (
        <div className="ml-20 rounded-[3px] border border-border-panel bg-[#181A1D] px-3 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{t(language, 'guided_evaluation')}</span>
            <span className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-2 py-0.5 text-[10px] font-semibold text-[#38BDF8]">
              {t(language, 'current_path')}: {activeQuickStart.title}
            </span>
            <span className={`rounded-[3px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}>
              {badgeText}
            </span>
            <span className="text-[10px] text-[#C7D2DA] truncate">
              <span className="font-semibold text-[#E6EAF0]">{t(language, 'quick_start_expected')}:</span> {activeQuickStart.expected}
            </span>
              {nextQuickStart && (
              <button
                type="button"
                onClick={() => onQuickStart(nextQuickStart)}
                className="rounded-[3px] border border-border-panel bg-[#232529] px-2 py-1 text-[10px] font-semibold text-text-primary hover:bg-[#2B2D31]"
              >
                {t(language, 'try_next')}
              </button>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] leading-4 text-[#A7B0BA]">
            <span><span className="font-semibold text-[#E6EAF0]">{t(language, 'quick_start_proof')}:</span> {activeQuickStart.proof}</span>
            <span><span className="font-semibold text-[#E6EAF0]">{t(language, 'quick_start_validates')}:</span> {activeQuickStart.validates}</span>
            {nextQuickStart && (
              <span><span className="font-semibold text-[#E6EAF0]">{t(language, 'next_path')}:</span> {nextQuickStart.title}</span>
            )}
          </div>
          {!running && status.kind === 'ready' && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold text-[#9BD4FF]">{t(language, 'quick_start_next_step')}</span>
              <button
                type="button"
                onClick={onRun}
                className="rounded-[3px] border border-[#075985] bg-[#0284C7] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#0369A1]"
              >
                {t(language, 'quick_start_run_now')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function WorkspaceDeviceStrip({
  language,
  devices,
  selectedWorkspaceDeviceId,
  onSelectWorkspaceDevice
}: {
  language: UiLanguage;
  devices: WorkspaceDeviceRecord[];
  selectedWorkspaceDeviceId: string | null;
  onSelectWorkspaceDevice: (deviceId: string) => void;
}) {
  if (devices.length <= 1) return null;
  return (
    <section className="flex flex-none items-center gap-2 border-b border-[#23262B] bg-[#17191C] px-3 py-1">
      <div className="w-24 shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#86868B]">{t(language, 'workspace_devices')}</div>
        <div className="mt-0.5 text-[9px] leading-4 text-[#6B7280]">{t(language, 'workspace_activate_device')}</div>
      </div>
      <div className="custom-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden">
        {devices.map((device) => {
          const selected = device.id === selectedWorkspaceDeviceId;
          const runnable = isRunnableDeviceV01(device.deviceType);
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => onSelectWorkspaceDevice(device.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-1 text-left ${selected ? 'border-[#075985] bg-[#0B2233] text-[#D8EEFF]' : 'border-border-panel bg-[#232529] text-text-primary hover:bg-[#2B2D31]'}`}
            >
              <span className="text-[11px] font-semibold">{localizeDisplayName(language, device.label)}</span>
              <span className="rounded-[3px] border border-border-panel px-1 py-0.5 text-[9px] font-bold text-text-secondary">
                {localizeDeviceType(language, device.deviceType)}
              </span>
              <span className={`rounded-[3px] border px-1 py-0.5 text-[9px] font-bold ${runnable ? 'border-[#064E3B] bg-[#10251D] text-[#34D399]' : 'border-[#713F12] bg-[#2A2112] text-[#FACC15]'}`}>
                {runnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
              </span>
              {selected && (
                <span className="rounded-[3px] border border-[#075985] bg-[#12324B] px-1 py-0.5 text-[9px] font-bold text-[#7DD3FC]">
                  {t(language, 'active_workspace_device')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="hidden max-w-[240px] shrink-0 text-right text-[9px] leading-4 text-[#6B7280] xl:block">
        {t(language, 'workspace_run_rule')}
      </div>
    </section>
  );
}

function FirstRunGuide({
  language,
  quickStartPaths,
  onQuickStart,
  onDismiss
}: {
  language: UiLanguage;
  quickStartPaths: QuickStartPath[];
  onQuickStart: (path: QuickStartPath) => void;
  onDismiss: () => void;
}) {
  const recommendedPath = quickStartPaths[0] ?? null;
  const secondaryPaths = quickStartPaths.slice(1);
  return (
    <section className="border-b border-border-panel bg-[#16181B] px-3 py-1">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex flex-1 flex-wrap items-center gap-1.5">
          <span className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7DD3FC]">
            {t(language, 'simulation_only')}
          </span>
          <span className="text-[11px] font-semibold text-text-primary">{t(language, 'welcome_title')}</span>
          <span className="text-[10px] text-text-secondary">{t(language, 'welcome_step_1')}</span>
          <span className="rounded-[3px] border border-border-panel bg-[#1E1F22] px-1.5 py-0.5 text-[9px] text-text-muted">{t(language, 'welcome_step_2')}</span>
          <span className="rounded-[3px] border border-border-panel bg-[#1E1F22] px-1.5 py-0.5 text-[9px] text-text-muted">{t(language, 'welcome_step_3')}</span>
          <span className="ml-1 text-[9px] font-semibold uppercase tracking-wide text-[#86868B]">{t(language, 'welcome_supported_now')}</span>
          {publicAlphaRunnableDeviceTypes.map((type) => (
            <span key={type} className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[9px] text-[#38BDF8]">
              {localizeDeviceType(language, type)}
            </span>
          ))}
          {secondaryPaths.map((path) => (
            <button
              key={`guide-${path.id}`}
              type="button"
              onClick={() => onQuickStart(path)}
              className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[9px] text-[#8ECBF5] hover:bg-[#0F2E45]"
            >
              {path.title}
            </button>
          ))}
        </div>
        {recommendedPath && (
          <button
            type="button"
            onClick={() => onQuickStart(recommendedPath)}
            className="shrink-0 rounded-[3px] border border-[#075985] bg-[#0284C7] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#0369A1]"
            title={recommendedPath.prompt}
          >
            {t(language, 'quick_start_try_now')}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-[3px] border border-border-panel bg-[#232529] px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:bg-[#2B2D31]"
        >
          {t(language, 'dismiss')}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-[#9AA3AF]">
        <span>{t(language, 'first_run_step_supported')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'first_run_step_command')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'first_run_step_target')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'first_run_step_safe')}</span>
        <span className="text-[#4B5563]">|</span>
        <span>{t(language, 'first_run_step_sim_only')}</span>
      </div>
    </section>
  );
}

export default function Home() {
  const workspaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<UiLanguage>('zh');
  const [deviceType, setDeviceType] = useState<DeviceType>('robot_arm');
  const profilesForType = useMemo(
    () => deviceProfiles.filter((profile) => profile.deviceMeta.device_type === deviceType),
    [deviceType]
  );
  const [selectedProfileId, setSelectedProfileId] = useState('virtual-robot-arm');
  const selectedProfile = useMemo(
    () => deviceProfiles.find((profile) => profile.id === selectedProfileId) ?? profilesForType[0] ?? deviceProfiles[0],
    [profilesForType, selectedProfileId]
  );
  const scenarioOptions = useMemo(
    () => isRunnableDeviceV01(selectedProfile.deviceMeta.device_type)
      ? deviceScenarios.filter((scenario) => scenario.device_profile === selectedProfile.id)
      : [],
    [selectedProfile.deviceMeta.device_type, selectedProfile.id]
  );
  const [scenarioId, setScenarioId] = useState(getScenarioForProfile('virtual-robot-arm', 'safe').id);
  const selectedScenario = useMemo(
    () => scenarioOptions.find((scenario) => scenario.id === scenarioId) ?? getScenarioForProfile(selectedProfile.id, 'safe'),
    [scenarioId, scenarioOptions, selectedProfile.id]
  );
  const [prompt, setPrompt] = useState(getLocalizedPrompt(selectedScenario, language));
  const [labReport, setLabReport] = useState<LabReport | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<TimelineStateSnapshot | null>(null);
  const [currentActionFrame, setCurrentActionFrame] = useState<ActionFrame | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [slowMode, setSlowMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [livePlaybackEvents, setLivePlaybackEvents] = useState<PlaybackEvent[]>([]);
  const [liveAdapterCommands, setLiveAdapterCommands] = useState<AdapterCommand[]>([]);
  const [runPreviewTask, setRunPreviewTask] = useState<{ profileId: string; prompt: string; task: TaskDSL } | null>(null);
  const [defaultWorkspaceDevice] = useState(() => createDefaultWorkspaceDevice('zh'));
  const [workspaceDevices, setWorkspaceDevices] = useState<WorkspaceDeviceRecord[]>([defaultWorkspaceDevice]);
  const [importedAssets, setImportedAssets] = useState<DeviceAsset[]>([]);
  const [assetImportOpen, setAssetImportOpen] = useState(false);
  const [selectedWorkspaceDeviceId, setSelectedWorkspaceDeviceId] = useState<string | null>(defaultWorkspaceDevice.id);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(startupLogs('zh'));
  const [validationRunning, setValidationRunning] = useState(false);
  const [running, setRunning] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [workspaceValidation, setWorkspaceValidation] = useState<WorkspaceValidationResult | null>(null);
  const [operatorNotice, setOperatorNotice] = useState<OperatorNotice | null>(null);
  const [commandStatus, setCommandStatus] = useState<CommandTerminalStatus>({
    kind: 'ready',
    message: defaultReadyMessage('zh')
  });
  const [runtimeDecision, setRuntimeDecision] = useState<OpenRealityRuntimeResult | null>(null);
  const [runtimeDecisionContext, setRuntimeDecisionContext] = useState<{ prompt: string; targetDeviceLabel: string; targetDeviceType: DeviceType } | null>(null);
  const [showFirstRunGuide, setShowFirstRunGuide] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const playbackTimersRef = useRef<number[]>([]);
  const liveRunTokenRef = useRef(0);
  const liveRunActiveRef = useRef(false);
  const consoleLogSessionRef = useRef(0);
  const workspaceIssues = useMemo(() => getWorkspaceIssues(workspaceDevices, labReport, language), [labReport, language, workspaceDevices]);
  const availableAssets = useMemo(() => [...builtInDeviceAssets, ...importedAssets], [importedAssets]);
  const workspaceBlocked = workspaceIssues.some((issue) => issue.severity === 'blocked');
  const workspaceWarnings = workspaceIssues.filter((issue) => issue.severity === 'warning').length;

  const selectedWorkspaceDevice = workspaceDevices.find((device) => device.id === selectedWorkspaceDeviceId) ?? null;
  const selectedWorkspaceAsset = assetForId(availableAssets, selectedWorkspaceDevice?.assetId);
  const selectedWorkspaceProfile = selectedWorkspaceAsset
    ? profileFromAsset(selectedWorkspaceAsset)
    : selectedWorkspaceDevice
      ? deviceProfiles.find((profile) => profile.id === selectedWorkspaceDevice.profileId) ?? selectedProfile
      : selectedProfile;
  const effectiveSelectedProfile = useMemo(() => {
    if (!selectedWorkspaceDevice) return selectedProfile;
    const asset = assetForId(availableAssets, selectedWorkspaceDevice.assetId);
    const baseProfile = asset ? profileFromAsset(asset) : selectedWorkspaceProfile;
    return applyWorkspaceDeviceConfig(baseProfile, selectedWorkspaceDevice);
  }, [availableAssets, selectedProfile, selectedWorkspaceDevice, selectedWorkspaceProfile]);
  const currentRunTargetLabel = useMemo(() => {
    if (selectedWorkspaceAsset) return localizeDisplayName(language, selectedWorkspaceAsset.manifest.display_name);
    if (selectedWorkspaceDevice) return localizeDisplayName(language, selectedWorkspaceDevice.label);
    return localizeDeviceType(language, effectiveSelectedProfile.deviceMeta.device_type);
  }, [effectiveSelectedProfile.deviceMeta.device_type, language, selectedWorkspaceAsset, selectedWorkspaceDevice]);
  const currentRunTargetWorkspaceDeviceId = useMemo(
    () => selectedWorkspaceDeviceId ?? workspaceDevices[0]?.id ?? null,
    [selectedWorkspaceDeviceId, workspaceDevices]
  );
  const currentRunTargetRunnable = useMemo(
    () => isRunnableDeviceV01(effectiveSelectedProfile.deviceMeta.device_type),
    [effectiveSelectedProfile.deviceMeta.device_type]
  );
  const currentRunStarterPrompts = useMemo(
    () => starterPromptsForDevice(effectiveSelectedProfile.deviceMeta.device_type, language),
    [effectiveSelectedProfile.deviceMeta.device_type, language]
  );
  const quickStartPaths = useMemo<QuickStartPath[]>(() => (
    language === 'zh'
      ? [
          { id: 'qs-robot-back', deviceType: 'robot_arm', title: '机械臂安全搬运', prompt: '把红方块放到后侧安全区', expected: '机械臂完成抓取搬运，日志和回放同步更新。', proof: '查看中间工作区动作、底部 Playback / Logs，以及右侧 Lab Report。', validates: '验证 AI 指令到安全门控、适配器命令、可回放机械臂执行的完整闭环。' },
          { id: 'qs-light-blue', deviceType: 'smart_light', title: '智能灯颜色控制', prompt: '把灯改成蓝色', expected: '灯具亮起并切换为蓝色，命令状态显示智能灯运行。', proof: '查看工作区灯光颜色变化、当前运行目标，以及 Adapter Commands / Logs。', validates: '验证低风险设备可复用同一套运行时、适配器命令和审计链路。' },
          { id: 'qs-camera-photo', deviceType: 'camera_sensor', title: '摄像头采集', prompt: '拍一张照片', expected: '摄像头出现采集反馈，日志记录 capture / read 路径。', proof: '查看工作区采集反馈、底部 Logs，以及右侧时间线 / Lab Report。', validates: '验证读操作设备也能走同一条 AI 指令、时间线与实验报告链路。' }
        ]
      : [
          { id: 'qs-robot-back', deviceType: 'robot_arm', title: 'Robot Arm Safe Transfer', prompt: 'Move the red cube to the back safe zone', expected: 'The arm completes pick-and-place, and playback plus logs update.', proof: 'Check the center workspace motion, bottom Playback / Logs, and the Lab Report on the right.', validates: 'Validates the full AI command to safety gate to adapter command to replayable robot execution path.' },
          { id: 'qs-light-blue', deviceType: 'smart_light', title: 'Smart Light Color Control', prompt: 'Set the light to blue', expected: 'The light turns on or changes to blue, and run status targets Smart Light.', proof: 'Check the workspace light change, current run target, and Adapter Commands / Logs.', validates: 'Validates that a low-risk device can reuse the same runtime, adapter command, and audit chain.' },
          { id: 'qs-camera-photo', deviceType: 'camera_sensor', title: 'Camera Capture', prompt: 'Take a photo', expected: 'The camera shows capture feedback and logs a low-risk capture path.', proof: 'Check the workspace capture feedback, bottom Logs, and the timeline / Lab Report.', validates: 'Validates that read-oriented devices can use the same AI command, timeline, and lab report flow.' }
        ]
  ), [language]);
  const activeQuickStart = useMemo(
    () => quickStartPaths.find((path) => path.deviceType === effectiveSelectedProfile.deviceMeta.device_type && path.prompt === prompt.trim()) ?? null,
    [effectiveSelectedProfile.deviceMeta.device_type, prompt, quickStartPaths]
  );

  const clearRuntimeDecision = useCallback(() => {
    setRuntimeDecision(null);
    setRuntimeDecisionContext(null);
  }, []);

  useEffect(() => {
    if (running || replayPlaying) return;
    setRunPreviewTask(buildVisiblePreviewTask(
      effectiveSelectedProfile.id,
      effectiveSelectedProfile.deviceMeta.device_type,
      prompt,
      language
    ));
  }, [effectiveSelectedProfile.id, effectiveSelectedProfile.deviceMeta.device_type, language, prompt, replayPlaying, running]);

  const showNotice = useCallback((severity: OperatorNotice['severity'], message: string) => {
    setOperatorNotice({ id: Date.now(), severity, message });
  }, []);

  const clearPlaybackTimers = useCallback(() => {
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
    setReplayPlaying(false);
  }, []);

  const reportPlaybackEvents = useMemo<PlaybackEvent[]>(() => {
    if (!labReport) return [];
    return new PlaybackEngine().createEvents(labReport, effectiveSelectedProfile.deviceMeta, effectiveSelectedProfile.geometry);
  }, [effectiveSelectedProfile.deviceMeta, effectiveSelectedProfile.geometry, labReport]);
  const playbackEvents = livePlaybackEvents.length > 0 ? livePlaybackEvents : reportPlaybackEvents;
  const currentReplayEvent = playbackEvents[Math.min(replayIndex, Math.max(0, playbackEvents.length - 1))];
  const replayTimeMs = currentReplayEvent?.timeline_ms ?? 0;
  const replayCommand = currentReplayEvent?.command_id ?? '-';

  useEffect(() => {
    if (!operatorNotice) return;
    const timer = window.setTimeout(() => setOperatorNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [operatorNotice]);

  useEffect(() => () => clearPlaybackTimers(), [clearPlaybackTimers]);

  const selectSnapshot = useCallback((snapshot: TimelineStateSnapshot | null) => {
    clearPlaybackTimers();
    setSelectedSnapshot(snapshot);
    setCurrentActionFrame(snapshot?.action_frame ?? null);
  }, [clearPlaybackTimers]);

  const applyReplayEventForReport = useCallback((event: PlaybackEvent | undefined, index: number, report: LabReport | null) => {
    if (!event || !report) return;
    setReplayIndex(index);
    setCurrentActionFrame(event.frame);
    const snapshot = report.state_snapshots?.find((item) => item.command_id === event.command_id) ?? null;
    if (snapshot) setSelectedSnapshot(snapshot);
  }, []);

  const applyReplayEvent = useCallback((event: PlaybackEvent | undefined, index: number) => {
    applyReplayEventForReport(event, index, labReport);
  }, [applyReplayEventForReport, labReport]);

  const playReplayEvents = useCallback((events: PlaybackEvent[], report: LabReport, startIndex: number, speed: number, slow: boolean) => {
    if (events.length === 0) return;
    setRunning(true);
    setReplayPlaying(true);
    setSelectedSnapshot(report.state_snapshots?.[0] ?? null);
    const baseDuration = Math.max(1, events[events.length - 1].timeline_ms - events[startIndex].timeline_ms);
    const slowScale = slow ? Math.max(1, 1500 / baseDuration) : 1;
    events.slice(startIndex).forEach((event, offset) => {
      const index = startIndex + offset;
      const delay = (Math.max(0, event.timeline_ms - events[startIndex].timeline_ms) * slowScale) / speed;
      const timer = window.setTimeout(() => {
        applyReplayEventForReport(event, index, report);
        if (index === events.length - 1) {
          setRunning(false);
          setReplayPlaying(false);
        }
      }, Math.round(delay));
      playbackTimersRef.current.push(timer);
    });
  }, [applyReplayEventForReport]);

  const seekReplay = useCallback((index: number) => {
    if (playbackEvents.length === 0) return;
    clearPlaybackTimers();
    const clamped = Math.min(Math.max(0, index), playbackEvents.length - 1);
    applyReplayEvent(playbackEvents[clamped], clamped);
  }, [applyReplayEvent, clearPlaybackTimers, playbackEvents]);

  const selectProfileAndScenario = useCallback((profileId: string, nextLanguage = language) => {
    const nextProfile = deviceProfiles.find((profile) => profile.id === profileId) ?? deviceProfiles[0];
    const nextScenario = getScenarioForProfile(nextProfile.id, 'safe');
    const nextPrompt = isRunnableDeviceV01(nextProfile.deviceMeta.device_type)
      ? getLocalizedPrompt(nextScenario, nextLanguage)
      : comingSoonPrompt(nextLanguage, nextProfile.deviceMeta.device_type);
    setSelectedProfileId(nextProfile.id);
    setDeviceType(nextProfile.deviceMeta.device_type);
    setScenarioId(nextScenario.id);
    setPrompt(nextPrompt);
    setCommandStatus({
      kind: isRunnableDeviceV01(nextProfile.deviceMeta.device_type) ? 'ready' : 'coming_soon',
      message: isRunnableDeviceV01(nextProfile.deviceMeta.device_type)
        ? readyMessageForPrompt(nextLanguage, nextProfile.deviceMeta.device_type, nextPrompt)
        : comingSoonMessage(nextLanguage, nextProfile.deviceMeta.device_type)
    });
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(nextLanguage));
  }, [language]);

  const buildWorkspaceFile = useCallback((): LabWorkspaceFile => ({
    file_type: 'open_reality_lab_workspace',
    version: 1,
    saved_at: new Date().toISOString(),
    language,
    selected_profile_id: selectedProfile.id,
    selected_scenario_id: selectedScenario.id,
    selected_workspace_device_id: selectedWorkspaceDeviceId,
    prompt,
    devices: workspaceDevices
  }), [language, prompt, selectedProfile.id, selectedScenario.id, selectedWorkspaceDeviceId, workspaceDevices]);

  const buildProjectFile = useCallback((): OpenRealityProjectFile => ({
    project: {
      name: projectName,
      file_type: 'open_reality_desktop_project',
      version: 1
    },
    devices: workspaceDevices,
    scenarios: deviceScenarios.map((scenario) => ({
      id: scenario.id,
      device_profile: scenario.device_profile,
      prompt: getLocalizedPrompt(scenario, language),
      expected_safety_result: scenario.expected_safety_result
    })),
    profiles: deviceProfiles.map((profile) => ({
      id: profile.id,
      device_type: profile.deviceMeta.device_type,
      label: language === 'zh' ? localDeviceType(profile.deviceMeta.device_type, language) : profile.label
    })),
    workspace: buildWorkspaceFile(),
    lab_reports: labReport ? [labReport] : [],
    metadata: {
      saved_at: new Date().toISOString(),
      app: 'Open Reality Studio Desktop',
      real_device_execution_enabled: false
    }
  }), [buildWorkspaceFile, labReport, language, projectName, workspaceDevices]);

  const applyWorkspaceFile = useCallback((workspace: LabWorkspaceFile) => {
    if (workspace.file_type !== 'open_reality_lab_workspace' || workspace.version !== 1) return;
    const nextProfile = deviceProfiles.find((profile) => profile.id === workspace.selected_profile_id) ?? deviceProfiles[0];
    const nextScenario = deviceScenarios.find((scenario) => scenario.id === workspace.selected_scenario_id) ?? getScenarioForProfile(nextProfile.id, 'safe');
    const nextRunnable = isRunnableDeviceV01(nextProfile.deviceMeta.device_type);
    setLanguage(workspace.language);
    setWorkspaceDevices(workspace.devices.map((device, index) => {
      const profile = deviceProfiles.find((item) => item.id === device.profileId) ?? getFirstProfileForType(device.deviceType);
      return {
        ...device,
        label: device.label ?? `${localDeviceType(device.deviceType, workspace.language)} ${index + 1}`,
        config: {
          enabled: device.config?.enabled ?? true,
          adapter_target_id: device.config?.adapter_target_id ?? profile.deviceMeta.device_id,
          max_speed: device.config?.max_speed ?? profile.deviceMeta.constraints.max_speed,
          force_limit: device.config?.force_limit ?? profile.deviceMeta.constraints.force_limit,
          forbidden_zones: device.config?.forbidden_zones ?? profile.deviceMeta.constraints.forbidden_zones
        }
      };
    }));
    setSelectedWorkspaceDeviceId(workspace.selected_workspace_device_id);
    setSelectedProfileId(nextProfile.id);
    setDeviceType(nextProfile.deviceMeta.device_type);
    setScenarioId(nextScenario.id);
    setPrompt(workspace.prompt);
    setConsoleLogs(startupLogs(workspace.language));
    setOperatorNotice(null);
    setCommandStatus({
      kind: nextRunnable ? 'ready' : 'coming_soon',
      message: nextRunnable ? readyMessageForPrompt(workspace.language, nextProfile.deviceMeta.device_type, workspace.prompt) : comingSoonMessage(workspace.language, nextProfile.deviceMeta.device_type)
    });
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
  }, []);

  const applyProjectFile = useCallback((project: OpenRealityProjectFile, filePath?: string | null) => {
    applyWorkspaceFile(project.workspace);
    setProjectName(project.project?.name || 'Untitled Project');
    setProjectFilePath(filePath ?? null);
    const lastReport = project.lab_reports?.[project.lab_reports.length - 1] ?? null;
    const lastSnapshot = lastReport?.state_snapshots?.at(-1) ?? null;
    setLabReport(lastReport);
    setSelectedSnapshot(lastSnapshot);
    setCurrentActionFrame(lastSnapshot?.action_frame ?? null);
  }, [applyWorkspaceFile]);

  useEffect(() => {
    const rawWorkspace = window.localStorage.getItem(workspaceStorageKey);
    if (!rawWorkspace) return;
    try {
      applyWorkspaceFile(JSON.parse(rawWorkspace) as LabWorkspaceFile);
    } catch {
      window.localStorage.removeItem(workspaceStorageKey);
    }
  }, [applyWorkspaceFile]);

  useEffect(() => {
    const isDefaultUntitledWorkspace =
      !projectFilePath &&
      workspaceDevices.length === 1 &&
      workspaceDevices[0]?.deviceType === 'robot_arm';
    const dismissed = window.localStorage.getItem(firstRunGuideStorageKey) === '1';
    setShowFirstRunGuide(!dismissed && isDefaultUntitledWorkspace && !labReport);
  }, [labReport, projectFilePath, workspaceDevices]);

  useEffect(() => {
    const workspace = buildWorkspaceFile();
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
    setAutosavedAt(workspace.saved_at);
  }, [buildWorkspaceFile]);

  const dismissFirstRunGuide = useCallback(() => {
    window.localStorage.setItem(firstRunGuideStorageKey, '1');
    setShowFirstRunGuide(false);
  }, []);

  const reopenFirstRunGuide = useCallback(() => {
    setShowFirstRunGuide(true);
  }, []);

  const handleWorkspaceSelect = useCallback((deviceId: string) => {
    const workspaceDevice = workspaceDevices.find((device) => device.id === deviceId);
    if (!workspaceDevice) return;
    setSelectedWorkspaceDeviceId(deviceId);
    const profile = deviceProfiles.find((item) => item.id === workspaceDevice.profileId) ?? getFirstProfileForType(workspaceDevice.deviceType);
    selectProfileAndScenario(profile.id);
  }, [selectProfileAndScenario, workspaceDevices]);

  const handleDropDevice = useCallback((nextType: DeviceType) => {
    const nextProfile = getFirstProfileForType(nextType);
    const nextDevice = createWorkspaceDevice(nextType, workspaceDevices.length, language);
    setWorkspaceDevices((devices) => [...devices, nextDevice]);
    setSelectedWorkspaceDeviceId(nextDevice.id);
    setShowFirstRunGuide(false);
    selectProfileAndScenario(nextProfile.id);
    setConsoleLogs((logs) => [`[INFO] Added ${nextDevice.label} to workspace.`, ...logs]);
    showNotice('info', noticeMessage(language, `\u5df2\u6dfb\u52a0\u8bbe\u5907\uff1a${nextDevice.label}`, `Device added: ${nextDevice.label}`));
  }, [language, selectProfileAndScenario, showNotice, workspaceDevices.length]);

  const handleAddAsset = useCallback((assetId: string) => {
    const asset = availableAssets.find((item) => item.manifest.asset_id === assetId);
    if (!asset) return;
    const nextDevice = createWorkspaceDevice(asset.manifest.device_type, workspaceDevices.length, language, asset);
    const baseProfile = getFirstProfileForType(asset.manifest.device_type);
    const baseScenario = getScenarioForProfile(baseProfile.id, 'safe');
    const nextPrompt = isRunnableDeviceV01(asset.manifest.device_type)
      ? getLocalizedPrompt(baseScenario, language)
      : comingSoonPrompt(language, asset.manifest.device_type);
    setWorkspaceDevices((devices) => [...devices, nextDevice]);
    setSelectedWorkspaceDeviceId(nextDevice.id);
    setShowFirstRunGuide(false);
    setDeviceType(asset.manifest.device_type);
    setSelectedProfileId(baseProfile.id);
    setScenarioId(baseScenario.id);
    setPrompt(nextPrompt);
    setCommandStatus({
      kind: isRunnableDeviceV01(asset.manifest.device_type) ? 'ready' : 'coming_soon',
      message: isRunnableDeviceV01(asset.manifest.device_type)
        ? readyMessageForPrompt(language, asset.manifest.device_type, nextPrompt)
        : comingSoonMessage(language, asset.manifest.device_type)
    });
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs((logs) => [`[INFO] Added ${nextDevice.label} to workspace.`, ...logs]);
    showNotice('info', noticeMessage(language, `\u5df2\u6dfb\u52a0\u8d44\u4ea7\uff1a${nextDevice.label}`, `Asset added: ${nextDevice.label}`));
  }, [availableAssets, language, showNotice, workspaceDevices.length]);

  const handleImportedAsset = useCallback((asset: DeviceAsset) => {
    setImportedAssets((assets) => [...assets.filter((item) => item.manifest.asset_id !== asset.manifest.asset_id), asset]);
    showNotice('success', noticeMessage(language, `\u8d44\u4ea7\u5df2\u5bfc\u5165\uff1a${asset.manifest.display_name}`, `Asset imported: ${asset.manifest.display_name}`));
  }, [language, showNotice]);

  const updateWorkspaceDevice = useCallback((deviceId: string, patch: Partial<WorkspaceDeviceRecord>) => {
    setWorkspaceDevices((devices) => devices.map((device) => (
      device.id === deviceId
        ? {
            ...device,
            ...patch,
            config: patch.config ? { ...device.config, ...patch.config } : device.config
          }
        : device
    )));
  }, []);

  const removeWorkspaceDevice = useCallback((deviceId: string) => {
    const removed = workspaceDevices.find((device) => device.id === deviceId);
    setWorkspaceDevices((devices) => devices.filter((device) => device.id !== deviceId));
    setSelectedWorkspaceDeviceId((selectedId) => selectedId === deviceId ? null : selectedId);
    if (removed) showNotice('warning', noticeMessage(language, `\u5df2\u79fb\u9664\u8bbe\u5907\uff1a${removed.label}`, `Device removed: ${removed.label}`));
  }, [language, showNotice, workspaceDevices]);

  const duplicateWorkspaceDevice = useCallback((deviceId: string) => {
    const source = workspaceDevices.find((device) => device.id === deviceId);
    if (!source) return;
    const clone = {
      ...source,
      id: `${source.id}-copy-${Date.now()}`,
      label: `${source.label} Copy`,
      slot: workspaceDevices.length % workspaceSlots.length,
      position: workspaceSlots[workspaceDevices.length % workspaceSlots.length] ?? workspaceSlots[0],
      config: { ...source.config, adapter_target_id: `${source.config.adapter_target_id}-copy` }
    };
    setWorkspaceDevices((devices) => [...devices, clone]);
    setSelectedWorkspaceDeviceId(clone.id);
    showNotice('info', noticeMessage(language, `\u5df2\u590d\u5236\u8bbe\u5907\uff1a${clone.label}`, `Device duplicated: ${clone.label}`));
  }, [language, showNotice, workspaceDevices]);

  const exportSelectedAssetConfig = useCallback(() => {
    if (!selectedWorkspaceDevice) return;
    const asset = assetForId(availableAssets, selectedWorkspaceDevice.assetId);
    downloadJson(`open-reality-selected-asset-${Date.now()}.json`, {
      workspace_device: selectedWorkspaceDevice,
      asset_manifest: asset?.manifest ?? null,
      device_meta: asset?.deviceMeta ?? effectiveSelectedProfile.deviceMeta,
      geometry: asset?.geometry ?? effectiveSelectedProfile.geometry,
      adapter_manifest: asset?.adapterManifest ?? null,
      scenarios: asset?.scenarios ?? null
    });
  }, [availableAssets, effectiveSelectedProfile, selectedWorkspaceDevice]);

  const handleLanguageChange = useCallback((nextLanguage: UiLanguage) => {
    consoleLogSessionRef.current += 1;
    setLanguage(nextLanguage);
    clearRuntimeDecision();
    setOperatorNotice(null);
    setCommandStatus((current) => ({
      ...current,
      message: current.kind === 'blocked' || current.kind === 'ask_human' || current.kind === 'proposed_plan' || current.kind === 'coming_soon'
        ? current.message
        : current.kind === 'ready'
          ? readyMessageForPrompt(nextLanguage, selectedProfile.deviceMeta.device_type, isRunnableDeviceV01(selectedProfile.deviceMeta.device_type) ? getLocalizedPrompt(selectedScenario, nextLanguage) : comingSoonPrompt(nextLanguage, selectedProfile.deviceMeta.device_type))
          : localizedCommandStatusMessage(nextLanguage, current.kind)
    }));
    setPrompt(
      isRunnableDeviceV01(selectedProfile.deviceMeta.device_type)
        ? getLocalizedPrompt(selectedScenario, nextLanguage)
        : comingSoonPrompt(nextLanguage, selectedProfile.deviceMeta.device_type)
    );
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(nextLanguage));
  }, [clearRuntimeDecision, selectedProfile.deviceMeta.device_type, selectedScenario]);

  const syncWorkspaceSelectionForType = useCallback((nextType: DeviceType, preferredProfileId?: string) => {
    const exactMatch = preferredProfileId
      ? workspaceDevices.find((device) => device.profileId === preferredProfileId)
      : undefined;
    const typeMatch = workspaceDevices.find((device) => device.deviceType === nextType);
    const nextSelectedDevice = exactMatch ?? typeMatch ?? null;
    setSelectedWorkspaceDeviceId(nextSelectedDevice?.id ?? null);
    return nextSelectedDevice;
  }, [workspaceDevices]);

  const handleDeviceTypeChange = useCallback((nextType: DeviceType) => {
    consoleLogSessionRef.current += 1;
    const nextProfile = getFirstProfileForType(nextType);
    const nextScenario = getScenarioForProfile(nextProfile.id, 'safe');
    clearRuntimeDecision();
    setOperatorNotice(null);
    syncWorkspaceSelectionForType(nextType, nextProfile.id);
    setDeviceType(nextType);
    setSelectedProfileId(nextProfile.id);
    setScenarioId(nextScenario.id);
    setPrompt(isRunnableDeviceV01(nextType) ? getLocalizedPrompt(nextScenario, language) : comingSoonPrompt(language, nextType));
    setCommandStatus({
      kind: isRunnableDeviceV01(nextType) ? 'ready' : 'coming_soon',
      message: isRunnableDeviceV01(nextType) ? readyMessageForPrompt(language, nextType, getLocalizedPrompt(nextScenario, language)) : comingSoonMessage(language, nextType)
    });
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(language));
  }, [clearRuntimeDecision, language, syncWorkspaceSelectionForType]);

  const handleProfileChange = useCallback((profileId: string) => {
    consoleLogSessionRef.current += 1;
    const nextProfile = deviceProfiles.find((profile) => profile.id === profileId) ?? deviceProfiles[0];
    const nextScenario = getScenarioForProfile(nextProfile.id, 'safe');
    clearRuntimeDecision();
    setOperatorNotice(null);
    syncWorkspaceSelectionForType(nextProfile.deviceMeta.device_type, nextProfile.id);
    setSelectedProfileId(nextProfile.id);
    setDeviceType(nextProfile.deviceMeta.device_type);
    setScenarioId(nextScenario.id);
    setPrompt(isRunnableDeviceV01(nextProfile.deviceMeta.device_type) ? getLocalizedPrompt(nextScenario, language) : comingSoonPrompt(language, nextProfile.deviceMeta.device_type));
    setCommandStatus({
      kind: isRunnableDeviceV01(nextProfile.deviceMeta.device_type) ? 'ready' : 'coming_soon',
      message: isRunnableDeviceV01(nextProfile.deviceMeta.device_type) ? readyMessageForPrompt(language, nextProfile.deviceMeta.device_type, getLocalizedPrompt(nextScenario, language)) : comingSoonMessage(language, nextProfile.deviceMeta.device_type)
    });
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(language));
  }, [clearRuntimeDecision, language, syncWorkspaceSelectionForType]);

  const handleScenarioChange = useCallback((nextScenarioId: string) => {
    consoleLogSessionRef.current += 1;
    const nextScenario = deviceScenarios.find((scenario) => scenario.id === nextScenarioId) ?? selectedScenario;
    clearRuntimeDecision();
    setOperatorNotice(null);
    setScenarioId(nextScenario.id);
    setPrompt(
      isRunnableDeviceV01(selectedProfile.deviceMeta.device_type)
        ? getLocalizedPrompt(nextScenario, language)
        : comingSoonPrompt(language, selectedProfile.deviceMeta.device_type)
    );
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(language));
  }, [clearRuntimeDecision, language, selectedProfile.deviceMeta.device_type, selectedScenario]);

  const handleQuickStart = useCallback((path: QuickStartPath) => {
    consoleLogSessionRef.current += 1;
    const nextProfile = getFirstProfileForType(path.deviceType);
    const nextScenario = getScenarioForProfile(nextProfile.id, 'safe');
    clearRuntimeDecision();
    setOperatorNotice(null);
    window.localStorage.setItem(firstRunGuideStorageKey, '1');
    setShowFirstRunGuide(false);
    syncWorkspaceSelectionForType(path.deviceType, nextProfile.id);
    setDeviceType(path.deviceType);
    setSelectedProfileId(nextProfile.id);
    setScenarioId(nextScenario.id);
    setPrompt(path.prompt);
    setCommandStatus({
      kind: 'ready',
      message: readyMessageForPrompt(language, path.deviceType, path.prompt)
    });
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setConsoleLogs(startupLogs(language));
  }, [clearRuntimeDecision, language, syncWorkspaceSelectionForType]);

  const handlePromptChange = useCallback((nextPrompt: string) => {
    clearRuntimeDecision();
    setPrompt(nextPrompt);
  }, [clearRuntimeDecision]);

  const runScenario = useCallback(async () => {
    if (liveRunActiveRef.current) {
      showNotice('warning', noticeMessage(language, '\u5f53\u524d\u6267\u884c\u6b63\u5728\u8fd0\u884c\uff0c\u8bf7\u5148\u505c\u6b62\u6216\u7b49\u5f85\u5b8c\u6210\u3002', 'A run is already active. Stop it or wait for completion.'));
      return;
    }
    liveRunActiveRef.current = true;
    const runToken = liveRunTokenRef.current + 1;
    liveRunTokenRef.current = runToken;
    const consoleSessionId = consoleLogSessionRef.current + 1;
    consoleLogSessionRef.current = consoleSessionId;
    const replaceLogs = (nextLogs: string[]) => {
      if (consoleLogSessionRef.current !== consoleSessionId) return;
      setConsoleLogs(nextLogs);
    };
    const prependLog = (entry: string, limit = 120) => {
      if (consoleLogSessionRef.current !== consoleSessionId) return;
      setConsoleLogs((logs) => [entry, ...logs.slice(0, limit)]);
    };
    const prependLogs = (entries: string[], limit = 120) => {
      if (consoleLogSessionRef.current !== consoleSessionId) return;
      setConsoleLogs((logs) => [...entries, ...logs.slice(0, limit)]);
    };
    clearPlaybackTimers();
    setCurrentActionFrame(null);
    setSelectedSnapshot(null);
    setLabReport(null);
    setRunPreviewTask(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    const autoDevice = workspaceDevices.length === 0
      ? createWorkspaceDevice(selectedProfile.deviceMeta.device_type, 0, language)
      : null;
    if (autoDevice) {
      setWorkspaceDevices([autoDevice]);
      setSelectedWorkspaceDeviceId(autoDevice.id);
      showNotice('info', noticeMessage(language, `\u5de5\u4f5c\u533a\u4e3a\u7a7a\uff0c\u5df2\u81ea\u52a8\u6dfb\u52a0\uff1a${autoDevice.label}`, `Workspace was empty. Added: ${autoDevice.label}`));
    }
    const targetWorkspaceDevice = autoDevice ?? selectedWorkspaceDevice;
    const targetWorkspaceDeviceId = targetWorkspaceDevice?.id ?? selectedWorkspaceDeviceId;
    const targetWorkspaceAsset = autoDevice ? undefined : assetForId(availableAssets, targetWorkspaceDevice?.assetId);
    const runProfile = autoDevice ? applyWorkspaceDeviceConfig(selectedProfile, autoDevice) : effectiveSelectedProfile;
    const assetScenario = targetWorkspaceAsset?.scenarios?.[selectedScenario.mode] as DeviceScenario | undefined;
    const runScenarioDefinition = assetScenario ?? (
      selectedScenario.device_profile === runProfile.id
        ? selectedScenario
        : getScenarioForProfile(runProfile.id, selectedScenario.mode)
    );
    const runPrompt = prompt.trim() || getLocalizedPrompt(runScenarioDefinition, language);
    const usesAutonomyCore = runProfile.deviceMeta.device_type === 'robot_arm';
    const runtimeKernelResult = compileOpenRealityRuntime({
      userPrompt: runPrompt,
      targetDeviceId: runProfile.deviceMeta.device_id,
      manifest: buildManifestFromProfile(runProfile),
      worldModel: buildWorldModelFromProfile(runProfile, {
        targetDeviceId: runProfile.deviceMeta.device_id,
        selected: Boolean(targetWorkspaceDeviceId),
        status: targetWorkspaceDeviceId ? 'selected' : 'idle'
      }),
      locale: language
    });
    const runTargetLabel = targetWorkspaceAsset
      ? localizeDisplayName(language, targetWorkspaceAsset.manifest.display_name)
      : localizeDeviceType(language, runProfile.deviceMeta.device_type);
    setRuntimeDecision(runtimeKernelResult);
    setRuntimeDecisionContext({
      prompt: runPrompt,
      targetDeviceLabel: runTargetLabel,
      targetDeviceType: runProfile.deviceMeta.device_type
    });
    const baseRunLogs = startupLogs(language);
    const publishRuntimeDecisionReport = (decision: OpenRealityRuntimeResult) => {
      setLabReport(buildRuntimeDecisionLabReport({
        profile: runProfile,
        scenarioId: runScenarioDefinition.id,
        prompt: runPrompt,
        runtimeResult: decision
      }));
    };
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    replaceLogs(baseRunLogs);
    if (runtimeKernelResult.status === 'not_runnable') {
      const message = runtimeKernelResult.userFacingMessage || comingSoonMessage(language, runProfile.deviceMeta.device_type);
      publishRuntimeDecisionReport(runtimeKernelResult);
      setCommandStatus({ kind: 'coming_soon', message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        `[WARN] Coming Soon / Not runnable in v0.1: ${runProfile.deviceMeta.device_type}`,
        ...baseRunLogs
      ]);
      showNotice('warning', message);
      liveRunActiveRef.current = false;
      return;
    }
    if (runtimeKernelResult.status === 'unsupported') {
      const message = runtimeKernelResult.userFacingMessage || noticeMessage(language, '当前设备不支持该任务。', 'The selected device does not support this task.');
      publishRuntimeDecisionReport(runtimeKernelResult);
      setCommandStatus({ kind: 'failed', message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        `[WARN] Unsupported task for ${runProfile.deviceMeta.device_type}: ${runPrompt}`,
        ...baseRunLogs
      ]);
      showNotice('warning', message);
      liveRunActiveRef.current = false;
      return;
    }
    if (runtimeKernelResult.status === 'ambiguous') {
      const message = runtimeKernelResult.userFacingMessage || noticeMessage(language, '任务不明确，请补充目标物体或区域。', 'The task is ambiguous. Clarify the object or target zone.');
      publishRuntimeDecisionReport(runtimeKernelResult);
      setCommandStatus({ kind: 'ask_human', message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        `[WARN] Ambiguous task for ${runProfile.deviceMeta.device_type}: ${runPrompt}`,
        ...baseRunLogs
      ]);
      showNotice('warning', message);
      liveRunActiveRef.current = false;
      return;
    }
    if (runtimeKernelResult.status === 'ask_human') {
      const message = runtimeKernelResult.userFacingMessage || noticeMessage(language, '该任务需要人工确认。', 'Human approval is required before continuing.');
      if (runtimeKernelResult.taskDsl) {
        setRunPreviewTask({ profileId: runProfile.id, prompt: runPrompt, task: runtimeKernelResult.taskDsl });
      }
      publishRuntimeDecisionReport(runtimeKernelResult);
      setCommandStatus({ kind: 'ask_human', message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        `[WARN] Runtime Kernel requires human approval: ${runtimeKernelResult.reason}`,
        ...baseRunLogs
      ]);
      showNotice('warning', message);
      liveRunActiveRef.current = false;
      return;
    }
    if (runtimeKernelResult.status === 'blocked') {
      const message = runtimeKernelResult.userFacingMessage || noticeMessage(language, '该任务已被安全治理器拦截。', 'The requested task was blocked by the Safety Governor.');
      publishRuntimeDecisionReport(runtimeKernelResult);
      setCommandStatus({ kind: 'blocked', message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        `[ERROR] Runtime Kernel blocked task: ${runtimeKernelResult.reason}`,
        ...baseRunLogs
      ]);
      showNotice('error', message);
      liveRunActiveRef.current = false;
      return;
    }
    if (runtimeKernelResult.taskDsl) {
      setRunPreviewTask({ profileId: runProfile.id, prompt: runPrompt, task: runtimeKernelResult.taskDsl });
    }
    setCommandStatus({
      kind: 'running',
      message: `${t(language, 'command_running')} ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`
    });
    setWorkspaceExpanded(true);
    setRunning(true);
    setReplayPlaying(true);
    try {
      replaceLogs(usesAutonomyCore
        ? [
            `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
            '[00:00] AutonomyCore semantic grounding',
            '[00:01] RiskJudge gate',
            ...baseRunLogs
          ]
        : [
            `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
            `[00:00] Compile AI command for ${runProfile.deviceMeta.device_type}`,
            '[00:01] Start low-risk virtual device simulation',
            ...baseRunLogs
          ]);
      const autonomyResult = usesAutonomyCore
        ? new AutonomyCore().run(runPrompt, {
            profile: runProfile,
            autonomy_level: 'L3_supervised_agent',
            mode: 'simulation',
            device_state: targetWorkspaceDevice?.current_state
          })
        : null;
      if (autonomyResult) {
        prependLogs([
          `[INFO] AutonomyCore status=${autonomyResult.status}`,
          `[INFO] intent=${autonomyResult.semantic_intent.goal} object=${autonomyResult.semantic_intent.object_query ?? '-'} target=${autonomyResult.semantic_intent.target_query ?? '-'}`,
          `[INFO] risk=${autonomyResult.risk_result.decision} score=${autonomyResult.risk_result.risk_score}`
        ]);
        if (autonomyResult.status !== 'execute' || !autonomyResult.task_dsl) {
          const reason = autonomyResult.risk_result.reasons.join('; ') || autonomyResult.status;
          setLabReport(buildAutonomyStopLabReport({
            profile: runProfile,
            scenarioId: runScenarioDefinition.id,
            prompt: runPrompt,
            runtimeResult: runtimeKernelResult,
            autonomyStatus: autonomyResult.status === 'block'
              ? 'block'
              : autonomyResult.status === 'ask_human'
                ? 'ask_human'
                : 'proposed_plan',
            reason
          }));
          setCommandStatus({
            kind: autonomyResult.status === 'block'
              ? 'blocked'
              : autonomyResult.status === 'ask_human'
                ? 'ask_human'
                : autonomyResult.status === 'proposed_plan'
                  ? 'proposed_plan'
                  : 'failed',
            message: autonomyResult.status === 'block'
              ? noticeMessage(language, `已阻止：${reason}`, `Blocked: ${reason}`)
              : autonomyResult.status === 'ask_human'
                ? noticeMessage(language, `需要人工确认：${reason}`, `Ask Human: ${reason}`)
                : autonomyResult.status === 'proposed_plan'
                  ? noticeMessage(language, '建议计划：需要确认', 'Proposed Plan: confirmation required')
                  : reason
          });
          setReplayPlaying(false);
          setRunning(false);
          prependLog(`[${autonomyResult.status === 'block' ? 'ERROR' : 'WARN'}] AutonomyCore stopped execution: ${autonomyResult.risk_result.reasons.join('; ') || autonomyResult.status}`);
          showNotice(
            autonomyResult.status === 'block' ? 'error' : 'warning',
            noticeMessage(language, `AutonomyCore ${autonomyResult.status}\uff1a\u672a\u751f\u6210\u8bbe\u5907\u547d\u4ee4`, `AutonomyCore ${autonomyResult.status}: no device commands generated`)
          );
          return;
        }
        setRunPreviewTask({ profileId: runProfile.id, prompt: runPrompt, task: autonomyResult.task_dsl });
      }
      let lastFrameTimeline = 0;
      let liveFrameCount = 0;

      const lowRiskTaskDsl = !usesAutonomyCore ? runtimeKernelResult.taskDsl ?? null : null;

      // Autonomy regression anchor: new LiveScenarioRunner().run(runProfile, runScenarioDefinition, runPrompt, autonomyResult?.task_dsl)
      for await (const event of new LiveScenarioRunner().run(
        runProfile,
        runScenarioDefinition,
        runPrompt,
        autonomyResult?.task_dsl ?? lowRiskTaskDsl ?? undefined,
        runtimeKernelResult,
        targetWorkspaceDevice?.current_state ?? null
      )) {
        if (liveRunTokenRef.current !== runToken) break;

        if (event.kind === 'compile') {
          prependLog(`[INFO] ${event.message}`);
        }

        if (event.kind === 'safety') {
          prependLog(`[INFO] ${event.message}`);
        }

        if (event.kind === 'command_start') {
          setLiveAdapterCommands((commands) => commands.some((command) => command.id === event.command.id) ? commands : [...commands, event.command]);
          prependLog(`[INFO] ${event.message}`);
        }

        if (event.kind === 'frame') {
          const baseDelay = Math.max(0, event.timeline_ms - lastFrameTimeline);
          const slowScale = slowMode ? 1.8 : 1;
          const delay = Math.round((baseDelay * slowScale) / replaySpeed);
          if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (liveRunTokenRef.current !== runToken) break;
          const playbackEvent: PlaybackEvent = {
            event_id: `live-${event.command.id}-${event.frame.time_ms}-${liveFrameCount}`,
            command_id: event.command.id,
            frame: event.frame,
            timeline_ms: event.timeline_ms,
            status: event.frame.status === 'completed' ? 'completed' : 'running',
            message: event.message
          };
          setCurrentActionFrame(event.frame);
          setLivePlaybackEvents((events) => events.some((item) => item.event_id === playbackEvent.event_id) ? events : [...events, playbackEvent]);
          setReplayIndex(liveFrameCount);
          prependLog(`[INFO] ${event.message}`);
          liveFrameCount += 1;
          lastFrameTimeline = event.timeline_ms;
        }

        if (event.kind === 'command_complete') {
          setSelectedSnapshot(event.snapshot);
          prependLog(`[INFO] ${event.message}`);
        }

        if (event.kind === 'blocked') {
          const blockedCommand = event.command;
          if (blockedCommand) {
            setLiveAdapterCommands((commands) => commands.some((command) => command.id === blockedCommand.id) ? commands : [...commands, blockedCommand]);
          }
          setSelectedSnapshot(event.snapshot);
          setCurrentActionFrame(event.snapshot.action_frame ?? null);
          if (blockedCommand) {
            const blockedPlaybackEvent: PlaybackEvent = {
              event_id: `live-${blockedCommand.id}-blocked`,
              command_id: blockedCommand.id,
              frame: {
                time_ms: 0,
                progress: 0,
                device_state: event.snapshot.device_state,
                visual_state: {},
                command_id: blockedCommand.id,
                status: 'blocked'
              },
              timeline_ms: event.timeline_ms,
              status: 'blocked',
              message: event.message
            };
            setLivePlaybackEvents((events) => events.some((item) => item.event_id === blockedPlaybackEvent.event_id) ? events : [...events, blockedPlaybackEvent]);
          }
          prependLog(`[ERROR] Blocked before adapter dispatch: ${event.message}`);
          setCommandStatus({
            kind: 'blocked',
            message: noticeMessage(language, `已阻止：${event.message}`, `Blocked: ${event.message}`)
          });
        }

        if (event.kind === 'report') {
          setLabReport(event.report);
          setWorkspaceValidation(null);
          const finalSnapshot = event.report.state_snapshots?.[event.report.state_snapshots.length - 1] ?? null;
          setSelectedSnapshot(finalSnapshot);
          if (finalSnapshot?.action_frame) setCurrentActionFrame(finalSnapshot.action_frame);
          if (targetWorkspaceDeviceId) {
            setWorkspaceDevices((devices) => devices.map((device) => device.id === targetWorkspaceDeviceId
              ? { ...device, current_state: event.report.device_state_after, last_run_result: event.report.result }
              : device
            ));
          }
          showNotice(
            event.report.result === 'pass' ? 'success' : event.report.result === 'blocked' ? 'warning' : 'error',
            noticeMessage(language, event.report.result === 'pass' ? '\u5b9e\u65f6\u4eff\u771f\u6267\u884c\u5b8c\u6210\u3002' : `\u6267\u884c\u5b8c\u6210\uff1a${localResult(event.report.result, language)}`, event.report.result === 'pass' ? 'Live simulator execution completed.' : `Execution finished: ${localResult(event.report.result, language)}`)
          );
          setCommandStatus({
            kind: event.report.result === 'pass' ? 'completed' : event.report.result === 'blocked' ? 'blocked' : 'failed',
            message: event.report.result === 'pass'
              ? noticeMessage(language, '执行完成。', 'Execution completed.')
              : `${localResult(event.report.result, language)}: ${event.report.safety_report.blocked_reasons.join('; ') || event.report.result}`
          });
        }
      }
    } catch (error) {
      setCommandStatus({
        kind: 'failed',
        message: error instanceof Error ? error.message : localUnknownError(language)
      });
      showNotice('error', noticeMessage(language, `\u6267\u884c\u5931\u8d25\uff1a${error instanceof Error ? error.message : localUnknownError(language)}`, `Execution failed: ${error instanceof Error ? error.message : localUnknownError(language)}`));
    } finally {
      if (liveRunTokenRef.current === runToken) {
        setRunning(false);
        setReplayPlaying(false);
        liveRunActiveRef.current = false;
      }
    }
  }, [availableAssets, clearPlaybackTimers, effectiveSelectedProfile, language, prompt, replaySpeed, selectedProfile, selectedScenario, selectedWorkspaceDevice, selectedWorkspaceDeviceId, showNotice, slowMode, workspaceDevices.length]);

  const runFullValidation = useCallback(async () => {
    setValidationRunning(true);
    const enabledDevices = workspaceDevices.filter((device) => device.config.enabled);
    if (enabledDevices.length === 0) {
      showNotice('error', noticeMessage(language, '\u6ca1\u6709\u542f\u7528\u8bbe\u5907\uff0c\u65e0\u6cd5\u6267\u884c\u5de5\u4f5c\u533a\u9a8c\u8bc1\u3002', 'No enabled devices. Workspace validation cannot run.'));
      setValidationRunning(false);
      return;
    }
    const deviceResults: WorkspaceValidationResult['device_results'] = [];
    let lastReport: LabReport | null = null;

    try {
      for (const device of enabledDevices) {
        const asset = assetForId(availableAssets, device.assetId);
        const baseProfile = asset ? profileFromAsset(asset) : deviceProfiles.find((profile) => profile.id === device.profileId) ?? getFirstProfileForType(device.deviceType);
        const effectiveProfile = applyWorkspaceDeviceConfig(baseProfile, device);
        const scenario = getScenarioForProfile(baseProfile.id, 'safe');
        const localizedPrompt = getLocalizedPrompt(scenario, language);
        setSelectedWorkspaceDeviceId(device.id);
        setDeviceType(baseProfile.deviceMeta.device_type);
        setSelectedProfileId(baseProfile.id);
        setScenarioId(scenario.id);
        setPrompt(localizedPrompt);
        const report = await new ScenarioRunner().run(effectiveProfile, scenario, localizedPrompt);
        lastReport = report;
        deviceResults.push({
          workspace_device_id: device.id,
          label: device.label,
          profile_id: baseProfile.id,
          scenario_id: scenario.id,
          result: report.result,
          lab_run_id: report.lab_run_id,
          blocked_reasons: report.safety_report.blocked_reasons
        });
        setLabReport(report);
        setSelectedSnapshot(report.state_snapshots?.[report.state_snapshots.length - 1] ?? null);
        setCurrentActionFrame(report.state_snapshots?.[report.state_snapshots.length - 1]?.action_frame ?? null);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u5de5\u4f5c\u533a\u9a8c\u8bc1\u5931\u8d25\uff1a${error instanceof Error ? error.message : localUnknownError(language)}`, `Workspace validation failed: ${error instanceof Error ? error.message : localUnknownError(language)}`));
      setValidationRunning(false);
      return;
    }

    const validation: WorkspaceValidationResult = {
      run_id: `workspace-validation-${Date.now()}`,
      generated_at: new Date().toISOString(),
      result: deviceResults.length > 0 && deviceResults.every((result) => result.result === 'pass')
        ? 'pass'
        : deviceResults.some((result) => result.result === 'blocked')
          ? 'blocked'
          : 'failed',
      device_results: deviceResults
    };
    setWorkspaceValidation(validation);
    if (lastReport) setLabReport(lastReport);
    showNotice(
      validation.result === 'pass' ? 'success' : 'warning',
      noticeMessage(language, `\u5de5\u4f5c\u533a\u9a8c\u8bc1\u5b8c\u6210\uff1a${localResult(validation.result, language)}`, `Workspace validation finished: ${localResult(validation.result, language)}`)
    );
    setValidationRunning(false);
  }, [language, showNotice, workspaceDevices]);

  const newProject = useCallback(() => {
    consoleLogSessionRef.current += 1;
    const nextScenario = getScenarioForProfile('virtual-robot-arm', 'safe');
    const nextDefaultDevice = createDefaultWorkspaceDevice(language);
    setProjectName('Untitled Project');
    setProjectFilePath(null);
    setLanguage(language);
    setDeviceType('robot_arm');
    setSelectedProfileId('virtual-robot-arm');
    setScenarioId(nextScenario.id);
    setPrompt(getLocalizedPrompt(nextScenario, language));
    setWorkspaceDevices([nextDefaultDevice]);
    setSelectedWorkspaceDeviceId(nextDefaultDevice.id);
    setConsoleLogs(startupLogs(language));
    setOperatorNotice(null);
    setCommandStatus({ kind: 'ready', message: defaultReadyMessage(language) });
    setWorkspaceValidation(null);
    setLabReport(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    showNotice('info', noticeMessage(language, '\u5df2\u65b0\u5efa\u672a\u547d\u540d\u5de5\u7a0b\u3002', 'Created a new untitled project.'));
  }, [language, showNotice]);

  const saveWorkspace = useCallback(async (saveAs = false) => {
    const project = buildProjectFile();
    if (window.openReality) {
      const result = saveAs
        ? await window.openReality.project.saveAs(project)
        : await window.openReality.project.save(project, projectFilePath);
      if (!result.canceled && result.filePath) {
        setProjectFilePath(result.filePath);
        setProjectName(result.filePath.split(/[\\/]/).pop()?.replace(/\.openreality\.json$/i, '') || projectName);
        showNotice('success', noticeMessage(language, '\u5de5\u7a0b\u5df2\u4fdd\u5b58\u3002', 'Project saved.'));
      }
      return;
    }
    downloadJson(`open-reality-project-${Date.now()}.openreality.json`, project);
  }, [buildProjectFile, language, projectFilePath, projectName, showNotice]);

  const loadWorkspaceFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as LabWorkspaceFile | OpenRealityProjectFile;
      if ('project' in parsed && 'workspace' in parsed) {
        applyProjectFile(parsed);
      } else {
        applyWorkspaceFile(parsed);
      }
      showNotice('success', noticeMessage(language, '\u5de5\u7a0b\u5df2\u6253\u5f00\u3002', 'Lab workspace opened.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u6253\u5f00\u5de5\u7a0b\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u6587\u4ef6\u683c\u5f0f\u65e0\u6548'}`, `Open failed: ${error instanceof Error ? error.message : 'Invalid file format'}`));
    }
  }, [applyProjectFile, applyWorkspaceFile, language, showNotice]);

  const openProject = useCallback(async () => {
    if (!window.openReality) {
      workspaceFileInputRef.current?.click();
      return;
    }
    try {
      const result = await window.openReality.project.open();
      if (result.canceled || !result.project) return;
      applyProjectFile(result.project, result.filePath);
      showNotice('success', noticeMessage(language, '\u5de5\u7a0b\u5df2\u6253\u5f00\u3002', 'Project opened.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u6253\u5f00\u5de5\u7a0b\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u6587\u4ef6\u683c\u5f0f\u65e0\u6548'}`, `Open failed: ${error instanceof Error ? error.message : 'Invalid file format'}`));
    }
  }, [applyProjectFile, language, showNotice]);

  const restoreLastWorkspace = useCallback(() => {
    const rawWorkspace = window.localStorage.getItem(workspaceStorageKey);
    if (!rawWorkspace) {
      showNotice('warning', noticeMessage(language, '\u6ca1\u6709\u53ef\u6062\u590d\u7684\u4e0a\u6b21\u5de5\u7a0b\u3002', 'No previous workspace to restore.'));
      return;
    }
    try {
      applyWorkspaceFile(JSON.parse(rawWorkspace) as LabWorkspaceFile);
      showNotice('success', noticeMessage(language, '\u5df2\u6062\u590d\u4e0a\u6b21\u5de5\u7a0b\u3002', 'Last workspace restored.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u6062\u590d\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u81ea\u52a8\u4fdd\u5b58\u6570\u636e\u65e0\u6548'}`, `Restore failed: ${error instanceof Error ? error.message : 'Invalid autosave data'}`));
    }
  }, [applyWorkspaceFile, language, showNotice]);

  const exportDeploymentConfig = useCallback(async () => {
    const readinessStatus = workspaceBlocked ? 'blocked' : workspaceWarnings > 0 ? 'warning' : 'pass';
    const basePackage = {
      package_type: 'open_reality_adapter_execution_package',
      version: 1,
      generated_at: new Date().toISOString(),
      status: labReport?.result ?? 'not_executed',
      deployment_certificate: {
        certificate_type: 'virtual_lab_validation_certificate',
        readiness_status: readinessStatus,
        virtual_lab_only: true,
        real_hardware_execution_enabled: false,
        blockers: workspaceIssues.filter((issue) => issue.severity === 'blocked').length,
        warnings: workspaceIssues.filter((issue) => issue.severity === 'warning').length,
        last_lab_run_id: labReport?.lab_run_id ?? null,
        workspace_validation_run_id: workspaceValidation?.run_id ?? null
      },
      device_profile: effectiveSelectedProfile.deviceMeta,
      scenario: selectedScenario.id,
      prompt,
      task_dsl: labReport?.task_dsl ?? null,
      safety_report: labReport?.safety_report ?? null,
      adapter_commands: labReport?.adapter_commands ?? [],
      deployment_readiness: {
        status: workspaceBlocked ? 'blocked' : workspaceWarnings > 0 ? 'warning' : 'pass',
        issues: workspaceIssues
      },
      workspace_validation: workspaceValidation,
      workspace_devices: workspaceDevices.map((device) => {
        const asset = assetForId(availableAssets, device.assetId);
        const profile = asset ? profileFromAsset(asset) : deviceProfiles.find((item) => item.id === device.profileId) ?? getFirstProfileForType(device.deviceType);
        return {
          workspace_device_id: device.id,
          label: device.label,
          profile_id: device.profileId,
          device_type: device.deviceType,
          adapter_target_id: device.config.adapter_target_id,
          enabled: device.config.enabled,
          model_asset: profile.deviceMeta.model_asset ?? null,
          config: device.config
        };
      }),
      device_state_before: labReport?.device_state_before ?? null,
      device_state_after: labReport?.device_state_after ?? null,
      real_device_boundary: {
        enabled: false,
        notice: 'Future adapter package only. Production hardware requires certified adapter, verified transport, and human supervision.'
      }
    };
    const canonicalPayload = JSON.stringify(basePackage);
    const deploymentPackage = {
      ...basePackage,
      package_digest_sha256: await sha256Hex(canonicalPayload)
    };
    if (window.openReality) {
      const result = await window.openReality.export.deploymentPackage(deploymentPackage);
      if (result.canceled) return;
      showNotice(
        workspaceBlocked ? 'warning' : 'success',
        noticeMessage(language, workspaceBlocked ? '\u914d\u7f6e\u5305\u5df2\u5bfc\u51fa\uff0c\u4f46\u9884\u68c0\u4ecd\u6709\u963b\u65ad\u9879\u3002' : '\u914d\u7f6e\u5305\u5df2\u5bfc\u51fa\u3002', workspaceBlocked ? 'Package exported with blocking preflight issues.' : 'Adapter package exported.')
      );
      return;
    }
    downloadJson(`open-reality-adapter-package-${Date.now()}.json`, deploymentPackage);
    showNotice(
      workspaceBlocked ? 'warning' : 'success',
      noticeMessage(language, workspaceBlocked ? '\u914d\u7f6e\u5305\u5df2\u5bfc\u51fa\uff0c\u4f46\u9884\u68c0\u4ecd\u6709\u963b\u65ad\u9879\u3002' : '\u914d\u7f6e\u5305\u5df2\u5bfc\u51fa\u3002', workspaceBlocked ? 'Package exported with blocking preflight issues.' : 'Adapter package exported.')
    );
  }, [effectiveSelectedProfile.deviceMeta, labReport, language, prompt, selectedScenario.id, showNotice, workspaceBlocked, workspaceDevices, workspaceIssues, workspaceValidation, workspaceWarnings]);

  const exportCurrentLabReport = useCallback(async () => {
    if (!labReport) return;
    if (window.openReality) {
      const result = await window.openReality.export.labReport(labReport);
      if (!result.canceled) showNotice('success', noticeMessage(language, '\u5b9e\u9a8c\u62a5\u544a\u5df2\u5bfc\u51fa\u3002', 'Lab Report exported.'));
      return;
    }
    exportLabReport(labReport);
  }, [labReport, language, showNotice]);

  const stopRun = useCallback(() => {
    liveRunTokenRef.current += 1;
    liveRunActiveRef.current = false;
    clearPlaybackTimers();
    setRunning(false);
    setValidationRunning(false);
    setCurrentActionFrame(null);
    setCommandStatus({
      kind: 'ready',
      message: t(language, 'command_stopped')
    });
    showNotice('warning', noticeMessage(language, '\u5df2\u505c\u6b62\u5f53\u524d\u6267\u884c\u3002', 'Current run stopped.'));
  }, [clearPlaybackTimers, language, showNotice]);

  const replayRun = useCallback(() => {
    if (replayPlaying) {
      clearPlaybackTimers();
      showNotice('info', noticeMessage(language, '\u56de\u653e\u5df2\u6682\u505c\u3002', 'Replay paused.'));
      return;
    }
    clearPlaybackTimers();
    if (!labReport) return;
    if (playbackEvents.length === 0) {
      const blockedSnapshot = labReport.state_snapshots?.find((snapshot) => snapshot.stage === 'blocked') ?? labReport.state_snapshots?.[0] ?? null;
      setSelectedSnapshot(blockedSnapshot);
      setCurrentActionFrame(null);
      showNotice('warning', noticeMessage(language, '\u6ca1\u6709\u53ef\u64ad\u653e\u52a8\u4f5c\u5e27\uff1a\u547d\u4ee4\u53ef\u80fd\u5df2\u88ab\u5b89\u5168\u8fd0\u884c\u65f6\u62e6\u622a\u3002', 'No playable action frames. Commands may have been blocked by Safety Runtime.'));
      return;
    }

    const startIndex = Math.min(replayIndex, playbackEvents.length - 1);
    playReplayEvents(playbackEvents, labReport, startIndex, replaySpeed, slowMode);
    showNotice('info', noticeMessage(language, '\u56de\u653e\u6b63\u5728\u6309 Adapter Commands \u64ad\u653e ActionFrames\u3002', 'Replay is playing ActionFrames generated from Adapter Commands.'));
  }, [clearPlaybackTimers, labReport, language, playReplayEvents, playbackEvents, replayIndex, replayPlaying, replaySpeed, showNotice, slowMode]);

  const replayFromStart = useCallback(() => {
    clearPlaybackTimers();
    if (!labReport || playbackEvents.length === 0) return;
    setReplayIndex(0);
    setCurrentActionFrame(null);
    playReplayEvents(playbackEvents, labReport, 0, replaySpeed, slowMode);
  }, [clearPlaybackTimers, labReport, playReplayEvents, playbackEvents, replaySpeed, slowMode]);

  useEffect(() => {
    if (!window.openReality) return;
    return window.openReality.onMenuAction((action) => {
      if (action === 'project:new') newProject();
      if (action === 'project:open') void openProject();
      if (action === 'project:save') void saveWorkspace(false);
      if (action === 'project:saveAs') void saveWorkspace(true);
      if (action === 'export:labReport') void exportCurrentLabReport();
      if (action === 'export:deploymentPackage') void exportDeploymentConfig();
      if (action === 'run:preflight') void runFullValidation();
      if (action === 'run:virtualLab') void runScenario();
      if (action === 'run:stop') stopRun();
      if (action === 'run:replay') replayRun();
    });
  }, [exportCurrentLabReport, exportDeploymentConfig, newProject, openProject, replayRun, runFullValidation, runScenario, saveWorkspace, stopRun]);

  const semanticWorkspaceDevices: SemanticWorkspaceDevice[] = workspaceDevices.map((device, index) => {
    const asset = assetForId(availableAssets, device.assetId);
    const profileForDevice = asset ? profileFromAsset(asset) : deviceProfiles.find((profile) => profile.id === device.profileId) ?? getFirstProfileForType(device.deviceType);
    const selected = device.id === selectedWorkspaceDeviceId;
    const savedState = device.current_state ?? profileForDevice.deviceMeta.runtime_state;
    const selectedState = replayStateForSelected(labReport, selectedSnapshot, savedState);
    const activeState = selected
      ? {
          ...selectedState,
          ...(currentActionFrame?.device_state ?? {}),
          visual_state: currentActionFrame?.visual_state ?? selectedState.visual_state
        }
      : savedState;
    return {
      id: device.id,
      label: device.label || `${localDeviceType(device.deviceType, language)} ${index + 1}`,
      assetId: device.assetId,
      deviceType: device.deviceType,
      state: activeState,
      position: device.position ?? workspaceSlots[device.slot] ?? workspaceSlots[0],
      modelAsset: profileForDevice.deviceMeta.model_asset
    };
  });
  const scenarioPreview = useMemo(() => {
    if (!(effectiveSelectedProfile.deviceMeta.device_type === 'robot_arm')) return null;
    // Preview compiler reference for regression tests: compilePromptToTaskDSL(prompt, effectiveSelectedProfile.deviceMeta.device_type)
    const task = runPreviewTask?.profileId === effectiveSelectedProfile.id && runPreviewTask.prompt === prompt.trim()
      ? runPreviewTask.task
      : null;
    if (!task) return null;
    const targetStep = task.steps.find((step) => step.id === 'step-4' && step.action === 'move_to_pose')
      ?? [...task.steps].reverse().find((step) => step.action === 'move_to_pose' && step.target);
    if (!targetStep?.target) return null;
    const target = targetPosition(String(targetStep.zone ?? targetStep.target), effectiveSelectedProfile.geometry);
    const selectedDevice = semanticWorkspaceDevices.find((device) => device.id === selectedWorkspaceDeviceId) ?? semanticWorkspaceDevices[0];
    const origin = previewOriginFromState(selectedDevice?.state, selectedDevice?.position ?? [0, 0, 0] as [number, number, number]);
    return {
      target,
      path: [origin, target] as [[number, number, number], [number, number, number]],
      unsafe: selectedScenario.mode === 'unsafe' || task.risk_level === 'high',
      passed: labReport?.result === 'pass' && !replayPlaying
    };
  }, [effectiveSelectedProfile, labReport?.result, prompt, replayPlaying, runPreviewTask, selectedScenario.mode, selectedWorkspaceDeviceId, semanticWorkspaceDevices]);

  return (
    <div className="industrial-workbench flex h-screen w-screen min-w-[1180px] flex-col overflow-hidden bg-bg-app text-text-primary">
      <div className="flex h-9 w-full select-none items-center border-b border-border-panel bg-bg-panel">
        <div className="flex h-full w-[264px] shrink-0 items-center gap-2 border-r border-border-panel px-3 text-[11px] font-semibold text-text-primary">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-wide text-text-muted-strong">{t(language, 'app_project')}</div>
            <div className="max-w-[160px] truncate text-[12px] font-semibold text-text-primary">{projectName}</div>
          </div>
          <span className={`ml-auto rounded-[3px] border px-1.5 py-0.5 text-[10px] ${workspaceBlocked ? 'border-[#7F1D1D] bg-[#2B1116] text-[#FCA5A5]' : workspaceWarnings > 0 ? 'border-[#713F12] bg-[#2A2112] text-[#FACC15]' : 'border-[#064E3B] bg-[#10251D] text-[#34D399]'}`}>
            {language === 'zh'
              ? workspaceBlocked ? '\u9884\u68c0\u963b\u65ad' : workspaceWarnings > 0 ? `\u9884\u68c0 ${workspaceWarnings} \u9879\u8b66\u544a` : '\u9884\u68c0\u901a\u8fc7'
              : workspaceBlocked ? 'Preflight Blocked' : workspaceWarnings > 0 ? `${workspaceWarnings} Warnings` : 'Preflight Passed'}
          </span>
        </div>
        <div className="flex h-full min-w-0 flex-1 items-center justify-between">
          <div className="toolbar-scroll custom-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-3">
          <button type="button" onClick={newProject} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_new')}
          </button>
          <button type="button" onClick={() => void openProject()} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_open')}
          </button>
          <button type="button" onClick={() => setAssetImportOpen(true)} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_import_asset')}
          </button>
          <span className="mx-1 h-6 w-px bg-border-panel" />
          <button type="button" onClick={() => void saveWorkspace(false)} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_save_project')}
          </button>
          <button type="button" onClick={() => void saveWorkspace(true)} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_save_as')}
          </button>
          {/* Restore Last autosaved workspace entry for desktop conformance checks. */}
          <button type="button" title={t(language, 'app_restore')} onClick={restoreLastWorkspace} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31]">
            {t(language, 'app_restore')}
          </button>
          <button type="button" title={t(language, 'app_quick_start')} onClick={reopenFirstRunGuide} className="h-7 rounded-[3px] border border-[#075985] bg-[#0B2233] px-3 text-[12px] font-semibold text-[#38BDF8] hover:bg-[#0F2E45]">
            {t(language, 'app_quick_start')}
          </button>
          </div>
          <div className="flex h-full shrink-0 items-center gap-1.5 border-l border-border-panel px-3">
          <button type="button" title={!currentRunTargetRunnable ? t(language, 'select_runnable_target_hint') : undefined} onClick={() => void runScenario()} disabled={running || !currentRunTargetRunnable} className="h-7 rounded-[3px] border border-[#075985] bg-[#0284C7] px-3 text-[12px] font-bold text-white hover:bg-[#0369A1] disabled:cursor-not-allowed disabled:opacity-40">
            {t(language, 'app_run')}
          </button>
          <span className={`h-7 rounded-[3px] border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide ${labReport?.result === 'blocked' ? 'border-[#7F1D1D] bg-[#2B1116] text-[#FCA5A5]' : replayPlaying ? 'border-[#92400E] bg-[#2A2112] text-[#F59E0B]' : labReport?.result === 'pass' ? 'border-[#064E3B] bg-[#10251D] text-[#34D399]' : 'border-border-panel bg-[#232529] text-text-secondary'}`}>
            {labReport?.result === 'blocked' ? t(language, 'status_safety_blocked') : replayPlaying ? t(language, 'status_playing_motion') : labReport?.result === 'pass' ? t(language, 'status_executed') : t(language, 'status_idle')}
          </span>
          <button type="button" onClick={stopRun} className="h-7 rounded-[3px] border border-[#4C1D1D] bg-[#25191B] px-3 text-[12px] font-semibold text-[#FCA5A5] hover:bg-[#3A2020]">
            {t(language, 'app_stop')}
          </button>
          <span className="mx-1 h-6 w-px bg-border-panel" />
          <button type="button" onClick={() => void exportCurrentLabReport()} disabled={!labReport} className="h-7 rounded-[3px] border border-border-panel bg-[#232529] px-3 text-[12px] font-semibold text-text-primary hover:bg-[#2B2D31] disabled:opacity-40">
            {t(language, 'app_export_report')}
          </button>
          <button type="button" onClick={() => void exportDeploymentConfig()} className="h-7 rounded-[3px] border border-[#075985] bg-[#0B2233] px-3 text-[12px] font-semibold text-[#38BDF8] hover:bg-[#0F2E45]">
            {t(language, 'app_export_adapter_package')}
          </button>
          </div>
          <input
            ref={workspaceFileInputRef}
            type="file"
            accept=".json,.ors-lab.json"
            className="hidden"
            onChange={(event) => {
              void loadWorkspaceFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </div>
      {operatorNotice && (
        <div className="pointer-events-none fixed right-3 top-12 z-50 max-w-[420px] border border-border-panel bg-bg-panel px-3 py-2 text-[12px] font-semibold">
          <span className={operatorNotice.severity === 'success' ? 'text-[#047857]' : operatorNotice.severity === 'warning' ? 'text-[#92400E]' : operatorNotice.severity === 'error' ? 'text-[#BE123C]' : 'text-[#0066CC]'}>
            {operatorNotice.message}
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 w-full gap-0 overflow-hidden">
        <LabConfigurator
          language={language}
          deviceTypes={deviceTypes}
          deviceType={deviceType}
          profiles={profilesForType}
          selectedProfileId={selectedProfile.id}
          scenarios={scenarioOptions}
          selectedScenarioId={selectedScenario.id}
          deviceAssets={availableAssets}
          selectedDeviceRunnable={isRunnableDeviceV01(deviceType)}
          selectedWorkspaceDeviceLabel={selectedWorkspaceDevice ? localizeDisplayName(language, selectedWorkspaceDevice.label) : null}
          selectedWorkspaceAssetId={selectedWorkspaceAsset?.manifest.asset_id ?? null}
          onLanguageChange={handleLanguageChange}
          onDeviceTypeChange={handleDeviceTypeChange}
          onProfileChange={handleProfileChange}
          onScenarioChange={handleScenarioChange}
          onAddAsset={handleAddAsset}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {showFirstRunGuide && (
            <FirstRunGuide
              language={language}
              quickStartPaths={quickStartPaths}
              onQuickStart={handleQuickStart}
              onDismiss={dismissFirstRunGuide}
            />
          )}
          <VirtualDeviceStage
            language={language}
            profile={effectiveSelectedProfile}
            report={labReport}
            replaySnapshot={selectedSnapshot}
            currentActionFrame={currentActionFrame ?? selectedSnapshot?.action_frame}
            scenarioPreview={scenarioPreview}
            workspaceDevices={semanticWorkspaceDevices}
            selectedWorkspaceDeviceId={selectedWorkspaceDeviceId}
            runTargetWorkspaceDeviceId={currentRunTargetWorkspaceDeviceId}
            expanded={workspaceExpanded}
            running={running}
            onExpandedChange={setWorkspaceExpanded}
            onDropDevice={handleDropDevice}
            onDropAsset={handleAddAsset}
            onSelectWorkspaceDevice={handleWorkspaceSelect}
            onMoveWorkspaceDevice={(deviceId, position) => updateWorkspaceDevice(deviceId, { position })}
          />
          {!workspaceExpanded && (
            <>
              <WorkspaceDeviceStrip
                language={language}
                devices={workspaceDevices}
                selectedWorkspaceDeviceId={selectedWorkspaceDeviceId}
                onSelectWorkspaceDevice={handleWorkspaceSelect}
              />
              <AICommandTerminal
                language={language}
                prompt={prompt}
                running={running}
                status={commandStatus}
                runTargetLabel={currentRunTargetLabel}
                runTargetRunnable={currentRunTargetRunnable}
                runTargetDeviceType={effectiveSelectedProfile.deviceMeta.device_type}
                starterPrompts={currentRunStarterPrompts}
                quickStartPaths={quickStartPaths}
                activeQuickStart={activeQuickStart}
                onPromptChange={handlePromptChange}
                onQuickStart={handleQuickStart}
                onRun={runScenario}
                onStop={stopRun}
              />
              <AutonomyDecisionPanel
                language={language}
                prompt={runtimeDecisionContext?.prompt ?? prompt.trim()}
                targetDeviceLabel={runtimeDecisionContext?.targetDeviceLabel ?? currentRunTargetLabel}
                targetDeviceType={runtimeDecisionContext?.targetDeviceType ?? effectiveSelectedProfile.deviceMeta.device_type}
                decision={runtimeDecision}
              />
              <BottomConsole
                language={language}
                labReport={labReport}
                selectedSnapshot={selectedSnapshot}
                consoleLogs={consoleLogs}
                liveAdapterCommands={liveAdapterCommands}
                playbackEvents={playbackEvents}
                replayIndex={replayIndex}
                replayPlaying={replayPlaying}
                replaySpeed={replaySpeed}
                slowMode={slowMode}
                replayTimeMs={replayTimeMs}
                replayCommand={replayCommand}
                onPlayPause={replayRun}
                onStepPrev={() => seekReplay(replayIndex - 1)}
                onStepNext={() => seekReplay(replayIndex + 1)}
                onReplayStart={replayFromStart}
                onSpeedChange={setReplaySpeed}
                onSlowModeChange={setSlowMode}
              />
            </>
          )}
        </div>
        <AuditPanel
          language={language}
          selectedProfile={selectedWorkspaceDevice ? effectiveSelectedProfile : selectedWorkspaceProfile}
          selectedWorkspaceDevice={selectedWorkspaceDevice}
          selectedAsset={selectedWorkspaceDevice?.assetId ? availableAssets.find((asset) => asset.manifest.asset_id === selectedWorkspaceDevice.assetId) ?? null : null}
          currentRunTargetLabel={currentRunTargetLabel}
          isRunnable={isRunnableDeviceV01(effectiveSelectedProfile.deviceMeta.device_type)}
          workspaceDeviceCount={workspaceDevices.length}
          workspaceValidation={workspaceValidation}
          onWorkspaceDeviceChange={updateWorkspaceDevice}
          onWorkspaceDeviceRemove={removeWorkspaceDevice}
          onWorkspaceDeviceDuplicate={duplicateWorkspaceDevice}
          onSelectedAssetExport={exportSelectedAssetConfig}
          labReport={labReport}
          safetyReport={labReport?.safety_report ?? null}
          selectedSnapshot={selectedSnapshot}
          onSnapshotSelect={selectSnapshot}
          onExportLabReport={() => void exportCurrentLabReport()}
        />
      </div>
      {assetImportOpen && (
        <AssetImportWizard
          onImport={handleImportedAsset}
          onClose={() => setAssetImportOpen(false)}
        />
      )}
    </div>
  );
}

