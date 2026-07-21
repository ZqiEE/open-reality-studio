import type { DeviceType } from '@/types/deviceMeta';

export type Locale = 'zh' | 'en';

const copy = {
  en: {
    app_project: 'Project',
    app_new: 'New',
    app_open: 'Open',
    app_import_asset: 'Import Asset',
    app_save_project: 'Save Project',
    app_save_as: 'Save As',
    app_restore: 'Restore',
    app_quick_start: 'Quick Start',
    app_run: 'Run',
    app_stop: 'Stop',
    app_export_report: 'Export Report',
    app_export_adapter_package: 'Export Adapter Package',
    status_idle: 'Idle',
    status_executed: 'Executed',
    status_playing_motion: 'Playing Motion',
    status_safety_blocked: 'Safety Blocked',
    command_waiting: 'Waiting for AI command.',
    command_running: 'Compiling AI command and running simulation.',
    command_stopped: 'Run stopped.',
    command_ready: 'Ready',
    command_completed: 'Completed',
    command_blocked: 'Blocked',
    command_ask_human: 'Ask Human',
    command_proposed: 'Proposed',
    command_coming_soon: 'Coming Soon',
    command_failed: 'Failed',
    coming_soon_runtime: 'is not runnable in this alpha. Only robot_arm, smart_light, and camera_sensor support simulation run right now.',
    coming_soon_scenario: 'scenarios are not implemented. This alpha only supports simulation run for robot_arm, smart_light, and camera_sensor.',
    prompt_placeholder: 'Describe the device task. Enter to run, Shift+Enter for newline, Ctrl+Enter to run.',
    replay: 'Replay',
    adapter_commands: 'Adapter Commands',
    state_diff: 'State Diff',
    logs: 'Logs',
    current_playback: 'Current Playback',
    pause: 'Pause',
    play: 'Play',
    step_prev: 'Step Prev',
    step_next: 'Step Next',
    reset: 'Reset',
    slow_mode: 'Slow Mode',
    command: 'Command',
    frame: 'Frame',
    time: 'Time',
    waiting_run: 'Waiting for run. Select a scenario and click Run.',
    no_commands_generated: 'No commands generated yet.',
    waiting_state_changes: 'Waiting for state changes.',
    ai_command: 'AI Command',
    command_example: 'Example',
    command_try_first: 'Try first',
    command_result_workspace_above: 'Result appears in the 3D workspace above.',
    command_observe_ready: 'After Run: watch the workspace for motion, the inspector for state, and the bottom console for logs.',
    command_observe_running: 'Now watch the workspace for motion, the inspector for live state, and the bottom console for logs.',
    command_observe_completed: 'Run completed. Check final placement in the workspace, state on the right, and logs below.',
    command_observe_blocked: 'Blocked before execution. Confirm the blocked reason in the workspace and right-side inspector.',
    command_target_notice: 'Run applies to the selected workspace device only.',
    command_safe_blocked_notice: 'Safe tasks execute in simulation. Unsafe tasks are blocked before execution.',
    running: 'Running',
    validate: 'Validate',
    developer_preview: 'Developer Preview',
    not_for_production: 'Not for production hardware',
    public_alpha_support: 'Public Alpha Support',
    supported_now: 'Supported Now',
    current_selection: 'Current Selection',
    active_workspace_device: 'Active Workspace Device',
    workspace_focus: 'Workspace Focus',
    current_workspace_device: 'Selected in Workspace',
    current_run_target: 'Current Run Target',
    workspace_devices: 'Workspace Devices',
    workspace_run_rule: 'Add devices into the workspace, then click one device here to make it the active run target.',
    workspace_run_rule_short: 'Selected device runs',
    workspace_selection_run_same: 'In this alpha, the selected workspace device is also the run target.',
    workspace_activate_device: 'Click a device to activate it',
    workspace_result_hint: 'Motion, target markers, blocked state, and final placement all appear in this workspace.',
    workspace_preview_hint: 'Blue markers show the planned path and target before you run.',
    workspace_drop_hint: 'Add devices into this workspace, then run to inspect motion, blocked state, and placement here.',
    workspace_drag_hint: 'Drag the selected device to design the layout before you run.',
    workspace_observe_here: 'Observe Here',
    workspace_layout_bounds: 'Layout Bounds',
    workspace_selected_layout: 'Selected Layout',
    workspace_drag_snap_precision: 'Workspace drag | snap 0.1m',
    workspace_dropzone_title: 'Drop Device Here',
    workspace_dropzone_subtitle: 'Place assets in the center, then drag to design layout.',
    workspace_dropzone_next: 'Suggested next placement',
    workspace_starter_slots: 'Starter layout guides only - devices can be dragged anywhere after placement.',
    workspace_legend_layout: 'Blue footprint = layout editing target',
    workspace_legend_run: 'Amber ring = current run target',
    selected_short: 'Selected',
    last_result: 'Last Result',
    simulation_only: 'Simulation-only',
    real_device_disabled: 'Real device execution disabled',
    starter_commands: 'Starter Commands',
    no_starter_commands: 'No runnable starter commands for this device in this alpha.',
    quick_start: 'Validation Paths',
    quick_start_try_now: 'Load Path',
    quick_start_recommended: 'Recommended First Run',
    quick_start_other_paths: 'Other Runnable Paths',
    quick_start_next_step: 'Next step: run this path.',
    quick_start_run_now: 'Run Now',
    quick_start_expected: 'Expected',
    quick_start_proof: 'Check',
    quick_start_validates: 'Validates',
    guided_evaluation: 'Guided Evaluation',
    current_path: 'Current Path',
    next_path: 'Next Path',
    try_next: 'Try Next',
    welcome_title: 'The gate between AI and real actuators',
    welcome_body: 'Every action is gated, refusable, and receipted. RealityWarden decides whether an AI intent may act, refuses with evidence when it may not, and exports a tamper-evident audit receipt either way.',
    welcome_step_1: 'State an intent — natural language or a saved action.',
    welcome_step_2: 'The safety gate validates capability, bounds, and fresh evidence.',
    welcome_step_3: 'Get the outcome — executed or refused — and export the receipt.',
    first_run_step_supported: 'Runnable now: Robot Arm, Smart Light, Camera Sensor.',
    first_run_step_command: 'Type the task in AI Command below the workspace.',
    first_run_step_target: 'The selected workspace device is the current run target.',
    first_run_step_safe: 'Safe tasks execute. Unsafe tasks are blocked before motion.',
    first_run_step_sim_only: 'This Public Alpha is simulation-only. Real device execution is disabled.',
    welcome_supported_now: 'Runnable now',
    welcome_protocol_only: 'Other built-in device families are inspectable protocol assets only in this alpha.',
    asset_only_runtime_title: 'This device family is asset-only in this alpha.',
    asset_only_runtime_detail: 'You can inspect it and place it in the workspace, but AI Run is only enabled for Robot Arm, Smart Light, and Camera Sensor.',
    jump_to_runnable_path: 'Jump to a runnable path',
    select_runnable_target_hint: 'To run a task, switch to Robot Arm, Smart Light, or Camera Sensor.',
    dismiss: 'Dismiss',
    support_supported: 'Supported',
    support_coming_soon: 'Coming Soon',
    support_note: 'Only robot_arm, smart_light, and camera_sensor are runnable in this alpha.',
    devices: 'Devices',
    language: 'Language',
    chinese: 'Chinese',
    english: 'English',
    device_type: 'Device Type',
    device_profile: 'Device Profile',
    scenario: 'Validation Scenario',
    scenario_not_implemented: 'Scenario not implemented',
    asset_library: 'Industrial Device Library',
    asset_library_note: 'Add or drag a device into the workspace first. Only Robot Arm, Smart Light, and Camera Sensor support Run in this alpha.',
    search_assets: 'Search assets...',
    no_assets_found: 'No assets found',
    sim: 'SIM',
    risk: 'RISK',
    license: 'LICENSE',
    add: 'Add',
    add_to_workspace: 'Add to Workspace',
    drag_to_workspace: 'Drag to Workspace',
    workspace_authoring_hint: 'Drag more devices from the left library into this workspace, then run to compare layout and behavior here.',
    asset_runtime_supported: 'Runnable Now',
    asset_runtime_asset_only: 'Asset Only',
    device: 'Device',
    model: 'Model',
    asset: 'Asset',
    run_status: 'Run Status',
    adapter: 'Adapter',
    fidelity: 'Fidelity',
    simulator_adapter_short: 'Sim',
    perspective_grid_snap: '[ Perspective | Grid: 0.1m | Snap: ON ]',
    action_plan_preview: 'Action Plan Preview',
    blocked_by_safety_runtime: 'Blocked by Safety Runtime',
    safety_runtime_blocked_caps: '[ SAFETY RUNTIME BLOCKED ]',
    snapshot: 'Snapshot',
    inspector_overview: 'Overview',
    inspector_runtime_state: 'Runtime State',
    inspector_capabilities: 'Capabilities',
    inspector_safety_rules: 'Safety Rules',
    inspector_geometry: 'Geometry',
    inspector_adapter_manifest: 'Adapter Manifest',
    inspector_asset_license: 'Asset License',
    runnable: 'Runnable',
    not_runnable: 'Coming Soon',
    not_run: 'Not run',
    duplicate_device: 'Duplicate Device',
    export_asset_config: 'Export Asset Config',
    remove_device: 'Remove Device'
  },
  zh: {
    app_project: '\u9879\u76ee',
    app_new: '\u65b0\u5efa',
    app_open: '\u6253\u5f00',
    app_import_asset: '\u5bfc\u5165\u8d44\u4ea7',
    app_save_project: '\u4fdd\u5b58\u5de5\u7a0b',
    app_save_as: '\u53e6\u5b58\u4e3a',
    app_restore: '\u6062\u590d',
    app_quick_start: '\u5feb\u901f\u4e0a\u624b',
    app_run: '\u8fd0\u884c',
    app_stop: '\u505c\u6b62',
    app_export_report: '\u5bfc\u51fa\u62a5\u544a',
    app_export_adapter_package: '\u5bfc\u51fa\u9002\u914d\u5668\u914d\u7f6e\u5305',
    status_idle: '\u5f85\u8fd0\u884c',
    status_executed: '\u5df2\u6267\u884c',
    status_playing_motion: '\u52a8\u4f5c\u64ad\u653e\u4e2d',
    status_safety_blocked: '\u5b89\u5168\u62e6\u622a',
    command_waiting: '\u7b49\u5f85 AI \u6307\u4ee4\u3002',
    command_running: '\u6b63\u5728\u7f16\u8bd1 AI \u6307\u4ee4\u5e76\u6267\u884c\u4eff\u771f\u3002',
    command_stopped: '\u6267\u884c\u5df2\u505c\u6b62\u3002',
    command_ready: '\u5f85\u8fd0\u884c',
    command_completed: '\u5df2\u5b8c\u6210',
    command_blocked: '\u5df2\u62e6\u622a',
    command_ask_human: '\u9700\u8981\u786e\u8ba4',
    command_proposed: '\u8ba1\u5212\u5f85\u786e\u8ba4',
    command_coming_soon: '\u6682\u672a\u5b9e\u73b0',
    command_failed: '\u5931\u8d25',
    coming_soon_runtime: '\u6682\u672a\u63a5\u5165\u5f53\u524d\u516c\u6d4b\u7248\u8fd0\u884c\u94fe\u8def\u3002\u5f53\u524d\u4ec5\u652f\u6301 robot_arm\u3001smart_light\u3001camera_sensor \u7684 simulation run\u3002',
    coming_soon_scenario: '\u573a\u666f\u672a\u5b9e\u73b0\u3002\u5f53\u524d\u516c\u6d4b\u7248\u4ec5\u652f\u6301 robot_arm\u3001smart_light\u3001camera_sensor \u7684 simulation run\u3002',
    prompt_placeholder: '\u8f93\u5165\u8981\u8ba9\u8bbe\u5907\u5b8c\u6210\u7684\u4efb\u52a1\u3002Enter \u8fd0\u884c\uff0cShift+Enter \u6362\u884c\uff0cCtrl+Enter \u8fd0\u884c\u3002',
    replay: '\u56de\u653e',
    adapter_commands: '\u9002\u914d\u5668\u547d\u4ee4',
    state_diff: '\u72b6\u6001\u5dee\u5f02',
    logs: '\u65e5\u5fd7',
    current_playback: '\u5f53\u524d\u56de\u653e',
    pause: '\u6682\u505c',
    play: '\u64ad\u653e',
    step_prev: '\u4e0a\u4e00\u6b65',
    step_next: '\u4e0b\u4e00\u6b65',
    reset: '\u91cd\u7f6e',
    slow_mode: '\u6162\u901f\u6a21\u5f0f',
    command: '\u547d\u4ee4',
    frame: '\u5e27',
    time: '\u65f6\u95f4',
    waiting_run: '\u7b49\u5f85\u8fd0\u884c\u3002\u9009\u62e9\u573a\u666f\u540e\u70b9\u51fb\u8fd0\u884c\u3002',
    no_commands_generated: '\u5c1a\u672a\u751f\u6210\u547d\u4ee4\u3002',
    waiting_state_changes: '\u7b49\u5f85\u8bbe\u5907\u72b6\u6001\u53d8\u5316\u3002',
    ai_command: 'AI \u6307\u4ee4',
    command_example: '\u793a\u4f8b',
    command_try_first: '\u5148\u8bd5\u8fd9\u53e5',
    command_result_workspace_above: '\u8fd0\u884c\u7ed3\u679c\u4f1a\u76f4\u63a5\u51fa\u73b0\u5728\u4e0a\u65b9 3D \u5de5\u4f5c\u533a\u3002',
    command_observe_ready: '\u8fd0\u884c\u540e\uff1a\u5148\u770b\u4e0a\u65b9\u5de5\u4f5c\u533a\u7684\u52a8\u4f5c\uff0c\u518d\u770b\u53f3\u4fa7\u72b6\u6001\uff0c\u6700\u540e\u770b\u5e95\u90e8\u65e5\u5fd7\u3002',
    command_observe_running: '\u6b63\u5728\u6267\u884c\uff1a\u8bf7\u76f4\u63a5\u89c2\u5bdf\u4e0a\u65b9\u5de5\u4f5c\u533a\u52a8\u4f5c\u3001\u53f3\u4fa7\u8fd0\u884c\u72b6\u6001\u548c\u5e95\u90e8\u65e5\u5fd7\u3002',
    command_observe_completed: '\u6267\u884c\u5b8c\u6210\u3002\u8bf7\u68c0\u67e5\u5de5\u4f5c\u533a\u91cc\u7684\u6700\u7ec8\u7ed3\u679c\uff0c\u53f3\u4fa7\u72b6\u6001\uff0c\u4ee5\u53ca\u5e95\u90e8\u65e5\u5fd7\u3002',
    command_observe_blocked: '\u5df2\u5728\u6267\u884c\u524d\u88ab\u62e6\u622a\u3002\u8bf7\u5728\u5de5\u4f5c\u533a\u548c\u53f3\u4fa7\u68c0\u67e5\u62e6\u622a\u539f\u56e0\u3002',
    command_target_notice: '\u8fd0\u884c\u53ea\u4f1a\u4f5c\u7528\u4e8e\u5de5\u4f5c\u533a\u5f53\u524d\u9009\u4e2d\u7684\u8bbe\u5907\u3002',
    command_safe_blocked_notice: '\u5b89\u5168\u4efb\u52a1\u4f1a\u5728\u4eff\u771f\u4e2d\u6267\u884c\uff0c\u4e0d\u5b89\u5168\u6307\u4ee4\u4f1a\u5728\u6267\u884c\u524d\u88ab\u62e6\u622a\u3002',
    running: '\u8fd0\u884c\u4e2d',
    validate: '\u9a8c\u8bc1',
    developer_preview: '\u5f00\u53d1\u8005\u9884\u89c8',
    not_for_production: '\u4e0d\u7528\u4e8e\u751f\u4ea7\u786c\u4ef6',
    public_alpha_support: 'Public Alpha \u652f\u6301',
    supported_now: '\u5f53\u524d\u652f\u6301',
    current_selection: '\u5f53\u524d\u9009\u62e9',
    active_workspace_device: '\u5f53\u524d\u6fc0\u6d3b\u5de5\u4f5c\u533a\u8bbe\u5907',
    workspace_focus: '\u5de5\u4f5c\u533a\u7126\u70b9',
    current_workspace_device: '\u5de5\u4f5c\u533a\u5f53\u524d\u9009\u4e2d',
    current_run_target: '\u5f53\u524d\u8fd0\u884c\u76ee\u6807',
    workspace_devices: '\u5de5\u4f5c\u533a\u8bbe\u5907',
    workspace_run_rule: '\u5148\u628a\u8bbe\u5907\u653e\u5165\u5de5\u4f5c\u533a\uff0c\u7136\u540e\u5728\u8fd9\u91cc\u70b9\u9009\u4e00\u53f0\uff0c\u88ab\u9009\u4e2d\u7684\u90a3\u53f0\u624d\u662f\u5f53\u524d\u8fd0\u884c\u76ee\u6807\u3002',
    workspace_run_rule_short: '\u9009\u4e2d\u8bbe\u5907\u5373\u8fd0\u884c\u76ee\u6807',
    workspace_selection_run_same: '\u5f53\u524d\u516c\u6d4b\u7248\u4e2d\uff0c\u5de5\u4f5c\u533a\u91cc\u88ab\u9009\u4e2d\u7684\u8bbe\u5907\uff0c\u5c31\u662f\u5f53\u524d\u8fd0\u884c\u76ee\u6807\u3002',
    workspace_activate_device: '\u70b9\u51fb\u8bbe\u5907\u5373\u53ef\u5c06\u5176\u8bbe\u4e3a\u5f53\u524d\u6fc0\u6d3b\u8bbe\u5907',
    workspace_result_hint: '\u52a8\u4f5c\u3001\u76ee\u6807\u6807\u8bb0\u3001\u62e6\u622a\u72b6\u6001\u3001\u6700\u7ec8\u653e\u7f6e\u7ed3\u679c\u90fd\u5728\u8fd9\u4e2a\u5de5\u4f5c\u533a\u91cc\u89c2\u5bdf\u3002',
    workspace_preview_hint: '\u8fd0\u884c\u524d\u770b\u5230\u7684\u84dd\u8272\u6807\u8bb0\uff0c\u5c31\u662f\u9884\u8ba1\u8def\u5f84\u548c\u76ee\u6807\u533a\u57df\u3002',
    workspace_drop_hint: '\u628a\u8bbe\u5907\u6dfb\u52a0\u5230\u8fd9\u4e2a\u5de5\u4f5c\u533a\uff0c\u7136\u540e\u5c31\u5728\u8fd9\u91cc\u76f4\u63a5\u89c2\u5bdf\u52a8\u4f5c\u3001\u62e6\u622a\u72b6\u6001\u548c\u653e\u7f6e\u7ed3\u679c\u3002',
    workspace_drag_hint: '\u8fd0\u884c\u524d\u53ef\u4ee5\u76f4\u63a5\u62d6\u52a8\u5f53\u524d\u9009\u4e2d\u8bbe\u5907\uff0c\u5148\u628a\u5de5\u4f5c\u533a\u5e03\u5c40\u6446\u597d\u3002',
    workspace_observe_here: '\u5728\u6b64\u89c2\u5bdf\u7ed3\u679c',
    workspace_layout_bounds: '\u5e03\u5c40\u8fb9\u754c',
    workspace_selected_layout: '\u5f53\u524d\u5e03\u5c40',
    workspace_drag_snap_precision: '\u5de5\u4f5c\u533a\u62d6\u62fd | 0.1m \u5438\u9644',
    workspace_dropzone_title: '\u5c06\u8bbe\u5907\u62d6\u5230\u8fd9\u91cc',
    workspace_dropzone_subtitle: '\u5148\u653e\u5230\u4e2d\u5fc3\u533a\uff0c\u518d\u62d6\u52a8\u8bbe\u8ba1\u5de5\u4f5c\u533a\u5e03\u5c40\u3002',
    workspace_dropzone_next: '\u5efa\u8bae\u4e0b\u4e00\u4e2a\u653e\u7f6e\u70b9',
    workspace_starter_slots: '\u8fd9\u4e9b\u53ea\u662f\u8d77\u59cb\u5e03\u5c40\u53c2\u8003\u70b9\uff0c\u653e\u5165\u540e\u4ecd\u7136\u53ef\u4ee5\u81ea\u7531\u62d6\u52a8\u3002',
    workspace_legend_layout: '\u84dd\u8272\u8f6e\u5ed3 = \u5f53\u524d\u5e03\u5c40\u7f16\u8f91\u76ee\u6807',
    workspace_legend_run: '\u6a59\u8272\u5706\u73af = \u5f53\u524d\u8fd0\u884c\u76ee\u6807',
    selected_short: '\u5df2\u9009\u4e2d',
    last_result: '\u4e0a\u6b21\u7ed3\u679c',
    simulation_only: '\u4ec5\u9650\u4eff\u771f',
    real_device_disabled: '\u771f\u5b9e\u8bbe\u5907\u6267\u884c\u672a\u5f00\u542f',
    starter_commands: '\u793a\u4f8b\u6307\u4ee4',
    no_starter_commands: '\u8be5\u8bbe\u5907\u5728\u5f53\u524d\u516c\u6d4b\u7248\u6682\u65e0\u53ef\u8fd0\u884c\u793a\u4f8b\u6307\u4ee4\u3002',
    quick_start: '\u9a8c\u8bc1\u8def\u5f84',
    quick_start_try_now: '\u8f7d\u5165\u8def\u5f84',
    quick_start_recommended: '\u63a8\u8350\u4ece\u8fd9\u6761\u5f00\u59cb',
    quick_start_other_paths: '\u5176\u4ed6\u53ef\u8fd0\u884c\u8def\u5f84',
    quick_start_next_step: '\u4e0b\u4e00\u6b65\uff1a\u76f4\u63a5\u8fd0\u884c\u8fd9\u6761\u8def\u5f84\u3002',
    quick_start_run_now: '\u7acb\u5373\u8fd0\u884c',
    quick_start_expected: '\u9884\u671f\u7ed3\u679c',
    quick_start_proof: '\u67e5\u770b',
    quick_start_validates: '\u9a8c\u8bc1',
    guided_evaluation: '\u8bc4\u4f30\u8def\u5f84',
    current_path: '\u5f53\u524d\u8def\u5f84',
    next_path: '\u4e0b\u4e00\u6761\u8def\u5f84',
    try_next: '\u7ee7\u7eed\u4e0b\u4e00\u6761',
    welcome_title: 'AI \u4e0e\u771f\u5b9e\u6267\u884c\u5668\u4e4b\u95f4\u7684\u5b89\u5168\u95e8',
    welcome_body: '\u6bcf\u4e2a\u52a8\u4f5c\u90fd\u8fc7\u95e8\u3001\u53ef\u62d2\u7edd\u3001\u6709\u56de\u6267\u3002RealityWarden \u5224\u5b9a AI \u610f\u56fe\u662f\u5426\u5141\u8bb8\u6267\u884c\uff0c\u4e0d\u5141\u8bb8\u65f6\u7ed9\u51fa\u8bc1\u636e\u5f0f\u62d2\u7edd\uff0c\u65e0\u8bba\u54ea\u79cd\u7ed3\u679c\u90fd\u53ef\u5bfc\u51fa\u9632\u7be1\u6539\u5ba1\u8ba1\u56de\u6267\u3002',
    welcome_step_1: '\u63d0\u51fa\u610f\u56fe\u2014\u2014\u81ea\u7136\u8bed\u8a00\u6216\u5df2\u4fdd\u5b58\u7684\u52a8\u4f5c\u3002',
    welcome_step_2: '\u5b89\u5168\u95e8\u6821\u9a8c\u80fd\u529b\u3001\u8fb9\u754c\u4e0e\u65b0\u9c9c\u4f20\u611f\u5668\u8bc1\u636e\u3002',
    welcome_step_3: '\u5f97\u5230\u7ed3\u679c\u2014\u2014\u6267\u884c\u6216\u62d2\u7edd\u2014\u2014\u5e76\u5bfc\u51fa\u56de\u6267\u3002',
    first_run_step_supported: '\u5f53\u524d\u53ef\u8fd0\u884c\uff1a\u673a\u68b0\u81c2\u3001\u667a\u80fd\u706f\u3001\u6444\u50cf\u5934\u3002',
    first_run_step_command: '\u5728\u5de5\u4f5c\u533a\u4e0b\u65b9\u7684 AI \u6307\u4ee4\u533a\u8f93\u5165\u4efb\u52a1\u3002',
    first_run_step_target: '\u5de5\u4f5c\u533a\u91cc\u5f53\u524d\u9009\u4e2d\u7684\u8bbe\u5907\uff0c\u5c31\u662f\u5f53\u524d\u8fd0\u884c\u76ee\u6807\u3002',
    first_run_step_safe: '\u5b89\u5168\u4efb\u52a1\u4f1a\u6267\u884c\uff0c\u4e0d\u5b89\u5168\u6307\u4ee4\u4f1a\u5728\u52a8\u4f5c\u524d\u88ab\u62e6\u622a\u3002',
    first_run_step_sim_only: '\u5f53\u524d Public Alpha \u4ec5\u9650\u4eff\u771f\uff0c\u4e0d\u4f1a\u63a7\u5236\u771f\u5b9e\u8bbe\u5907\u3002',
    welcome_supported_now: '\u5f53\u524d\u53ef\u8fd0\u884c',
    welcome_protocol_only: '\u5176\u4ed6\u5185\u7f6e\u8bbe\u5907\u5bb6\u65cf\u5728\u5f53\u524d\u516c\u6d4b\u7248\u4e2d\u4ec5\u4f5c\u4e3a\u53ef\u67e5\u770b\u7684\u534f\u8bae\u8d44\u4ea7\u5b58\u5728\uff0c\u4e0d\u80fd\u76f4\u63a5\u8fd0\u884c\u3002',
    asset_only_runtime_title: '\u8be5\u8bbe\u5907\u5bb6\u65cf\u5728\u5f53\u524d\u516c\u6d4b\u7248\u4e2d\u4ec5\u4f5c\u4e3a\u8d44\u4ea7\u5c55\u793a\u3002',
    asset_only_runtime_detail: '\u4f60\u53ef\u4ee5\u67e5\u770b\u5b83\u3001\u628a\u5b83\u653e\u5165\u5de5\u4f5c\u533a\uff0c\u4f46 AI \u8fd0\u884c\u5f53\u524d\u53ea\u5bf9\u673a\u68b0\u81c2\u3001\u667a\u80fd\u706f\u548c\u6444\u50cf\u5934\u5f00\u653e\u3002',
    jump_to_runnable_path: '\u5207\u6362\u5230\u53ef\u8fd0\u884c\u8def\u5f84',
    select_runnable_target_hint: '\u82e5\u8981\u8fd0\u884c\u4efb\u52a1\uff0c\u8bf7\u5207\u6362\u5230\u673a\u68b0\u81c2\u3001\u667a\u80fd\u706f\u6216\u6444\u50cf\u5934\u4f20\u611f\u5668\u3002',
    dismiss: '\u5173\u95ed',
    support_supported: '\u5df2\u652f\u6301',
    support_coming_soon: '\u6682\u672a\u5b9e\u73b0',
    support_note: '\u5f53\u524d\u516c\u6d4b\u7248\u4ec5\u652f\u6301 robot_arm\u3001smart_light\u3001camera_sensor \u7684\u8fd0\u884c\u8def\u5f84\u3002',
    devices: '\u8bbe\u5907',
    language: '\u8bed\u8a00',
    chinese: '\u4e2d\u6587',
    english: 'English',
    device_type: '\u8bbe\u5907\u7c7b\u578b',
    device_profile: '\u8bbe\u5907\u6863\u6848',
    scenario: '\u9a8c\u8bc1\u573a\u666f',
    scenario_not_implemented: '\u573a\u666f\u672a\u5b9e\u73b0',
    asset_library: '\u5de5\u4e1a\u8bbe\u5907\u5e93',
    asset_library_note: '\u5148\u5c06\u8bbe\u5907\u6dfb\u52a0\u6216\u62d6\u5165\u5de5\u4f5c\u533a\uff0c\u518d\u8fd0\u884c\u67e5\u770b\u6548\u679c\u3002\u5f53\u524d\u516c\u6d4b\u7248\u53ea\u652f\u6301\u673a\u68b0\u81c2\u3001\u667a\u80fd\u706f\u548c\u6444\u50cf\u5934\u7684\u8fd0\u884c\u8def\u5f84\u3002',
    search_assets: '\u641c\u7d22\u8d44\u4ea7...',
    no_assets_found: '\u672a\u627e\u5230\u8d44\u4ea7',
    sim: '\u4eff\u771f',
    risk: '\u98ce\u9669',
    license: '\u8bb8\u53ef',
    add: '\u6dfb\u52a0',
    add_to_workspace: '\u6dfb\u52a0\u5230\u5de5\u4f5c\u533a',
    drag_to_workspace: '\u62d6\u5165\u5de5\u4f5c\u533a',
    workspace_authoring_hint: '\u53ef\u4ee5\u7ee7\u7eed\u4ece\u5de6\u4fa7\u8bbe\u5907\u5e93\u62d6\u5165\u66f4\u591a\u8bbe\u5907\uff0c\u5728\u8fd9\u91cc\u5e03\u5c40\u5e76\u76f4\u63a5\u89c2\u5bdf\u8fd0\u884c\u6548\u679c\u3002',
    asset_runtime_supported: '\u53ef\u8fd0\u884c',
    asset_runtime_asset_only: '\u4ec5\u8d44\u4ea7',
    device: '\u8bbe\u5907',
    model: '\u578b\u53f7',
    asset: '\u8d44\u4ea7',
    run_status: '\u8fd0\u884c\u72b6\u6001',
    adapter: '\u9002\u914d\u5668',
    fidelity: '\u4eff\u771f\u7ea7\u522b',
    simulator_adapter_short: '\u4eff\u771f',
    perspective_grid_snap: '[ \u900f\u89c6 | \u7f51\u683c: 0.1m | \u5438\u9644: \u5f00 ]',
    action_plan_preview: '\u52a8\u4f5c\u8ba1\u5212\u9884\u89c8',
    blocked_by_safety_runtime: '\u5df2\u88ab\u5b89\u5168\u8fd0\u884c\u65f6\u62e6\u622a',
    safety_runtime_blocked_caps: '[ \u5b89\u5168\u8fd0\u884c\u65f6\u5df2\u62e6\u622a ]',
    snapshot: '\u5feb\u7167',
    inspector_overview: '\u6982\u89c8',
    inspector_runtime_state: '\u8fd0\u884c\u72b6\u6001',
    inspector_capabilities: '\u80fd\u529b',
    inspector_safety_rules: '\u5b89\u5168\u89c4\u5219',
    inspector_geometry: '\u51e0\u4f55\u4fe1\u606f',
    inspector_adapter_manifest: '\u9002\u914d\u5668\u6e05\u5355',
    inspector_asset_license: '\u8d44\u4ea7\u8bb8\u53ef',
    runnable: '\u53ef\u8fd0\u884c',
    not_runnable: '\u6682\u672a\u5b9e\u73b0',
    not_run: '\u672a\u8fd0\u884c',
    duplicate_device: '\u590d\u5236\u8bbe\u5907',
    export_asset_config: '\u5bfc\u51fa\u8d44\u4ea7\u914d\u7f6e',
    remove_device: '\u79fb\u9664\u8bbe\u5907'
  }
} as const;

