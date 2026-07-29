import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  JointStateSnapshot,
  JointTrajectoryAction,
  Ros2DoctorReport,
  Ros2ReferenceTransport
} from '.';

interface SidecarReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PythonRos2SidecarOptions {
  pythonExecutable: string;
  sidecarPath: string;
  proposalTopic?: string;
  jointStateTopic?: string;
  controllerAction?: string;
}

/**
 * JSONL IPC client for the rclpy transport sidecar. It deliberately exposes no
 * policy, release, evidence, or permit operation to Python.
 */
export class PythonRos2SidecarTransport implements Ros2ReferenceTransport {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
  private handler?: (payload: string) => Promise<void>;
  private state?: JointStateSnapshot;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  constructor(private readonly options: PythonRos2SidecarOptions) {}

  async subscribeProposals(handler: (payload: string) => Promise<void>): Promise<void> {
    if (this.handler) throw new Error('proposal_subscription_already_active');
    this.handler = handler;
    await this.ensureStarted();
  }

  async getFreshJointState(maxAgeMs: number): Promise<JointStateSnapshot> {
    const deadline = Date.now() + Math.min(maxAgeMs, 1_000);
    while (!this.state && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    if (!this.state) throw new Error('joint_state_missing');
    const ageMs = Date.now() - Date.parse(this.state.observedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
      throw new Error('joint_state_stale');
    }
    return this.state;
  }

  async dispatchTrajectory(
    action: JointTrajectoryAction,
    controllerIdentity: string
  ): Promise<{ accepted: boolean; detail: string }> {
    return this.request('dispatch', { action, controllerIdentity }) as Promise<{
      accepted: boolean;
      detail: string;
    }>;
  }

  async cancelActiveGoal(reason: string): Promise<{ requested: boolean; detail: string }> {
    return this.request('cancel', { reason }) as Promise<{ requested: boolean; detail: string }>;
  }

  async doctor(): Promise<Ros2DoctorReport> {
    return this.request('doctor', {}) as Promise<Ros2DoctorReport>;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await this.request('shutdown', {});
    } catch {
      child.kill();
    }
    this.lines?.close();
    this.child = undefined;
    for (const pending of Array.from(this.pending.values())) {
      pending.reject(new Error('ros2_sidecar_closed'));
    }
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) return;
    const args = [
      this.options.sidecarPath,
      '--proposal-topic', this.options.proposalTopic ?? '/rlsok/action_proposals',
      '--joint-state-topic', this.options.jointStateTopic ?? '/joint_states',
      '--controller-action',
      this.options.controllerAction ?? '/joint_trajectory_controller/follow_joint_trajectory'
    ];
    const child = spawn(this.options.pythonExecutable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => void this.handleLine(line));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_192);
    });
    child.on('exit', (code) => {
      const error = new Error(
        `ros2_sidecar_exited:${code ?? 'signal'}${stderr.trim() ? `:${stderr.trim()}` : ''}`
      );
      for (const pending of Array.from(this.pending.values())) pending.reject(error);
      this.pending.clear();
      this.child = undefined;
    });
    child.on('error', (error) => {
      for (const pending of Array.from(this.pending.values())) pending.reject(error);
      this.pending.clear();
    });
    await Promise.race([
      this.request('ping', {}),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('ros2_sidecar_startup_timeout')),
        5_000
      ))
    ]);
  }

  private request(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child && operation !== 'ping') {
      return this.ensureStarted().then(() => this.request(operation, params));
    }
    const child = this.child;
    if (!child) return Promise.reject(new Error('ros2_sidecar_not_started'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, operation, params })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private async handleLine(line: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.event === 'joint_state') {
      this.state = message.state as JointStateSnapshot;
      return;
    }
    if (message.event === 'proposal' && typeof message.payload === 'string') {
      try {
        await this.handler?.(message.payload);
      } catch {
        // Proposal failures are isolated; evidence is emitted by Core when identity is known.
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    const reply = message as unknown as SidecarReply;
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(new Error(reply.error ?? 'ros2_sidecar_request_failed'));
  }
}
