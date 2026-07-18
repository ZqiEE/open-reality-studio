import type { DeviceGeometry, DeviceMeta } from './deviceMeta';
import type { TaskDSL, TaskStep } from './taskDsl';

export type Vec3 = [number, number, number];

export type SimObjectKind = 'cube' | 'obstacle' | 'safe_zone' | 'forbidden_zone' | 'robot_target';

export interface SimObject {
  id: string;
  kind: SimObjectKind;
  position: Vec3;
  size?: number;
  zone_size?: [number, number];
  radius?: number;
  height?: number;
}

export interface RobotState {
  base_position: Vec3;
  current_position: Vec3;
  home_position: Vec3;
  arm_segments: [number, number];
}

export interface GripperState {
  status: 'open' | 'closed';
  holding_object_id?: string;
}

export interface WorldState {
  profile_id: string;
  robot: RobotState;
  objects: Record<string, SimObject>;
  gripper: GripperState;
  workspace: DeviceGeometry['workspace'];
  forbidden_zones: SimObject[];
  execution_status: 'idle' | 'dry_run' | 'executing' | 'blocked' | 'completed' | 'failed';
}

export interface MotionPlanStep {
  step_id: string;
  action: TaskStep['action'] | 'scan_event';
  target?: string;
  target_position?: Vec3;
  path?: Vec3[];
  speed?: 'slow' | 'normal' | 'fast';
  force?: 'low' | 'medium' | 'high';
  estimated_duration_ms: number;
  status: 'pending' | 'running' | 'completed' | 'blocked' | 'failed';
  note?: string;
}

export interface MotionPlan {
  plan_id: string;
  task_id: string;
  profile_id: string;
  steps: MotionPlanStep[];
  adapter_commands: AdapterCommand[];
}

export interface AdapterCommand {
  command: string;
  target_position?: Vec3;
  speed?: string;
  force?: string;
  source_step_id: string;
  /**
   * Honest scalar joint angle in degrees for 1-DOF digital-twin devices only
   * (e.g. the ESP32 + SG90 servo twin). Multi-DOF / 3D devices NEVER set this;
   * they speak target_position (Vec3). The simulation-to-real bridge requires
   * this field on every command and structurally rejects any run that lacks it,
   * so a 3D pose can never be projected onto a servo angle. Not authoritative:
   * downstream validateActionManifest and the hardware gate revalidate range.
   */
  target_angle_deg?: number;
}

export interface OperationalDryRunReport {
  dry_run_status: 'pass' | 'blocked' | 'needs_confirmation';
  profile_id: string;
  motion_steps_checked: number;
  reachability_pass: boolean;
  collision_pass: boolean;
  forbidden_zone_pass: boolean;
  blocked_reasons: string[];
  planned_path: Vec3[];
}

export interface TimelineEvent {
  id: string;
  timestamp_ms: number;
  type: 'dry_run' | 'step_started' | 'step_completed' | 'blocked' | 'world_state_updated' | 'replay';
  step_id?: string;
  message: string;
}

export interface SimulationRunResult {
  worldState: WorldState;
  motionPlan: MotionPlan;
  dryRun: OperationalDryRunReport;
  timeline: TimelineEvent[];
}

export interface SimulationInput {
  deviceMeta: DeviceMeta;
  geometry: DeviceGeometry;
  task: TaskDSL;
}
