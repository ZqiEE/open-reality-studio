import { app, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { flashWithEsptoolJs } from '../hardware/esptoolFlasher';

/**
 * Real-hardware IPC (v0.3, connection + read-only distance).
 *
 * This is the ONLY main-process surface for the renderer's REAL HARDWARE
 * panel. Actuation exists here in exactly ONE form: executeRealAngle(), which
 * routes through the compiled HardwareExecutionGate chain and stays
 * real_execution_locked until the four-scenario acceptance evidence exists
 * (desktop regression enforces both properties). This file never hand-rolls
 * an actuation frame.
 *
 * The newline-JSON protocol client below mirrors the semantics of
 * `lib/hardware/SerialEsp32Transport` (id-matched responses, hard timeouts,
 * malformed lines are errors — never coerced into success). It is duplicated
 * here because the electron tsconfig rootDir cannot include lib/; when the
 * execution path is wired post-acceptance, this duplication is consolidated.
 *
 * Honesty rules: every failure returns { ok: false, error } with the real
 * reason; there is no retry-and-pretend, no cached reading, no fake state.
 */

interface SerialPortInstanceLike {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'close' | 'error', listener: (error?: Error) => void): void;
  open(callback: (error: Error | null) => void): void;
  close(callback: (error: Error | null) => void): void;
  write(chunk: string, callback: (error: Error | null | undefined) => void): void;
  isOpen: boolean;
}

interface SerialPortModuleLike {
  SerialPort: {
    new (options: { path: string; baudRate: number; autoOpen: boolean }): SerialPortInstanceLike;
    list(): Promise<SerialPortDescriptor[]>;
  };
}

interface SerialPortDescriptor {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

type SerialPortDescriptorResult = { ok: true; ports: SerialPortDescriptor[] } | { ok: false; error: string };
type SerialPortListResult = { ok: true; ports: Array<{ path: string; label?: string }> } | { ok: false; error: string };

function loadSerialPortModule(): SerialPortModuleLike | { error: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('serialport') as SerialPortModuleLike;
  } catch {
    return {
      error: 'serialport_not_installed: run `npm install serialport` in the app directory'
    };
  }
}

interface PendingRequest {
  resolve: (value: { ok: boolean; error?: string; data?: Record<string, unknown> }) => void;
  timer: ReturnType<typeof setTimeout>;
}

class HardwareConnection {
  private port: SerialPortInstanceLike | null = null;
  private buffer = '';
  private requestSeq = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private operationQueue: Promise<void> = Promise.resolve();
  private connectedPortPath: string | null = null;
  private diagnoseData: Record<string, unknown> | null = null;

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async listPorts(): Promise<SerialPortListResult> {
    const listed = await this.listPortDescriptors();
    if (!listed.ok) return listed;
    return {
      ok: true,
      ports: listed.ports.map((port) => ({ path: port.path, label: port.manufacturer }))
    };
  }