type CopyKey = keyof typeof copy.en;

const deviceTypeMap: Record<DeviceType, { zh: string; en: string }> = {
  robot_arm: { zh: '\u673a\u68b0\u81c2', en: 'Robot Arm' },
  mobile_robot: { zh: '\u79fb\u52a8\u673a\u5668\u4eba', en: 'Mobile Robot' },
  smart_light: { zh: '\u667a\u80fd\u706f', en: 'Smart Light' },
  camera_sensor: { zh: '\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Camera Sensor' },
  conveyor_belt: { zh: '\u4f20\u9001\u5e26', en: 'Conveyor Belt' },
  plc_cabinet: { zh: 'PLC \u63a7\u5236\u67dc', en: 'PLC Cabinet' },
  lab_instrument: { zh: '\u5b9e\u9a8c\u4eea\u5668', en: 'Lab Instrument' },
  warehouse_rack: { zh: '\u4ed3\u50a8\u8d27\u67b6', en: 'Warehouse Rack' },
  sensor_box: { zh: '\u4f20\u611f\u5668\u76d2', en: 'Sensor Box' }
};

const statusMap: Record<string, { zh: string; en: string }> = {
  idle: { zh: '\u5f85\u673a', en: 'IDLE' },
  pass: { zh: '\u901a\u8fc7', en: 'PASS' },
  blocked: { zh: '\u5df2\u62e6\u622a', en: 'BLOCKED' },
  needs_confirmation: { zh: '\u9700\u786e\u8ba4', en: 'REVIEW' },
  executing: { zh: '\u6267\u884c\u4e2d', en: 'RUNNING' },
  completed: { zh: '\u5b8c\u6210', en: 'DONE' },
  failed: { zh: '\u5931\u8d25', en: 'FAILED' },
  running: { zh: '\u8fd0\u884c\u4e2d', en: 'RUNNING' },
  captured: { zh: '\u5df2\u91c7\u96c6', en: 'CAPTURED' },
  sampled: { zh: '\u5df2\u8bfb\u53d6', en: 'SAMPLED' },
  on: { zh: '\u5f00\u542f', en: 'ON' },
  off: { zh: '\u5173\u95ed', en: 'OFF' }
};

