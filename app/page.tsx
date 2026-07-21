'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuditPanel } from '@/components/AuditPanel';
import { AutonomyDecisionPanel } from '@/components/AutonomyDecisionPanel';
import { AssetImportWizard } from '@/components/AssetImportWizard';
import { ActionComposer, BUILTIN_INTENT_IDS } from '@/components/ActionComposer';
import { AccessibleDialogBoundary } from '@/components/AccessibleDialogBoundary';
import { validateActionManifest } from '@/lib/action-manifest/ActionManifest';
import type { ActionManifest } from '@/lib/action-manifest/ActionManifest';
import { LabConfigurator } from '@/components/LabConfigurator';
import { RealHardwarePanel } from '@/components/RealHardwarePanel';
import { RealDeviceWorkspace } from '@/components/RealDeviceWorkspace';
import { EvidenceSidebar } from '@/components/EvidenceSidebar';
import { AppHeader } from '@/components/AppHeader';
import { exportAuditReceiptFiles } from '@/lib/export/exportAuditReceipt';
import packageJson from '@/package.json';
import { MarketplaceManager } from '@/components/MarketplaceManager';
import { ManualImportWizard } from '@/components/ManualImportWizard';
import { OperatorNotice } from '@/components/OperatorNotice';
import type { OperatorNoticeAction, OperatorNoticeState } from '@/components/OperatorNotice';
import { enableManualImportForVirtualLab, restoreEnabledManualSimulationAsset, validateStoredManualImport, type ManualImportRecord } from '@/lib/manual-import/ManualProfileImport';
import type { HardwareBridge } from '@/components/RealHardwarePanel';
import { REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS } from '@/lib/hardware/TeachMode';
import type { RealHardwareTelemetry } from '@/types/realHardwareTelemetry';
import type { UiLanguage } from '@/components/LabConfigurator';
import { RealityAssetCatalog } from '@/components/RealityAssetCatalog';
import { VirtualDeviceStage } from '@/components/VirtualDeviceStage';
import type { SemanticWorkspaceDevice } from '@/components/SemanticDeviceStage';
import { builtInDeviceAssets } from '@/lib/assets/DeviceAssetRegistry';
import type { DeviceAsset } from '@/lib/assets/DeviceAsset';
import { validateDeviceAsset } from '@/lib/assets/DeviceAssetValidator';
import type { AdapterCommand } from '@/lib/adapter/AdapterCommand';
import type { ActionFrame } from '@/lib/action-runtime/ActionState';
import { localizeDeviceType, localizeDisplayName, t } from '@/lib/i18n';
import type { OpenRealityRuntimeResult } from '@/lib/open-reality-runtime/types';
import { getBuiltinRealityAssets } from '@/lib/reality-assets';
import {
  bindMarketplaceAssetToVirtualLab,
  marketplaceWorkspaceReference,
  removeUnavailableMarketplaceWorkspaceDevices,
  type MarketplaceWorkspaceReference,
  type VerifiedMarketplaceRuntimeAsset
} from '@/lib/marketplace';
import { buildLocalRuntimeDecisionLabReport } from '@/lib/reporting/buildLabReport';
import { PlaybackEngine } from '@/lib/action-runtime/PlaybackEngine';
import type { PlaybackEvent } from '@/lib/action-runtime/PlaybackEngine';
import { targetPosition } from '@/lib/action-runtime/TargetResolver';
import { tryCompilePromptToTaskDSL } from '@/lib/compiler/mockTaskCompiler';
import { LlmTaskCompiler } from '@/lib/compiler/llm/LlmTaskCompiler';
import { compileTaskDslWithFallback } from '@/lib/compiler/llm/compileWithFallback';
import type { CompileWithFallbackResult } from '@/lib/compiler/llm/compileWithFallback';
import { deviceProfiles } from '@/lib/profiles/deviceProfiles';
import { LocalRuntime } from '@/lib/runtime/LocalRuntime';
import type { LabReport, TimelineStateSnapshot } from '@/lib/virtual-lab/LabReport';
import type { DeviceScenario } from '@/lib/virtual-lab/DeviceScenario';
import { LiveScenarioRunner } from '@/lib/virtual-lab/LiveScenarioRunner';
import { ScenarioRunner } from '@/lib/virtual-lab/ScenarioRunner';
import { deviceScenarios, getScenarioForProfile } from '@/lib/virtual-lab/scenarios';
import type { DeviceType } from '@/types/deviceMeta';
import type { TaskDSL } from '@/types/taskDsl';
import { MAX_PROJECT_FILE_BYTES, serializeOpenRealityProjectFile, validateLabWorkspaceFile, validateOpenRealityProjectFile } from '@/lib/project/ProjectFileContract';
import { discardProjectAutosave, loadProjectAutosave, saveProjectAutosave } from '@/lib/project/ProjectAutosaveStore';

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
  version: 3;
  saved_at: string;
  language: UiLanguage;
  selected_profile_id: string;
  selected_scenario_id: string;
  selected_workspace_device_id: string | null;
  prompt: string;
  devices: WorkspaceDeviceRecord[];
  imported_assets: DeviceAsset[];
  marketplace_assets: MarketplaceWorkspaceReference[];
  /** v0.4 custom actions (untrusted on load; revalidated per manifest). */
  custom_actions?: unknown[];
  /** v0.5 reviewed, simulation-only manual import proposals. */
  manual_imports?: unknown[];
}

