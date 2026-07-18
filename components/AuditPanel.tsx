'use client';

import { useEffect, useState } from 'react';
import type { AdapterCommand } from '@/lib/adapter/AdapterCommand';
import type { LabReport, TimelineStateSnapshot } from '@/lib/virtual-lab/LabReport';
import type { SafetyReport } from '@/types/safety';
import type { TaskDSL, TaskStep } from '@/types/taskDsl';
import type { DeviceProfile, DeviceType } from '@/types/deviceMeta';
import type { DeviceAsset } from '@/lib/assets/DeviceAsset';
import { localizeCapability, localizeCategory, localizeDeviceType, localizeDisplayName, localizeFidelity, localizeMetadataValue, localizeProfileName, localizeScenarioName, t as ti } from '@/lib/i18n';
import type { UiLanguage } from './LabConfigurator';
import { StatusPill } from './StatusPill';

interface AuditPanelProps {
  view?: 'all' | 'evidence' | 'inspector';
  language: UiLanguage;
  selectedProfile: DeviceProfile;
  selectedWorkspaceDevice: WorkspaceDeviceRecord | null;
  selectedAsset: DeviceAsset | null;
  currentRunTargetLabel: string;
  isRunnable: boolean;
  workspaceDeviceCount: number;
  workspaceValidation: WorkspaceValidationResult | null;
  onWorkspaceDeviceChange: (deviceId: string, patch: Partial<WorkspaceDeviceRecord>) => void;
  onWorkspaceDeviceRemove: (deviceId: string) => void;
  onWorkspaceDeviceDuplicate: (deviceId: string) => void;
  onSelectedAssetExport: () => void;
  labReport: LabReport | null;
  safetyReport: SafetyReport | null;
  selectedSnapshot: TimelineStateSnapshot | null;
  onSnapshotSelect: (snapshot: TimelineStateSnapshot | null) => void;
  onExportLabReport: () => void;
}