const displayNameMap: Record<string, { zh: string; en: string }> = {
  'Generic Industrial Robot Arm': { zh: '\u901a\u7528\u5de5\u4e1a\u673a\u68b0\u81c2', en: 'Generic Industrial Robot Arm' },
  '\u901a\u7528\u5de5\u4e1a\u673a\u68b0\u81c2': { zh: '\u901a\u7528\u5de5\u4e1a\u673a\u68b0\u81c2', en: 'Generic Industrial Robot Arm' },
  'Generic Smart Light Panel': { zh: '\u901a\u7528\u667a\u80fd\u706f', en: 'Generic Smart Light Panel' },
  '\u901a\u7528\u667a\u80fd\u706f': { zh: '\u901a\u7528\u667a\u80fd\u706f', en: 'Generic Smart Light Panel' },
  'Generic PTZ Camera': { zh: '\u901a\u7528\u4e91\u53f0\u6444\u50cf\u5934', en: 'Generic PTZ Camera' },
  '\u901a\u7528\u4e91\u53f0\u6444\u50cf\u5934': { zh: '\u901a\u7528\u4e91\u53f0\u6444\u50cf\u5934', en: 'Generic PTZ Camera' },
  'Generic AGV Mobile Robot': { zh: '\u901a\u7528 AGV \u79fb\u52a8\u673a\u5668\u4eba', en: 'Generic AGV Mobile Robot' },
  '\u901a\u7528 AGV \u79fb\u52a8\u673a\u5668\u4eba': { zh: '\u901a\u7528 AGV \u79fb\u52a8\u673a\u5668\u4eba', en: 'Generic AGV Mobile Robot' },
  'Generic Conveyor Belt': { zh: '\u901a\u7528\u4f20\u9001\u5e26', en: 'Generic Conveyor Belt' },
  '\u901a\u7528\u4f20\u9001\u5e26': { zh: '\u901a\u7528\u4f20\u9001\u5e26', en: 'Generic Conveyor Belt' },
  'Generic PLC Cabinet': { zh: '\u901a\u7528 PLC \u63a7\u5236\u67dc', en: 'Generic PLC Cabinet' },
  '\u901a\u7528 PLC \u63a7\u5236\u67dc': { zh: '\u901a\u7528 PLC \u63a7\u5236\u67dc', en: 'Generic PLC Cabinet' },
  'Generic Lab Instrument': { zh: '\u901a\u7528\u5b9e\u9a8c\u4eea\u5668', en: 'Generic Lab Instrument' },
  '\u901a\u7528\u5b9e\u9a8c\u4eea\u5668': { zh: '\u901a\u7528\u5b9e\u9a8c\u4eea\u5668', en: 'Generic Lab Instrument' },
  'Generic Warehouse Rack': { zh: '\u901a\u7528\u4ed3\u50a8\u8d27\u67b6', en: 'Generic Warehouse Rack' },
  '\u901a\u7528\u4ed3\u50a8\u8d27\u67b6': { zh: '\u901a\u7528\u4ed3\u50a8\u8d27\u67b6', en: 'Generic Warehouse Rack' },
  'Generic Sensor Box': { zh: '\u901a\u7528\u4f20\u611f\u5668\u76d2', en: 'Generic Sensor Box' },
  '\u901a\u7528\u4f20\u611f\u5668\u76d2': { zh: '\u901a\u7528\u4f20\u611f\u5668\u76d2', en: 'Generic Sensor Box' },
  'Camera Sensor': { zh: '\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Camera Sensor' },
  '\u6444\u50cf\u5934\u4f20\u611f\u5668': { zh: '\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Camera Sensor' },
  'Virtual Robot Arm': { zh: '\u865a\u62df\u673a\u68b0\u81c2', en: 'Virtual Robot Arm' },
  '\u865a\u62df\u673a\u68b0\u81c2': { zh: '\u865a\u62df\u673a\u68b0\u81c2', en: 'Virtual Robot Arm' },
  'Virtual Smart Light': { zh: '\u865a\u62df\u667a\u80fd\u706f', en: 'Virtual Smart Light' },
  '\u865a\u62df\u667a\u80fd\u706f': { zh: '\u865a\u62df\u667a\u80fd\u706f', en: 'Virtual Smart Light' },
  'Virtual Camera Sensor': { zh: '\u865a\u62df\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Virtual Camera Sensor' },
  '\u865a\u62df\u6444\u50cf\u5934\u4f20\u611f\u5668': { zh: '\u865a\u62df\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Virtual Camera Sensor' },
  'Robot Arm Safe Pick and Place': { zh: '\u673a\u68b0\u81c2\u5b89\u5168\u6293\u53d6\u653e\u7f6e', en: 'Robot Arm Safe Pick and Place' },
  '\u673a\u68b0\u81c2\u5b89\u5168\u6293\u53d6\u653e\u7f6e': { zh: '\u673a\u68b0\u81c2\u5b89\u5168\u6293\u53d6\u653e\u7f6e', en: 'Robot Arm Safe Pick and Place' },
  'Robot Arm Unsafe Throw Block': { zh: '\u673a\u68b0\u81c2\u5371\u9669\u629b\u63b7\u62e6\u622a', en: 'Robot Arm Unsafe Throw Block' },
  '\u673a\u68b0\u81c2\u5371\u9669\u629b\u63b7\u62e6\u622a': { zh: '\u673a\u68b0\u81c2\u5371\u9669\u629b\u63b7\u62e6\u622a', en: 'Robot Arm Unsafe Throw Block' },
  'Smart Light Control': { zh: '\u667a\u80fd\u706f\u63a7\u5236', en: 'Smart Light Control' },
  '\u667a\u80fd\u706f\u63a7\u5236': { zh: '\u667a\u80fd\u706f\u63a7\u5236', en: 'Smart Light Control' },
  'Smart Light Unsafe Operation Block': { zh: '\u667a\u80fd\u706f\u9ad8\u98ce\u9669\u64cd\u4f5c\u62e6\u622a', en: 'Smart Light Unsafe Operation Block' },
  '\u667a\u80fd\u706f\u9ad8\u98ce\u9669\u64cd\u4f5c\u62e6\u622a': { zh: '\u667a\u80fd\u706f\u9ad8\u98ce\u9669\u64cd\u4f5c\u62e6\u622a', en: 'Smart Light Unsafe Operation Block' },
  'Camera Safe Capture': { zh: '\u6444\u50cf\u5934\u5b89\u5168\u91c7\u96c6', en: 'Camera Safe Capture' },
  '\u6444\u50cf\u5934\u5b89\u5168\u91c7\u96c6': { zh: '\u6444\u50cf\u5934\u5b89\u5168\u91c7\u96c6', en: 'Camera Safe Capture' },
  'Camera Privacy Zone Block': { zh: '\u6444\u50cf\u5934\u9690\u79c1\u533a\u62e6\u622a', en: 'Camera Privacy Zone Block' },
  '\u6444\u50cf\u5934\u9690\u79c1\u533a\u62e6\u622a': { zh: '\u6444\u50cf\u5934\u9690\u79c1\u533a\u62e6\u622a', en: 'Camera Privacy Zone Block' },
  'robot-arm-pick-place-safe': { zh: '\u673a\u68b0\u81c2\u5b89\u5168\u6293\u53d6\u653e\u7f6e', en: 'Robot Arm Safe Pick and Place' },
  'robot-arm-pick-place-unsafe': { zh: '\u673a\u68b0\u81c2\u5371\u9669\u629b\u63b7\u62e6\u622a', en: 'Robot Arm Unsafe Throw Block' },
  'smart-light-control-safe': { zh: '\u667a\u80fd\u706f\u63a7\u5236', en: 'Smart Light Control' },
  'smart-light-control-unsafe': { zh: '\u667a\u80fd\u706f\u9ad8\u98ce\u9669\u64cd\u4f5c\u62e6\u622a', en: 'Smart Light Unsafe Operation Block' },
  'camera-sensor-check-safe': { zh: '\u6444\u50cf\u5934\u5b89\u5168\u91c7\u96c6', en: 'Camera Safe Capture' },
  'camera-sensor-check-unsafe': { zh: '\u6444\u50cf\u5934\u9690\u79c1\u533a\u62e6\u622a', en: 'Camera Privacy Zone Block' },
  'virtual-robot-arm': { zh: '\u901a\u7528\u673a\u68b0\u81c2', en: 'Robot Arm' },
  'virtual-mobile-robot': { zh: '\u79fb\u52a8\u673a\u5668\u4eba', en: 'Mobile Robot' },
  'virtual-smart-light': { zh: '\u667a\u80fd\u706f', en: 'Smart Light' },
  'virtual-camera-sensor': { zh: '\u6444\u50cf\u5934\u4f20\u611f\u5668', en: 'Camera Sensor' },
  'virtual-conveyor-belt': { zh: '\u4f20\u9001\u5e26', en: 'Conveyor Belt' }
};