interface OpenRealityProjectFile {
  project: {
    name: string;
    file_type: 'open_reality_desktop_project';
    version: 3;
  };
  devices: WorkspaceDeviceRecord[];
  scenarios: Array<{ id: string; device_profile: string; prompt: string; expected_safety_result: string }>;
  profiles: Array<{ id: string; device_type: DeviceType; label: string }>;
  workspace: LabWorkspaceFile;
  lab_reports: LabReport[];
  metadata: {
    saved_at: string;
    app: 'RealityWarden Desktop';
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
      support: {
        openGuide: () => Promise<{ ok: boolean; error?: string }>;
        exportDiagnostics: () => Promise<{ canceled: boolean; filePath?: string }>;
        showAbout: () => Promise<void>;
      };
      onMenuAction: (callback: (action: OpenRealityMenuAction) => void) => () => void;
      hardware?: HardwareBridge;
      marketplace?: {
        state: () => Promise<unknown>;
        catalog: (useCache: boolean) => Promise<unknown>;
        reviewCatalogPackage: (packageId: string, packageVersion: string, catalogDigestSha256: string) => Promise<unknown>;
        runtimeAssets: () => Promise<unknown>;
        browsePackage: () => Promise<unknown>;
        browseSubmissionAsset: () => Promise<unknown>;
        exportSubmissionDraft: (rawAsset: unknown, sourcePackageId: string | null, changeSummary: string, confirmed: boolean) => Promise<unknown>;
        install: (rawPackage: unknown, confirmed: boolean) => Promise<unknown>;
        enableSimulation: (packageId: string, confirmed: boolean) => Promise<unknown>;
        uninstall: (packageId: string, confirmed: boolean) => Promise<unknown>;
        browsePublisher: () => Promise<unknown>;
        trustPublisher: (rawPublisher: unknown, confirmed: boolean) => Promise<unknown>;
        revokePublisher: (keyId: string, confirmed: boolean) => Promise<unknown>;
        resetState: (confirmed: boolean) => Promise<unknown>;
      };
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

interface CommandTerminalStatus {
  kind: 'ready' | 'running' | 'completed' | 'blocked' | 'ask_human' | 'proposed_plan' | 'coming_soon' | 'failed';
  message: string;
}

/**
 * Single authoritative run-state vocabulary — one run, one set of words.
 *
 * Before this existed the same run was described three times by three
 * independently-derived expressions: CommandDock read `commandStatus.kind`,
 * AppHeader re-derived its own `result` from `labReport.result` plus
 * `replayPlaying`, and the right rail keyed evidence off a third ad-hoc
 * expression. They could disagree — a command refused during compilation
 * never produces a lab report, so the header still read "idle" while the AI
 * terminal read "BLOCKED". A gateway product cannot show two answers to
 * "was it allowed?".
 *
 * `deriveRunState` below is now the only place a run is turned into a phase.
 * CommandDock, AppHeader and the evidence rail consume its projections and
 * MUST NOT recompute their own.
 */
type RunPhase =
  | 'idle'
  | 'gated'
  | 'executed'
  | 'blocked'
  | 'awaiting_human'
  | 'unsupported'
  | 'failed';

interface AuthoritativeRunState {
  /** The one phase every surface renders. */
  phase: RunPhase;
  /** A run is in flight (drives the disabled Run control). */
  active: boolean;
  /** Projection consumed by CommandDock's primary badge. */
  command: CommandTerminalStatus;
  /** Projection consumed by the AppHeader status badge. */
  headerResult: RunPhase;
  /** Projection consumed by the right evidence rail's remount identity. */
  evidenceKey: string | null;
}

function deriveRunState(input: {
  command: CommandTerminalStatus;
  running: boolean;
  replayPlaying: boolean;
  evidencePrompt: string | null;
  labRunId: string | null;
}): AuthoritativeRunState {
  // A terminal verdict always outranks "still draining" playback: a refusal
  // must never be overwritten by a replay that is still winding down.
  const phase: RunPhase =
    input.command.kind === 'blocked' ? 'blocked'
      : input.command.kind === 'failed' ? 'failed'
        : input.command.kind === 'coming_soon' ? 'unsupported'
          : input.command.kind === 'ask_human' || input.command.kind === 'proposed_plan' ? 'awaiting_human'
            : input.command.kind === 'completed' ? 'executed'
              : input.command.kind === 'running' || input.running || input.replayPlaying ? 'gated'
                : 'idle';
  return {
    phase,
    active: input.running,
    command: input.command,
    headerResult: phase,
    evidenceKey: input.evidencePrompt ?? input.labRunId ?? (input.running ? 'gated' : null)
  };
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
const builtinRealityAssets = getBuiltinRealityAssets();
const firstRunGuideStorageKey = 'open-reality-studio:first-run-guide-dismissed';
const firstRunDemoStorageKey = 'realitywarden:first-run-demo-done';
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
    ? ['[INFO] RealityWarden ready.', '[INFO] 工作区已初始化。', '[INFO] 默认路径已就绪：机械臂 -> 把红方块放到后侧安全区。']
    : ['[INFO] RealityWarden ready.', '[INFO] Workspace initialized.', '[INFO] Default path ready: Robot Arm -> move the red cube to the back safe zone.'];
}

function downloadJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
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

const LLM_COMPILER_BASE_URL = 'http://127.0.0.1:11434';
const LLM_COMPILER_MODEL = 'qwen2.5:3b';

async function sha256Hex(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getWorkspaceIssues(
  devices: WorkspaceDeviceRecord[],
  report: LabReport | null,
  workspaceValidation: WorkspaceValidationResult | null,
  language: UiLanguage
): WorkspaceIssue[] {
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

  if (workspaceValidation && workspaceValidation.result !== 'pass') {
    issues.push({
      id: 'workspace-validation-not-pass',
      severity: 'blocked',
      title: language === 'zh' ? '\u5de5\u4f5c\u533a\u6574\u4f53\u9a8c\u8bc1\u672a\u901a\u8fc7' : 'Workspace validation did not pass',
      detail: language === 'zh'
        ? `\u6574\u4f53\u9a8c\u8bc1\u7ed3\u679c\u4e3a ${workspaceValidation.result}\uff0c\u4e0d\u80fd\u4ec5\u4f9d\u636e\u6700\u540e\u4e00\u53f0\u8bbe\u5907\u7684\u62a5\u544a\u5c06\u5de5\u4f5c\u533a\u6807\u8bb0\u4e3a\u5c31\u7eea\u3002`
        : `Workspace validation is ${workspaceValidation.result}; a passing report from only the last device cannot mark the workspace ready.`
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

const maxPersistedModelBytes = 12 * 1024 * 1024;

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the selected model bytes.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Model conversion did not produce text.'));
    reader.readAsDataURL(blob);
  });
}

async function makeImportedAssetPortable(asset: DeviceAsset) {
  const path = asset.manifest.visual_model.path;
  if (!path || path.startsWith('data:')) return asset;
  if (!path.startsWith('blob:')) throw new Error('Imported model paths must be embedded; external and machine-local paths are not portable.');
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Unable to read imported model (${response.status}).`);
    const blob = await response.blob();
    if (blob.size > maxPersistedModelBytes) throw new Error(`Imported model exceeds ${maxPersistedModelBytes} bytes.`);
    const portablePath = await blobAsDataUrl(blob);
    return {
      ...asset,
      manifest: {
        ...asset.manifest,
        visual_model: { ...asset.manifest.visual_model, path: portablePath }
      }
    };
  } finally {
    URL.revokeObjectURL(path);
  }
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
  const [expanded, setExpanded] = useState(false);
  const tabs = language === 'zh'
    ? [t(language, 'replay'), t(language, 'adapter_commands'), t(language, 'state_diff'), t(language, 'logs')]
    : [t(language, 'replay'), t(language, 'adapter_commands'), t(language, 'state_diff'), t(language, 'logs')];
  const commands = labReport?.adapter_commands ?? liveAdapterCommands;
  const logs = labReport?.execution_timeline ?? [];
  const latestLog = logs.length > 0
    ? logs[logs.length - 1]?.message
    : consoleLogs[consoleLogs.length - 1] ?? t(language, 'waiting_run');
  return (
    <div className={`${expanded ? 'h-[144px] max-h-[15vh]' : 'h-8'} border-t border-border-panel bg-[#0F111A] text-text-primary`}>
      <div className="flex h-8 items-center border-b border-border-panel bg-bg-panel px-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mr-2 flex h-5 w-6 items-center justify-center border border-border-panel bg-[#181B26] text-[11px] font-bold text-text-secondary hover:bg-[#232736]"
          title={expanded ? 'Collapse console' : 'Expand console'}
        >
          {expanded ? 'v' : '^'}
        </button>
        {tabs.map((tab, index) => (
          <div key={tab} className={`hidden h-full items-center border-b px-3 text-[11px] font-semibold sm:flex ${index === 0 ? 'border-selected text-text-primary' : 'border-transparent text-text-secondary'}`}>
            {tab}
          </div>
        ))}
        <div className="ml-auto truncate font-mono text-[11px] text-text-secondary">
          {replayPlaying ? t(language, 'status_playing_motion') : latestLog}
        </div>
      </div>
      {expanded && (
      <div className="grid h-[calc(100%-2rem)] grid-cols-[1.05fr_1fr_.8fr_1fr] overflow-hidden font-mono text-[11px]">
        <div className="custom-scrollbar overflow-auto border-r border-border-panel p-1.5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'current_playback')}</div>
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
                className={`h-5 border px-1.5 text-[11px] font-semibold ${replaySpeed === speed ? 'border-selected bg-[#0B2233] text-[#38BDF8]' : 'border-[#30363D] bg-[#1E1F22] text-text-secondary hover:bg-[#2B2D31]'}`}
              >
                {speed}x
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-[11px] text-text-secondary">
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
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'adapter_commands')}</div>
          {commands.length === 0 && <div className="text-text-secondary">{t(language, 'no_commands_generated')}</div>}
          {commands.map((command) => {
            const commandEvents = playbackEvents.filter((event) => event.command_id === command.id);
            const isCurrent = command.id === replayCommand || command.id === selectedSnapshot?.command_id;
            const isBlocked = commandEvents.some((event) => event.status === 'blocked') || command.allowed === false;
            const isCompleted = commandEvents.length > 0 && playbackEvents.findIndex((event) => event.command_id === command.id) < replayIndex && !isCurrent;
            return (
            <div key={command.id} className={`mb-1 border-l-2 px-2 py-1 ${isBlocked ? 'border-blocked bg-[#3A2028] text-status-blocked-soft' : isCurrent ? 'border-selected bg-[#232D36] text-text-primary' : isCompleted ? 'border-pass bg-[#1D2B24] text-[#A7F3D0]' : 'border-transparent text-text-secondary'}`}>
              {command.id} / {command.action} / {command.target ?? '-'}
            </div>
          );})}
        </div>
        <div className="custom-scrollbar overflow-auto border-r border-border-panel p-1.5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'state_diff')}</div>
          <div className="text-text-secondary">{selectedSnapshot?.changed_keys?.length ? selectedSnapshot.changed_keys.join(', ') : t(language, 'waiting_state_changes')}</div>
        </div>
        <div className="custom-scrollbar overflow-auto p-1.5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'logs')}</div>
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
      )}
    </div>
  );
}

function CommandDock({
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
  llmChip,
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
  llmChip: { state: 'checking' | 'online' | 'offline' | 'compiling'; model: string };
  onPromptChange: (prompt: string) => void;
  onQuickStart: (path: QuickStartPath) => void;
  onRun: () => void;
  onStop: () => void;
}) {
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
      ? 'border-status-blocked-edge bg-status-blocked-surface text-status-blocked-soft'
      : status.kind === 'running'
        ? 'border-status-running-edge bg-status-warning-surface text-status-running'
      : status.kind === 'completed'
        ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft'
        : status.kind === 'coming_soon'
          ? 'border-status-warning-edge bg-status-warning-surface text-status-warning'
        : status.kind === 'ask_human' || status.kind === 'proposed_plan'
          ? 'border-status-warning-edge bg-status-warning-surface text-status-warning'
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
    ? `${primaryStarter} · ${t(language, 'command_result_workspace_above')}`
    : labels.placeholder;
  const llmChipText =
    llmChip.state === 'online' ? `LLM: ${llmChip.model}`
      : llmChip.state === 'compiling' ? (language === 'zh' ? 'LLM 编译中…' : 'LLM compiling…')
        : llmChip.state === 'offline' ? (language === 'zh' ? '规则编译器（LLM 离线）' : 'rule compiler (LLM offline)')
          : 'LLM …';
  const llmChipTitle = language === 'zh'
    ? '本地 LLM 编译器（Ollama）。启用：安装 Ollama，运行 ollama pull qwen2.5:3b 并保持 Ollama 运行。离线时显式回退到规则编译器，安全管线完全不变。'
    : 'Local LLM compiler (Ollama). Enable: install Ollama, run `ollama pull qwen2.5:3b`, keep Ollama running. When offline the rule compiler runs instead — explicitly, with the safety pipeline unchanged.';

  const submit = () => {
    if (!running && runTargetRunnable) onRun();
  };

  return (
    <section data-component="CommandDock" className="flex flex-none flex-col gap-2 border-y border-border bg-surface px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="rw-text-title shrink-0 text-text-primary">{labels.label}</h2>
        <div className={`inline-flex h-6 shrink-0 items-center border px-2 text-[12px] font-bold uppercase tracking-wide ${badgeClass}`} aria-live="polite" data-command-state={status.kind}>
          {badgeText}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-[12px]">
          <span className="shrink-0 text-text-secondary">{t(language, 'active_workspace_device')}:</span>
          <span className="truncate font-semibold text-text-primary" title={runTargetLabel}>{runTargetLabel}</span>
          <span className={`shrink-0 border px-1.5 py-0.5 font-bold ${runTargetRunnable ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>
            {runTargetRunnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-stretch gap-2">
        <div className="flex min-h-[60px] min-w-0 flex-1 items-stretch border border-border-strong bg-background focus-within:border-accent">
          <div className="flex shrink-0 items-center border-r border-border px-2 font-mono text-[11px] font-bold text-simulation">USER &gt;</div>
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
            rows={2}
            className="min-h-[58px] max-h-32 min-w-0 flex-1 resize-y border-0 bg-transparent px-3 py-2 font-mono text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
            placeholder={guidedPlaceholder}
          />
        </div>
        <button
          type="button"
          data-run-control
          aria-label={labels.run}
          disabled={running || !runTargetRunnable}
          onClick={submit}
          className="h-10 self-start border border-accent bg-accent px-5 text-[13px] font-semibold text-[#061018] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? labels.running : labels.run}
        </button>
        <button
          type="button"
          data-stop-control
          aria-label={labels.stop}
          onClick={onStop}
          className="h-10 self-start border border-status-blocked-edge px-4 text-[13px] font-semibold text-status-blocked-soft hover:bg-status-blocked-surface"
        >
          {labels.stop}
        </button>
      </div>

      <details className="border-t border-border pt-1">
        <summary className="cursor-pointer select-none text-[12px] font-semibold text-text-secondary hover:text-text-primary">
          {language === 'zh' ? '命令详情' : 'Command details'}
          <span className="ml-2 font-normal text-text-muted">{language === 'zh' ? '编译器、诊断、快捷路径与示例' : 'compiler, diagnostics, quick paths & examples'}</span>
        </summary>
        <div className="custom-scrollbar mt-2 grid max-h-[28vh] grid-cols-2 gap-3 overflow-y-auto border border-border bg-background p-3 text-[12px] max-[1280px]:grid-cols-1">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-text-secondary">{language === 'zh' ? '编译来源' : 'Compiler source'}</span>
              <span className={`inline-flex h-5 max-w-full items-center truncate border px-1.5 font-mono text-[11px] ${llmChip.state === 'online' || llmChip.state === 'compiling' ? 'border-status-running-edge text-status-running' : 'border-border text-text-secondary'}`} title={llmChipTitle}>
                {llmChipText}
              </span>
            </div>
            <div>
              <div className="font-semibold text-text-secondary">{language === 'zh' ? '诊断说明' : 'Diagnostic note'}</div>
              <div className="mt-1 text-text-primary">{status.message}</div>
              <div className="mt-1 text-text-secondary">{t(language, 'workspace_selection_run_same')} · {t(language, 'command_safe_blocked_notice')}</div>
            </div>
            <button type="button" disabled title={language === 'zh' ? '多路径验证将在后续版本提供。' : 'Multi-path validation ships in a later version.'} className="h-7 border border-border px-2 text-[12px] text-text-secondary opacity-40">
              {labels.validate}
            </button>
          </div>

          <div className="min-w-0 space-y-2">
            <div className="font-semibold text-text-secondary">{t(language, 'starter_commands')}</div>
            <div className="flex flex-wrap gap-1.5">
              {starterPrompts.length > 0 ? starterPrompts.map((starter) => (
                <button key={`${runTargetDeviceType}-${starter}`} type="button" onClick={() => onPromptChange(starter)} title={starter} className="max-w-full truncate border border-border bg-surface-raised px-2 py-1 text-[12px] text-text-primary">
                  {starter}
                </button>
              )) : <span className="text-text-muted">{t(language, 'no_starter_commands')}</span>}
            </div>
            {!runTargetRunnable && (
              <div className="border border-status-warning-edge bg-status-warning-surface p-2 text-status-warning">
                <div className="font-semibold">{t(language, 'asset_only_runtime_title')}</div>
                <div className="mt-1 text-text-secondary">{t(language, 'asset_only_runtime_detail')}</div>
                <div className="mt-2 text-[11px] font-bold uppercase tracking-wide">{t(language, 'jump_to_runnable_path')}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickStartPaths.map((path) => (
                    <button key={`jump-${path.id}`} type="button" onClick={() => onQuickStart(path)} className="border border-status-warning-edge px-2 py-1 text-[12px] font-semibold text-status-warning">
                      {localizeDeviceType(language, path.deviceType)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeQuickStart && (
              <div className="border border-border bg-surface p-2 text-text-secondary">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{t(language, 'guided_evaluation')}</div>
                <div className="font-semibold text-simulation">{t(language, 'current_path')}: {activeQuickStart.title}</div>
                <div className="mt-1"><span className="font-semibold text-text-primary">{t(language, 'quick_start_expected')}:</span> {activeQuickStart.expected}</div>
                <div className="mt-1"><span className="font-semibold text-text-primary">{t(language, 'quick_start_proof')}:</span> {activeQuickStart.proof}</div>
                <div className="mt-1"><span className="font-semibold text-text-primary">{t(language, 'quick_start_validates')}:</span> {activeQuickStart.validates}</div>
                {nextQuickStart && <button type="button" onClick={() => onQuickStart(nextQuickStart)} className="mt-2 border border-border px-2 py-1 text-text-primary">{t(language, 'next_path')}: {nextQuickStart.title} · {t(language, 'try_next')}</button>}
              </div>
            )}
          </div>
        </div>
      </details>
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
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t(language, 'workspace_devices')}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-[#6B7280]">{t(language, 'workspace_activate_device')}</div>
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
              <span className="rounded-[3px] border border-border-panel px-1 py-0.5 text-[11px] font-bold text-text-secondary">
                {localizeDeviceType(language, device.deviceType)}
              </span>
              <span className={`rounded-[3px] border px-1 py-0.5 text-[11px] font-bold ${runnable ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>
                {runnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
              </span>
              {selected && (
                <span className="rounded-[3px] border border-[#075985] bg-[#12324B] px-1 py-0.5 text-[11px] font-bold text-[#7DD3FC]">
                  {t(language, 'active_workspace_device')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="hidden max-w-[240px] shrink-0 text-right text-[11px] leading-4 text-[#6B7280] xl:block">
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
  const copy = language === 'zh'
    ? {
        headline: 'AI 不应该直接触碰现实。',
        subtitle: 'RealityWarden 是 AI 与真实执行器之间的举证型安全网关：每个动作都过门、可拒绝、有回执。',
        eyebrow: 'REAL-first Public Alpha',
        boundary: '真机执行仅限已审参考台 · 逐次人工确认',
        trySimulation: '试运行仿真',
        exploreAssets: '查看 Reality Assets',
        gateLeft: 'AI 意图',
        gateCenter: '安全门',
        gateRight: '结果 + 回执',
        chips: ['REAL-first', 'Safety-Governed', 'Receipted Physical AI'],
        pipelineTitle: 'Runtime Decision Pipeline',
        pipelineSubtitle: '自然语言命令先经过目标、能力、世界状态与新鲜传感器证据检查。',
        prompt: '“Move the red cube to the safe zone.”',
        decisionSafe: 'SAFE TO SIMULATE',
        decisionBlocked: 'BLOCKED · 拒绝连同证据写入审计',
        assetTitle: 'Abstracting hardware into safe boundaries.',
        assetSubtitle: 'Reality Assets 在任何 AI 动作运行前描述设备能力、安全边界、适配器模式和示例指令。',
        auditTitle: 'Every decision leaves a receipt.',
        auditSubtitle: '记录请求、检查、放行或拦截原因与信号证据，随时导出防篡改审计回执。',
        ecosystemTitle: 'Built for teams that must prove safety.',
        ecosystemSubtitle: '当客户、保险或审计方索要安全证明时，你交出的不是承诺，而是可独立校验的回执。',
        advancedTitle: 'Developer / Advanced',
        advancedSubtitle: '导入、验证、目录和开发者工具被收进高级区域，不污染首屏主路径。',
        dismiss: '进入工作台'
      }
    : {
        headline: 'AI should not touch reality directly.',
        subtitle: 'RealityWarden is the evidence-grade safety gateway between AI intent and real actuators: every action gated, refusable, and receipted.',
        eyebrow: 'REAL-first Public Alpha',
        boundary: 'Real execution: reviewed reference rig only · per-run operator confirmation',
        trySimulation: 'Try Simulation',
        exploreAssets: 'Explore Reality Assets',
        gateLeft: 'AI Intent',
        gateCenter: 'Safety Gate',
        gateRight: 'Outcome + Receipt',
        chips: ['REAL-first', 'Safety-Governed', 'Receipted Physical AI'],
        pipelineTitle: 'Runtime Decision Pipeline',
        pipelineSubtitle: 'A natural-language command is checked against goals, capabilities, world state, and fresh sensor evidence.',
        prompt: '“Move the red cube to the safe zone.”',
        decisionSafe: 'SAFE TO SIMULATE',
        decisionBlocked: 'BLOCKED · refusal recorded with evidence',
        assetTitle: 'Abstracting hardware into safe boundaries.',
        assetSubtitle: 'Reality Assets describe device capabilities, safety notes, adapter boundaries, and example prompts before any AI action can run.',
        auditTitle: 'Every decision leaves a receipt.',
        auditSubtitle: 'What was requested, what was checked, why it was allowed or blocked, and honest signal evidence — exportable as a tamper-evident audit receipt.',
        ecosystemTitle: 'Built for teams that must prove safety.',
        ecosystemSubtitle: 'When a customer, insurer, or auditor asks for proof, you hand them an independently verifiable receipt — not a promise.',
        advancedTitle: 'Developer / Advanced',
        advancedSubtitle: 'Import, validation, catalog, and developer-kit entry points stay available without polluting the first-run path.',
        dismiss: 'Enter Workbench'
      };
  const pipeline = ['Goal Parsing', 'Device Capability Check', 'World State Validation', 'Fresh Evidence Check', 'Safety Governor', 'Decision + Receipt'];
  const assetCards = [
    ['Robot Arm', 'pick / place', 'Simulation Only'],
    ['Smart Light', 'power / color', 'Simulation Only'],
    ['Camera Sensor', 'capture / read', 'Read Only'],
    ['Imported Asset', 'validate / inspect', 'Real disabled']
  ];
  const roles = ['Customers', 'Insurers', 'Auditors', 'Integrators', 'Safety Reviewers'];
  return (
    <section className="custom-scrollbar max-h-full overflow-y-auto border border-[#27272A] bg-black/92 p-6 text-white backdrop-blur-xl">
      <div className="grid gap-8 xl:grid-cols-[1.1fr_.9fr]">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="border border-[#3F3F46] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#D4D4D8]">{copy.eyebrow}</span>
            <span className="border border-[#3F3F46] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1AA]">{copy.boundary}</span>
          </div>
          <h1 className="max-w-3xl text-[52px] font-semibold leading-[0.98] tracking-[-0.04em] text-white">{copy.headline}</h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-[#A1A1AA]">{copy.subtitle}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            {recommendedPath && (
              <button type="button" onClick={() => onQuickStart(recommendedPath)} className="h-10 border border-white bg-white px-5 text-[13px] font-semibold text-black hover:bg-[#E4E4E7]">
                {copy.trySimulation}
                <span className="sr-only">{t(language, 'quick_start_try_now')}</span>
              </button>
            )}
            <button type="button" onClick={onDismiss} className="h-10 border border-[#3F3F46] bg-[#0A0A0A] px-5 text-[13px] font-semibold text-[#E4E4E7] hover:bg-[#18181B]">
              {copy.exploreAssets}
            </button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {copy.chips.map((chip) => (
              <span key={chip} className="border border-[#27272A] bg-[#09090B] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A1A1AA]">{chip}</span>
            ))}
          </div>
          <div className="mt-6 grid gap-2 md:grid-cols-3">
            {quickStartPaths.map((path) => (
              <button
                key={`guide-${path.id}`}
                type="button"
                onClick={() => onQuickStart(path)}
                className="border border-[#27272A] bg-[#050505] p-3 text-left hover:border-[#52525B] hover:bg-[#0A0A0A]"
                title={path.prompt}
              >
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#71717A]">{localizeDeviceType(language, path.deviceType)}</div>
                <div className="mt-1 text-[13px] font-semibold text-white">{path.title}</div>
                <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-[#A1A1AA]">{path.expected}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="border border-[#27272A] bg-[#050505] p-5">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">{copy.gateLeft}</div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 16 }).map((_, index) => (
                  <span key={index} className="h-2 w-2 rounded-full bg-white/20" />
                ))}
              </div>
            </div>
            <div className="flex h-48 w-16 flex-col items-center justify-center border-x border-white/20">
              <div className="h-full w-px bg-gradient-to-b from-transparent via-white to-transparent" />
              <div className="my-3 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.16em] text-white [writing-mode:vertical-rl]">{copy.gateCenter}</div>
              <div className="h-full w-px bg-gradient-to-b from-transparent via-white to-transparent" />
            </div>
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">{copy.gateRight}</div>
              <div className="relative h-40 border border-[#3F3F46] bg-[linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] bg-[size:22px_22px]">
                <div className="absolute bottom-7 left-8 h-12 w-24 border border-white/70" />
                <div className="absolute bottom-7 right-8 h-20 w-8 border border-white/45" />
                <div className="absolute bottom-20 left-16 h-3 w-3 bg-white" />
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] uppercase tracking-[0.12em] text-[#A1A1AA]">
            <span>Intent</span><span>Checked</span><span>Simulated</span>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-[1fr_.9fr]">
        <div className="border border-[#27272A] bg-[#050505] p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">{copy.pipelineTitle}</div>
          <p className="mt-2 text-[13px] leading-6 text-[#A1A1AA]">{copy.pipelineSubtitle}</p>
          <div className="mt-4 border border-[#27272A] bg-black px-3 py-2 font-mono text-[13px] text-[#E4E4E7]">{copy.prompt}</div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {pipeline.map((step, index) => (
              <div key={step} className="border border-[#27272A] bg-[#09090B] p-3">
                <div className="text-[11px] font-mono text-[#71717A]">0{index + 1}</div>
                <div className="mt-1 text-[13px] font-semibold text-[#E4E4E7]">{step}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <div className="border border-[#3F3F46] bg-[#0A0A0A] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white">{copy.decisionSafe}</div>
            <div className="border border-[#4C1D1D] bg-[#1A0D0D] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-status-blocked-soft">{copy.decisionBlocked}</div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="border border-[#27272A] bg-[#050505] p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">Reality Assets</div>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">{copy.assetTitle}</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#A1A1AA]">{copy.assetSubtitle}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {assetCards.map(([name, capability, status]) => (
                <div key={name} className="border border-[#27272A] bg-[#09090B] p-3">
                  <div className="text-[13px] font-semibold">{name}</div>
                  <div className="mt-1 font-mono text-[11px] text-[#A1A1AA]">{capability}</div>
                  <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#D4D4D8]">{status}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="border border-[#27272A] bg-[#050505] p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">Developer / Advanced</div>
            <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.03em]">{copy.advancedTitle}</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#A1A1AA]">{copy.advancedSubtitle}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="border border-[#27272A] bg-[#050505] p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">Accountability</div>
          <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">{copy.auditTitle}</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#A1A1AA]">{copy.auditSubtitle}</p>
          <div className="mt-4 grid grid-cols-[58px_1fr_90px_90px] border border-[#27272A] font-mono text-[11px]">
            {['Time', 'Prompt', 'Decision', 'Reason'].map((head) => <div key={head} className="border-b border-[#27272A] px-2 py-2 text-[#71717A]">{head}</div>)}
            <div className="px-2 py-2 text-[#A1A1AA]">00:14</div>
            <div className="truncate px-2 py-2 text-[#E4E4E7]">Enable real adapter</div>
            <div className="px-2 py-2 text-status-blocked-soft">BLOCKED</div>
            <div className="truncate px-2 py-2 text-[#A1A1AA]">real disabled</div>
          </div>
        </div>
        <div className="border border-[#27272A] bg-[#050505] p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">Controlled Ecosystem</div>
          <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">{copy.ecosystemTitle}</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#A1A1AA]">{copy.ecosystemSubtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {roles.map((role) => <span key={role} className="border border-[#27272A] bg-[#09090B] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D4D4D8]">{role}</span>)}
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onDismiss} className="h-9 border border-[#3F3F46] bg-[#0A0A0A] px-4 text-[13px] font-semibold text-[#E4E4E7] hover:bg-[#18181B]">
          {copy.dismiss}
        </button>
      </div>
    </section>
  );
}

export default function Home() {
  const workspaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<UiLanguage>('en');
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
  const [snapshotManuallySelected, setSnapshotManuallySelected] = useState(false);
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
  const [actionComposerOpen, setActionComposerOpen] = useState(false);
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceSimulationAssets, setMarketplaceSimulationAssets] = useState<DeviceAsset[]>([]);
  const [marketplaceReferences, setMarketplaceReferences] = useState<MarketplaceWorkspaceReference[]>([]);
  const [marketplaceBindings, setMarketplaceBindings] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [marketplaceRuntimeReady, setMarketplaceRuntimeReady] = useState(false);
  const [customActions, setCustomActions] = useState<ActionManifest[]>([]);
  const [realHardwareTelemetry, setRealHardwareTelemetry] = useState<RealHardwareTelemetry>({
    connected: false,
    distanceCm: null,
    lastCommandAngle: null
  });
  const [workspaceMode, setWorkspaceMode] = useState<'real' | 'simulation'>('real');
  const [manualImports, setManualImports] = useState<ManualImportRecord[]>([]);
  const [manualSimulationAssets, setManualSimulationAssets] = useState<DeviceAsset[]>([]);
  const [selectedWorkspaceDeviceId, setSelectedWorkspaceDeviceId] = useState<string | null>(defaultWorkspaceDevice.id);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(startupLogs('en'));
  const [llmChipState, setLlmChipState] = useState<'checking' | 'online' | 'offline' | 'compiling'>('checking');
  const llmChipStateRef = useRef<'checking' | 'online' | 'offline' | 'compiling'>('checking');
  const llmCompilerRef = useRef<LlmTaskCompiler | null>(null);
  useEffect(() => {
    llmChipStateRef.current = llmChipState;
  }, [llmChipState]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    fetch(`${LLM_COMPILER_BASE_URL}/api/tags`, { signal: controller.signal })
      .then((response) => {
        if (!cancelled) setLlmChipState(response.ok ? 'online' : 'offline');
      })
      .catch(() => {
        if (!cancelled) setLlmChipState('offline');
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const [validationRunning, setValidationRunning] = useState(false);
  const [running, setRunning] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [autosaveQuarantined, setAutosaveQuarantined] = useState(false);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [workspaceValidation, setWorkspaceValidation] = useState<WorkspaceValidationResult | null>(null);
  const [operatorNotice, setOperatorNotice] = useState<OperatorNoticeState | null>(null);
  const [commandStatus, setCommandStatus] = useState<CommandTerminalStatus>({
    kind: 'ready',
    message: defaultReadyMessage('en')
  });
  const [runtimeDecision, setRuntimeDecision] = useState<OpenRealityRuntimeResult | null>(null);
  const [runtimeDecisionContext, setRuntimeDecisionContext] = useState<{ prompt: string; targetDeviceLabel: string; targetDeviceType: DeviceType } | null>(null);
  const [showFirstRunGuide, setShowFirstRunGuide] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const playbackTimersRef = useRef<number[]>([]);
  const liveRunTokenRef = useRef(0);
  const liveRunActiveRef = useRef(false);
  const validationRunTokenRef = useRef(0);
  const consoleLogSessionRef = useRef(0);
  const workspaceIssues = useMemo(
    () => getWorkspaceIssues(workspaceDevices, labReport, workspaceValidation, language),
    [labReport, language, workspaceDevices, workspaceValidation]
  );
  const availableAssets = useMemo(
    () => [...builtInDeviceAssets, ...importedAssets, ...manualSimulationAssets, ...marketplaceSimulationAssets],
    [importedAssets, manualSimulationAssets, marketplaceSimulationAssets]
  );
  const workspaceBlocked = workspaceIssues.some((issue) => issue.severity === 'blocked');
  const workspaceWarnings = workspaceIssues.filter((issue) => issue.severity === 'warning').length;

  // Single source of truth for "the active device": explicit selection first,
  // otherwise the first workspace device — the SAME fallback the 3D stage
  // uses. Previously the inspector/command bar fell back to the type dropdown
  // instead, so three panels could name three different devices.
  const selectedWorkspaceDevice =
    workspaceDevices.find((device) => device.id === selectedWorkspaceDeviceId)
    ?? workspaceDevices[0]
    ?? null;
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
  const selectedManualActionRecord = useMemo(() => manualImports.find((record) => (
    record.virtual_lab?.enabled === true
    && record.device_meta.profile_id === selectedWorkspaceDevice?.assetId
    && record.device_meta.profile_id === effectiveSelectedProfile.deviceMeta.profile_id
  )) ?? null, [effectiveSelectedProfile.deviceMeta.profile_id, manualImports, selectedWorkspaceDevice?.assetId]);
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
    () => isRunnableDeviceV01(effectiveSelectedProfile.deviceMeta.device_type) && (selectedWorkspaceDevice?.config.enabled ?? true),
    [effectiveSelectedProfile.deviceMeta.device_type, selectedWorkspaceDevice?.config.enabled]
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
  const stageReplaySnapshot = snapshotManuallySelected ? selectedSnapshot : null;
  const stageActionFrame = currentActionFrame ?? stageReplaySnapshot?.action_frame ?? null;

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

  const showNotice = useCallback((severity: OperatorNoticeState['severity'], message: string, options?: Pick<OperatorNoticeState, 'persistent' | 'action'>) => {
    setOperatorNotice({ id: Date.now(), severity, message, ...options });
  }, []);

  const refreshMarketplaceWorkspace = useCallback(async () => {
    const bridge = window.openReality?.marketplace;
    if (!bridge) {
      setMarketplaceSimulationAssets([]);
      setMarketplaceReferences([]);
      setMarketplaceBindings({});
      setMarketplaceRuntimeReady(true);
      return { assets: [] as DeviceAsset[], references: [] as MarketplaceWorkspaceReference[] };
    }
    const nextAssets: DeviceAsset[] = [];
    const nextReferences: MarketplaceWorkspaceReference[] = [];
    const nextBindings: Record<string, { ok: boolean; detail: string }> = {};
    try {
      const response = await bridge.runtimeAssets() as {
        ok?: unknown;
        error?: unknown;
        assets?: unknown;
        rejected?: unknown;
      };
      if (response?.ok !== true || !Array.isArray(response.assets)) {
        throw new Error(typeof response?.error === 'string' ? response.error : 'Marketplace runtime asset response was rejected');
      }
      for (const raw of response.assets) {
        if (!raw || typeof raw !== 'object' || typeof (raw as { packageId?: unknown }).packageId !== 'string') {
          nextBindings.unknown = { ok: false, detail: 'Malformed main-process runtime asset was refused.' };
          continue;
        }
        const runtimeAsset = raw as VerifiedMarketplaceRuntimeAsset;
        const packageId = runtimeAsset.packageId;
        const deviceType = runtimeAsset.asset?.deviceType;
        const templates = builtInDeviceAssets.filter((candidate) => candidate.manifest.device_type === deviceType);
        if (templates.length !== 1) {
          nextBindings[packageId] = { ok: false, detail: `Virtual Lab requires exactly one trusted semantic template for ${String(deviceType)}.` };
          continue;
        }
        const binding = bindMarketplaceAssetToVirtualLab({ runtimeAsset, templateAsset: templates[0] });
        if (!binding.ok) {
          nextBindings[packageId] = { ok: false, detail: `${binding.code}: ${binding.detail}` };
          continue;
        }
        const reference = marketplaceWorkspaceReference(runtimeAsset, binding.asset);
        if (!reference) {
          nextBindings[packageId] = { ok: false, detail: 'Digest-bound project reference could not be created.' };
          continue;
        }
        nextAssets.push(binding.asset);
        nextReferences.push(reference);
        nextBindings[packageId] = { ok: true, detail: 'Available in Virtual Lab · simulation only · real authority false' };
      }
      if (Array.isArray(response.rejected)) {
        for (const raw of response.rejected) {
          if (!raw || typeof raw !== 'object') continue;
          const packageId = (raw as { packageId?: unknown }).packageId;
          const detail = (raw as { detail?: unknown }).detail;
          if (typeof packageId === 'string') nextBindings[packageId] = { ok: false, detail: typeof detail === 'string' ? detail : 'Current trust policy refused this enabled package.' };
        }
      }
      setMarketplaceSimulationAssets(nextAssets);
      setMarketplaceReferences(nextReferences);
      setMarketplaceBindings(nextBindings);
      const activeIds = new Set(nextAssets.map((asset) => asset.manifest.asset_id));
      setWorkspaceDevices((current) => {
        const reconciled = removeUnavailableMarketplaceWorkspaceDevices(current, activeIds);
        if (reconciled.removedAssetIds.length > 0) {
          setSelectedWorkspaceDeviceId((selected) => reconciled.devices.some((device) => device.id === selected) ? selected : reconciled.devices[0]?.id ?? null);
          showNotice('warning', noticeMessage(language, 'Marketplace 信任或安装状态已变化；失效资产已从工作区移除。', 'Marketplace trust or installation changed; unavailable assets were removed from the workspace.'));
        }
        return reconciled.devices;
      });
      if (Object.values(nextBindings).some((binding) => !binding.ok)) {
        showNotice('warning', noticeMessage(language, '部分 Marketplace 资产未通过 Virtual Lab 绑定；详情已显示在 Marketplace。', 'Some Marketplace assets were refused by Virtual Lab binding; details are visible in Marketplace.'));
      }
      return { assets: nextAssets, references: nextReferences };
    } catch (error) {
      setMarketplaceSimulationAssets([]);
      setMarketplaceReferences([]);
      setMarketplaceBindings({ runtime: { ok: false, detail: error instanceof Error ? error.message : String(error) } });
      setWorkspaceDevices((current) => {
        const reconciled = removeUnavailableMarketplaceWorkspaceDevices(current, new Set<string>());
        setSelectedWorkspaceDeviceId((selected) => reconciled.devices.some((device) => device.id === selected) ? selected : reconciled.devices[0]?.id ?? null);
        return reconciled.devices;
      });
      showNotice('error', noticeMessage(language, `Marketplace 运行时不可用：${error instanceof Error ? error.message : String(error)}`, `Marketplace runtime unavailable: ${error instanceof Error ? error.message : String(error)}`), { persistent: true });
      return { assets: [] as DeviceAsset[], references: [] as MarketplaceWorkspaceReference[] };
    } finally {
      setMarketplaceRuntimeReady(true);
    }
  }, [language, showNotice]);

  useEffect(() => { void refreshMarketplaceWorkspace(); }, [refreshMarketplaceWorkspace]);

  const closeAssetImport = useCallback(() => {
    setAssetImportOpen(false);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-file-menu-trigger]')?.focus(), 0);
  }, []);

  const closeActionComposer = useCallback(() => {
    setActionComposerOpen(false);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-action-composer-trigger]')?.focus(), 0);
  }, []);

  const closeManualImport = useCallback(() => {
    setManualImportOpen(false);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-file-menu-trigger]')?.focus(), 0);
  }, []);

  const closeMarketplace = useCallback(() => {
    setMarketplaceOpen(false);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-marketplace-trigger]')?.focus(), 0);
  }, []);

  const requestProjectFile = useCallback(() => {
    if (!workspaceFileInputRef.current) return;
    workspaceFileInputRef.current.value = '';
    workspaceFileInputRef.current.click();
  }, []);

  const clearPlaybackTimers = useCallback(() => {
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
    setReplayPlaying(false);
  }, []);

  const cancelActiveWork = useCallback(() => {
    liveRunTokenRef.current += 1;
    liveRunActiveRef.current = false;
    validationRunTokenRef.current += 1;
    clearPlaybackTimers();
    setRunning(false);
    setReplayPlaying(false);
    setValidationRunning(false);
    setCurrentActionFrame(null);
  }, [clearPlaybackTimers]);

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
    if (operatorNotice.persistent || operatorNotice.severity === 'error') return;
    const timer = window.setTimeout(() => setOperatorNotice(null), operatorNotice.severity === 'warning' ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [operatorNotice]);

  useEffect(() => () => clearPlaybackTimers(), [clearPlaybackTimers]);

  const selectSnapshot = useCallback((snapshot: TimelineStateSnapshot | null) => {
    clearPlaybackTimers();
    setSnapshotManuallySelected(Boolean(snapshot));
    setSelectedSnapshot(snapshot);
    setCurrentActionFrame(snapshot?.action_frame ?? null);
  }, [clearPlaybackTimers]);

  const applyReplayEventForReport = useCallback((event: PlaybackEvent | undefined, index: number, report: LabReport | null) => {
    if (!event || !report) return;
    setReplayIndex(index);
    setCurrentActionFrame(event.frame);
    setSnapshotManuallySelected(false);
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
    setSnapshotManuallySelected(false);
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
    cancelActiveWork();
    clearRuntimeDecision();
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
  }, [cancelActiveWork, clearRuntimeDecision, language]);

  const buildWorkspaceFile = useCallback((): LabWorkspaceFile => {
    const usedMarketplaceAssetIds = new Set(workspaceDevices.flatMap((device) => device.assetId?.startsWith('marketplace-') ? [device.assetId] : []));
    return {
      file_type: 'open_reality_lab_workspace',
      version: 3,
      saved_at: new Date().toISOString(),
      language,
      selected_profile_id: selectedProfile.id,
      selected_scenario_id: selectedScenario.id,
      selected_workspace_device_id: selectedWorkspaceDeviceId,
      prompt,
      devices: workspaceDevices,
      imported_assets: importedAssets,
      marketplace_assets: marketplaceReferences.filter((reference) => usedMarketplaceAssetIds.has(reference.workspace_asset_id)),
      custom_actions: customActions,
      manual_imports: manualImports
    };
  }, [customActions, importedAssets, language, manualImports, marketplaceReferences, prompt, selectedProfile.id, selectedScenario.id, selectedWorkspaceDeviceId, workspaceDevices]);

  const buildProjectFile = useCallback((): OpenRealityProjectFile => ({
    project: {
      name: projectName,
      file_type: 'open_reality_desktop_project',
      version: 3
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
      app: 'RealityWarden Desktop',
      real_device_execution_enabled: false
    }
  }), [buildWorkspaceFile, labReport, language, projectName, workspaceDevices]);

  const applyWorkspaceFile = useCallback((
    input: unknown,
    marketplaceContext: { references: MarketplaceWorkspaceReference[]; assets: DeviceAsset[] } = { references: marketplaceReferences, assets: marketplaceSimulationAssets }
  ) => {
    const checked = validateLabWorkspaceFile(input);
    if (!checked.ok) throw new Error(`${checked.code}: ${checked.detail}`);
    const workspace = checked.value as unknown as LabWorkspaceFile;
    const nextImportedAssets = workspace.imported_assets.map((asset) => {
      const validation = validateDeviceAsset(asset);
      if (!validation.valid) throw new Error(`Imported asset ${asset.manifest?.asset_id ?? 'unknown'} was rejected: ${validation.failures.join(' ')}`);
      return asset;
    });
    const importedAssetIds = new Set<string>();
    const reservedAssetIds = new Set(builtInDeviceAssets.map((asset) => asset.manifest.asset_id));
    const declaredManualAssetIds = new Set((workspace.manual_imports ?? []).flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const profileId = (raw as { device_meta?: { profile_id?: unknown } }).device_meta?.profile_id;
      return typeof profileId === 'string' ? [profileId] : [];
    }));
    const declaredMarketplaceAssetIds = new Set(workspace.marketplace_assets.map((reference) => reference.workspace_asset_id));
    for (const asset of nextImportedAssets) {
      const assetId = asset.manifest.asset_id;
      if (reservedAssetIds.has(assetId)) throw new Error(`Imported asset shadows built-in asset: ${assetId}`);
      if (declaredManualAssetIds.has(assetId)) throw new Error(`Imported asset shadows manual-review asset: ${assetId}`);
      if (declaredMarketplaceAssetIds.has(assetId)) throw new Error(`Imported asset shadows Marketplace asset: ${assetId}`);
      if (importedAssetIds.has(assetId)) throw new Error(`Duplicate imported asset: ${assetId}`);
      importedAssetIds.add(assetId);
    }
    const nextProfile = deviceProfiles.find((profile) => profile.id === workspace.selected_profile_id);
    if (!nextProfile) throw new Error(`Unknown selected profile: ${workspace.selected_profile_id}`);
    const nextScenario = deviceScenarios.find((scenario) => scenario.id === workspace.selected_scenario_id);
    if (!nextScenario) throw new Error(`Unknown selected scenario: ${workspace.selected_scenario_id}`);
    if (nextScenario.device_profile !== nextProfile.id) throw new Error(`Scenario ${nextScenario.id} does not belong to profile ${nextProfile.id}`);
    const deviceProfilesById = new Map(deviceProfiles.map((profile) => [profile.id, profile]));
    for (const device of workspace.devices) {
      if (device.assetId) {
        if (device.profileId !== device.assetId) throw new Error(`Device ${device.id} profile does not match its asset identity`);
        const isBuiltIn = reservedAssetIds.has(device.assetId);
        const isImported = importedAssetIds.has(device.assetId);
        const isDeclaredManual = declaredManualAssetIds.has(device.assetId);
        const isDeclaredMarketplace = declaredMarketplaceAssetIds.has(device.assetId);
        if (!isBuiltIn && !isImported && !isDeclaredManual && !isDeclaredMarketplace) throw new Error(`Device ${device.id} references missing asset ${device.assetId}`);
        continue;
      }
      const profile = deviceProfilesById.get(device.profileId);
      if (!profile) throw new Error(`Unknown device profile: ${device.profileId}`);
      if (profile.deviceMeta.device_type !== device.deviceType) throw new Error(`Device ${device.id} type does not match profile ${device.profileId}`);
    }
    cancelActiveWork();
    clearRuntimeDecision();
    const nextRunnable = isRunnableDeviceV01(nextProfile.deviceMeta.device_type);
    setLanguage(workspace.language);
    const loadedWorkspaceDevices = workspace.devices.map((device) => {
      return {
        ...device,
        label: device.label,
        config: {
          enabled: device.config.enabled,
          adapter_target_id: device.config.adapter_target_id,
          max_speed: device.config.max_speed,
          force_limit: device.config.force_limit,
          forbidden_zones: device.config.forbidden_zones
        }
      };
    });
    // Custom actions are untrusted data on load: revalidate each against the
    // loaded profile; invalid ones are dropped loudly, never repaired.
    const loadedActions: ActionManifest[] = [];
    for (const raw of workspace.custom_actions ?? []) {
      const checked = validateActionManifest(raw, nextProfile.deviceMeta, BUILTIN_INTENT_IDS);
      if (checked.ok) {
        loadedActions.push(checked.manifest);
        continue;
      }
      const teachChecked = validateActionManifest(raw, REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
      if (teachChecked.ok) loadedActions.push(teachChecked.manifest);
      else showNotice('warning', noticeMessage(workspace.language, `自定义动作被拒绝（${checked.code}）：${checked.detail}`, `Custom action rejected (${checked.code}): ${checked.detail}`));
    }
    setCustomActions(loadedActions);
    const loadedManualImports: ManualImportRecord[] = [];
    const loadedManualAssets: DeviceAsset[] = [];
    const claimedManualAssetIds = new Set<string>();
    for (const raw of workspace.manual_imports ?? []) {
      if (raw && typeof raw === 'object') {
        const meta = (raw as { device_meta?: unknown }).device_meta;
        if (meta && typeof meta === 'object' && typeof (meta as { profile_id?: unknown }).profile_id === 'string') claimedManualAssetIds.add((meta as { profile_id: string }).profile_id);
      }
      const checked = validateStoredManualImport(raw, BUILTIN_INTENT_IDS);
      if (!checked.ok) {
        showNotice('warning', noticeMessage(workspace.language, `手册导入记录被拒绝：${checked.detail}`, `Manual import record rejected: ${checked.detail}`));
        continue;
      }
      if (checked.record.virtual_lab?.enabled) {
        const restored = restoreEnabledManualSimulationAsset({ record: checked.record, templateAssets: builtInDeviceAssets, builtinIntentIds: BUILTIN_INTENT_IDS });
        if (!restored.ok) {
          showNotice('warning', noticeMessage(workspace.language, `已启用手册资产被拒绝：${restored.detail}`, `Enabled manual asset rejected: ${restored.detail}`));
          continue;
        }
        loadedManualAssets.push(restored.asset);
      }
      loadedManualImports.push(checked.record);
    }
    const enabledManualAssetIds = new Set(loadedManualAssets.map((asset) => asset.manifest.asset_id));
    const currentMarketplaceReferences = new Map(marketplaceContext.references.map((reference) => [reference.workspace_asset_id, reference]));
    const validMarketplaceAssetIds = new Set(workspace.marketplace_assets.flatMap((reference) => {
      const current = currentMarketplaceReferences.get(reference.workspace_asset_id);
      return current
        && current.package_id === reference.package_id
        && current.package_version === reference.package_version
        && current.digest_sha256 === reference.digest_sha256
        && current.signed_asset_id === reference.signed_asset_id
        ? [reference.workspace_asset_id]
        : [];
    }));
    const filteredWorkspaceDevices = loadedWorkspaceDevices.filter((device) => (
      !device.assetId
      || ((!claimedManualAssetIds.has(device.assetId) || enabledManualAssetIds.has(device.assetId))
        && (!declaredMarketplaceAssetIds.has(device.assetId) || validMarketplaceAssetIds.has(device.assetId)))
    ));
    if (filteredWorkspaceDevices.some((device) => device.assetId && validMarketplaceAssetIds.has(device.assetId) && !marketplaceContext.assets.some((asset) => asset.manifest.asset_id === device.assetId))) {
      throw new Error('Marketplace project reference passed identity checks but its bound simulation asset is unavailable');
    }
    if (filteredWorkspaceDevices.length !== loadedWorkspaceDevices.length) showNotice('warning', noticeMessage(workspace.language, '未通过当前 simulation-only 信任校验的手册或 Marketplace 设备已从工作区移除。', 'Manual or Marketplace devices without current simulation-only trust were removed from the workspace.'));
    setWorkspaceDevices(filteredWorkspaceDevices);
    setImportedAssets(nextImportedAssets);
    setSelectedWorkspaceDeviceId(filteredWorkspaceDevices.some((device) => device.id === workspace.selected_workspace_device_id) ? workspace.selected_workspace_device_id : filteredWorkspaceDevices[0]?.id ?? null);
    setManualImports(loadedManualImports);
    setManualSimulationAssets(loadedManualAssets);
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
  }, [cancelActiveWork, clearRuntimeDecision, marketplaceReferences, marketplaceSimulationAssets, showNotice]);

  const applyProjectFile = useCallback((
    input: unknown,
    filePath?: string | null,
    marketplaceContext?: { references: MarketplaceWorkspaceReference[]; assets: DeviceAsset[] }
  ) => {
    const checked = validateOpenRealityProjectFile(input);
    if (!checked.ok) throw new Error(`${checked.code}: ${checked.detail}`);
    const project = checked.value as unknown as OpenRealityProjectFile;
    applyWorkspaceFile(project.workspace, marketplaceContext);
    setProjectName(project.project?.name || 'Untitled Project');
    setProjectFilePath(filePath ?? null);
    const lastReport = project.lab_reports?.[project.lab_reports.length - 1] ?? null;
    const lastSnapshot = lastReport?.state_snapshots?.at(-1) ?? null;
    setLabReport(lastReport);
    setSelectedSnapshot(lastSnapshot);
    setCurrentActionFrame(lastSnapshot?.action_frame ?? null);
  }, [applyWorkspaceFile]);

  const applySavedDocument = useCallback((text: string) => {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && 'project' in parsed && 'workspace' in parsed) applyProjectFile(parsed);
    else applyWorkspaceFile(parsed);
  }, [applyProjectFile, applyWorkspaceFile]);

  useEffect(() => {
    if (!marketplaceRuntimeReady || autosaveReady || autosaveQuarantined) return;
    let active = true;
    void (async () => {
      let record;
      try {
        record = await loadProjectAutosave();
      } catch (error) {
        if (!active) return;
        setAutosaveQuarantined(true);
        showNotice('error', noticeMessage(language, `读取自动保存失败：${error instanceof Error ? error.message : '存储不可用'}`, `Autosave read failed: ${error instanceof Error ? error.message : 'storage unavailable'}`), { persistent: true });
        return;
      }
      if (!active) return;
      if (!record) {
        setAutosaveReady(true);
        return;
      }
      try {
        applySavedDocument(record.text);
        setAutosaveQuarantined(false);
        setAutosaveReady(true);
        if (record.source === 'legacy-localstorage') showNotice('info', noticeMessage(language, '旧版自动保存已恢复，将迁移到成品级存储。', 'Legacy autosave restored and will migrate to durable project storage.'));
      } catch (error) {
        setAutosaveQuarantined(true);
        showNotice(
          'error',
          noticeMessage(language, `自动保存已隔离：${error instanceof Error ? error.message : '数据无效'}`, `Autosave quarantined: ${error instanceof Error ? error.message : 'invalid data'}`),
          { persistent: true, action: { kind: 'discard_autosave', label: language === 'zh' ? '清除损坏的自动保存' : 'Discard corrupted autosave' } }
        );
      }
    })();
    return () => { active = false; };
  }, [applySavedDocument, autosaveQuarantined, autosaveReady, language, marketplaceRuntimeReady, showNotice]);

  useEffect(() => {
    if (!autosaveReady || autosaveQuarantined) return;
    // Debounced autosave: serializing the whole workspace on every keystroke
    // caused needless main-thread work; 600ms of quiet is enough.
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const project = buildProjectFile();
          const serialized = serializeOpenRealityProjectFile(project);
          if (!serialized.ok) throw new Error(`${serialized.code}: ${serialized.detail}`);
          await saveProjectAutosave(serialized.value);
          if (active) setAutosavedAt(project.workspace.saved_at);
        } catch (error) {
          if (!active) return;
          setAutosaveQuarantined(true);
          showNotice('error', noticeMessage(language, `自动保存失败：${error instanceof Error ? error.message : '存储不可用'}`, `Autosave failed: ${error instanceof Error ? error.message : 'storage unavailable'}`), {
            persistent: true,
            action: { kind: 'retry_autosave', label: language === 'zh' ? '重试自动保存' : 'Retry autosave' }
          });
        }
      })();
    }, 600);
    return () => { active = false; window.clearTimeout(timer); };
  }, [autosaveQuarantined, autosaveReady, buildProjectFile, language, showNotice]);

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
    cancelActiveWork();
    clearRuntimeDecision();
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
  }, [availableAssets, cancelActiveWork, clearRuntimeDecision, language, showNotice, workspaceDevices.length]);

  const invalidateWorkspaceResults = useCallback(() => {
    cancelActiveWork();
    clearRuntimeDecision();
    setLabReport(null);
    setWorkspaceValidation(null);
    setSelectedSnapshot(null);
    setCurrentActionFrame(null);
    setLivePlaybackEvents([]);
    setLiveAdapterCommands([]);
    setReplayIndex(0);
    setCommandStatus({ kind: 'ready', message: t(language, 'command_waiting') });
  }, [cancelActiveWork, clearRuntimeDecision, language]);

  const handleImportedAsset = useCallback((asset: DeviceAsset) => {
    void (async () => {
      try {
        const portableAsset = await makeImportedAssetPortable(asset);
        const validation = validateDeviceAsset(portableAsset);
        if (!validation.valid) throw new Error(validation.failures.join(' '));
        invalidateWorkspaceResults();
        setImportedAssets((assets) => [...assets.filter((item) => item.manifest.asset_id !== portableAsset.manifest.asset_id), portableAsset]);
        showNotice('success', noticeMessage(language, `\u8d44\u4ea7\u5df2\u5bfc\u5165\uff1a${portableAsset.manifest.display_name}`, `Asset imported: ${portableAsset.manifest.display_name}`));
      } catch (error) {
        showNotice('error', noticeMessage(language, `资产导入失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Asset import failed: ${error instanceof Error ? error.message : localUnknownError(language)}`));
      }
    })();
  }, [invalidateWorkspaceResults, language, showNotice]);

  const updateWorkspaceDevice = useCallback((deviceId: string, patch: Partial<WorkspaceDeviceRecord>) => {
    invalidateWorkspaceResults();
    setWorkspaceDevices((devices) => devices.map((device) => (
      device.id === deviceId
        ? {
            ...device,
            ...patch,
            config: patch.config ? { ...device.config, ...patch.config } : device.config
          }
        : device
    )));
  }, [invalidateWorkspaceResults]);

  const removeWorkspaceDevice = useCallback((deviceId: string) => {
    const removed = workspaceDevices.find((device) => device.id === deviceId);
    const remainingDevices = workspaceDevices.filter((device) => device.id !== deviceId);
    invalidateWorkspaceResults();
    setWorkspaceDevices(remainingDevices);
    setSelectedWorkspaceDeviceId((selectedId) => (
      selectedId === deviceId || !remainingDevices.some((device) => device.id === selectedId)
        ? remainingDevices[0]?.id ?? null
        : selectedId
    ));
    if (removed) showNotice('warning', noticeMessage(language, `\u5df2\u79fb\u9664\u8bbe\u5907\uff1a${removed.label}`, `Device removed: ${removed.label}`));
  }, [invalidateWorkspaceResults, language, showNotice, workspaceDevices]);

  const handleRemoveSelectedDevice = useCallback(() => {
    const device = workspaceDevices.find((item) => item.id === selectedWorkspaceDeviceId) ?? workspaceDevices[0];
    if (!device) return;
    const confirmed = window.confirm(
      language === 'zh'
        ? `确认移除设备「${device.label}」？此操作不影响其他设备。`
        : `Remove device "${device.label}"? Other devices are not affected.`
    );
    if (confirmed) removeWorkspaceDevice(device.id);
  }, [language, removeWorkspaceDevice, selectedWorkspaceDeviceId, workspaceDevices]);

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
    invalidateWorkspaceResults();
    setWorkspaceDevices((devices) => [...devices, clone]);
    setSelectedWorkspaceDeviceId(clone.id);
    showNotice('info', noticeMessage(language, `\u5df2\u590d\u5236\u8bbe\u5907\uff1a${clone.label}`, `Device duplicated: ${clone.label}`));
  }, [invalidateWorkspaceResults, language, showNotice, workspaceDevices]);

  const exportSelectedAssetConfig = useCallback(() => {
    if (!selectedWorkspaceDevice) return;
    try {
      const asset = assetForId(availableAssets, selectedWorkspaceDevice.assetId);
      downloadJson(`open-reality-selected-asset-${Date.now()}.json`, {
        workspace_device: selectedWorkspaceDevice,
        asset_manifest: asset?.manifest ?? null,
        device_meta: asset?.deviceMeta ?? effectiveSelectedProfile.deviceMeta,
        geometry: asset?.geometry ?? effectiveSelectedProfile.geometry,
        adapter_manifest: asset?.adapterManifest ?? null,
        scenarios: asset?.scenarios ?? null
      });
      showNotice('success', noticeMessage(language, '所选资产配置已导出。', 'Selected asset configuration exported.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `导出所选资产失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Selected asset export failed: ${error instanceof Error ? error.message : localUnknownError(language)}`), {
        action: { kind: 'retry_export_asset', label: language === 'zh' ? '重试导出' : 'Retry export' }
      });
    }
  }, [availableAssets, effectiveSelectedProfile, language, selectedWorkspaceDevice, showNotice]);

  const handleLanguageChange = useCallback((nextLanguage: UiLanguage) => {
    consoleLogSessionRef.current += 1;
    cancelActiveWork();
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
  }, [cancelActiveWork, clearRuntimeDecision, selectedProfile.deviceMeta.device_type, selectedScenario]);

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
    cancelActiveWork();
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
  }, [cancelActiveWork, clearRuntimeDecision, language, syncWorkspaceSelectionForType]);

  const handleProfileChange = useCallback((profileId: string) => {
    consoleLogSessionRef.current += 1;
    cancelActiveWork();
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
  }, [cancelActiveWork, clearRuntimeDecision, language, syncWorkspaceSelectionForType]);

  const handleScenarioChange = useCallback((nextScenarioId: string) => {
    consoleLogSessionRef.current += 1;
    cancelActiveWork();
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
  }, [cancelActiveWork, clearRuntimeDecision, language, selectedProfile.deviceMeta.device_type, selectedScenario]);

  const handleQuickStart = useCallback((path: QuickStartPath) => {
    consoleLogSessionRef.current += 1;
    cancelActiveWork();
    const nextProfile = getFirstProfileForType(path.deviceType);
    const nextScenario = getScenarioForProfile(nextProfile.id, 'safe');
    clearRuntimeDecision();
    setOperatorNotice(null);
    window.localStorage.setItem(firstRunGuideStorageKey, '1');
    setShowFirstRunGuide(false);
    const existingDevice = syncWorkspaceSelectionForType(path.deviceType, nextProfile.id);
    if (!existingDevice) {
      const matchingAsset = availableAssets.find((asset) => asset.manifest.device_type === path.deviceType);
      const nextDevice = createWorkspaceDevice(path.deviceType, workspaceDevices.length, language, matchingAsset);
      setWorkspaceDevices((devices) => [...devices, nextDevice]);
      setSelectedWorkspaceDeviceId(nextDevice.id);
    }
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
  }, [availableAssets, cancelActiveWork, clearRuntimeDecision, language, syncWorkspaceSelectionForType, workspaceDevices.length]);

  const handlePromptChange = useCallback((nextPrompt: string) => {
    if (liveRunActiveRef.current) cancelActiveWork();
    clearRuntimeDecision();
    setPrompt(nextPrompt);
  }, [cancelActiveWork, clearRuntimeDecision]);

  const runScenario = useCallback(async (options?: { manifestRun?: { taskDsl: TaskDSL; actionId: string; label: string } }) => {
    const manifestRun = options?.manifestRun;
    if (liveRunActiveRef.current) {
      showNotice('warning', noticeMessage(language, '\u5f53\u524d\u6267\u884c\u6b63\u5728\u8fd0\u884c\uff0c\u8bf7\u5148\u505c\u6b62\u6216\u7b49\u5f85\u5b8c\u6210\u3002', 'A run is already active. Stop it or wait for completion.'));
      return;
    }
    if (selectedWorkspaceDevice && !selectedWorkspaceDevice.config.enabled) {
      showNotice('warning', noticeMessage(language, '\u5f53\u524d\u8bbe\u5907\u5df2\u7981\u7528\uff0c\u8bf7\u5148\u5728\u8bbe\u5907\u914d\u7f6e\u4e2d\u542f\u7528\u5b83\u3002', 'The current device is disabled. Enable it in Device Configuration before running.'));
      return;
    }
    liveRunActiveRef.current = true;
    const runToken = liveRunTokenRef.current + 1;
    liveRunTokenRef.current = runToken;
    const consoleSessionId = consoleLogSessionRef.current + 1;
    consoleLogSessionRef.current = consoleSessionId;
    setSnapshotManuallySelected(false);
    const replaceLogs = (nextLogs: string[]) => {
      if (consoleLogSessionRef.current !== consoleSessionId) return;
      setConsoleLogs(nextLogs);
    };
    const prependLog = (entry: string, limit = 120) => {
      if (consoleLogSessionRef.current !== consoleSessionId) return;
      setConsoleLogs((logs) => [entry, ...logs.slice(0, limit)]);
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
    const runPrompt = manifestRun ? manifestRun.label : (prompt.trim() || getLocalizedPrompt(runScenarioDefinition, language));
    const runTargetLabel = targetWorkspaceAsset
      ? localizeDisplayName(language, targetWorkspaceAsset.manifest.display_name)
      : localizeDeviceType(language, runProfile.deviceMeta.device_type);
    let llmCompile: CompileWithFallbackResult | undefined;
    if (!manifestRun && runProfile.deviceMeta.device_type === 'robot_arm' && llmChipStateRef.current === 'online') {
      if (!llmCompilerRef.current) {
        llmCompilerRef.current = new LlmTaskCompiler({ baseUrl: LLM_COMPILER_BASE_URL, model: LLM_COMPILER_MODEL });
      }
      setLlmChipState('compiling');
      try {
        llmCompile = await compileTaskDslWithFallback(runPrompt, runProfile.deviceMeta, llmCompilerRef.current);
      } catch {
        llmCompile = undefined;
      }
      // Stop/project/profile changes invalidate the token while the compiler
      // request is in flight. Never let that stale request restart a canceled
      // run or overwrite a newer workspace.
      if (liveRunTokenRef.current !== runToken) return;
      setLlmChipState(llmCompile && llmCompile.compiler === 'llm' ? 'online' : 'offline');
    }
    if (liveRunTokenRef.current !== runToken) return;
    let localRuntimeSession: ReturnType<LocalRuntime['prepareSimulationSession']>;
    try {
      localRuntimeSession = new LocalRuntime().prepareSimulationSession({
        profile: runProfile,
        prompt: runPrompt,
        locale: language,
        deviceState: targetWorkspaceDevice?.current_state ?? null,
        llmCompile,
        manifestCompile: manifestRun ? { taskDsl: manifestRun.taskDsl, actionId: manifestRun.actionId } : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : localUnknownError(language);
      setCommandStatus({ kind: 'failed', message });
      showNotice('error', noticeMessage(language, `运行准备失败：${message}`, `Run preparation failed: ${message}`));
      liveRunActiveRef.current = false;
      return;
    }
    const runtimeKernelResult = localRuntimeSession.runtimeResult;
    const visibleRuntimeDecision: OpenRealityRuntimeResult = localRuntimeSession.status === runtimeKernelResult.status
      ? runtimeKernelResult
      : {
          ...runtimeKernelResult,
          status: localRuntimeSession.status === 'proposed_plan' ? 'ask_human' : localRuntimeSession.status,
          reason: localRuntimeSession.reason,
          userFacingMessage: localRuntimeSession.userFacingMessage
        };
    setRuntimeDecision(visibleRuntimeDecision);
    setRuntimeDecisionContext({
      prompt: runPrompt,
      targetDeviceLabel: runTargetLabel,
      targetDeviceType: runProfile.deviceMeta.device_type
    });
    const baseRunLogs = startupLogs(language);
    const compilerLogLine = `[COMPILER] ${localRuntimeSession.compilerDetail}`;
    const runtimeAuditLogs = localRuntimeSession.auditLog.map((entry) =>
      `[${entry.level.toUpperCase()}] [${entry.stage}] ${entry.code}: ${entry.message} (hardwareSignalSent=${entry.hardwareSignalSent})`
    );
    const publishLocalRuntimeDecisionReport = () => {
      setLabReport(buildLocalRuntimeDecisionLabReport({
        profile: runProfile,
        scenarioId: runScenarioDefinition.id,
        prompt: runPrompt,
        session: localRuntimeSession
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
    if (!localRuntimeSession.canExecute || localRuntimeSession.status !== 'compiled' || !localRuntimeSession.executableTaskDsl) {
      const message = localRuntimeSession.userFacingMessage;
      const terminalKind = localRuntimeSession.status === 'not_runnable'
        ? 'coming_soon'
        : localRuntimeSession.status === 'blocked'
          ? 'blocked'
          : localRuntimeSession.status === 'ask_human' || localRuntimeSession.status === 'ambiguous'
            ? 'ask_human'
            : localRuntimeSession.status === 'proposed_plan'
              ? 'proposed_plan'
              : 'failed';
      const noticeSeverity = localRuntimeSession.status === 'blocked'
        ? 'error'
        : localRuntimeSession.status === 'unsupported' || localRuntimeSession.status === 'not_runnable'
          ? 'warning'
          : 'warning';
      if (runtimeKernelResult.taskDsl) {
        setRunPreviewTask({ profileId: runProfile.id, prompt: runPrompt, task: runtimeKernelResult.taskDsl });
      }
      publishLocalRuntimeDecisionReport();
      setCommandStatus({ kind: terminalKind, message });
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        language === 'zh'
          ? '[SIMULATION] 仿真运行 —— 未向真实硬件发送任何信号。'
          : '[SIMULATION] Simulated run — no signals were sent to real hardware.',
        compilerLogLine,
        ...runtimeAuditLogs,
        ...baseRunLogs
      ]);
      showNotice(noticeSeverity, message);
      liveRunActiveRef.current = false;
      return;
    }
    setRunPreviewTask({
      profileId: runProfile.id,
      prompt: runPrompt,
      task: localRuntimeSession.executableTaskDsl
    });
    setCommandStatus({
      kind: 'running',
      message: `${t(language, 'command_running')} ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`
    });
    setRunning(true);
    setReplayPlaying(true);
    try {
      replaceLogs([
        `[INFO] ${language === 'zh' ? `当前运行目标：${runTargetLabel}` : `Current run target: ${runTargetLabel}`}`,
        language === 'zh'
          ? '[SIMULATION] 仿真运行 —— 未向真实硬件发送任何信号。'
          : '[SIMULATION] Simulated run — no signals were sent to real hardware.',
        compilerLogLine,
        ...runtimeAuditLogs,
        ...baseRunLogs
      ]);
      let lastFrameTimeline = 0;
      let liveFrameCount = 0;
      for await (const event of new LiveScenarioRunner().run(
        runProfile,
        runScenarioDefinition,
        runPrompt,
        localRuntimeSession.executableTaskDsl,
        runtimeKernelResult,
        targetWorkspaceDevice?.current_state ?? null,
        localRuntimeSession.auditLog
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
          const auditBlockedCount = event.report.state_snapshots?.filter((snapshot) => snapshot.stage === 'blocked').length ?? 0;
          prependLog(language === 'zh'
            ? `[AUDIT] 本次 ${event.report.adapter_commands.length} 条适配器指令，拦截 ${auditBlockedCount} 条，hardwareSignalSent=false（仿真，未触碰真实硬件）。`
            : `[AUDIT] ${event.report.adapter_commands.length} adapter command(s), ${auditBlockedCount} blocked, hardwareSignalSent=false (simulation, no real hardware touched).`);
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
      if (liveRunTokenRef.current !== runToken) return;
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

  const runScenarioRef = useRef(runScenario);
  useEffect(() => {
    runScenarioRef.current = runScenario;
  }, [runScenario]);

  // First-launch auto demo: run the unsafe starter once so a new user watches
  // the safety layer block a command within the first 30 seconds. Never
  // repeats after the first launch (persisted flag).
  const autoDemoTriggeredRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!autoDemoTriggeredRef.current) {
      if (window.localStorage.getItem(firstRunDemoStorageKey)) return;
      autoDemoTriggeredRef.current = true;
      window.localStorage.setItem(firstRunDemoStorageKey, '1');
      const demoPrompt = getLocalizedPrompt(getScenarioForProfile('virtual-robot-arm', 'unsafe'), language);
      setPrompt(demoPrompt);
      setCommandStatus({ kind: 'ready', message: t(language, 'command_waiting') });
      setConsoleLogs((logs) => [
        language === 'zh'
          ? '[DEMO] 首次启动演示：即将发送一条不安全指令（把方块扔出桌面），观察安全层如何拦截它。'
          : '[DEMO] First-run demo: sending an unsafe command (throw the cube off the table) so you can watch the safety layer block it.',
        ...logs
      ]);
    }
    // React Strict Mode cleans up and re-runs effects in development. The
    // initialization above stays one-shot, while each mount gets a live timer.
    const timer = window.setTimeout(() => {
      void runScenarioRef.current();
    }, 1600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFullValidation = useCallback(async () => {
    const validationToken = validationRunTokenRef.current + 1;
    validationRunTokenRef.current = validationToken;
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
        if (validationRunTokenRef.current !== validationToken) return;
        const asset = assetForId(availableAssets, device.assetId);
        const baseProfile = asset ? profileFromAsset(asset) : deviceProfiles.find((profile) => profile.id === device.profileId) ?? getFirstProfileForType(device.deviceType);
        const effectiveProfile = applyWorkspaceDeviceConfig(baseProfile, device);
        const scenario = (asset?.scenarios?.safe as DeviceScenario | undefined) ?? getScenarioForProfile(baseProfile.id, 'safe');
        const localizedPrompt = getLocalizedPrompt(scenario, language);
        setSelectedWorkspaceDeviceId(device.id);
        setDeviceType(baseProfile.deviceMeta.device_type);
        setSelectedProfileId(baseProfile.id);
        setScenarioId(scenario.id);
        setPrompt(localizedPrompt);
        const report = await new ScenarioRunner().run(effectiveProfile, scenario, localizedPrompt);
        if (validationRunTokenRef.current !== validationToken) return;
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
        if (validationRunTokenRef.current !== validationToken) return;
      }
    } catch (error) {
      if (validationRunTokenRef.current !== validationToken) return;
      showNotice('error', noticeMessage(language, `\u5de5\u4f5c\u533a\u9a8c\u8bc1\u5931\u8d25\uff1a${error instanceof Error ? error.message : localUnknownError(language)}`, `Workspace validation failed: ${error instanceof Error ? error.message : localUnknownError(language)}`));
      setValidationRunning(false);
      return;
    }

    if (validationRunTokenRef.current !== validationToken) return;

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
  }, [availableAssets, language, showNotice, workspaceDevices]);

  const newProject = useCallback(() => {
    cancelActiveWork();
    clearRuntimeDecision();
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
    setCustomActions([]);
    setManualImports([]);
    setManualSimulationAssets([]);
    setReplayIndex(0);
    showNotice('info', noticeMessage(language, '\u5df2\u65b0\u5efa\u672a\u547d\u540d\u5de5\u7a0b\u3002', 'Created a new untitled project.'));
  }, [cancelActiveWork, clearRuntimeDecision, language, showNotice]);

  const saveWorkspace = useCallback(async (saveAs = false) => {
    try {
      const project = buildProjectFile();
      const serialized = serializeOpenRealityProjectFile(project);
      if (!serialized.ok) throw new Error(`${serialized.code}: ${serialized.detail}`);
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
      showNotice('success', noticeMessage(language, '工程文件已下载。', 'Project file downloaded.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `保存工程失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Save failed: ${error instanceof Error ? error.message : localUnknownError(language)}`), {
        action: { kind: saveAs ? 'retry_project_save_as' : 'retry_project_save', label: language === 'zh' ? '重试保存' : 'Retry save' }
      });
    }
  }, [buildProjectFile, language, projectFilePath, projectName, showNotice]);

  const loadWorkspaceFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error(`file_too_large: project file exceeds ${MAX_PROJECT_FILE_BYTES} bytes`);
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && 'project' in parsed && 'workspace' in parsed) {
        const checked = validateOpenRealityProjectFile(parsed);
        if (!checked.ok) throw new Error(`${checked.code}: ${checked.detail}`);
        applyProjectFile(checked.value as unknown as OpenRealityProjectFile);
      } else {
        const checked = validateLabWorkspaceFile(parsed);
        if (!checked.ok) throw new Error(`${checked.code}: ${checked.detail}`);
        applyWorkspaceFile(checked.value as unknown as LabWorkspaceFile);
      }
      showNotice('success', noticeMessage(language, '\u5de5\u7a0b\u5df2\u6253\u5f00\u3002', 'Lab workspace opened.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u6253\u5f00\u5de5\u7a0b\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u6587\u4ef6\u683c\u5f0f\u65e0\u6548'}`, `Open failed: ${error instanceof Error ? error.message : 'Invalid file format'}`), {
        action: { kind: 'choose_project_file', label: language === 'zh' ? '选择其他文件' : 'Choose another file' }
      });
    }
  }, [applyProjectFile, applyWorkspaceFile, language, showNotice]);

  const openProject = useCallback(async () => {
    if (!window.openReality) {
      requestProjectFile();
      return;
    }
    try {
      const result = await window.openReality.project.open();
      if (result.canceled || !result.project) return;
      const marketplaceContext = await refreshMarketplaceWorkspace();
      applyProjectFile(result.project, result.filePath, marketplaceContext);
      showNotice('success', noticeMessage(language, '\u5de5\u7a0b\u5df2\u6253\u5f00\u3002', 'Project opened.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `\u6253\u5f00\u5de5\u7a0b\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u6587\u4ef6\u683c\u5f0f\u65e0\u6548'}`, `Open failed: ${error instanceof Error ? error.message : 'Invalid file format'}`), {
        action: { kind: 'retry_project_open', label: language === 'zh' ? '重试打开' : 'Retry open' }
      });
    }
  }, [applyProjectFile, language, refreshMarketplaceWorkspace, requestProjectFile, showNotice]);

  const restoreLastWorkspace = useCallback(async () => {
    try {
      const record = await loadProjectAutosave();
      if (!record) {
        showNotice('warning', noticeMessage(language, '\u6ca1\u6709\u53ef\u6062\u590d\u7684\u4e0a\u6b21\u5de5\u7a0b\u3002', 'No previous workspace to restore.'));
        return;
      }
      applySavedDocument(record.text);
      setAutosaveQuarantined(false);
      setAutosaveReady(true);
      showNotice('success', noticeMessage(language, '\u5df2\u6062\u590d\u4e0a\u6b21\u5de5\u7a0b\u3002', 'Last workspace restored.'));
    } catch (error) {
      showNotice(
        'error',
        noticeMessage(language, `\u6062\u590d\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u81ea\u52a8\u4fdd\u5b58\u6570\u636e\u65e0\u6548'}`, `Restore failed: ${error instanceof Error ? error.message : 'Invalid autosave data'}`),
        {
          persistent: true,
          action: {
            kind: 'discard_autosave',
            label: language === 'zh' ? '清除损坏的自动保存' : 'Discard corrupted autosave'
          }
        }
      );
    }
  }, [applySavedDocument, language, showNotice]);

  const exportDeploymentConfig = useCallback(async () => {
    try {
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
    } catch (error) {
      showNotice('error', noticeMessage(language, `导出 Adapter Package 失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Adapter Package export failed: ${error instanceof Error ? error.message : localUnknownError(language)}`), {
        action: { kind: 'retry_export_adapter', label: language === 'zh' ? '重试导出' : 'Retry export' }
      });
    }
  }, [availableAssets, effectiveSelectedProfile.deviceMeta, labReport, language, prompt, selectedScenario.id, showNotice, workspaceBlocked, workspaceDevices, workspaceIssues, workspaceValidation, workspaceWarnings]);

  const exportCurrentLabReport = useCallback(async () => {
    if (!labReport) return;
    try {
      if (window.openReality) {
        const result = await window.openReality.export.labReport(labReport);
        if (!result.canceled) showNotice('success', noticeMessage(language, '\u5b9e\u9a8c\u62a5\u544a\u5df2\u5bfc\u51fa\u3002', 'Lab Report exported.'));
        return;
      }
      downloadJson(`${labReport.lab_run_id}.json`, labReport);
      showNotice('success', noticeMessage(language, '\u5b9e\u9a8c\u62a5\u544a\u5df2\u5bfc\u51fa\u3002', 'Lab Report exported.'));
    } catch (error) {
      showNotice('error', noticeMessage(language, `导出实验报告失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Lab Report export failed: ${error instanceof Error ? error.message : localUnknownError(language)}`), {
        action: { kind: 'retry_export_report', label: language === 'zh' ? '重试导出' : 'Retry export' }
      });
    }
  }, [labReport, language, showNotice]);

  const exportCurrentAuditReceipt = useCallback(() => {
    if (!labReport) return;
    try {
      const receipt = exportAuditReceiptFiles(labReport.lab_run_id, labReport.runtime_audit_log, {
        appVersion: packageJson.version,
        deviceProfileId: labReport.device_profile,
        operator: null,
        note: `lab_run ${labReport.lab_run_id}: ${labReport.prompt}`
      });
      showNotice('success', noticeMessage(language, `审计回执已导出（防篡改哈希 ${receipt.integrity.contentHash.slice(0, 12)}…）。`, `Audit receipt exported (tamper-evident hash ${receipt.integrity.contentHash.slice(0, 12)}…).`));
    } catch (error) {
      showNotice('error', noticeMessage(language, `审计回执导出失败：${error instanceof Error ? error.message : localUnknownError(language)}`, `Audit receipt export failed: ${error instanceof Error ? error.message : localUnknownError(language)}`));
    }
  }, [labReport, language, showNotice]);

  const handleNoticeAction = useCallback((action: OperatorNoticeAction) => {
    setOperatorNotice(null);
    if (action === 'discard_autosave') {
      void discardProjectAutosave().then(() => {
        setAutosaveQuarantined(false);
        setAutosaveReady(true);
        showNotice('success', noticeMessage(language, '损坏的自动保存已清除；当前工作区未被修改。', 'Corrupted autosave cleared; the current workspace was not changed.'));
      }).catch((error) => {
        setAutosaveQuarantined(true);
        showNotice('error', noticeMessage(language, `清除自动保存失败：${error instanceof Error ? error.message : '存储不可用'}`, `Autosave clear failed: ${error instanceof Error ? error.message : 'storage unavailable'}`), { persistent: true, action: { kind: 'discard_autosave', label: language === 'zh' ? '重试清除' : 'Retry discard' } });
      });
      return;
    }
    if (action === 'retry_autosave') {
      setAutosaveQuarantined(false);
      setAutosaveReady(true);
      return;
    }
    if (action === 'retry_project_save') void saveWorkspace(false);
    if (action === 'retry_project_save_as') void saveWorkspace(true);
    if (action === 'retry_project_open') void openProject();
    if (action === 'choose_project_file') requestProjectFile();
    if (action === 'retry_export_adapter') void exportDeploymentConfig();
    if (action === 'retry_export_report') void exportCurrentLabReport();
    if (action === 'retry_export_asset') exportSelectedAssetConfig();
  }, [exportCurrentLabReport, exportDeploymentConfig, exportSelectedAssetConfig, language, openProject, requestProjectFile, saveWorkspace, showNotice]);

  const stopRun = useCallback(() => {
    cancelActiveWork();
    setCommandStatus({
      kind: 'ready',
      message: t(language, 'command_stopped')
    });
    showNotice('warning', noticeMessage(language, '\u5df2\u505c\u6b62\u5f53\u524d\u6267\u884c\u3002', 'Current run stopped.'));
  }, [cancelActiveWork, language, showNotice]);

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
      setSnapshotManuallySelected(false);
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

  const openSupportGuide = useCallback(async () => {
    if (!window.openReality) {
      showNotice('info', noticeMessage(language, '桌面支持指南仅在 RealityWarden 桌面版中提供。', 'The packaged support guide is available in RealityWarden Desktop.'));
      return;
    }
    const result = await window.openReality.support.openGuide();
    if (!result.ok) showNotice('error', noticeMessage(language, '无法打开支持指南。', 'Could not open the support guide.'));
  }, [language, showNotice]);

  const exportLocalDiagnostics = useCallback(async () => {
    if (!window.openReality) {
      showNotice('info', noticeMessage(language, '本地诊断包仅在 RealityWarden 桌面版中提供。', 'Local diagnostics are available in RealityWarden Desktop.'));
      return;
    }
    try {
      const result = await window.openReality.support.exportDiagnostics();
      if (!result.canceled) showNotice('success', noticeMessage(language, '已导出脱敏的本地诊断包，未上传任何数据。', 'Redacted local diagnostics exported. No data was uploaded.'));
    } catch {
      showNotice('error', noticeMessage(language, '诊断包导出失败，请重试。', 'Diagnostic export failed. Try again.'));
    }
  }, [language, showNotice]);

  const showDesktopAbout = useCallback(() => {
    if (window.openReality) void window.openReality.support.showAbout();
    else showNotice('info', 'RealityWarden · Public Alpha');
  }, [showNotice]);

  useEffect(() => {
    if (!window.openReality) return;
    return window.openReality.onMenuAction((action) => {
      if (action === 'project:new') newProject();
      if (action === 'project:open') void openProject();
      if (action === 'project:save') void saveWorkspace(false);
      if (action === 'project:saveAs') void saveWorkspace(true);
      if (action === 'export:labReport') void exportCurrentLabReport();
      if (action === 'export:deploymentPackage') void exportDeploymentConfig();
      if (action === 'run:preflight') {
        setWorkspaceMode('simulation');
        void runFullValidation();
      }
      if (action === 'run:virtualLab') {
        setWorkspaceMode('simulation');
        void runScenario();
      }
      if (action === 'run:stop') stopRun();
      if (action === 'run:replay') {
        setWorkspaceMode('simulation');
        replayRun();
      }
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
    const localTarget = targetPosition(String(targetStep.target ?? targetStep.zone), effectiveSelectedProfile.geometry);
    const selectedDevice = semanticWorkspaceDevices.find((device) => device.id === selectedWorkspaceDeviceId) ?? semanticWorkspaceDevices[0];
    // The device (and everything it animates) renders inside a group offset by
    // device.position, while the preview marker is drawn in world coordinates.
    // Shift the local zone target into world space so the predicted marker and
    // the actual landing spot always coincide.
    const base = selectedDevice?.position ?? ([0, 0, 0] as [number, number, number]);
    const target: [number, number, number] = [localTarget[0] + base[0], localTarget[1], localTarget[2] + base[2]];
    const localOrigin = previewOriginFromState(selectedDevice?.state, [0, 0, 0]);
    const origin: [number, number, number] = [localOrigin[0] + base[0], 0, localOrigin[2] + base[2]];
    return {
      target,
      path: [origin, target] as [[number, number, number], [number, number, number]],
      unsafe: selectedScenario.mode === 'unsafe' || task.risk_level === 'high',
      passed: labReport?.result === 'pass' && !replayPlaying
    };
  }, [effectiveSelectedProfile, labReport?.result, prompt, replayPlaying, runPreviewTask, selectedScenario.mode, selectedWorkspaceDeviceId, semanticWorkspaceDevices]);

  // The single authoritative run state. Every surface below subscribes to a
  // projection of this value; none of them derives its own run words.
  const runState = useMemo(() => deriveRunState({
    command: commandStatus,
    running,
    replayPlaying,
    evidencePrompt: runtimeDecisionContext?.prompt ?? null,
    labRunId: labReport?.lab_run_id ?? null
  }), [commandStatus, labReport?.lab_run_id, replayPlaying, running, runtimeDecisionContext?.prompt]);

  const focusRealHardware = () => {
    const panel = document.querySelector<HTMLElement>('[data-real-hardware-panel]');
    panel?.focus();
    panel?.querySelector<HTMLElement>('[data-real-hardware-content]')?.scrollTo({ top: 0 });
  };

  return (
    <div className={`industrial-workbench flex h-screen w-screen min-w-[1180px] flex-col overflow-hidden bg-bg-app text-text-primary ${assetImportOpen || actionComposerOpen || manualImportOpen || marketplaceOpen ? 'modal-surface-active' : ''}`}>
      <AppHeader
        language={language}
        workspaceMode={workspaceMode}
        realHardwareConnected={realHardwareTelemetry.connected}
        projectName={projectName}
        preflight={workspaceBlocked ? 'blocked' : workspaceWarnings > 0 ? 'warning' : 'passed'}
        warningCount={workspaceWarnings}
        result={runState.headerResult}
        customActionCount={customActions.length}
        hasReport={Boolean(labReport)}
        onNew={newProject}
        onOpen={() => void openProject()}
        onImportAsset={() => setAssetImportOpen(true)}
        onImportManual={() => setManualImportOpen(true)}
        onSave={() => void saveWorkspace(false)}
        onSaveAs={() => void saveWorkspace(true)}
        onRestore={restoreLastWorkspace}
        onOpenSupport={() => void openSupportGuide()}
        onExportDiagnostics={() => void exportLocalDiagnostics()}
        onAbout={showDesktopAbout}
        onQuickStart={reopenFirstRunGuide}
        onActions={() => setActionComposerOpen(true)}
        onMarketplace={() => setMarketplaceOpen(true)}
        onFocusRealHardware={focusRealHardware}
        onWorkspaceModeChange={setWorkspaceMode}
        onExportReport={() => void exportCurrentLabReport()}
        onExportReceipt={() => void exportCurrentAuditReceipt()}
        onExportAdapter={() => void exportDeploymentConfig()}
        onLanguageChange={handleLanguageChange}
      />
      <input
        ref={workspaceFileInputRef}
        data-project-file-input
        type="file"
        accept=".openreality.json,.json,application/json"
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void loadWorkspaceFile(event.target.files?.[0] ?? null)}
      />
      {operatorNotice && (
        <OperatorNotice language={language} notice={operatorNotice} onDismiss={() => setOperatorNotice(null)} onAction={handleNoticeAction} />
      )}
      <div className="flex min-h-0 flex-1 w-full gap-0 overflow-hidden">
        {workspaceMode === 'simulation' && <LabConfigurator
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
          onDeviceTypeChange={handleDeviceTypeChange}
          onProfileChange={handleProfileChange}
          onScenarioChange={handleScenarioChange}
          onAddAsset={handleAddAsset}
        />}
        <div data-component="WorkspaceViewport" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0F111A]">
          <div className="relative min-h-0 flex-1 overflow-hidden border-b border-border-panel bg-[#0F111A]">
            {workspaceMode === 'real' ? (
              <RealDeviceWorkspace language={language} telemetry={realHardwareTelemetry} onFocusRealHardware={focusRealHardware} />
            ) : (
            <VirtualDeviceStage
              language={language}
              profile={effectiveSelectedProfile}
              report={labReport}
              replaySnapshot={stageReplaySnapshot}
              currentActionFrame={stageActionFrame}
              scenarioPreview={scenarioPreview}
              realHardwareTelemetry={realHardwareTelemetry}
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
              onRemoveSelectedDevice={handleRemoveSelectedDevice}
              onForbiddenZonesChange={(forbiddenZones) => {
                if (!selectedWorkspaceDevice) return;
                updateWorkspaceDevice(selectedWorkspaceDevice.id, { config: { ...selectedWorkspaceDevice.config, forbidden_zones: forbiddenZones } });
              }}
            />
            )}
            {workspaceMode === 'simulation' && !workspaceExpanded && (
              <>
                {showFirstRunGuide && (
                  <div className="pointer-events-none absolute inset-4 z-30">
                    <div className="pointer-events-auto h-full">
                      <FirstRunGuide
                        language={language}
                        quickStartPaths={quickStartPaths}
                        onQuickStart={handleQuickStart}
                        onDismiss={dismissFirstRunGuide}
                      />
                    </div>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 mx-auto w-[min(980px,calc(100%-32px))]">
                  <div className="pointer-events-auto">
                    <CommandDock
                      language={language}
                      prompt={prompt}
                      running={runState.active}
                      status={runState.command}
                      runTargetLabel={currentRunTargetLabel}
                      runTargetRunnable={currentRunTargetRunnable}
                      runTargetDeviceType={effectiveSelectedProfile.deviceMeta.device_type}
                      starterPrompts={currentRunStarterPrompts}
                      quickStartPaths={quickStartPaths}
                      activeQuickStart={activeQuickStart}
                      llmChip={{ state: llmChipState, model: LLM_COMPILER_MODEL }}
                      onPromptChange={handlePromptChange}
                      onQuickStart={handleQuickStart}
                      onRun={runScenario}
                      onStop={stopRun}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          {workspaceMode === 'simulation' && !workspaceExpanded && (
            <>
              <WorkspaceDeviceStrip
                language={language}
                devices={workspaceDevices}
                selectedWorkspaceDeviceId={selectedWorkspaceDeviceId}
                onSelectWorkspaceDevice={handleWorkspaceSelect}
              />
              <RealityAssetCatalog
                language={language}
                assets={builtinRealityAssets}
                selectedAssetId={`openreality.${selectedWorkspaceDevice?.deviceType ?? effectiveSelectedProfile.deviceMeta.device_type}`}
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
        <EvidenceSidebar
          language={language}
          workspaceMode={workspaceMode}
          selectionKey={selectedWorkspaceDeviceId}
          evidenceKey={runState.evidenceKey}
          evidence={(
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className={`${runtimeDecision ? 'h-[44%] min-h-[280px]' : 'h-[104px]'} shrink-0 overflow-hidden`}>
                <AutonomyDecisionPanel
                  language={language}
                  prompt={runtimeDecisionContext?.prompt ?? prompt.trim()}
                  targetDeviceLabel={runtimeDecisionContext?.targetDeviceLabel ?? currentRunTargetLabel}
                  targetDeviceType={runtimeDecisionContext?.targetDeviceType ?? effectiveSelectedProfile.deviceMeta.device_type}
                  decision={runtimeDecision}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <AuditPanel
                  view="evidence"
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
              onExportReceipt={() => void exportCurrentAuditReceipt()}
                />
              </div>
            </div>
          )}
          inspector={(
            <AuditPanel
              view="inspector"
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
              onExportReceipt={() => void exportCurrentAuditReceipt()}
            />
          )}
          hardware={(
            <RealHardwarePanel
              language={language}
              primary={workspaceMode === 'real'}
              actions={customActions}
              onSaveAction={(manifest) => setCustomActions((current) => [...current, manifest])}
              onTelemetryChange={setRealHardwareTelemetry}
            />
          )}
        />
      </div>
      {assetImportOpen && (
        <div data-app-modal className="contents">
          <AccessibleDialogBoundary label={language === 'zh' ? '导入设备资产' : 'Import device asset'} onClose={closeAssetImport}>
            <AssetImportWizard
              onImport={handleImportedAsset}
              onClose={closeAssetImport}
            />
          </AccessibleDialogBoundary>
        </div>
      )}
      {actionComposerOpen && (
        <div data-app-modal className="contents">
          <ActionComposer
          language={language}
          deviceMeta={effectiveSelectedProfile.deviceMeta}
          actions={customActions}
          onSave={(manifest) => {
            setCustomActions((current) => [...current.filter((item) => item.action_id !== manifest.action_id), manifest]);
          }}
          onImport={(manifests) => setCustomActions((current) => [...current, ...manifests])}
          manualActionRecord={selectedManualActionRecord}
          onInstallManualActions={(manifests) => setCustomActions((current) => [...current, ...manifests])}
          onDelete={(actionId) => setCustomActions((current) => current.filter((item) => item.action_id !== actionId))}
          onRun={(manifest, taskDsl) => {
            setActionComposerOpen(false);
            void runScenario({
              manifestRun: {
                taskDsl,
                actionId: manifest.action_id,
                label: language === 'zh' ? manifest.display_name.zh : manifest.display_name.en
              }
            });
          }}
            onClose={closeActionComposer}
          />
        </div>
      )}
      {manualImportOpen && (
        <div data-app-modal className="contents">
          <ManualImportWizard
          language={language}
          builtinIntentIds={BUILTIN_INTENT_IDS}
          existingRecords={manualImports}
          onSave={(record) => {
            const previouslyEnabled = manualImports.some((item) => item.device_meta.profile_id === record.device_meta.profile_id && item.virtual_lab?.enabled);
            setManualImports((current) => [...current.filter((item) => item.device_meta.profile_id !== record.device_meta.profile_id), record]);
            setManualSimulationAssets((current) => current.filter((asset) => asset.manifest.asset_id !== record.device_meta.profile_id));
            if (previouslyEnabled) {
              setWorkspaceDevices((current) => {
                const next = current.filter((device) => device.assetId !== record.device_meta.profile_id);
                setSelectedWorkspaceDeviceId((selected) => next.some((device) => device.id === selected) ? selected : next[0]?.id ?? null);
                return next;
              });
            }
            showNotice('success', noticeMessage(language, previouslyEnabled ? '提案已更新；旧仿真实例已移除，需重新通过第二道启用确认。' : '已保存仅仿真的手册提案；真实硬件保持禁用。', previouslyEnabled ? 'Proposal updated; old simulation instances were removed and second-gate enablement is required again.' : 'Saved simulation-only manual proposal; real hardware remains disabled.'));
          }}
          onEnable={(record, confirmed) => {
            const template = builtInDeviceAssets.find((asset) => asset.manifest.device_type === record.device_meta.device_type);
            if (!template) return { ok: false, detail: language === 'zh' ? '缺少匹配的可信语义几何模板。' : 'No matching trusted semantic geometry template.' };
            const enabled = enableManualImportForVirtualLab({ record, templateAsset: template, builtinIntentIds: BUILTIN_INTENT_IDS, confirmed });
            if (!enabled.ok) return enabled;
            const nextDevice = createWorkspaceDevice(enabled.asset.manifest.device_type, workspaceDevices.length, language, enabled.asset);
            const baseProfile = getFirstProfileForType(enabled.asset.manifest.device_type);
            const nextScenario = getScenarioForProfile(baseProfile.id, 'safe');
            const nextPrompt = isRunnableDeviceV01(enabled.asset.manifest.device_type) ? getLocalizedPrompt(nextScenario, language) : comingSoonPrompt(language, enabled.asset.manifest.device_type);
            setManualImports((current) => [...current.filter((item) => item.device_meta.profile_id !== enabled.record.device_meta.profile_id), enabled.record]);
            setManualSimulationAssets((current) => [...current.filter((asset) => asset.manifest.asset_id !== enabled.asset.manifest.asset_id), enabled.asset]);
            setWorkspaceDevices((current) => [...current, nextDevice]);
            setSelectedWorkspaceDeviceId(nextDevice.id);
            setDeviceType(enabled.asset.manifest.device_type);
            setSelectedProfileId(baseProfile.id);
            setScenarioId(nextScenario.id);
            setPrompt(nextPrompt);
            setCommandStatus({ kind: isRunnableDeviceV01(enabled.asset.manifest.device_type) ? 'ready' : 'coming_soon', message: isRunnableDeviceV01(enabled.asset.manifest.device_type) ? readyMessageForPrompt(language, enabled.asset.manifest.device_type, nextPrompt) : comingSoonMessage(language, enabled.asset.manifest.device_type) });
            setLabReport(null); setWorkspaceValidation(null); setSelectedSnapshot(null); setCurrentActionFrame(null); setLivePlaybackEvents([]); setLiveAdapterCommands([]); setReplayIndex(0);
            showNotice('success', noticeMessage(language, '已通过第二道确认并添加到 Virtual Lab；执行模式仍为 simulation。', 'Second-gate confirmation passed and asset added to Virtual Lab; execution mode remains simulation.'));
            return { ok: true };
          }}
          onReviewActions={(record) => {
            if (!record.virtual_lab?.enabled) return { ok: false, detail: language === 'zh' ? '必须先通过第二道确认启用仿真资产。' : 'Enable the simulation asset through the second gate first.' };
            const workspaceDevice = workspaceDevices.find((device) => device.assetId === record.device_meta.profile_id);
            if (!workspaceDevice) return { ok: false, detail: language === 'zh' ? '请先从 Asset Library 将已启用的仿真资产添加到工作区。' : 'Add the enabled simulation asset to the workspace from Asset Library first.' };
            setSelectedWorkspaceDeviceId(workspaceDevice.id);
            setManualImportOpen(false);
            setActionComposerOpen(true);
            return { ok: true };
          }}
            onClose={closeManualImport}
          />
        </div>
      )}
      {marketplaceOpen && (
        <div data-app-modal className="contents">
          <AccessibleDialogBoundary label="RealityWarden Marketplace" onClose={closeMarketplace}>
            <MarketplaceManager
              language={language}
              onClose={closeMarketplace}
              onLifecycleChange={refreshMarketplaceWorkspace}
              workspaceBindings={marketplaceBindings}
            />
          </AccessibleDialogBoundary>
        </div>
      )}
    </div>
  );
}