  async listPortDescriptors(): Promise<SerialPortDescriptorResult> {
    const loaded = loadSerialPortModule();
    if ('error' in loaded) return { ok: false, error: loaded.error };
    try {
      const ports = await loaded.SerialPort.list();
      return {
        ok: true,
        ports: ports.map((port) => ({
          path: port.path,
          manufacturer: port.manufacturer,
          serialNumber: port.serialNumber,
          vendorId: port.vendorId,
          productId: port.productId
        }))
      };
    } catch (error) {
      return { ok: false, error: `list failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  connect(portPath: string) {
    return this.enqueue(() => this.connectExclusive(portPath));
  }

  private async connectExclusive(portPath: string) {
    if (typeof portPath !== 'string' || portPath.trim().length === 0) {
      return { ok: false, error: 'invalid serial port path' };
    }
    const loaded = loadSerialPortModule();
    if ('error' in loaded) return { ok: false, error: loaded.error };
    await this.disconnectExclusive();
    const port = new loaded.SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    try {
      await new Promise<void>((resolve, reject) => {
        port.open((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      return { ok: false, error: `open failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.port = port;
    port.on('data', (chunk) => {
      if (this.port === port) this.handleData(chunk.toString('utf8'));
    });
    port.on('close', () => this.handlePortClosed(port, 'port closed'));
    port.on('error', () => {
      if (this.port === port) this.failAllPending('port error');
    });
    // Opening the port toggles DTR and resets the ESP32; give the firmware
    // time to boot before the handshake instead of reporting a false timeout.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const diagnose = await this.request('diagnose_hardware', 3000);
    const handshake = await this.request('read_distance', 3000);
    if (!diagnose.ok && !handshake.ok) {
      await this.disconnectExclusive();
      return { ok: false, error: `handshake failed: diagnose=${diagnose.error ?? 'no response'}; read=${handshake.error ?? 'no response'}` };
    }
    const distance = handshake.data?.distanceCm;
    this.connectedPortPath = portPath;
    this.diagnoseData = diagnose.ok && diagnose.data ? diagnose.data : null;
    return {
      ok: true,
      distanceCm: typeof distance === 'number' ? distance : undefined,
      diagnoseOk: diagnose.ok,
      diagnoseData: diagnose.ok ? diagnose.data : undefined,
      diagnoseError: diagnose.ok ? undefined : diagnose.error,
      readError: handshake.ok ? undefined : handshake.error
    };
  }

  connectedContext() {
    return {
      portPath: this.connectedPortPath,
      diagnoseData: this.diagnoseData
    };
  }

  async readDistance() {
    if (!this.port || !this.port.isOpen) {
      return { ok: false, error: 'hardware offline: not connected' };
    }
    const response = await this.request('read_distance', 3000);
    if (!response.ok) return { ok: false, error: response.error ?? 'read failed' };
    const distance = response.data?.distanceCm;
    if (typeof distance !== 'number') {
      return { ok: false, error: 'device responded without a numeric distanceCm' };
    }
    return { ok: true, distanceCm: distance };
  }

  disconnect() {
    return this.enqueue(() => this.disconnectExclusive());
  }

  /**
   * Read-only device probe: open -> boot wait -> diagnose_hardware (with a
   * read_distance fallback for legacy firmware) -> close. Never actuates.
   * The renderer interprets the raw result via lib/hardware/SetupAdvisor.
   */
  probe(portPath: string) {
    return this.enqueue(() => this.probeExclusive(portPath));
  }

  private async probeExclusive(portPath: string) {
    if (typeof portPath !== 'string' || portPath.trim().length === 0) {
      return { ok: false as const, error: 'invalid serial port path' };
    }
    const loaded = loadSerialPortModule();
    if ('error' in loaded) return { ok: false as const, error: loaded.error };
    await this.disconnectExclusive();
    const port = new loaded.SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    try {
      await new Promise<void>((resolve, reject) => {
        port.open((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      return { ok: false as const, error: `open failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.port = port;
    port.on('data', (chunk) => {
      if (this.port === port) this.handleData(chunk.toString('utf8'));
    });
    port.on('close', () => this.handlePortClosed(port, 'port closed'));
    port.on('error', () => {
      if (this.port === port) this.failAllPending('port error');
    });
    try {
      // DTR toggle resets the ESP32; wait for the firmware to boot.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const diagnose = await this.request('diagnose_hardware', 3000);
      if (diagnose.ok) {
        return { ok: true as const, diagnoseOk: true as const, diagnoseData: diagnose.data };
      }
      // Legacy firmware (pre-diagnostics) answers read_distance but not
      // diagnose_hardware. Distinguish that from plain silence.
      const legacyRead = await this.request('read_distance', 3000);
      if (!legacyRead.ok && (diagnose.error ?? '').includes('timeout')) {
        return { ok: false as const, error: diagnose.error ?? 'no valid response' };
      }
      return {
        ok: true as const,
        diagnoseOk: false as const,
        diagnoseError: diagnose.error,
        legacyReadOk: legacyRead.ok,
        legacyDeviceMs: typeof legacyRead.data?.deviceMs === 'number'
      };
    } finally {
      await this.disconnectExclusive();
    }
  }

  /** Probe every listed port sequentially; stop at the first identified device. */
  autoDetect() {
    return this.enqueue(async () => {
      const listed = await this.listPorts();
      if (!listed.ok || !('ports' in listed) || !listed.ports) {
        return { ok: false as const, error: 'error' in listed && listed.error ? listed.error : 'list ports failed' };
      }
      const results: Array<Record<string, unknown>> = [];
      for (const port of listed.ports) {
        const probe = await this.probeExclusive(port.path);
        results.push({ path: port.path, label: port.label, ...probe });
        if ('diagnoseOk' in probe && probe.diagnoseOk === true) break;
      }
      return { ok: true as const, results };
    });
  }

  private async disconnectExclusive() {
    this.failAllPending('disconnected');
    const port = this.port;
    this.port = null;
    this.connectedPortPath = null;
    this.diagnoseData = null;
    this.buffer = '';
    if (port && port.isOpen) {
      await new Promise<void>((resolve) => {
        port.close(() => resolve());
      });
    }
    return { ok: true };
  }

  private handlePortClosed(port: SerialPortInstanceLike, reason: string) {
    // Events from a previously disconnected port must never tear down a newer
    // connection or reject that connection's pending requests.
    if (this.port !== port) return;
    this.port = null;
    this.buffer = '';
    this.failAllPending(reason);
  }

  private request(cmd: string, timeoutMs: number) {
    return new Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>((resolve) => {
      const port = this.port;
      if (!port || !port.isOpen) {
        resolve({ ok: false, error: 'hardware offline: not connected' });
        return;
      }
      const id = `ui-${Date.now()}-${this.requestSeq += 1}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `device response timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      port.write(`${JSON.stringify({ id, cmd })}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve({ ok: false, error: `serial write failed: ${error.message}` });
        }
      });
    });
  }

  private handleData(chunk: string) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string) {
    let parsed: { id?: string; ok?: boolean; error?: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // malformed line: matching request will time out honestly
    }
    if (!parsed.id) return;
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(parsed.id);
    entry.resolve({
      ok: parsed.ok === true,
      error: parsed.ok === true ? undefined : parsed.error ?? 'device reported failure',
      data: parsed.data
    });
  }

  private failAllPending(reason: string) {
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
    });
    this.pending.clear();
  }
}