const categoryMap: Record<string, { zh: string; en: string }> = {
  robotics: { zh: '\u673a\u5668\u4eba', en: 'Robotics' },
  vision: { zh: '\u89c6\u89c9', en: 'Vision' },
  semantic: { zh: '\u8bed\u4e49\u7ea7', en: 'Semantic' },
  factory: { zh: '\u5de5\u5382', en: 'Factory' },
  automation: { zh: '\u81ea\u52a8\u5316', en: 'Automation' },
  sensor: { zh: '\u4f20\u611f\u5668', en: 'Sensor' },
  sensors: { zh: '\u4f20\u611f\u5668', en: 'Sensors' },
  warehouse: { zh: '\u4ed3\u50a8', en: 'Warehouse' },
  lab: { zh: '\u5b9e\u9a8c\u5ba4', en: 'Lab' },
  controls: { zh: '\u63a7\u5236', en: 'Controls' },
  'mobile-robotics': { zh: '\u79fb\u52a8\u673a\u5668\u4eba', en: 'Mobile Robotics' },
  'building-automation': { zh: '\u697c\u5b87\u81ea\u52a8\u5316', en: 'Building Automation' },
  'material-handling': { zh: '\u7269\u6599\u8f93\u9001', en: 'Material Handling' },
  'lab-equipment': { zh: '\u5b9e\u9a8c\u8bbe\u5907', en: 'Lab Equipment' }
};

