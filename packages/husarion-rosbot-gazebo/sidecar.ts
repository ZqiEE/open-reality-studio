import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  HUSARION_ROSBOT_COMMAND_TOPIC,
  HUSARION_ROSBOT_MESSAGE_TYPE,
  HUSARION_ROSBOT_STATE_TOPIC,
  normalizeRosNamespace,
  rosbotOdometryObservationSchema,
  resolveRosbotTopic,
  type HusarionRosbotTransport,
  type RosbotOdometryObservation,
  type RosbotTwistAction
} from '.';

interface SidecarReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const MAXIMUM_PENDING_REQUESTS = 16;
const MAXIMUM_SIDECAR_FRAME_BYTES = 256 * 1024;

interface PythonHusarionRosbotTransportOptions {
  pythonExecutable: string;
  sidecarPath: string;
  namespace?: string;
  discoveryTimeoutMs?: number;
  useSimTime?: boolean;
  requiredObserverNode?: string;
}

/** JSONL IPC transport. Policy, release state, permits, and Evidence stay in TypeScript Core. */
export class PythonHusarionRosbotTransport implements HusarionRosbotTransport {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = Buffer.alloc(0);
  private state?: RosbotOdometryObservation;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly namespace: string;
  private readonly discoveryTimeoutMs: number;
  private terminalError?: Error;

  constructor(private readonly options: PythonHusarionRosbotTransportOptions) {
    this.namespace = normalizeRosNamespace(options.namespace);
    const timeout = options.discoveryTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      throw new Error('ros2_discovery_timeout_out_of_range');
    }
    this.discoveryTimeoutMs = timeout;
    if (
      options.requiredObserverNode !== undefined
      && !/^[A-Za-z0-9_-]{1,255}$/.test(options.requiredObserverNode)
    ) throw new Error('rosbot_command_path_observer_invalid');
  }

  async getOdometryObservation(): Promise<unknown | undefined> {
    await this.ensureStarted();
    const deadline = Date.now() + this.discoveryTimeoutMs;
    while (!this.state && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    return this.state;
  }

  async publishVelocity(action: RosbotTwistAction): Promise<{
    published: true;
    topic: string;
    messageType: typeof HUSARION_ROSBOT_MESSAGE_TYPE;
  }> {
    const result = await this.request('publish', { action }) as {
      published: true;
      topic: string;
      messageType: typeof HUSARION_ROSBOT_MESSAGE_TYPE;
    };
    const expectedTopic = resolveRosbotTopic(this.namespace, HUSARION_ROSBOT_COMMAND_TOPIC);
    if (
      result.published !== true
      || result.topic !== expectedTopic
      || result.messageType !== HUSARION_ROSBOT_MESSAGE_TYPE
    ) throw new Error('rosbot_publish_confirmation_invalid');
    return result;
  }

  async waitForCommandPathReady(): Promise<boolean> {
    const result = await this.request('wait_command_path', {
      timeoutMs: this.discoveryTimeoutMs,
      requiredObserverNode: this.options.requiredObserverNode
    }) as { ready?: unknown };
    if (typeof result.ready !== 'boolean') {
      throw new Error('rosbot_command_path_readiness_invalid');
    }
    return result.ready;
  }

  async close(): Promise<void> {
    if (!this.child) return;
    try {
      await this.request('shutdown', {}, Math.min(this.discoveryTimeoutMs, 5_000));
    } catch {
      // The request path already poisoned and terminated an uncertain channel.
    } finally {
      this.failChannel(new Error('rosbot_sidecar_closed'));
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.terminalError) throw this.terminalError;
    if (this.child) return;
    const child = spawn(this.options.pythonExecutable, [
      this.options.sidecarPath,
      '--namespace',
      this.namespace,
      ...(this.options.useSimTime ? ['--use-sim-time'] : []),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => this.handleStdoutChunk(chunk));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_192);
    });
    child.on('exit', (code) => {
      const error = new Error(
        `rosbot_sidecar_exited:${code ?? 'signal'}${stderr.trim() ? `:${stderr.trim()}` : ''}`
      );
      this.failChannel(error, false);
    });
    child.on('error', (error) => {
      this.failChannel(error);
    });
    await this.request('ping', {}, this.discoveryTimeoutMs);
  }

  private request(
    operation: string,
    params: Record<string, unknown>,
    timeoutMs = operation === 'publish'
      ? Math.min(300_000, this.discoveryTimeoutMs + 35_000)
      : this.discoveryTimeoutMs
  ): Promise<unknown> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (!this.child && operation !== 'ping') {
      return this.ensureStarted().then(() => this.request(operation, params, timeoutMs));
    }
    const child = this.child;
    if (!child) return Promise.reject(new Error('rosbot_sidecar_not_started'));
    if (this.pending.size >= MAXIMUM_PENDING_REQUESTS) {
      return Promise.reject(new Error('rosbot_sidecar_request_capacity_exceeded'));
    }
    const id = this.nextId++;
    const frame = `${JSON.stringify({ id, operation, params })}\n`;
    if (Buffer.byteLength(frame, 'utf8') > MAXIMUM_SIDECAR_FRAME_BYTES) {
      return Promise.reject(new Error('rosbot_sidecar_request_too_large'));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        const error = new Error(`rosbot_sidecar_${operation}_timeout`);
        pending.reject(error);
        this.failChannel(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(frame, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(error);
        this.failChannel(error);
      });
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
        this.failChannel(new Error('rosbot_sidecar_response_too_large'));
        return;
      }
      if (fragment.length > 0) {
        this.stdoutBuffer = this.stdoutBuffer.length === 0
          ? Buffer.from(fragment)
          : Buffer.concat([this.stdoutBuffer, fragment]);
      }
      if (newline === -1) return;
      const line = this.stdoutBuffer.toString('utf8');
      this.stdoutBuffer = Buffer.alloc(0);
      this.handleLine(line);
      offset = newline + 1;
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      message = parsed as Record<string, unknown>;
    } catch {
      this.failChannel(new Error('rosbot_sidecar_response_malformed'));
      return;
    }
    if (message.event === 'odometry') {
      const state = rosbotOdometryObservationSchema.safeParse(message.state);
      if (!state.success) {
        this.failChannel(new Error('rosbot_sidecar_odometry_invalid'));
        return;
      }
      this.state = state.data;
      return;
    }
    if (
      typeof message.id !== 'number'
      || !Number.isSafeInteger(message.id)
      || typeof message.ok !== 'boolean'
    ) {
      this.failChannel(new Error('rosbot_sidecar_response_invalid'));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.failChannel(new Error('rosbot_sidecar_unsolicited_response'));
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    const reply = message as unknown as SidecarReply;
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(new Error(
      typeof reply.error === 'string' && reply.error.length > 0
        ? reply.error
        : 'rosbot_sidecar_request_failed'
    ));
  }
}

export const HUSARION_ROSBOT_SIDECAR_TOPICS = Object.freeze({
  command: HUSARION_ROSBOT_COMMAND_TOPIC,
  state: HUSARION_ROSBOT_STATE_TOPIC
});