/**
 * REAL EXECUTION service (product path, owner-approved 2026-07-11).
 *
 * Runs the SAME compiled safety chain the CLI demo and the invariant tests
 * run - SafetyMonitor -> HardwareExecutionGate -> Esp32DeviceAdapter ->
 * SerialEsp32Transport - loaded from dist-electron-runtime (built by
 * scripts/build-electron.cjs). No protocol logic is duplicated here and no
 * actuation frame is ever hand-rolled in this file: the gate chain is the
 * only path, so every invariant (blocked => zero frames, ticket enforcement,
 * default-block, honest audit) applies to UI execution identically.
 *
 * LOCK: execution stays disabled (real_execution_locked) until the
 * four-scenario acceptance evidence exists in docs/acceptance/evidence/
 * (>= 4 .json files) or ORS_REAL_EXECUTION=enabled is set explicitly for
 * bench work. Every call additionally requires confirm:true from the UI.
 */
const APP_ROOT = path.join(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(APP_ROOT, 'docs', 'acceptance', 'evidence');
const PACKAGED_APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : APP_ROOT;
const FIRMWARE_RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : APP_ROOT;
const RUNTIME_LIB = path.join(PACKAGED_APP_ROOT, 'dist-electron-runtime', 'lib');
const ESPTOOL_RUNTIME_ROOT = path.join(PACKAGED_APP_ROOT, 'dist-electron-runtime');
let firmwareFlashInProgress = false;

interface RuntimeGovernedFirmwareModule {
  governedFirmwareAvailability(sensorInterface: string | null | undefined):
    { available: true } | { available: false; reason: string };
  resolveGovernedFirmwareImage(raw: unknown, rootDir: string):
    | { ok: true; plan: { file: string; sha256: string; version: string; sensorInterface: string; address: number; byteLength: number; bytes: Uint8Array } }
    | { ok: false; code: string; detail: string };
}

interface RuntimeFirmwareTargetAuthority {
  createFirmwareTargetAuthorization(input: {
    authorizationId: string;
    requestedPortPath: unknown;
    listedPorts: ReadonlyArray<{ path: string; manufacturer?: string; serialNumber?: string; vendorId?: string; productId?: string }>;
    request: unknown;
    imageSha256: string;
    nowMs: number;
  }): { ok: true; authorization: FirmwareTargetAuthorization } | { ok: false; code: string; detail: string };
  validateFirmwareTargetAuthorization(input: {
    authorization: FirmwareTargetAuthorization;
    authorizationId: unknown;
    requestedPortPath: unknown;
    listedPorts: ReadonlyArray<{ path: string; manufacturer?: string; serialNumber?: string; vendorId?: string; productId?: string }>;
    request: unknown;
    imageSha256: unknown;
    nowMs: number;
  }): { ok: true } | { ok: false; code: string; detail: string };
}

interface FirmwareTargetAuthorization {
  authorizationId: string;
  target: { portPath: string; label?: string; fingerprint: string };
  requestSha256: string;
  imageSha256: string;
  expiresAtMs: number;
}

const pendingFirmwareAuthorizations = new Map<string, FirmwareTargetAuthorization>();

function storeFirmwareAuthorization(authorization: FirmwareTargetAuthorization) {
  const now = Date.now();
  pendingFirmwareAuthorizations.forEach((existing, id) => {
    if (existing.expiresAtMs < now) pendingFirmwareAuthorizations.delete(id);
  });
  while (pendingFirmwareAuthorizations.size >= 8) {
    const oldest = pendingFirmwareAuthorizations.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingFirmwareAuthorizations.delete(oldest);
  }
  pendingFirmwareAuthorizations.set(authorization.authorizationId, authorization);
}

function consumeFirmwareAuthorization(authorizationId: unknown): FirmwareTargetAuthorization | null {
  if (typeof authorizationId !== 'string') return null;
  const authorization = pendingFirmwareAuthorizations.get(authorizationId) ?? null;
  pendingFirmwareAuthorizations.delete(authorizationId); // one use, including failed/tampered attempts
  return authorization;
}

function loadGovernedFirmware(): RuntimeGovernedFirmwareModule | { error: string } {
  try {
    // Electron consumes the compiled root authority; rootDir prevents a direct
    // lib/ import and keeps checksum/order semantics in one implementation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(RUNTIME_LIB, 'device-onboarding', 'GovernedFirmwareImage')) as RuntimeGovernedFirmwareModule;
  } catch (error) {
    return {
      error: `firmware_authority_unavailable: rebuild the desktop runtime. Underlying: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function loadFirmwareTargetAuthority(): RuntimeFirmwareTargetAuthority | { error: string } {
  try {
    // Same compiled root authority as the CLI/tests; Electron never imports
    // lib/ directly and does not duplicate target-binding policy.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(RUNTIME_LIB, 'device-onboarding', 'FirmwareTargetAuthorization')) as RuntimeFirmwareTargetAuthority;
  } catch (error) {
    return {
      error: `firmware_target_authority_unavailable: rebuild the desktop runtime. Underlying: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function connectedSensorInterface() {
  const value = connection.connectedContext().diagnoseData?.sensorInterface;
  return typeof value === 'string' ? value : null;
}

async function firmwarePlan(payload: { portPath?: unknown; request?: unknown }) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid_firmware_request: object payload required' };
  const context = connection.connectedContext();
  if (typeof payload.portPath !== 'string' || payload.portPath.length === 0) return { ok: false, error: 'invalid_target_port: select a currently listed serial port' };
  const runtime = loadGovernedFirmware();
  if ('error' in runtime) return { ok: false, error: runtime.error };
  const availability = runtime.governedFirmwareAvailability(context.portPath === payload.portPath ? connectedSensorInterface() : null);
  if (!availability.available) return { ok: false, unavailable: true, error: availability.reason };
  const resolved = runtime.resolveGovernedFirmwareImage(payload.request, FIRMWARE_RESOURCE_ROOT);
  if (!resolved.ok) return { ok: false, error: `${resolved.code}: ${resolved.detail}` };
  const listed = await connection.listPortDescriptors();
  if (!listed.ok) return { ok: false, error: `firmware_target_list_failed: ${listed.error}` };
  const targetAuthority = loadFirmwareTargetAuthority();
  if ('error' in targetAuthority) return { ok: false, error: targetAuthority.error };
  const authorized = targetAuthority.createFirmwareTargetAuthorization({
    authorizationId: randomUUID(),
    requestedPortPath: payload.portPath,
    listedPorts: listed.ports,
    request: payload.request,
    imageSha256: resolved.plan.sha256,
    nowMs: Date.now()
  });
  if (!authorized.ok) return { ok: false, error: `${authorized.code}: ${authorized.detail}` };
  storeFirmwareAuthorization(authorized.authorization);
  const { bytes: _bytes, ...publicPlan } = resolved.plan;
  return {
    ok: true,
    plan: {
      ...publicPlan,
      authorizationId: authorized.authorization.authorizationId,
      targetPort: authorized.authorization.target.portPath,
      targetLabel: authorized.authorization.target.label,
      expiresAtMs: authorized.authorization.expiresAtMs
    }
  };
}

async function flashGovernedFirmware(payload: {
  portPath?: unknown;
  request?: unknown;
  confirm?: unknown;
  expectedSha256?: unknown;
  authorizationId?: unknown;
}) {
  if (firmwareFlashInProgress) return { ok: false, error: 'firmware_flash_in_progress: wait for the current operation to finish' };
  if (payload?.confirm !== true) return { ok: false, error: 'firmware_confirmation_required: explicitly confirm the displayed target, version, and sha256' };
  const authorization = consumeFirmwareAuthorization(payload.authorizationId);
  if (!authorization) return { ok: false, error: 'firmware_authorization_required: prepare and review the firmware plan first' };
  firmwareFlashInProgress = true;
  let flashAttempted = false;
  try {
    const listed = await connection.listPortDescriptors();
    if (!listed.ok) return { ok: false, error: `firmware_target_list_failed: ${listed.error}` };
    const targetAuthority = loadFirmwareTargetAuthority();
    if ('error' in targetAuthority) return { ok: false, error: targetAuthority.error };
    const targetCheck = targetAuthority.validateFirmwareTargetAuthorization({
      authorization,
      authorizationId: payload.authorizationId,
      requestedPortPath: payload.portPath,
      listedPorts: listed.ports,
      request: payload.request,
      imageSha256: payload.expectedSha256,
      nowMs: Date.now()
    });
    if (!targetCheck.ok) return { ok: false, error: `${targetCheck.code}: ${targetCheck.detail}` };
    const runtime = loadGovernedFirmware();
    if ('error' in runtime) return { ok: false, error: runtime.error };
    const resolved = runtime.resolveGovernedFirmwareImage(payload.request, FIRMWARE_RESOURCE_ROOT);
    if (!resolved.ok) return { ok: false, error: `${resolved.code}: ${resolved.detail}` };
    if (resolved.plan.sha256 !== payload.expectedSha256) {
      return { ok: false, error: 'firmware_plan_changed: verified image changed after preview; flashing refused' };
    }

    const portPath = authorization.target.portPath;
    await connection.disconnect();
    flashAttempted = true;
    const flashed = await flashWithEsptoolJs({
      runtimeRoot: ESPTOOL_RUNTIME_ROOT,
      portPath,
      bytes: resolved.plan.bytes,
      address: resolved.plan.address
    });
    const reconnected = await connection.connect(portPath);
    if (!reconnected.ok) {
      return {
        ok: false,
        flashed: true,
        reconnected: false,
        error: `flash completed, but automatic reconnect/diagnose failed: ${reconnected.error ?? 'unknown reconnect failure'}`
      };
    }
    const diagnosedVersion = reconnected.diagnoseData?.firmwareVersion;
    if (reconnected.diagnoseOk !== true || diagnosedVersion !== resolved.plan.version) {
      return {
        ok: false,
        flashed: true,
        reconnected: true,
        diagnoseData: reconnected.diagnoseData,
        error: `flash completed, but diagnose did not verify firmware v${resolved.plan.version}; reported ${typeof diagnosedVersion === 'string' ? diagnosedVersion : 'unknown'}`
      };
    }
    return {
      ok: true,
      flashed: true,
      reconnected: true,
      chip: flashed.chip,
      version: resolved.plan.version,
      sha256: resolved.plan.sha256,
      distanceCm: reconnected.distanceCm,
      diagnoseData: reconnected.diagnoseData
    };
  } catch (error) {
    return {
      ok: false,
      flashCompleted: false,
      hardwareState: flashAttempted ? 'unknown_or_incomplete_after_failed_flash' : 'not_written',
      reconnected: false,
      error: `${flashAttempted ? 'flash' : 'firmware preparation'} failed without retry: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    firmwareFlashInProgress = false;
  }
}

function evidenceCount(): number {
  try {
    return fs.readdirSync(EVIDENCE_DIR).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function executionLock(): { locked: boolean; reason?: string; evidenceCount: number } {
  const count = evidenceCount();
  if (process.env.ORS_REAL_EXECUTION === 'enabled') {
    return { locked: false, evidenceCount: count };
  }
  if (count >= 4) return { locked: false, evidenceCount: count };
  return {
    locked: true,
    evidenceCount: count,
    reason: `real_execution_locked: four-scenario acceptance evidence required (${count}/4 json files in docs/acceptance/evidence/). Run the acceptance per docs/acceptance/OPERATOR_CARD.md, or set ORS_REAL_EXECUTION=enabled for supervised bench work.`
  };
}

interface RuntimeHardwareModule {
  createNodeSerialPort(portPath: string, baudRate?: number): unknown;
  SerialEsp32Transport: new (port: unknown, options: { requestTimeoutMs: number }) => {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
  Esp32DeviceAdapter: new (transport: unknown) => {
    readDistance(sensorId?: string): Promise<unknown | null>;
    readDistanceDetailed(sensorId?: string): Promise<{ reading: unknown | null; error?: string }>;
  };
  HardwareExecutionGate: new (adapter: unknown) => {
    run(request: unknown): Promise<{
      status: 'executed' | 'failed' | 'blocked';
      reason: string;
      executionMode: string;
      result: {
        ok: boolean;
        signalSent: boolean;
        signalState: 'not_sent' | 'attempted_unconfirmed' | 'device_acknowledged';
        executionEvidence: string;
        physicalOutcomeVerified?: boolean;
        detail: string;
      };
    }>;
    getAuditLog(): { list(): unknown[] };
  };
  DistanceSensorPollingService: new (adapter: unknown, options: { intervalMs: number; sampleWindow: number }) => {
    pollOnce(): Promise<{
      generation: number;
      state: string;
      readings: Array<{ value: number }>;
      lastError?: string;
    }>;
    snapshot(): { readings: Array<{ value: number }>; lastError?: string };
    stop(): void;
  };
  HardwareActionSequenceRunner: new (gate: unknown, sensors: unknown) => {
    run(commands: unknown[]): Promise<{
      status: string;
      reason: string;
      completedSteps: number;
      steps: Array<{
        command: { args: { angle?: unknown } };
        outcome: {
          status: 'executed' | 'failed' | 'blocked';
          reason: string;
          executionMode: string;
          result: {
            ok: boolean;
            signalSent: boolean;
            signalState: 'not_sent' | 'attempted_unconfirmed' | 'device_acknowledged';
            executionEvidence: string;
            physicalOutcomeVerified?: boolean;
            detail: string;
          };
        };
      }>;
    }>;
  };
  REAL_SERVO_TEACH_DEVICE_META: unknown;
  REAL_TEACH_BUILTIN_INTENT_IDS: ReadonlySet<string>;
  hardwareCommandsFromTeachTaskDsl(taskDsl: unknown, idPrefix?: string):
    { ok: true; commands: unknown[] } | { ok: false; detail: string };
}

interface RuntimeActionManifestModule {
  validateActionManifest(raw: unknown, deviceMeta: unknown, builtinIntentIds: ReadonlySet<string>):
    { ok: true; manifest: unknown } | { ok: false; code: string; detail: string };
  expandManifestToTaskDsl(manifest: unknown, deviceMeta: unknown, prompt: string):
    { ok: true; taskDsl: unknown } | { ok: false; code: string; detail: string };
}

function loadRuntimeHardware(): RuntimeHardwareModule | { error: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(RUNTIME_LIB, 'hardware')) as RuntimeHardwareModule;
  } catch (error) {
    return {
      error: 'runtime_chain_unavailable: compiled safety chain missing. Rebuild the desktop app (npm run desktop:dev / node scripts/build-electron.cjs). '
        + `Underlying: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function loadRuntimeActionManifest(): RuntimeActionManifestModule | { error: string } {
  try {
    // Electron consumes the root build output; it never imports lib/ across
    // the electron tsconfig rootDir and never copies validator semantics.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(RUNTIME_LIB, 'action-manifest', 'ActionManifest')) as RuntimeActionManifestModule;
  } catch (error) {
    return {
      error: 'runtime_manifest_unavailable: compiled Action Manifest authority missing. Rebuild the desktop app. '
        + `Underlying: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function executeRealAngle(payload: { portPath?: string; angle?: number; manifest?: unknown; confirm?: boolean }) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid_execution_request: object payload required' };
  if (firmwareFlashInProgress) return { ok: false, error: 'firmware_flash_in_progress: actuation is blocked while firmware is being written' };
  const lock = executionLock();
  if (lock.locked) return { ok: false, error: lock.reason };
  if (payload.confirm !== true) {
    return { ok: false, error: 'confirmation_required: the UI must submit an explicit operator confirmation' };
  }
  const hasAngle = Object.prototype.hasOwnProperty.call(payload, 'angle');
  const hasManifest = Object.prototype.hasOwnProperty.call(payload, 'manifest');
  if (hasAngle === hasManifest) return { ok: false, error: 'invalid_execution_request: provide exactly one angle or manifest' };
  const portPath = payload.portPath;
  if (typeof portPath !== 'string' || portPath.trim().length === 0) {
    return { ok: false, error: 'invalid serial port path' };
  }
  const runtime = loadRuntimeHardware();
  if ('error' in runtime) return { ok: false, error: runtime.error };
  let commands: unknown[];
  let replay = false;
  if (hasAngle) {
    const angle = payload.angle;
    if (typeof angle !== 'number' || !Number.isFinite(angle)) {
      return { ok: false, error: 'invalid_angle: numeric angle required' };
    }
    commands = [{
      id: `ui-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: 'esp32-servo-rig',
      capabilityId: 'move_to_angle',
      args: { angle }
    }];
  } else {
    const actionRuntime = loadRuntimeActionManifest();
    if ('error' in actionRuntime) return { ok: false, error: actionRuntime.error };
    const checked = actionRuntime.validateActionManifest(
      payload.manifest,
      runtime.REAL_SERVO_TEACH_DEVICE_META,
      runtime.REAL_TEACH_BUILTIN_INTENT_IDS
    );
    if (!checked.ok) return { ok: false, error: `manifest_rejected:${checked.code}:${checked.detail}` };
    const expanded = actionRuntime.expandManifestToTaskDsl(checked.manifest, runtime.REAL_SERVO_TEACH_DEVICE_META, 'REAL jog-teach replay');
    if (!expanded.ok) return { ok: false, error: `manifest_expansion_rejected:${expanded.code}:${expanded.detail}` };
    const mapped = runtime.hardwareCommandsFromTeachTaskDsl(expanded.taskDsl, `teach-replay-${Date.now()}`);
    if (!mapped.ok) return { ok: false, error: `manifest_command_mapping_rejected:${mapped.detail}` };
    commands = mapped.commands;
    replay = true;
  }

  // The panel's read-only client must release the port before the real chain
  // opens it; the UI reconnects afterwards.
  await connection.disconnect();

  const transport = new runtime.SerialEsp32Transport(runtime.createNodeSerialPort(portPath, 115200), { requestTimeoutMs: 3000 });
  try {
    await transport.connect();
  } catch (error) {
    return { ok: false, error: `open failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    // ESP32 reboots on DTR toggle; wait for the firmware prompt window.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const adapter = new runtime.Esp32DeviceAdapter(transport);
    const gate = new runtime.HardwareExecutionGate(adapter);
    const sensors = new runtime.DistanceSensorPollingService(adapter, {
      intervalMs: 250,
      sampleWindow: 5
    });
    const readErrors: string[] = [];
    // Pre-warm the conditioning window. A failure clears prior evidence in the
    // polling service; it is never replaced with a cached last-good reading.
    for (let index = 0; index < 4; index += 1) {
      const evidence = await sensors.pollOnce();
      if (evidence.lastError) readErrors.push(evidence.lastError);
    }
    const runner = new runtime.HardwareActionSequenceRunner(gate, sensors);
    const sequence = await runner.run(commands);
    const outcome = sequence.steps[sequence.steps.length - 1]?.outcome;
    const sentSteps = sequence.steps.filter((step) => step.outcome.result.signalSent);
    const latestSentOutcome = sentSteps[sentSteps.length - 1]?.outcome;
    const acknowledgedSteps = sequence.steps.filter((step) => step.outcome.status === 'executed'
      && step.outcome.result.signalState === 'device_acknowledged');
    const lastAcknowledgedAngle = acknowledgedSteps[acknowledgedSteps.length - 1]?.command.args.angle;
    const latestEvidence = sensors.snapshot();
    if (latestEvidence.lastError) readErrors.push(latestEvidence.lastError);
    sensors.stop();
    if (!outcome) {
      return {
        ok: false,
        error: `execution sequence rejected: ${sequence.reason}`,
        executionMode: 'real_hardware',
        signalSent: false,
        signalState: 'not_sent',
        readErrors
      };
    }
    return {
      ok: sequence.status === 'completed',
      status: sequence.status === 'completed' ? 'executed' : outcome.status,
      reason: replay ? sequence.reason : outcome.reason,
      executionMode: outcome.executionMode,
      signalSent: sentSteps.length > 0,
      signalState: latestSentOutcome?.result.signalState ?? outcome.result.signalState,
      executionEvidence: latestSentOutcome?.result.executionEvidence ?? outcome.result.executionEvidence,
      physicalOutcomeVerified: outcome.result.physicalOutcomeVerified,
      detail: outcome.result.detail,
      distanceCm: latestEvidence.readings[0]?.value,
      lastAcknowledgedAngle: typeof lastAcknowledgedAngle === 'number' ? lastAcknowledgedAngle : undefined,
      sequenceStatus: sequence.status,
      completedSteps: sequence.completedSteps,
      attemptedSteps: sequence.steps.length,
      readErrors,
      audit: gate.getAuditLog().list()
    };
  } catch (error) {
    return { ok: false, error: `execution failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

const connection = new HardwareConnection();

export function registerHardwareIpc() {
  ipcMain.handle('hardware:listPorts', () => connection.listPorts());
  ipcMain.handle('hardware:connect', (_event, payload: { portPath: string }) =>
    connection.connect(payload.portPath));
  ipcMain.handle('hardware:readDistance', () => connection.readDistance());
  ipcMain.handle('hardware:disconnect', () => connection.disconnect());
  ipcMain.handle('hardware:probe', (_event, payload: { portPath: string }) =>
    connection.probe(payload.portPath));
  ipcMain.handle('hardware:autoDetect', () => connection.autoDetect());
  ipcMain.handle('hardware:executionStatus', () => executionLock());
  ipcMain.handle('hardware:firmwarePlan', (_event, payload: { portPath?: unknown; request?: unknown }) =>
    firmwarePlan(payload));
  ipcMain.handle('hardware:flashFirmware', (_event, payload: { portPath?: unknown; request?: unknown; confirm?: unknown; expectedSha256?: unknown; authorizationId?: unknown }) =>
    flashGovernedFirmware(payload));
  ipcMain.handle('hardware:execute', (_event, payload: { portPath?: string; angle?: number; manifest?: unknown; confirm?: boolean }) =>
    executeRealAngle(payload));
}