const fidelityMap: Record<string, { zh: string; en: string }> = {
  semantic: { zh: '\u8bed\u4e49\u7ea7', en: 'Semantic' },
  kinematic: { zh: '\u8fd0\u52a8\u5b66\u7ea7', en: 'Kinematic' },
  physics: { zh: '\u7269\u7406\u7ea7', en: 'Physics' }
};

const capabilityMap: Record<string, { zh: string; en: string }> = {
  'robot.pick': { zh: '\u673a\u68b0\u81c2\u6293\u53d6', en: 'Robot Pick' },
  'robot.place': { zh: '\u673a\u68b0\u81c2\u653e\u7f6e', en: 'Robot Place' },
  'robot.move_to_pose': { zh: '\u673a\u68b0\u81c2\u79fb\u52a8\u5230\u4f4d\u59ff', en: 'Robot Move To Pose' },
  'robot.return_home': { zh: '\u673a\u68b0\u81c2\u56de\u539f\u70b9', en: 'Robot Return Home' },
  'light.set_power': { zh: '\u706f\u5149\u7535\u6e90\u63a7\u5236', en: 'Light Power Control' },
  'light.set_brightness': { zh: '\u706f\u5149\u4eae\u5ea6\u63a7\u5236', en: 'Light Brightness Control' },
  'light.set_color': { zh: '\u706f\u5149\u989c\u8272\u63a7\u5236', en: 'Light Color Control' },
  'camera.snapshot': { zh: '\u62cd\u6444\u5feb\u7167', en: 'Camera Snapshot' },
  'sensor.read': { zh: '\u8bfb\u53d6\u4f20\u611f\u5668', en: 'Sensor Read' },
  'device.read_state': { zh: '\u8bfb\u53d6\u8bbe\u5907\u72b6\u6001', en: 'Device Read State' },
  'device.dry_run': { zh: '\u8bbe\u5907\u5e72\u8fd0\u884c', en: 'Device Dry Run' },
  'device.emergency_stop': { zh: '\u8bbe\u5907\u6025\u505c', en: 'Device Emergency Stop' },
  scan_area: { zh: '\u626b\u63cf\u533a\u57df', en: 'Scan Area' },
  identify_object: { zh: '\u8bc6\u522b\u76ee\u6807', en: 'Identify Object' },
  move_to_pose: { zh: '\u79fb\u52a8\u5230\u4f4d\u59ff', en: 'Move To Pose' },
  grasp: { zh: '\u6293\u53d6', en: 'Grasp' },
  release: { zh: '\u91ca\u653e', en: 'Release' },
  return_home: { zh: '\u56de\u5230\u539f\u70b9', en: 'Return Home' },
  set_light: { zh: '\u8bbe\u7f6e\u706f\u5149', en: 'Set Light' },
  set_brightness: { zh: '\u8bbe\u7f6e\u4eae\u5ea6', en: 'Set Brightness' },
  set_color: { zh: '\u8bbe\u7f6e\u989c\u8272', en: 'Set Color' },
  capture_frame: { zh: '\u91c7\u96c6\u753b\u9762', en: 'Capture Frame' },
  read_sensor: { zh: '\u8bfb\u53d6\u4f20\u611f\u5668', en: 'Read Sensor' }
};