interface WorkspaceDeviceRecord {
  id: string;
  label: string;
  profileId: string;
  assetId?: string;
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

const text = {
  zh: {
    safetyRuntime: '\u5b89\u5168\u8fd0\u884c\u65f6',
    deviceInspector: '\u4eff\u771f\u6a21\u578b\u8be6\u60c5',
    assetInfo: '\u8d44\u4ea7\u4fe1\u606f',
    license: '\u8bb8\u53ef',
    adapterManifest: '\u9002\u914d\u5668\u6e05\u5355',
    scenarios: '\u573a\u666f',
    simulatorFidelity: '\u4eff\u771f\u7ea7\u522b',
    workspaceCount: '\u9884\u6f14\u6a21\u578b',
    modelSource: '\u6a21\u578b\u6765\u6e90',
    capabilities: '\u80fd\u529b',
    constraints: '\u8fb9\u754c\u7ea6\u675f',
    safetyPolicy: '\u5b89\u5168\u7b56\u7565',
    deploymentConfig: '\u4eff\u771f\u914d\u7f6e',
    deviceName: '\u8bbe\u5907\u540d\u79f0',
    layoutPosition: '\u5e03\u5c40\u4f4d\u7f6e',
    layoutHint: '\u53ef\u5728\u5de5\u4f5c\u533a\u76f4\u63a5\u62d6\u52a8\uff0c\u4e5f\u53ef\u5728\u8fd9\u91cc\u7cbe\u786e\u5fae\u8c03 X / Z \u5750\u6807\u3002',
    posX: 'X \u5750\u6807',
    posY: 'Y \u5750\u6807',
    posZ: 'Z \u5750\u6807',
    adapterTargetId: '\u9002\u914d\u5668\u76ee\u6807 ID',
    enabled: '\u542f\u7528\u6a21\u578b',
    maxSpeed: '\u6700\u5927\u901f\u5ea6',
    forceLimit: '\u529b\u9650\u5236',
    removeDevice: '\u79fb\u9664\u8bbe\u5907',
    noWorkspaceDevice: '\u5c06\u4eff\u771f\u6a21\u578b\u52a0\u5165\u9884\u6f14\u5de5\u4f5c\u533a\u540e\u53ef\u7f16\u8f91\u5176\u914d\u7f6e\u3002',
    workspaceValidation: '\u5de5\u4f5c\u533a\u9a8c\u8bc1',
    validationNotRun: '\u5c1a\u672a\u6267\u884c',
    realSource: '\u771f\u5b9e\u6765\u6e90',
    placeholderSource: '\u5360\u4f4d\u8d44\u4ea7',
    workspace: '\u5de5\u4f5c\u7a7a\u95f4',
    forbiddenZones: '\u7981\u6b62\u533a',
    executionGate: '\u6267\u884c\u51c6\u5165\u68c0\u67e5',
    runToEvaluate: '\u8fd0\u884c\u573a\u666f\u540e\u663e\u793a\u5b89\u5168\u89c4\u5219\u8bc4\u4f30\u3002',
    blocked: '\u5df2\u62e6\u622a',
    taskPlan: '\u4efb\u52a1\u8ba1\u5212',
    taskEmpty: '\u6267\u884c\u540e\u663e\u793a\u4efb\u52a1\u8ba1\u5212\u3002',
    intent: '\u610f\u56fe',
    risk: '\u98ce\u9669\u7b49\u7ea7',
    stepCount: '\u6b65\u9aa4',
    commandCount: '\u547d\u4ee4',
    actionPlans: '\u52a8\u4f5c\u8ba1\u5212',
    frameCount: '\u5e27',
    duration: '\u65f6\u957f',
    validation: '\u9a8c\u8bc1',
    snapshotCount: '\u5feb\u7167',
    deviceCommands: '\u8bbe\u5907\u547d\u4ee4',
    commandsEmpty: '\u6267\u884c\u540e\u663e\u793a\u8bbe\u5907\u547d\u4ee4\u3002',
    source: '\u6765\u6e90\u6b65\u9aa4',
    target: '\u76ee\u6807',
    reason: '\u539f\u56e0',
    allow: '\u5141\u8bb8',
    block: '\u62e6\u622a',
    rawTask: '\u539f\u59cb\u4efb\u52a1\u6570\u636e',
    rawCommand: '\u539f\u59cb\u547d\u4ee4\u6570\u636e',
    rawBackup: '\u5ba1\u8ba1\u5907\u4efd',
    viewFull: '\u67e5\u770b\u5b8c\u6574',
    deviceState: '\u8bbe\u5907\u72b6\u6001',
    beforeAfter: '\u6267\u884c\u524d / \u6267\u884c\u540e',
    timeline: '\u6267\u884c\u56de\u653e',
    timelineEmpty: '\u6267\u884c\u540e\u663e\u793a\u65f6\u95f4\u7ebf\u3002',
    changed: '\u53d8\u5316\u5b57\u6bb5',
    labReport: '\u5b9e\u9a8c\u62a5\u544a',
    exportReport: '\u5bfc\u51fa\u5b9e\u9a8c\u62a5\u544a',
    fullAudit: '\u5b8c\u6574\u5ba1\u8ba1\u6570\u636e',
    status: { pass: '\u901a\u8fc7', fail: '\u5931\u8d25', warning: '\u8b66\u544a', blocked: '\u5df2\u62e6\u622a', idle: '\u5f85\u673a', needs_confirmation: '\u9700\u786e\u8ba4' },
    stage: { initial: '\u521d\u59cb\u72b6\u6001', compile: '\u4efb\u52a1\u7f16\u8bd1', safety: '\u5b89\u5168\u68c0\u67e5', adapter: '\u9002\u914d\u5668', device: '\u8bbe\u5907\u6267\u884c', blocked: '\u62e6\u622a\u73b0\u573a', final: '\u5b8c\u6210' },
    fields: { zone: '\u533a\u57df', speed: '\u901f\u5ea6', force: '\u529b\u5ea6', value: '\u503c' },
    actions: {
      scan_area: '\u626b\u63cf\u533a\u57df',
      identify_object: '\u8bc6\u522b\u76ee\u6807',
      move_to_pose: '\u79fb\u52a8\u5230\u4f4d\u59ff',
      grasp: '\u6293\u53d6',
      release: '\u91ca\u653e',
      return_home: '\u56de\u5230\u539f\u70b9',
      throw_object: '\u629b\u63b7\u7269\u4f53',
      navigate_to: '\u5bfc\u822a\u5230\u76ee\u6807',
      dock: '\u505c\u9760',
      set_light: '\u8bbe\u7f6e\u706f\u5149',
      set_brightness: '\u8bbe\u7f6e\u4eae\u5ea6',
      set_color: '\u8bbe\u7f6e\u989c\u8272',
      capture_frame: '\u91c7\u96c6\u753b\u9762',
      read_sensor: '\u8bfb\u53d6\u4f20\u611f\u5668',
      read_register: '\u8bfb\u53d6\u5bc4\u5b58\u5668',
      write_register: '\u5199\u5165\u5bc4\u5b58\u5668',
      start_sequence: '\u542f\u52a8\u5e8f\u5217',
      stop_sequence: '\u505c\u6b62\u5e8f\u5217',
      read_measurement: '\u8bfb\u53d6\u6d4b\u91cf',
      set_parameter: '\u8bbe\u7f6e\u53c2\u6570',
      start_test: '\u542f\u52a8\u6d4b\u8bd5',
      stop_test: '\u505c\u6b62\u6d4b\u8bd5',
      scan_slot: '\u626b\u63cf\u8d27\u4f4d',
      reserve_slot: '\u9884\u7559\u8d27\u4f4d',
      release_slot: '\u91ca\u653e\u8d27\u4f4d',
      mark_item: '\u6807\u8bb0\u7269\u6599',
      calibrate_sensor: '\u6821\u51c6\u4f20\u611f\u5668',
      reset_sensor: '\u91cd\u7f6e\u4f20\u611f\u5668',
      start_belt: '\u542f\u52a8\u4f20\u9001\u5e26',
      stop_belt: '\u505c\u6b62\u4f20\u9001\u5e26',
      sort_item: '\u5206\u62e3\u7269\u6599'
    },
    checks: {
      action_supported: '\u6240\u6709\u52a8\u4f5c\u90fd\u5728\u8bbe\u5907\u80fd\u529b\u8303\u56f4\u5185',
      target_exists: '\u6240\u6709\u76ee\u6807\u90fd\u5b58\u5728',
      inside_workspace: '\u76ee\u6807\u4fdd\u6301\u5728\u5de5\u4f5c\u7a7a\u95f4\u5185',
      no_forbidden_zone_violation: '\u8def\u5f84\u907f\u5f00\u5df2\u914d\u7f6e\u7684\u7981\u6b62\u533a',
      speed_limit_safe: '\u901f\u5ea6\u5728\u8bbe\u5907\u6863\u6848\u9650\u5236\u5185',
      force_limit_safe: '\u529b\u5ea6\u5728\u8bbe\u5907\u6863\u6848\u9650\u5236\u5185',
      no_throwing_action: '\u4e0d\u5141\u8bb8\u629b\u63b7\u52a8\u4f5c',
      logging_enabled: '\u6267\u884c\u65e5\u5fd7\u5df2\u542f\u7528',
      risk_level_acceptable: '\u98ce\u9669\u7b49\u7ea7\u7b26\u5408\u5f53\u524d\u8bbe\u5907\u6863\u6848'
    }
  },
  en: {
    safetyRuntime: 'Safety Runtime',
    deviceInspector: 'Simulation Details',
    assetInfo: 'Asset Info',
    license: 'License',
    adapterManifest: 'Adapter Manifest',
    scenarios: 'Scenarios',
    simulatorFidelity: 'Simulator Fidelity',
    workspaceCount: 'Rehearsal Models',
    modelSource: 'Model Source',
    capabilities: 'Capabilities',
    constraints: 'Constraints',
    safetyPolicy: 'Safety Policy',
    deploymentConfig: 'Simulation Config',
    deviceName: 'Device Name',
    layoutPosition: 'Layout Position',
    layoutHint: 'Drag the device in the workspace, or fine-tune X / Z coordinates here.',
    posX: 'Position X',
    posY: 'Position Y',
    posZ: 'Position Z',
    adapterTargetId: 'Adapter Target ID',
    enabled: 'Model Enabled',
    maxSpeed: 'Max Speed',
    forceLimit: 'Force Limit',
    removeDevice: 'Remove Device',
    noWorkspaceDevice: 'Add a simulation model to the rehearsal workspace to edit its configuration.',
    workspaceValidation: 'Workspace Validation',
    validationNotRun: 'Not run',
    realSource: 'Real Source',
    placeholderSource: 'Placeholder Asset',
    workspace: 'Workspace',
    forbiddenZones: 'Forbidden Zones',
    executionGate: 'Execution Gate',
    runToEvaluate: 'Run a scenario to evaluate safety rules.',
    blocked: 'BLOCKED',
    taskPlan: 'Task Plan',
    taskEmpty: 'Task plan appears after execution.',
    intent: 'Intent',
    risk: 'Risk',
    stepCount: 'steps',
    commandCount: 'commands',
    actionPlans: 'Action Plans',
    frameCount: 'frames',
    duration: 'duration',
    validation: 'validation',
    snapshotCount: 'snapshots',
    deviceCommands: 'Device Commands',
    commandsEmpty: 'Adapter commands appear after execution.',
    source: 'Source Step',
    target: 'Target',
    reason: 'Reason',
    allow: 'ALLOW',
    block: 'BLOCK',
    rawTask: 'Raw Task Data',
    rawCommand: 'Raw Command Data',
    rawBackup: 'Audit backup',
    viewFull: 'View Full',
    deviceState: 'Device State',
    beforeAfter: 'Before / After',
    timeline: 'Execution Timeline',
    timelineEmpty: 'Timeline appears after a lab run.',
    changed: 'Changed',
    labReport: 'Lab Report',
    exportReport: 'Export Lab Report',
    fullAudit: 'Full audit data',
    status: { pass: 'PASS', fail: 'FAIL', warning: 'WARNING', blocked: 'BLOCKED', idle: 'IDLE', needs_confirmation: 'REVIEW' },
    stage: { initial: 'Initial', compile: 'Compile', safety: 'Safety', adapter: 'Adapter', device: 'Device', blocked: 'Blocked', final: 'Final' },
    fields: { zone: 'Zone', speed: 'Speed', force: 'Force', value: 'Value' },
    actions: {
      scan_area: 'Scan area',
      identify_object: 'Identify object',
      move_to_pose: 'Move to pose',
      grasp: 'Grasp',
      release: 'Release',
      return_home: 'Return home',
      throw_object: 'Throw object',
      navigate_to: 'Navigate to',
      dock: 'Dock',
      set_light: 'Set light',
      set_brightness: 'Set brightness',
      set_color: 'Set color',
      capture_frame: 'Capture frame',
      read_sensor: 'Read sensor',
      read_register: 'Read register',
      write_register: 'Write register',
      start_sequence: 'Start sequence',
      stop_sequence: 'Stop sequence',
      read_measurement: 'Read measurement',
      set_parameter: 'Set parameter',
      start_test: 'Start test',
      stop_test: 'Stop test',
      scan_slot: 'Scan slot',
      reserve_slot: 'Reserve slot',
      release_slot: 'Release slot',
      mark_item: 'Mark item',
      calibrate_sensor: 'Calibrate sensor',
      reset_sensor: 'Reset sensor',
      start_belt: 'Start belt',
      stop_belt: 'Stop belt',
      sort_item: 'Sort item'
    },
    checks: {} as Record<string, string>
  }
};

const zhValueMap: Record<string, string> = {
  low: '\u4f4e',
  medium: '\u4e2d',
  high: '\u9ad8',
  slow: '\u6162\u901f',
  normal: '\u5e38\u901f',
  fast: '\u5feb\u901f',
  idle: '\u5f85\u673a',
  completed: '\u5b8c\u6210',
  blocked: '\u5df2\u62e6\u622a',
  docked: '\u5df2\u505c\u9760',
  captured: '\u5df2\u91c7\u96c6',
  pickup_zone: '\u53d6\u6599\u533a',
  right_safe_zone: '\u53f3\u4fa7\u5b89\u5168\u533a',
  left_safe_zone: '\u5de6\u4fa7\u5b89\u5168\u533a',
  charging_dock: '\u5145\u7535\u6869',
  aisle_a: 'A \u901a\u9053',
  restricted_zone: '\u9650\u5236\u533a',
  privacy_zone: '\u9690\u79c1\u533a',
  bin_a: 'A \u6599\u7bb1',
  jam_zone: '\u5361\u6ede\u533a',
  red_cube: '\u7ea2\u8272\u65b9\u5757',
  lamp: '\u706f\u5177',
  camera_view: '\u6444\u50cf\u5934\u89c6\u91ce'
};

const profileNames = {
  zh: {
    'virtual-robot-arm': '\u901a\u7528\u673a\u68b0\u81c2',
    'virtual-mobile-robot': '\u79fb\u52a8\u673a\u5668\u4eba',
    'virtual-smart-light': '\u667a\u80fd\u706f',
    'virtual-camera-sensor': '\u6444\u50cf\u5934\u4f20\u611f\u5668',
    'virtual-conveyor-belt': '\u4f20\u9001\u5e26',
    'generic-robot-arm': '\u901a\u7528\u673a\u68b0\u81c2',
    'desktop-pick-place-arm': '\u684c\u9762\u53d6\u653e\u673a\u68b0\u81c2',
    'restricted-lab-arm': '\u53d7\u9650\u5b9e\u9a8c\u5ba4\u673a\u68b0\u81c2'
  },
  en: {
    'virtual-robot-arm': 'Robot Arm',
    'virtual-mobile-robot': 'Mobile Robot',
    'virtual-smart-light': 'Smart Light',
    'virtual-camera-sensor': 'Camera Sensor',
    'virtual-conveyor-belt': 'Conveyor Belt',
    'generic-robot-arm': 'Generic Robot Arm',
    'desktop-pick-place-arm': 'Desktop Pick-place Arm',
    'restricted-lab-arm': 'Restricted Lab Arm'
  }
} as const;

const deviceTypeNames = {
  zh: {
    robot_arm: '\u673a\u68b0\u81c2',
    mobile_robot: '\u79fb\u52a8\u673a\u5668\u4eba',
    smart_light: '\u667a\u80fd\u706f',
    camera_sensor: '\u6444\u50cf\u5934\u4f20\u611f\u5668',
    conveyor_belt: '\u4f20\u9001\u5e26',
    plc_cabinet: 'PLC \u63a7\u5236\u67dc',
    lab_instrument: '\u5b9e\u9a8c\u5ba4\u4eea\u5668',
    warehouse_rack: '\u4ed3\u50a8\u8d27\u67b6',
    sensor_box: '\u4f20\u611f\u5668\u76d2'
  },
  en: {
    robot_arm: 'Robot Arm',
    mobile_robot: 'Mobile Robot',
    smart_light: 'Smart Light',
    camera_sensor: 'Camera Sensor',
    conveyor_belt: 'Conveyor Belt',
    plc_cabinet: 'PLC Cabinet',
    lab_instrument: 'Lab Instrument',
    warehouse_rack: 'Warehouse Rack',
    sensor_box: 'Sensor Box'
  }
} as const;

function localProfileName(profile: DeviceProfile, language: UiLanguage) {
  return localizeProfileName(language, profile.deviceMeta.display_name ?? profile.label ?? profile.id);
}

function localDeviceType(deviceType: DeviceType, language: UiLanguage) {
  return deviceTypeNames[language][deviceType];
}

function localResult(result: 'pass' | 'blocked' | 'failed', language: UiLanguage) {
  if (language === 'en') return result.toUpperCase();
  if (result === 'pass') return '\u901a\u8fc7';
  if (result === 'blocked') return '\u5df2\u62e6\u622a';
  return '\u5931\u8d25';
}

function localValue(value: unknown, language: UiLanguage) {
  if (typeof value === 'string') return localizeMetadataValue(language, value);
  return String(value);
}

function localCheckLabel(id: string, fallback: string, language: UiLanguage) {
  if (language === 'en') return fallback;
  return text.zh.checks[id as keyof typeof text.zh.checks] ?? fallback;
}

function localMessage(message: string, language: UiLanguage) {
  if (language === 'en') return message;
  if (message.includes('Initial device state captured')) return '\u5df2\u6355\u83b7\u521d\u59cb\u8bbe\u5907\u72b6\u6001\u3002';
  if (message.includes('Blocked before adapter execution')) return '\u5df2\u5728\u9002\u914d\u5668\u6267\u884c\u524d\u62e6\u622a\uff0c\u8bbe\u5907\u72b6\u6001\u4fdd\u6301\u4e0d\u53d8\u3002';
  if (message.includes('Virtual device state updated')) return '\u865a\u62df\u8bbe\u5907\u72b6\u6001\u5df2\u901a\u8fc7\u9002\u914d\u5668\u66f4\u65b0\u3002';
  if (message.includes('executed')) return '\u547d\u4ee4\u5df2\u6267\u884c\u3002';
  return message;
}

function AuditSection({
  title,
  summary,
  defaultOpen = false,
  forceOpen,
  children
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <section className="border-b border-[#E5E5EA] bg-[#F5F5F7]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] text-[#86868B]">{open ? 'v' : '>'}</span>
          <div className="truncate text-xs font-semibold uppercase tracking-wide text-[#1D1D1F]">{title}</div>
          {summary && <div className="truncate text-[11px] text-[#86868B]">{summary}</div>}
        </div>
      </button>
      {open && <div className="px-3 py-3">{children}</div>}
    </section>
  );
}

function DarkJsonBlock({ value, viewFullLabel }: { value: unknown; viewFullLabel: string }) {
  const [full, setFull] = useState(false);

  return (
    <div className="relative">
      <pre className={`custom-scrollbar overflow-auto border border-[#E5E5EA] bg-[#111827] p-3 font-mono text-[11px] leading-relaxed text-[#F3F4F6] ${full ? 'max-h-[520px]' : 'max-h-64'}`}>
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
      {!full && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-[#111827] to-transparent pb-2">
          <button type="button" onClick={() => setFull(true)} className="pointer-events-auto border border-[#374151] bg-[#111827] px-2.5 py-1 text-[11px] font-semibold text-[#F3F4F6]">
            {viewFullLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-[#E5E5EA] bg-white px-2.5 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-[#1D1D1F]">{value}</div>
    </div>
  );
}

function KeyValueGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid gap-2">
      {rows.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">{key}</div>
          <div className="min-w-0 break-words font-mono text-[11px] leading-4 text-text-primary">{value}</div>
        </div>
      ))}
    </div>
  );
}

function InspectorGroup({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-panel">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-8 w-full items-center justify-between bg-[#1B1D20] px-3 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary hover:bg-[#232529]">
        <span>{title}</span>
        <span>{open ? '-' : '+'}</span>
      </button>
      {open && <div className="bg-bg-panel p-3">{children}</div>}
    </div>
  );
}

function TaskPlanView({ language, taskDsl }: { language: UiLanguage; taskDsl: TaskDSL | null | undefined }) {
  const t = text[language];
  if (!taskDsl) return <div className="text-xs text-[#86868B]">{t.taskEmpty}</div>;

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <InlineMetric label={t.intent} value={taskDsl.intent} />
        <InlineMetric label={t.risk} value={localValue(taskDsl.risk_level, language)} />
      </div>
      <div className="border border-[#E5E5EA] bg-white">
        {taskDsl.steps.map((step, index) => (
          <div key={step.id} className="grid grid-cols-[34px_1fr] gap-2 border-b border-[#F3F4F6] px-2.5 py-2.5 last:border-b-0">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#EAF3FF] text-[11px] font-bold text-[#0066CC]">{index + 1}</div>
            <div>
              <div className="text-xs font-semibold text-[#1D1D1F]">{t.actions[step.action]}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-5 text-[#86868B]">
                {step.target && <span>{t.target}: {localValue(step.target, language)}</span>}
                {step.zone && <span>{t.fields.zone}: {localValue(step.zone, language)}</span>}
                {step.speed && <span>{t.fields.speed}: {localValue(step.speed, language)}</span>}
                {step.force && <span>{t.fields.force}: {localValue(step.force, language)}</span>}
                {step.value !== undefined && <span>{t.fields.value}: {localValue(step.value, language)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <AuditSection title={t.rawTask} summary={t.rawBackup}>
        <DarkJsonBlock value={taskDsl} viewFullLabel={t.viewFull} />
      </AuditSection>
    </div>
  );
}

function AdapterCommandView({ language, commands, activeCommandId }: { language: UiLanguage; commands: AdapterCommand[]; activeCommandId?: string }) {
  const t = text[language];
  if (commands.length === 0) return <div className="text-xs text-[#86868B]">{t.commandsEmpty}</div>;

  return (
    <div className="grid gap-2">
      <div className="border border-[#E5E5EA] bg-white">
        {commands.map((command, index) => (
          <div key={command.id} className={`grid grid-cols-[34px_1fr_auto] gap-2 border-b border-l-2 border-b-[#F3F4F6] px-2.5 py-2.5 last:border-b-0 ${command.id === activeCommandId ? 'border-l-[#0066CC] bg-[#F3F8FF]' : 'border-l-transparent'}`}>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F5F5F7] text-[11px] font-bold text-[#86868B]">{index + 1}</div>
            <div>
              <div className="text-xs font-semibold text-[#1D1D1F]">{t.actions[command.action]}</div>
              <div className="mt-1 text-[11px] leading-5 text-[#86868B]">
                {t.source}: {command.source_step_id}
                {command.target ? ` ? ${t.target}: ${localValue(command.target, language)}` : ''}
                {command.blocked_reason ? ` ? ${t.reason}: ${language === 'zh' ? t.block : command.blocked_reason}` : ''}
              </div>
            </div>
            <div className={command.allowed ? 'text-[11px] font-bold text-emerald-600' : 'text-[11px] font-bold text-rose-600'}>
              {command.allowed ? t.allow : t.block}
            </div>
          </div>
        ))}
      </div>
      <AuditSection title={t.rawCommand} summary={t.rawBackup}>
        <DarkJsonBlock value={commands} viewFullLabel={t.viewFull} />
      </AuditSection>
    </div>
  );
}

function ActionPlanView({ language, report, activeCommandId }: { language: UiLanguage; report: LabReport | null; activeCommandId?: string }) {
  const t = text[language];
  const plans = report?.action_plans ?? [];
  if (plans.length === 0) return <div className="text-xs text-[#86868B]">{language === 'zh' ? '\u8fd0\u884c\u540e\u663e\u793a\u52a8\u4f5c\u8ba1\u5212\u3002' : 'Action plans appear after execution.'}</div>;

  return (
    <div className="grid gap-2">
      {plans.map((plan, index) => {
        const diagnostics = plan.validation.diagnostics ?? {};
        return (
          <div key={plan.action_plan_id} className={`border border-l-2 px-3 py-2.5 ${plan.command_id === activeCommandId ? 'border-[#BBD7F5] border-l-[#0066CC] bg-[#F3F8FF]' : 'border-[#E5E5EA] border-l-transparent bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#1D1D1F]">{index + 1}. {t.actions[plan.action]}</div>
                <div className="mt-1 text-[11px] leading-5 text-[#86868B]">
                  {plan.command_id}
                  {plan.target ? ` · ${t.target}: ${localValue(plan.target, language)}` : ''}
                </div>
              </div>
              <div className={plan.validation.blocked ? 'text-[11px] font-bold text-rose-600' : 'text-[11px] font-bold text-emerald-600'}>
                {plan.validation.blocked ? t.block : t.allow}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">
              <span>{t.frameCount}: {plan.frame_count}</span>
              <span>{t.duration}: {plan.duration_ms}ms</span>
              <span>{t.validation}: {plan.validation.reachable ? 'reachable' : 'blocked'}</span>
            </div>
            {plan.validation.reason && (
              <div className="mt-2 border border-[#FECDD3] bg-[#FFF1F2] px-2 py-1.5 text-[11px] font-semibold leading-relaxed text-status-blocked">
                {plan.validation.reason}
              </div>
            )}
            {Object.keys(diagnostics).length > 0 && (
              <div className="mt-2 border-t border-[#F3F4F6] pt-2">
                <DarkJsonBlock value={diagnostics} viewFullLabel={t.viewFull} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateInspector({ language, before, snapshot }: { language: UiLanguage; before: Record<string, unknown>; snapshot: TimelineStateSnapshot | null }) {
  const state = snapshot?.device_state ?? before;
  const changed = new Set(snapshot?.changed_keys ?? []);
  const frame = snapshot?.action_frame;
  const visualState = frame?.visual_state ?? {};
  const hasVisualState = Object.keys(visualState).length > 0;

  return (
    <div className="grid gap-2 border border-[#E5E5EA] bg-white p-2.5 font-mono text-[11px] text-[#1D1D1F]">
      {frame && (
        <div className="grid grid-cols-3 gap-2 border border-[#D7E7FA] bg-[#F3F8FF] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#0066CC]">
          <span>{language === 'zh' ? '命令' : 'Command'}: {frame.command_id}</span>
          <span>{language === 'zh' ? '时间' : 'Time'}: {frame.time_ms}ms</span>
          <span>{language === 'zh' ? '进度' : 'Progress'}: {Math.round(frame.progress * 100)}%</span>
        </div>
      )}
      <div>
        <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{language === 'zh' ? '设备状态' : 'Device State'}</div>
        {Object.entries(state).map(([key, value]) => (
          <div key={key} className={`grid grid-cols-[120px_1fr] gap-3 px-2 py-1 ${changed.has(key) ? 'bg-[#EAF3FF] text-[#0066CC]' : 'text-[#1D1D1F]'}`}>
            <span className="text-[#86868B]">{key}</span>
            <span>{localValue(value, language)}</span>
          </div>
        ))}
      </div>
      {hasVisualState && (
        <div className="border-t border-[#F3F4F6] pt-2">
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{language === 'zh' ? '视觉动作帧' : 'Visual Action Frame'}</div>
          {Object.entries(visualState).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[120px_1fr] gap-3 px-2 py-1 text-[#1D1D1F]">
              <span className="text-[#86868B]">{key}</span>
              <span>{localValue(value, language)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionTimeline({
  language,
  snapshots,
  actionPlans,
  selectedSnapshot,
  onSelect
}: {
  language: UiLanguage;
  snapshots: TimelineStateSnapshot[];
  actionPlans: NonNullable<LabReport['action_plans']>;
  selectedSnapshot: TimelineStateSnapshot | null;
  onSelect: (snapshot: TimelineStateSnapshot) => void;
}) {
  const t = text[language];
  if (snapshots.length === 0) return <div className="text-xs text-[#86868B]">{t.timelineEmpty}</div>;

  return (
    <div className="grid gap-2">
      {snapshots.map((snapshot, index) => {
        const active = selectedSnapshot?.step_index === snapshot.step_index && selectedSnapshot?.step_id === snapshot.step_id;
        const blocked = snapshot.safety_status === 'blocked';
        const actionPlan = snapshot.command_id ? actionPlans.find((plan) => plan.command_id === snapshot.command_id) : null;
        return (
          <button
            key={`${snapshot.step_id}-${index}`}
            type="button"
            onClick={() => onSelect(snapshot)}
            className={`relative w-full border border-[#E5E5EA] bg-white px-3 py-2.5 text-left transition-colors hover:bg-[#F5F5F7] ${active ? 'border-l-[#0066CC]' : 'border-l-[#E5E5EA]'}`}
          >
            <span className={`absolute left-0 top-0 h-full w-1 ${active ? 'bg-[#0066CC]' : 'bg-[#E5E5EA]'}`} />
            <div className="ml-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-[#1D1D1F]">{t.stage[snapshot.stage]} - {snapshot.step_id}</div>
                <div className="mt-1 text-[11px] leading-5 text-[#86868B]">{localMessage(snapshot.message, language)}</div>
                {snapshot.changed_keys.length > 0 && (
                  <div className="mt-1.5 text-[11px] font-semibold text-[#0066CC]">{t.changed}: {snapshot.changed_keys.join(', ')}</div>
                )}
                {actionPlan && (
                  <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">
                    {language === 'zh'
                      ? `${actionPlan.frame_count} 帧 · ${actionPlan.duration_ms}ms`
                      : `${actionPlan.frame_count} frames · ${actionPlan.duration_ms}ms`}
                  </div>
                )}
              </div>
              <div className={blocked ? 'text-[11px] font-bold text-rose-600' : 'text-[11px] font-bold text-emerald-600'}>
                {t.status[snapshot.safety_status]}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DeviceInspector({
  language,
  profile,
  isRunnable,
  workspaceDeviceCount,
  workspaceValidation,
  selectedWorkspaceDevice,
  selectedAsset,
  currentRunTargetLabel,
  onWorkspaceDeviceChange,
  onWorkspaceDeviceRemove,
  onWorkspaceDeviceDuplicate,
  onSelectedAssetExport
}: {
  language: UiLanguage;
  profile: DeviceProfile;
  isRunnable: boolean;
  workspaceDeviceCount: number;
  workspaceValidation: WorkspaceValidationResult | null;
  selectedWorkspaceDevice: WorkspaceDeviceRecord | null;
  selectedAsset: DeviceAsset | null;
  currentRunTargetLabel: string;
  onWorkspaceDeviceChange: (deviceId: string, patch: Partial<WorkspaceDeviceRecord>) => void;
  onWorkspaceDeviceRemove: (deviceId: string) => void;
  onWorkspaceDeviceDuplicate: (deviceId: string) => void;
  onSelectedAssetExport: () => void;
}) {
  const t = text[language];
  const meta = profile.deviceMeta;
  const workspace = meta.constraints.workspace;
  const modelAsset = meta.model_asset;
  const isRealModel = modelAsset?.source === 'open_source_robot_model' || modelAsset?.source === 'real_device_cad';
  const runtimeState = selectedWorkspaceDevice?.current_state ?? meta.runtime_state;
  const runtimeEntries = Object.entries(runtimeState).slice(0, 6);
  const currentPosition = selectedWorkspaceDevice?.position ?? [0, 0, 0];

  const updateLayoutPosition = (axis: 0 | 1 | 2, rawValue: string) => {
    if (!selectedWorkspaceDevice) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const nextPosition: [number, number, number] = [...currentPosition] as [number, number, number];
    nextPosition[axis] = axis === 0
      ? Math.min(workspace.x_max, Math.max(workspace.x_min, parsed))
      : axis === 1
        ? Math.min(workspace.y_max, Math.max(workspace.y_min, parsed))
        : Math.min(workspace.z_max, Math.max(workspace.z_min, parsed));
    onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { position: nextPosition });
  };

  return (
    <section className="border-b border-border-panel bg-bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t.deviceInspector}</div>
          <div className="mt-1 text-[15px] font-semibold leading-5 text-text-primary">{localizeDisplayName(language, selectedWorkspaceDevice?.label ?? localProfileName(profile, language))}</div>
          <div className="mt-1 text-[11px] leading-5 text-text-secondary">
            {localizeDeviceType(language, meta.device_type)} / {language === 'zh' ? '\u578b\u53f7' : 'Model'} {localizeDisplayName(language, meta.model)}
          </div>
        </div>
        <div className="rounded-[3px] border border-border-panel bg-[#232529] px-2 py-1 text-[11px] font-semibold text-text-primary">
          {workspaceDeviceCount} {t.workspaceCount}
        </div>
      </div>

      <div className="mt-3 border border-border-panel bg-bg-panel">
        <InspectorGroup title={ti(language, 'inspector_overview')} defaultOpen>
          {/* Device name/type/model already live in the panel header directly
              above - repeating them here was pure noise (UI audit B4). The run
              target row survives only when it differs from the shown device. */}
          <KeyValueGrid rows={[
            ...(currentRunTargetLabel !== localizeDisplayName(language, selectedWorkspaceDevice?.label ?? localProfileName(profile, language))
              ? [[ti(language, 'current_run_target'), currentRunTargetLabel] as [string, string]]
              : []),
            [ti(language, 'device_profile'), meta.profile_id],
            [ti(language, 'run_status'), isRunnable ? ti(language, 'runnable') : ti(language, 'not_runnable')],
            [t.layoutPosition, `X ${currentPosition[0].toFixed(1)} / Z ${currentPosition[2].toFixed(1)}`],
            [ti(language, 'asset'), selectedAsset?.manifest.asset_id ?? 'virtual-profile']
          ]} />
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_runtime_state')} defaultOpen>
          <KeyValueGrid rows={runtimeEntries.map(([key, value]) => [key, localValue(value, language)])} />
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_capabilities')} defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            {meta.capabilities.map((capability) => (
              <span key={capability} className="max-w-full rounded-[3px] border border-border-panel bg-[#232529] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-text-primary">
                {localizeCapability(language, capability)}
              </span>
            ))}
          </div>
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_safety_rules')}>
          <KeyValueGrid rows={[
            ['max speed', meta.constraints.max_speed],
            ['force', meta.constraints.force_limit],
            ['forbidden', meta.constraints.forbidden_zones.join(', ') || '-']
          ]} />
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_geometry')}>
          <KeyValueGrid rows={[
            ['workspace', `X ${workspace.x_min}..${workspace.x_max} / Z ${workspace.z_min}..${workspace.z_max}`],
            ['camera', profile.geometry.camera.position.join(', ')]
          ]} />
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_adapter_manifest')}>
          <KeyValueGrid rows={[
            ['adapter', 'SimulatorAdapter'],
            ['target id', selectedWorkspaceDevice?.config.adapter_target_id ?? meta.device_id]
          ]} />
        </InspectorGroup>
        <InspectorGroup title={ti(language, 'inspector_asset_license')}>
          <KeyValueGrid rows={[
            ['license', selectedAsset?.manifest.license ?? meta.model_asset?.license ?? '-'],
            ['source', selectedAsset?.manifest.source ?? meta.model_asset?.source ?? '-']
          ]} />
        </InspectorGroup>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <InlineMetric label={t.modelSource} value={isRealModel ? t.realSource : t.placeholderSource} />
        <InlineMetric label={language === 'zh' ? '\u8bbe\u5907\u6863\u6848' : 'Profile'} value={localProfileName(profile, language)} />
      </div>

      <div className="mt-2 border border-[#E5E5EA] bg-white p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{ti(language, 'inspector_runtime_state')}</div>
          <span className={`border px-1.5 py-0.5 text-[11px] font-bold ${selectedWorkspaceDevice?.last_run_result === 'blocked' ? 'border-[#FECDD3] bg-[#FFF1F2] text-status-blocked' : selectedWorkspaceDevice?.last_run_result === 'pass' ? 'border-[#A7F3D0] bg-[#ECFDF5] text-status-executed' : 'border-[#E5E5EA] bg-[#F5F5F7] text-[#86868B]'}`}>
            {selectedWorkspaceDevice?.last_run_result ? localResult(selectedWorkspaceDevice.last_run_result, language) : ti(language, 'not_run')}
          </span>
        </div>
        <div className="mt-2 grid gap-1 font-mono text-[11px]">
          {runtimeEntries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[150px_1fr] gap-2">
              <span className="break-all text-[#86868B]">{key}</span>
              <span className="truncate text-[#1D1D1F]">{localValue(value, language)}</span>
            </div>
          ))}
        </div>
      </div>

      {selectedAsset && (
        <div className="mt-2 grid gap-2 border border-[#E5E5EA] bg-white p-2.5 text-[11px] leading-5 text-[#1D1D1F]">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.assetInfo}</div>
          <div>{localizeDisplayName(language, selectedAsset.manifest.display_name)}</div>
          <div>{language === 'zh' ? '\u5206\u7c7b' : 'Category'}: {localizeCategory(language, selectedAsset.manifest.category)}</div>
          <div>{t.license}: {localizeMetadataValue(language, selectedAsset.manifest.license)}</div>
          <div>{language === 'zh' ? '\u54c1\u724c' : 'Brand'}: {localizeMetadataValue(language, selectedAsset.manifest.brand)}</div>
          <div>{t.simulatorFidelity}: {localizeFidelity(language, selectedAsset.manifest.simulator_fidelity ?? selectedAsset.deviceMeta.simulator_fidelity?.level ?? 'semantic')}</div>
          <div>{t.adapterManifest}: {selectedAsset.adapterManifest.adapter_id}</div>
          <div>{t.scenarios}: {localizeScenarioName(language, selectedAsset.scenarios.safe.id)}, {localizeScenarioName(language, selectedAsset.scenarios.unsafe.id)}</div>
        </div>
      )}

      <div className="mt-2 border border-[#E5E5EA] bg-white p-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.capabilities}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta.capabilities.map((capability) => (
            <span key={capability} className="border border-[#E5E5EA] bg-[#F5F5F7] px-2 py-1 text-[11px] font-semibold text-[#1D1D1F]">
              {localizeCapability(language, capability)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 grid gap-2 border border-[#E5E5EA] bg-white p-2.5 text-[11px] leading-5 text-[#1D1D1F]">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.constraints}</div>
        <div>{t.workspace}: X {workspace.x_min}..{workspace.x_max}, Y {workspace.y_min}..{workspace.y_max}, Z {workspace.z_min}..{workspace.z_max}</div>
        <div>{t.forbiddenZones}: {meta.constraints.forbidden_zones.map((zone) => localValue(zone, language)).join(', ') || '-'}</div>
        <div>
          {t.safetyPolicy}: {language === 'zh' ? '\u901f\u5ea6' : 'speed'}={localValue(meta.constraints.max_speed, language)}, {language === 'zh' ? '\u529b\u9650\u5236' : 'force'}={localValue(meta.constraints.force_limit, language)}
        </div>
      </div>

      <div className="mt-2 border border-[#E5E5EA] bg-white p-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.deploymentConfig}</div>
        {!selectedWorkspaceDevice ? (
          <div className="mt-2 text-[11px] leading-5 text-[#86868B]">{t.noWorkspaceDevice}</div>
        ) : (
          <div className="mt-2 grid gap-2">
            <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
              {t.deviceName}
              <input
                value={localizeDisplayName(language, selectedWorkspaceDevice.label)}
                onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { label: event.target.value })}
                className="h-7 border border-[#E5E5EA] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
              />
            </label>
            <div className="grid gap-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.layoutPosition}</div>
              <div className="text-[11px] leading-5 text-[#6B7280]">{t.layoutHint}</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
                  {t.posX}
                  <input
                    type="number"
                    step="0.1"
                    min={workspace.x_min}
                    max={workspace.x_max}
                    value={Number(currentPosition[0].toFixed(2))}
                    onChange={(event) => updateLayoutPosition(0, event.target.value)}
                    className="h-7 border border-[#E5E5EA] bg-white px-2 font-mono text-xs normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
                  />
                </label>
                <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
                  {t.posY}
                  <input
                    type="number"
                    step="0.1"
                    min={workspace.y_min}
                    max={workspace.y_max}
                    value={Number(currentPosition[1].toFixed(2))}
                    onChange={(event) => updateLayoutPosition(1, event.target.value)}
                    className="h-7 border border-[#E5E5EA] bg-white px-2 font-mono text-xs normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
                  />
                </label>
                <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
                  {t.posZ}
                  <input
                    type="number"
                    step="0.1"
                    min={workspace.z_min}
                    max={workspace.z_max}
                    value={Number(currentPosition[2].toFixed(2))}
                    onChange={(event) => updateLayoutPosition(2, event.target.value)}
                    className="h-7 border border-[#E5E5EA] bg-white px-2 font-mono text-xs normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
                  />
                </label>
              </div>
            </div>
            <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
              {t.adapterTargetId}
              <input
                value={selectedWorkspaceDevice.config.adapter_target_id}
                onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { config: { ...selectedWorkspaceDevice.config, adapter_target_id: event.target.value } })}
                className="h-7 border border-[#E5E5EA] bg-white px-2 font-mono text-xs normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
                {t.maxSpeed}
                <select
                  value={selectedWorkspaceDevice.config.max_speed}
                  onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { config: { ...selectedWorkspaceDevice.config, max_speed: event.target.value as 'slow' | 'normal' | 'fast' } })}
                  className="h-7 border border-[#E5E5EA] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
                >
                  <option value="slow">{localValue('slow', language)}</option>
                  <option value="normal">{localValue('normal', language)}</option>
                  <option value="fast">{localValue('fast', language)}</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
                {t.forceLimit}
                <select
                  value={selectedWorkspaceDevice.config.force_limit}
                  onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { config: { ...selectedWorkspaceDevice.config, force_limit: event.target.value as 'low' | 'medium' | 'high' } })}
                  className="h-7 border border-[#E5E5EA] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
                >
                  <option value="low">{localValue('low', language)}</option>
                  <option value="medium">{localValue('medium', language)}</option>
                  <option value="high">{localValue('high', language)}</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#86868B]">
              {t.forbiddenZones}
              <input
                value={selectedWorkspaceDevice.config.forbidden_zones.join(', ')}
                onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, {
                  config: {
                    ...selectedWorkspaceDevice.config,
                    forbidden_zones: event.target.value.split(',').map((zone) => zone.trim()).filter(Boolean)
                  }
                })}
                className="h-7 border border-[#E5E5EA] bg-white px-2 font-mono text-xs normal-case tracking-normal text-[#1D1D1F] outline-none focus:border-[#0066CC] focus:ring-1 focus:ring-[#0066CC]"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-[#1D1D1F]">
              <input
                type="checkbox"
                checked={selectedWorkspaceDevice.config.enabled}
                onChange={(event) => onWorkspaceDeviceChange(selectedWorkspaceDevice.id, { config: { ...selectedWorkspaceDevice.config, enabled: event.target.checked } })}
                className="h-3.5 w-3.5 accent-[#0066CC]"
              />
              {t.enabled}
            </label>
            <button
              type="button"
              onClick={() => onWorkspaceDeviceDuplicate(selectedWorkspaceDevice.id)}
              className="h-7 border border-[#BBD7F5] bg-[#EAF3FF] px-2 text-[11px] font-semibold text-[#0066CC] hover:bg-[#DDEEFF]"
            >
              {ti(language, 'duplicate_device')}
            </button>
            <button
              type="button"
              onClick={onSelectedAssetExport}
              className="h-7 border border-[#E5E5EA] bg-white px-2 text-[11px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
            >
              {ti(language, 'export_asset_config')}
            </button>
            <button
              type="button"
              onClick={() => onWorkspaceDeviceRemove(selectedWorkspaceDevice.id)}
              className="h-7 border border-[#FECDD3] bg-[#FFF1F2] px-2 text-[11px] font-semibold text-status-blocked hover:bg-[#FFE4E6]"
            >
              {ti(language, 'remove_device')}
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 border border-[#E5E5EA] bg-white p-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#86868B]">{t.workspaceValidation}</div>
        {!workspaceValidation ? (
          <div className="mt-2 text-[11px] leading-5 text-[#86868B]">{t.validationNotRun}</div>
        ) : (
          <div className="mt-2 grid gap-1.5 text-[11px] leading-5 text-[#1D1D1F]">
            <div className={workspaceValidation.result === 'pass' ? 'font-bold text-status-executed' : 'font-bold text-status-blocked'}>
              {localResult(workspaceValidation.result, language)} / {workspaceValidation.run_id}
            </div>
            {workspaceValidation.device_results.map((result) => (
              <div key={result.workspace_device_id} className="flex justify-between gap-2 border-t border-[#F3F4F6] pt-1.5">
                <span className="truncate">{result.label}</span>
                <span className={result.result === 'pass' ? 'font-bold text-status-executed' : 'font-bold text-status-blocked'}>{localResult(result.result, language)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function AuditPanel({
  view = 'all',
  language,
  selectedProfile,
  selectedWorkspaceDevice,
  selectedAsset,
  currentRunTargetLabel,
  isRunnable,
  workspaceDeviceCount,
  workspaceValidation,
  onWorkspaceDeviceChange,
  onWorkspaceDeviceRemove,
  onWorkspaceDeviceDuplicate,
  onSelectedAssetExport,
  labReport,
  safetyReport,
  selectedSnapshot,
  onSnapshotSelect,
  onExportLabReport
}: AuditPanelProps) {
  const t = text[language];
  const hasRun = Boolean(labReport);
  const blocked = safetyReport?.status === 'blocked';

  const inspector = (
    <DeviceInspector
      language={language}
      profile={selectedProfile}
      isRunnable={isRunnable}
      workspaceDeviceCount={workspaceDeviceCount}
      workspaceValidation={workspaceValidation}
      selectedWorkspaceDevice={selectedWorkspaceDevice}
      selectedAsset={selectedAsset}
      currentRunTargetLabel={currentRunTargetLabel}
      onWorkspaceDeviceChange={onWorkspaceDeviceChange}
      onWorkspaceDeviceRemove={onWorkspaceDeviceRemove}
      onWorkspaceDeviceDuplicate={onWorkspaceDeviceDuplicate}
      onSelectedAssetExport={onSelectedAssetExport}
    />
  );

  if (view === 'inspector') {
    return <aside className="custom-scrollbar h-full w-full overflow-y-auto bg-bg-panel">{inspector}</aside>;
  }

  return (
    <aside className="custom-scrollbar flex h-full w-full shrink-0 flex-col overflow-y-auto bg-bg-panel">
      {view === 'all' && inspector}

      <section className="border-b border-[#E5E5EA] bg-[#F5F5F7] p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">{t.safetyRuntime}</div>
            <div className="mt-1 text-base font-semibold text-[#1D1D1F]">{t.executionGate}</div>
          </div>
          <StatusPill status={safetyReport?.status === 'pass' ? 'pass' : safetyReport?.status === 'blocked' ? 'blocked' : safetyReport?.status === 'needs_confirmation' ? 'needs_confirmation' : 'idle'} language={language} />
        </div>

        <div className="mt-3">
          {(safetyReport?.checks ?? []).map((check) => (
            <div key={check.id} className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] bg-white px-2.5 py-2.5 last:border-b-0">
              <div>
                <div className="text-[11px] font-semibold text-[#1D1D1F]">{localCheckLabel(check.id, check.label, language)}</div>
                {check.reason && <div className="mt-1 text-[11px] leading-relaxed text-rose-600">{language === 'zh' ? t.block : check.reason}</div>}
              </div>
              <span className={check.status === 'pass' ? 'text-[11px] font-bold text-emerald-600' : check.status === 'warning' ? 'text-[11px] font-bold text-[#0066CC]' : 'text-[11px] font-bold text-rose-600'}>
                {t.status[check.status]}
              </span>
            </div>
          ))}
          {!safetyReport && <div className="border border-[#E5E5EA] bg-white px-3 py-3 text-xs text-[#86868B]">{t.runToEvaluate}</div>}
        </div>

        {blocked && (
          <div className="mt-3 border border-[#FECDD3] bg-[#FFF1F2] p-3 text-xs font-semibold leading-relaxed text-status-blocked">
            {t.blocked}: {language === 'zh' ? '\u5371\u9669\u547d\u4ee4\u5df2\u5728\u8bbe\u5907\u6267\u884c\u524d\u88ab\u5b89\u5168\u8fd0\u884c\u65f6\u62e6\u622a\u3002' : safetyReport.blocked_reasons.join(' ')}
          </div>
        )}
      </section>

      <AuditSection title={t.taskPlan} summary={`${labReport?.task_dsl.steps.length ?? 0} ${t.stepCount}`} defaultOpen>
        <TaskPlanView language={language} taskDsl={labReport?.task_dsl} />
      </AuditSection>

      <AuditSection title={t.deviceCommands} summary={`${labReport?.adapter_commands.length ?? 0} ${t.commandCount}`} defaultOpen>
        <AdapterCommandView language={language} commands={labReport?.adapter_commands ?? []} activeCommandId={selectedSnapshot?.command_id} />
      </AuditSection>

      <AuditSection title={t.actionPlans} summary={`${labReport?.action_plans.length ?? 0} ${t.actionPlans}`} forceOpen={hasRun}>
        <ActionPlanView language={language} report={labReport} activeCommandId={selectedSnapshot?.command_id} />
      </AuditSection>

      <AuditSection title={t.deviceState} summary={t.beforeAfter} forceOpen={hasRun}>
        <StateInspector language={language} before={labReport?.device_state_before ?? { status: 'idle' }} snapshot={selectedSnapshot} />
      </AuditSection>

      <AuditSection title={t.timeline} summary={`${labReport?.state_snapshots?.length ?? 0} ${t.snapshotCount}`} forceOpen={hasRun}>
        <ExecutionTimeline language={language} snapshots={labReport?.state_snapshots ?? []} actionPlans={labReport?.action_plans ?? []} selectedSnapshot={selectedSnapshot} onSelect={onSnapshotSelect} />
      </AuditSection>

      <AuditSection title={t.labReport} summary={labReport ? `${localResult(labReport.result, language)} - ${labReport.lab_run_id}` : t.fullAudit}>
        <button type="button" onClick={onExportLabReport} disabled={!labReport} className="mb-3 h-8 w-full border border-[#E5E5EA] bg-white px-3 text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
          {t.exportReport}
        </button>
        <DarkJsonBlock value={labReport ?? { status: 'idle' }} viewFullLabel={t.viewFull} />
      </AuditSection>
    </aside>
  );
}
