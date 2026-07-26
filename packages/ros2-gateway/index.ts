import type { ExecutablePolicySpec } from '../exec-spec';
import type { ExecutionPermit } from '../execution-gate';

export interface ActionProposal<TAction> {
  proposalId: string;
  proposerIdentity: string;
  deviceId: string;
  action: TAction;
  proposedAt: string;
}

export interface DispatchResult {
  accepted: boolean;
  detail: string;
}

export interface ActionProposalSource<TAction> {
  subscribe(handler: (proposal: ActionProposal<TAction>) => Promise<void>): Promise<void>;
}

export interface RobotStateSource<TState> {
  getFreshState(maxAgeMs: number): Promise<TState>;
}

export interface ControllerSink<TAction> {
  dispatch(action: TAction, permit: ExecutionPermit): Promise<DispatchResult>;
  cancel(reason: string): Promise<void>;
}

export interface ReleaseResolver {
  resolveActiveRelease(
    deviceId: string,
    proposerIdentity: string
  ): Promise<ExecutablePolicySpec>;
}

/** In-memory reference source for contract tests; not a ROS 2 transport. */
export class InMemoryActionProposalSource<TAction> implements ActionProposalSource<TAction> {
  private handler?: (proposal: ActionProposal<TAction>) => Promise<void>;

  async subscribe(handler: (proposal: ActionProposal<TAction>) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async publish(proposal: ActionProposal<TAction>): Promise<void> {
    if (!this.handler) throw new Error('proposal_source_has_no_subscriber');
    await this.handler(proposal);
  }
}

/** In-memory reference state source; missing or stale state fails closed. */
export class InMemoryRobotStateSource<TState> implements RobotStateSource<TState> {
  constructor(private state?: { value: TState; observedAt: number }) {}

  update(value: TState, observedAt: number = Date.now()): void {
    this.state = { value, observedAt };
  }

  async getFreshState(maxAgeMs: number): Promise<TState> {
    if (!this.state) throw new Error('robot_state_missing');
    const age = Date.now() - this.state.observedAt;
    if (age < 0 || age > maxAgeMs) throw new Error('robot_state_stale');
    return this.state.value;
  }
}

/** In-memory reference sink. Permit validity remains owned by ExecutionGate. */
export class InMemoryControllerSink<TAction> implements ControllerSink<TAction> {
  readonly dispatched: TAction[] = [];
  readonly cancellations: string[] = [];

  async dispatch(action: TAction, _permit: ExecutionPermit): Promise<DispatchResult> {
    this.dispatched.push(action);
    return { accepted: true, detail: 'in_memory_dispatch_recorded' };
  }

  async cancel(reason: string): Promise<void> {
    this.cancellations.push(reason);
  }
}

/** Exact device+proposer binding; absence is an explicit resolution failure. */
export class InMemoryReleaseResolver implements ReleaseResolver {
  private readonly releases = new Map<string, ExecutablePolicySpec>();

  bind(deviceId: string, proposerIdentity: string, release: ExecutablePolicySpec): void {
    this.releases.set(`${deviceId}\0${proposerIdentity}`, release);
  }

  async resolveActiveRelease(
    deviceId: string,
    proposerIdentity: string
  ): Promise<ExecutablePolicySpec> {
    const release = this.releases.get(`${deviceId}\0${proposerIdentity}`);
    if (!release) throw new Error('active_release_not_found');
    return release;
  }
}

/**
 * Interface boundary reserved for reference adapters:
 * FollowJointTrajectory, JointJog, TwistStamped, gripper commands, JointState,
 * cancel, and a protective-stop bridge. Experimental and not safety-rated.
 */
export const ROS2_REFERENCE_CONTRACTS = [
  'FollowJointTrajectory',
  'JointJog',
  'TwistStamped',
  'GripperCommand',
  'JointState',
  'cancel',
  'protective_stop_bridge'
] as const;