const metadataValueMap: Record<string, { zh: string; en: string }> = {
  low: { zh: '\u4f4e', en: 'Low' },
  medium: { zh: '\u4e2d', en: 'Medium' },
  high: { zh: '\u9ad8', en: 'High' },
  slow: { zh: '\u6162\u901f', en: 'Slow' },
  normal: { zh: '\u5e38\u901f', en: 'Normal' },
  fast: { zh: '\u5feb\u901f', en: 'Fast' },
  idle: { zh: '\u5f85\u673a', en: 'Idle' },
  completed: { zh: '\u5b8c\u6210', en: 'Completed' },
  blocked: { zh: '\u5df2\u62e6\u622a', en: 'Blocked' },
  docked: { zh: '\u5df2\u505c\u9760', en: 'Docked' },
  captured: { zh: '\u5df2\u91c7\u96c6', en: 'Captured' },
  pickup_zone: { zh: '\u53d6\u6599\u533a', en: 'Pickup Zone' },
  right_safe_zone: { zh: '\u53f3\u4fa7\u5b89\u5168\u533a', en: 'Right Safe Zone' },
  left_safe_zone: { zh: '\u5de6\u4fa7\u5b89\u5168\u533a', en: 'Left Safe Zone' },
  front_safe_zone: { zh: '\u524d\u4fa7\u5b89\u5168\u533a', en: 'Front Safe Zone' },
  back_safe_zone: { zh: '\u540e\u4fa7\u5b89\u5168\u533a', en: 'Back Safe Zone' },
  charging_dock: { zh: '\u5145\u7535\u6869', en: 'Charging Dock' },
  aisle_a: { zh: 'A \u901a\u9053', en: 'Aisle A' },
  restricted_zone: { zh: '\u9650\u5236\u533a', en: 'Restricted Zone' },
  unsafe_zone: { zh: '\u5371\u9669\u533a', en: 'Unsafe Zone' },
  privacy_zone: { zh: '\u9690\u79c1\u533a', en: 'Privacy Zone' },
  bin_a: { zh: 'A \u6599\u7bb1', en: 'Bin A' },
  jam_zone: { zh: '\u5361\u6ede\u533a', en: 'Jam Zone' },
  red_cube: { zh: '\u7ea2\u8272\u65b9\u5757', en: 'Red Cube' },
  blue_cube: { zh: '\u84dd\u8272\u65b9\u5757', en: 'Blue Cube' },
  lamp: { zh: '\u706f\u5177', en: 'Lamp' },
  camera_view: { zh: '\u6444\u50cf\u5934\u89c6\u89d2', en: 'Camera View' },
  generic: { zh: '\u901a\u7528', en: 'Generic' },
  'project-owned-generic': { zh: '\u9879\u76ee\u81ea\u6709\u901a\u7528\u8bb8\u53ef', en: 'Project-Owned Generic' },
  'created-for-open-reality-studio': { zh: '\u4e3a RealityWarden \u521b\u5efa', en: 'Created for RealityWarden' },
  generated_placeholder: { zh: '\u5360\u4f4d\u8d44\u4ea7', en: 'Placeholder Asset' },
  open_source_robot_model: { zh: '\u5f00\u6e90\u8bbe\u5907\u6a21\u578b', en: 'Open Source Device Model' },
  real_device_cad: { zh: '\u771f\u5b9e\u8bbe\u5907 CAD', en: 'Real Device CAD' }
};

