import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import {
  HUSARION_ROSBOT_COMMAND_TOPIC,
  HUSARION_ROSBOT_MESSAGE_TYPE,
  HUSARION_ROSBOT_STATE_TOPIC,
  normalizeRosNamespace,
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

interface PythonHusarionRosbotTransportOptions {
  pythonExecutable: string;
  sidecarPath: string;
  namespace?: string;
  discoveryTimeoutMs?: number;
  useSimTime?: boolean;
}

/** JSONL IPC transport. Policy, release state, permits, and Evidence stay in TypeScript Core. */
export class PythonHusarionRosbotTransport implements HusarionRosbotTransport {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
  private state?: RosbotOdometryObservation;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  private readonly namespace: string;
  private readonly discoveryTimeoutMs: number;

  constructor(private readonly options: PythonHusarionRosbotTransportOptions) {
    this.namespace = normalizeRosNamespace(options.namespace);
    const timeout = options.discoveryTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      throw new Error('ros2_discovery_timeout_out_of_range');
    }
    this.discoveryTimeoutMs = timeout;
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
    for (const pending of this.pending.values()) {
      pending.reject(new Error('rosbot_sidecar_closed'));
    }
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
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
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => this.handleLine(line));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_192);
    });
    child.on('exit', (code) => {
      const error = new Error(
        `rosbot_sidecar_exited:${code ?? 'signal'}${stderr.trim() ? `:${stderr.trim()}` : ''}`
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.child = undefined;
    });
    child.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    await Promise.race([
      this.request('ping', {}),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('rosbot_sidecar_startup_timeout')),
        this.discoveryTimeoutMs
      ))
    ]);
  }

  private request(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child && operation !== 'ping') {
      return this.ensureStarted().then(() => this.request(operation, params));
    }
    const child = this.child;
    if (!child) return Promise.reject(new Error('rosbot_sidecar_not_started'));
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

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.event === 'odometry') {
      this.state = message.state as RosbotOdometryObservation;
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    const reply = message as unknown as SidecarReply;
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(new Error(reply.error ?? 'rosbot_sidecar_request_failed'));
  }
}

export const HUSARION_ROSBOT_SIDECAR_TOPICS = Object.freeze({
  command: HUSARION_ROSBOT_COMMAND_TOPIC,
  state: HUSARION_ROSBOT_STATE_TOPIC
});
