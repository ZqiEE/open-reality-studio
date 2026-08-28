import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  jointStateSnapshotSchema,
  ros2ControllerResultSchema,
  type JointStateSnapshot,
  type JointTrajectoryAction,
  type Ros2DoctorReport,
  type Ros2ReferenceTransport,
} from ".";

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
  jointOrder?: string[];
  discoveryTimeoutMs?: number;
}

const MAXIMUM_PENDING_REQUESTS = 16;
const MAXIMUM_SIDECAR_FRAME_BYTES = 256 * 1024;

/**
 * JSONL IPC client for the rclpy transport sidecar. It deliberately exposes no
 * policy, release, evidence, or permit operation to Python.
 */
export class PythonRos2SidecarTransport implements Ros2ReferenceTransport {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = Buffer.alloc(0);
  private handler?: (payload: string) => Promise<void>;
  private state?: JointStateSnapshot;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private readonly discoveryTimeoutMs: number;
  private terminalError?: Error;

  constructor(private readonly options: PythonRos2SidecarOptions) {
    const timeout = options.discoveryTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      throw new Error("ros2_discovery_timeout_out_of_range");
    }
    this.discoveryTimeoutMs = timeout;
  }

  async subscribeProposals(
    handler: (payload: string) => Promise<void>,
  ): Promise<void> {
    if (this.handler) throw new Error("proposal_subscription_already_active");
    this.handler = handler;
    await this.ensureStarted();
  }

  async getFreshJointState(maxAgeMs: number): Promise<JointStateSnapshot> {
    // DDS discovery is asynchronous for every new sidecar participant. Give
    // the first or next fresh sample a bounded startup window. A cached stale
    // sample can race an active publisher; only a newly fresh sample succeeds.
    const deadline = Date.now() + this.discoveryTimeoutMs;
    let observedState = false;
    while (Date.now() < deadline) {
      if (this.state) {
        observedState = true;
        const ageMs = Date.now() - Date.parse(this.state.observedAt);
        if (!Number.isFinite(ageMs) || ageMs < -5) {
          throw new Error("joint_state_stale");
        }
        if (ageMs >= 0 && ageMs <= maxAgeMs) return this.state;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(observedState ? "joint_state_stale" : "joint_state_missing");
  }

  async dispatchTrajectory(
    action: JointTrajectoryAction,
    controllerIdentity: string,
  ): ReturnType<Ros2ReferenceTransport["dispatchTrajectory"]> {
    const parsed = ros2ControllerResultSchema.safeParse(
      await this.request("dispatch", { action, controllerIdentity }),
    );
    if (!parsed.success) throw new Error("ros2_sidecar_controller_result_invalid");
    return parsed.data;
  }

  async doctor(): Promise<Ros2DoctorReport> {
    return this.request("doctor", {}) as Promise<Ros2DoctorReport>;
  }

  async close(): Promise<void> {
    if (!this.child) return;
    try {
      await this.request("shutdown", {}, Math.min(this.discoveryTimeoutMs, 5_000));
    } catch {
      // The request path already poisoned and terminated an uncertain channel.
      // Cleanup must not mask the operation error that led callers here.
    } finally {
      this.failChannel(new Error("ros2_sidecar_closed"));
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.terminalError) throw this.terminalError;
    if (this.child) return;
    const args = [
      this.options.sidecarPath,
      "--proposal-topic",
      this.options.proposalTopic ?? "/rlsok/action_proposals",
      "--joint-state-topic",
      this.options.jointStateTopic ?? "/joint_states",
      "--controller-action",
      this.options.controllerAction ??
        "/joint_trajectory_controller/follow_joint_trajectory",
      "--discovery-timeout-seconds",
      String(this.discoveryTimeoutMs / 1_000),
    ];
    if (this.options.jointOrder) {
      args.push("--joint-order-json", JSON.stringify(this.options.jointOrder));
    }
    const child = spawn(this.options.pythonExecutable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
    });
    child.on("exit", (code) => {
      const error = new Error(
        `ros2_sidecar_exited:${code ?? "signal"}${stderr.trim() ? `:${stderr.trim()}` : ""}`,
      );
      this.failChannel(error, false);
    });
    child.on("error", (error) => {
      this.failChannel(error);
    });
    await this.request("ping", {}, this.discoveryTimeoutMs);
  }

  private request(
    operation: string,
    params: Record<string, unknown>,
    timeoutMs = operation === "dispatch"
      ? Math.min(300_000, this.discoveryTimeoutMs + 35_000)
      : this.discoveryTimeoutMs,
  ): Promise<unknown> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (!this.child && operation !== "ping") {
      return this.ensureStarted().then(() => this.request(operation, params, timeoutMs));
    }
    const child = this.child;
    if (!child) return Promise.reject(new Error("ros2_sidecar_not_started"));
    if (this.pending.size >= MAXIMUM_PENDING_REQUESTS) {
      return Promise.reject(new Error("ros2_sidecar_request_capacity_exceeded"));
    }
    const id = this.nextId++;
    const frame = `${JSON.stringify({ id, operation, params })}\n`;
    if (Buffer.byteLength(frame, "utf8") > MAXIMUM_SIDECAR_FRAME_BYTES) {
      return Promise.reject(new Error("ros2_sidecar_request_too_large"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        const error = new Error(`ros2_sidecar_${operation}_timeout`);
        pending.reject(error);
        this.failChannel(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(
        frame,
        (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(error);
          this.failChannel(error);
        },
      );
    });
  }

  private failChannel(error: Error, kill = true): void {
    this.terminalError ??= error;
    const child = this.child;
    this.child = undefined;
    this.stdoutBuffer = Buffer.alloc(0);
    for (const pending of Array.from(this.pending.values())) {
      clearTimeout(pending.timeout);
      pending.reject(this.terminalError);
    }
    this.pending.clear();
    if (kill) child?.kill();
  }

  private handleStdoutChunk(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.length : newline;
      const fragment = chunk.subarray(offset, end);
      if (this.stdoutBuffer.length + fragment.length > MAXIMUM_SIDECAR_FRAME_BYTES) {
        this.failChannel(new Error("ros2_sidecar_response_too_large"));
        return;
      }
      if (fragment.length > 0) {
        this.stdoutBuffer = this.stdoutBuffer.length === 0
          ? Buffer.from(fragment)
          : Buffer.concat([this.stdoutBuffer, fragment]);
      }
      if (newline === -1) return;
      const line = this.stdoutBuffer.toString("utf8");
      this.stdoutBuffer = Buffer.alloc(0);
      void this.handleLine(line);
      offset = newline + 1;
    }
  }

  private async handleLine(line: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.failChannel(new Error("ros2_sidecar_response_malformed"));
      return;
    }
    if (message.event === "joint_state") {
      const state = jointStateSnapshotSchema.safeParse(message.state);
      if (!state.success) {
        this.failChannel(new Error("ros2_sidecar_joint_state_invalid"));
        return;
      }
      this.state = state.data;
      return;
    }
    if (message.event === "proposal" && typeof message.payload === "string") {
      try {
        await this.handler?.(message.payload);
      } catch {
        // Proposal failures are isolated; evidence is emitted by Core when identity is known.
      }
      return;
    }
    const responseId = message.id;
    if (
      typeof responseId !== "number" ||
      !Number.isSafeInteger(responseId) ||
      typeof message.ok !== "boolean"
    ) {
      this.failChannel(new Error("ros2_sidecar_response_invalid"));
      return;
    }
    const pending = this.pending.get(responseId);
    if (!pending) {
      this.failChannel(new Error("ros2_sidecar_unsolicited_response"));
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(responseId);
    const reply = message as unknown as SidecarReply;
    if (reply.ok) pending.resolve(reply.result);
    else
      pending.reject(new Error(reply.error ?? "ros2_sidecar_request_failed"));
  }
}