const messageMap: Record<string, { zh: string; en: string }> = {
  'Blocked by Safety Runtime': { zh: '\u5df2\u88ab\u5b89\u5168\u8fd0\u884c\u65f6\u62e6\u622a', en: 'Blocked by Safety Runtime' },
  'Run stopped.': { zh: '\u6267\u884c\u5df2\u505c\u6b62\u3002', en: 'Run stopped.' },
  'Execution completed.': { zh: '\u6267\u884c\u5b8c\u6210\u3002', en: 'Execution completed.' },
  'Waiting for AI command.': { zh: '\u7b49\u5f85 AI \u6307\u4ee4\u3002', en: 'Waiting for AI command.' }
};

type MapRecord = Record<string, { zh: string; en: string }>;

export function t(locale: Locale, key: CopyKey | string) {
  const table = copy[locale] as Record<string, string>;
  return table[key] ?? copy.en[key as CopyKey] ?? key;
}

export function localizeStatus(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return statusMap[normalized]?.[locale] ?? statusMap[normalized]?.en ?? normalized;
}

export function localizeDeviceType(locale: Locale, value: unknown) {
  const normalized = String(value ?? '') as DeviceType;
  return deviceTypeMap[normalized]?.[locale] ?? deviceTypeMap[normalized]?.en ?? String(value ?? '');
}

function localizeNumberedDeviceName(locale: Locale, value: string) {
  for (const entry of Object.values(deviceTypeMap)) {
    const labels = [entry.zh, entry.en];
    for (const label of labels) {
      if (value === label) return entry[locale];
      if (value.startsWith(`${label} `)) {
        return `${entry[locale]} ${value.slice(label.length + 1)}`;
      }
    }
  }
  return null;
}

function lookup(locale: Locale, normalized: string, table: MapRecord) {
  return table[normalized]?.[locale] ?? table[normalized]?.en ?? null;
}

export function localizeDisplayName(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  const numbered = localizeNumberedDeviceName(locale, normalized);
  if (numbered) return numbered;
  return lookup(locale, normalized, displayNameMap) ?? (normalized in deviceTypeMap ? localizeDeviceType(locale, normalized) : normalized);
}

export function localizeCategory(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return lookup(locale, normalized, categoryMap) ?? normalized;
}

export function localizeCapability(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return lookup(locale, normalized, capabilityMap) ?? normalized;
}

export function localizeProfileName(locale: Locale, value: unknown) {
  return localizeDisplayName(locale, value);
}

export function localizeScenarioName(locale: Locale, value: unknown) {
  return localizeDisplayName(locale, value);
}

export function localizeFidelity(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return lookup(locale, normalized, fidelityMap) ?? normalized;
}

export function localizeMetadataValue(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return (
    lookup(locale, normalized, metadataValueMap)
    ?? lookup(locale, normalized, categoryMap)
    ?? normalized
  );
}

export function localizeMessage(locale: Locale, value: unknown) {
  const normalized = String(value ?? '');
  return lookup(locale, normalized, messageMap) ?? normalized;
}

