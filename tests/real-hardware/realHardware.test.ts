/**
 * Safety invariant tests for the real-hardware execution path.
 *
 * These are behavioral spy/mock tests, not documentation checks:
 * - blocked command  => adapter.execute() call count === 0 AND zero frames on the wire
 * - sensor missing / stale / invalid => actuation blocked (default-block)
 * - distance below minSafeDistance   => actuation blocked
 * - transport offline => signalSent:false + "hardware offline", never fake success
 * - every audit entry carries an explicit hardwareSignalSent boolean
 */
import { Esp32DeviceAdapter, ESP32_SERVO_RIG_CAPABILITIES } from '../../lib/hardware/Esp32DeviceAdapter';
import { HardwareExecutionGate } from '../../lib/hardware/HardwareExecutionGate';
import { HardwareActionSequenceRunner } from '../../lib/hardware/HardwareActionSequenceRunner';
import { REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS, buildTeachManifest, hardwareCommandsFromTeachTaskDsl, waypointAfterJog } from '../../lib/hardware/TeachMode';
import { parseRealNaturalCommand } from '../../lib/hardware/RealCommandParser';
import { validateActionManifest } from '../../lib/action-manifest/ActionManifest';
import type { TaskDSL } from '../../types/taskDsl';
import { visibleRealHardwareTelemetry } from '../../lib/hardware/RealHardwareTelemetry';
import { DistanceSensorPollingService } from '../../lib/hardware/SensorPollingService';
import type { SensorReadResult } from '../../lib/hardware/SensorPollingService';
// Tests are a sanctioned importer of the gate-private ticket: they verify the
// structural single-path contract itself (audit 1.1).
import { ACTUATION_TICKET, isActuationCommand } from '../../lib/hardware/internal/actuation';
import type { ActuationTicket } from '../../lib/hardware/internal/actuation';
import { TransportFrameRejectedError, TransportOfflineError } from '../../lib/hardware/RealDeviceTransport';
import type { RealDeviceTransport } from '../../lib/hardware/RealDeviceTransport';
import { SerialEsp32Transport } from '../../lib/hardware/SerialEsp32Transport';
import type { SerialPortLike } from '../../lib/hardware/SerialEsp32Transport';
import type {
  HardwareCommand,
  SensorReading,
  TransportFrame,
  TransportResponse
} from '../../lib/hardware/types';
import { RuntimeAuditLog } from '../../lib/runtime/RuntimeAuditLog';
import { SafetyMonitor } from '../../lib/runtime/SafetyMonitor';
import { mkdtempSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REAL_EXECUTION_RELEASE_APPROVAL, verifyRealExecutionReleaseApproval } from '../../lib/hardware/RealExecutionReleaseApproval';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

/** Transport spy: records every frame that would reach the wire. */
class FakeTransport implements RealDeviceTransport {
  sentFrames: TransportFrame[] = [];
  private connected = false;

  constructor(private readonly respond: (frame: TransportFrame) => TransportResponse = (frame) => ({
    id: frame.id,
    ok: true,
    data: frame.cmd === 'read_distance' ? { distanceCm: 42 } : { angle: frame.args?.angle }
  })) {}

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  isConnected() { return this.connected; }

  async send(frame: TransportFrame): Promise<TransportResponse> {
    // Mirror the real transport contract (audit 1.1): plain send() refuses
    // actuation frames, so a spy can never under-report wire traffic.
    if (isActuationCommand(frame.cmd)) {
      throw new Error(`actuation_requires_gate: ${frame.cmd}`);
    }
    return this.dispatch(frame);
  }

  async sendActuation(frame: TransportFrame, ticket: ActuationTicket): Promise<TransportResponse> {
    if (ticket !== ACTUATION_TICKET) {
      throw new Error('invalid_actuation_ticket');
    }
    return this.dispatch(frame);
  }

  private async dispatch(frame: TransportFrame): Promise<TransportResponse> {
    if (!this.connected) throw new TransportOfflineError();
    this.sentFrames.push(frame);
    return this.respond(frame);
  }
}

/** Adapter spy: counts every execute() invocation. */
class SpyAdapter extends Esp32DeviceAdapter {
  executeCalls = 0;
  async execute(command: HardwareCommand, ticket: ActuationTicket) {
    this.executeCalls += 1;
    return super.execute(command, ticket);
  }
}

const NOW = 1_750_000_000_000;

// Interlock requirements now live authoritatively in ESP32_SERVO_RIG_CAPABILITIES
// (audit 2.1): hc-sr04, maxAgeMs 1500, plausible 2..400, baseline minSafe 10.
// Tests therefore pass readings (and, where relevant, tightening overrides)
// but never assemble the interlock policy themselves.

const DEVICE_MS = 500_000; // ESP32 millis() baseline for tests

function reading(value: number, ageMs = 0, deviceMs: number = DEVICE_MS): SensorReading {
  return {
    sensorId: 'hc-sr04',
    capabilityId: 'read_distance',
    value,
    unit: 'cm',
    timestampMs: NOW - ageMs,
    deviceTimestampMs: deviceMs
  };
}

// A reading from legacy firmware that does not report a device-side timestamp.
function readingNoDeviceTs(value: number, ageMs = 0): SensorReading {
  return {
    sensorId: 'hc-sr04',
    capabilityId: 'read_distance',
    value,
    unit: 'cm',
    timestampMs: NOW - ageMs
    // deviceTimestampMs intentionally omitted
  };
}

function servoCommand(angle: number): HardwareCommand {
  return {
    id: `cmd-${angle}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: 'esp32-servo-rig',
    capabilityId: 'move_to_angle',
    args: { angle }
  };
}

function buildGate(transport: FakeTransport) {
  const adapter = new SpyAdapter(transport, ESP32_SERVO_RIG_CAPABILITIES);
  const audit = new RuntimeAuditLog();
  const gate = new HardwareExecutionGate(adapter, new SafetyMonitor(), audit);
  return { adapter, audit, gate };
}

async function testBlockedNeverReachesHardware() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, audit, gate } = buildGate(transport);

  // Out-of-range angle (limit is 0..180) with perfectly healthy sensors.
  const outcome = await gate.run({
    command: servoCommand(200),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'angle 200 must be blocked');
  assert(adapter.executeCalls === 0, 'blocked command must NOT invoke adapter.execute() (call count must be 0)');
  assert(transport.sentFrames.length === 0, 'blocked command must put zero frames on the wire');
  assert(outcome.result.signalSent === false, 'blocked outcome must report signalSent=false');

  const entries = audit.list();
  const blockedEntry = entries.find((entry) => entry.code === 'hardware_command_blocked');
  assert(blockedEntry, 'block decision must be written to the audit log');
  assert(blockedEntry.hardwareSignalSent === false, 'blocked audit entry must have hardwareSignalSent=false');

  // Negative angle must also be blocked without reaching hardware.
  const negative = await gate.run({
    command: servoCommand(-5),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  assert(negative.status === 'blocked', 'angle -5 must be blocked');
  assert(adapter.executeCalls === 0, 'adapter.execute() call count must stay 0 after second blocked command');
}

async function testSensorMissingDefaultBlocks() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [], // no data at all
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'missing sensor data must default-block actuation');
  assert(outcome.reason.indexOf('sensor_missing') === 0, `reason must be sensor_missing, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'missing-sensor block must not reach adapter.execute()');
}

async function testDistanceReadPreservesDeviceError() {
  const transport = new FakeTransport((frame) => ({
    id: frame.id,
    ok: false,
    detail: 'no echo (sensor disconnected or out of range)'
  }));
  await transport.connect();
  const adapter = new Esp32DeviceAdapter(transport, ESP32_SERVO_RIG_CAPABILITIES);

  const detailed = await adapter.readDistanceDetailed('hc-sr04');
  assert(detailed.reading === null, 'failed sensor read must not fabricate a reading');
  assert(
    detailed.error === 'no echo (sensor disconnected or out of range)',
    `device sensor failure detail must be preserved, got: ${detailed.error}`
  );
  assert(await adapter.readDistance('hc-sr04') === null, 'legacy readDistance API must remain fail-closed');
}

async function testSensorStaleDefaultBlocks() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100, 5000)], // 5s old, maxAgeMs=1000
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'stale sensor data must default-block actuation');
  assert(outcome.reason.indexOf('sensor_stale') === 0, `reason must be sensor_stale, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'stale-sensor block must not reach adapter.execute()');
}

async function testSensorInvalidDefaultBlocks() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  for (const badValue of [9999, 0.5, NaN]) {
    const outcome = await gate.run({
      command: servoCommand(45),
      capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
      sensorReadings: [reading(badValue)],
        nowMs: NOW
    });
    assert(outcome.status === 'blocked', `implausible sensor value ${badValue} must default-block actuation`);
    assert(outcome.reason.indexOf('sensor_invalid') === 0, `reason must be sensor_invalid, got: ${outcome.reason}`);
  }
  assert(adapter.executeCalls === 0, 'invalid-sensor blocks must not reach adapter.execute()');
}

async function testMinSafeDistanceInterlock() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  // Legal angle, fresh + plausible reading, but obstacle too close (5cm < 10cm).
  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(5)],
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'distance below minSafeDistance must block actuation');
  assert(
    outcome.reason.indexOf('min_safe_distance_violation') === 0,
    `reason must be min_safe_distance_violation, got: ${outcome.reason}`
  );
  assert(adapter.executeCalls === 0, 'min-safe-distance block must not reach adapter.execute()');
}

async function testOfflineTransportNeverFakesSuccess() {
  const transport = new FakeTransport();
  // NOT connected on purpose.
  const { adapter, audit, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });

  assert(outcome.status === 'failed', 'offline hardware must fail, not fake success');
  assert(outcome.result.ok === false, 'offline result.ok must be false');
  assert(outcome.result.signalSent === false, 'offline result.signalSent must be false');
  assert(outcome.result.signalState === 'not_sent', 'offline result must prove signalState=not_sent');
  assert(outcome.result.detail === 'hardware offline', `offline detail must be "hardware offline", got: ${outcome.result.detail}`);
  assert(adapter.executeCalls === 1, 'allowed command reaches the adapter, which then reports offline honestly');
  assert(transport.sentFrames.length === 0, 'offline transport must not record any sent frame');

  const failedEntry = audit.list().find((entry) => entry.code === 'hardware_command_failed');
  assert(failedEntry, 'offline failure must be audited');
  assert(failedEntry.hardwareSignalSent === false, 'offline audit entry must have hardwareSignalSent=false');
  assert(failedEntry.hardwareSignalState === 'not_sent', 'offline audit entry must carry signalState=not_sent');
}

async function testAllowedCommandExecutesAndAudits() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, audit, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });

  assert(outcome.status === 'executed', 'legal command with healthy sensors must execute');
  assert(outcome.executionMode === 'real_hardware', 'outcome must be labeled real_hardware');
  assert(outcome.result.signalSent === true, 'executed result must report signalSent=true');
  assert(outcome.result.signalState === 'device_acknowledged', 'executed result must require a matching device acknowledgement');
  assert(outcome.result.executionEvidence === 'command_acknowledged_open_loop', 'servo success proves command acknowledgement, not physical arrival');
  assert(outcome.result.physicalOutcomeVerified === false, 'open-loop servo outcome must never claim physical verification');
  assert(adapter.executeCalls === 1, 'allowed command must invoke adapter.execute() exactly once');
  assert(transport.sentFrames.length === 1, 'exactly one frame must reach the wire');
  assert(transport.sentFrames[0].cmd === 'move_to_angle', 'wire frame must carry move_to_angle');
  assert(transport.sentFrames[0].args?.angle === 45, 'wire frame must carry angle=45');

  const executedEntry = audit.list().find((entry) => entry.code === 'hardware_command_executed');
  assert(executedEntry, 'executed decision must be audited');
  assert(executedEntry.hardwareSignalSent === true, 'executed audit entry must have hardwareSignalSent=true');
  assert(executedEntry.hardwareSignalState === 'device_acknowledged', 'executed audit entry must preserve device acknowledgement evidence');
  assert(executedEntry.data?.executionEvidence === 'command_acknowledged_open_loop', 'audit must label SG90 acknowledgement as open-loop');
  assert(executedEntry.data?.physicalOutcomeVerified === false, 'audit must explicitly deny physical outcome verification');
}

async function testAttemptedDeliveryIsNotReportedAsAcknowledged() {
  const transport = new FakeTransport(() => {
    throw new Error('device response timeout after write attempt');
  });
  await transport.connect();
  const { audit, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    sensorReadings: [reading(100)],
    nowMs: NOW
  });

  assert(outcome.status === 'failed', 'unconfirmed delivery must fail, never execute');
  assert(outcome.result.signalSent === true, 'compatibility boolean stays conservative after a send attempt');
  assert(outcome.result.signalState === 'attempted_unconfirmed', 'send attempt without response must not be called acknowledged');
  assert(outcome.result.executionEvidence === 'delivery_unconfirmed', 'execution evidence must say delivery_unconfirmed');
  assert(outcome.result.physicalOutcomeVerified === false, 'unconfirmed delivery cannot verify physical outcome');
  assert(transport.sentFrames.length === 1, 'test must exercise the after-dispatch ambiguity, not a pre-wire rejection');

  const failedEntry = audit.list().find((entry) => entry.code === 'hardware_command_failed');
  assert(failedEntry?.hardwareSignalSent === true, 'ambiguous send must stay conservatively true in legacy audit flag');
  assert(failedEntry?.hardwareSignalState === 'attempted_unconfirmed', 'audit must preserve attempted_unconfirmed precision');
  assert(failedEntry?.data?.executionEvidence === 'delivery_unconfirmed', 'audit must not claim execution for unconfirmed delivery');
}

async function testReadsAllowedWhileActuationLockedOut() {
  const transport = new FakeTransport();
  await transport.connect();
  const { gate } = buildGate(transport);

  // Sensor data missing: actuation is locked out, but a read_distance command
  // (non-actuation) may pass so the operator can re-establish observability.
  const outcome = await gate.run({
    command: {
      id: 'read-1',
      deviceId: 'esp32-servo-rig',
      capabilityId: 'read_distance',
      args: {}
    },
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [],
    nowMs: NOW
  });

  assert(outcome.status === 'executed', 'read_distance must stay available while actuation is locked out');
}

async function testUnsupportedCapabilityFailsLoudly() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: {
      id: 'bogus-1',
      deviceId: 'esp32-servo-rig',
      capabilityId: 'launch_rocket' as never,
      args: {}
    },
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'unsupported capability must be blocked, never guessed');
  assert(outcome.reason.indexOf('unsupported_capability') === 0, 'reason must name the unsupported capability');
  assert(adapter.executeCalls === 0, 'unsupported capability must not reach adapter.execute()');
  assert(transport.sentFrames.length === 0, 'unsupported capability must put zero frames on the wire');
}

async function testEveryAuditEntryCarriesHardwareSignalSent() {
  const transport = new FakeTransport();
  await transport.connect();
  const { audit, gate } = buildGate(transport);

  await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  await gate.run({
    command: servoCommand(200),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  audit.info('input', 'note', 'plain info entry');

  const entries = audit.list();
  assert(entries.length >= 3, 'audit log must contain the recorded entries');
  for (const entry of entries) {
    assert(
      typeof entry.hardwareSignalSent === 'boolean',
      `every audit entry must carry boolean hardwareSignalSent (entry ${entry.code})`
    );
    assert(
      ['not_sent', 'attempted_unconfirmed', 'device_acknowledged'].includes(entry.hardwareSignalState),
      `every audit entry must carry a valid hardwareSignalState (entry ${entry.code})`
    );
    assert(
      entry.hardwareSignalSent === (entry.hardwareSignalState !== 'not_sent'),
      `hardwareSignalSent and hardwareSignalState must agree (entry ${entry.code})`
    );
  }

  const exported = JSON.parse(audit.exportJson()) as Array<Record<string, unknown>>;
  assert(exported.length === entries.length, 'exportJson must contain every entry');
  for (const entry of exported) {
    assert(
      typeof entry.hardwareSignalSent === 'boolean',
      'exported audit entries must carry boolean hardwareSignalSent'
    );
    assert(
      typeof entry.hardwareSignalState === 'string'
        && ['not_sent', 'attempted_unconfirmed', 'device_acknowledged'].includes(entry.hardwareSignalState),
      'exported audit entries must carry hardwareSignalState'
    );
  }

  let rejectedContradiction = false;
  try {
    new RuntimeAuditLog().decision(
      'hardware',
      'error',
      'contradictory_test_entry',
      'must be rejected',
      false,
      'attempted_unconfirmed'
    );
  } catch (error) {
    rejectedContradiction = error instanceof Error
      && error.message.indexOf('invalid_hardware_signal_evidence') === 0;
  }
  assert(rejectedContradiction, 'audit log must reject contradictory boolean and precise signal evidence');
}

/** Fake serial port for SerialEsp32Transport protocol tests. */
class FakeSerialPort implements SerialPortLike {
  written: string[] = [];
  openCalls = 0;
  closeCalls = 0;
  private opened = false;
  private dataListeners: Array<(chunk: string) => void> = [];
  private closeListeners: Array<() => void> = [];
  autoRespond: ((line: string) => string | null) | null = null;

  async open() {
    this.openCalls += 1;
    if (this.opened) throw new Error('port already open');
    this.opened = true;
  }
  async close() {
    this.closeCalls += 1;
    if (!this.opened) throw new Error('port not open');
    this.opened = false;
    this.closeListeners.forEach((listener) => listener());
  }
  async write(chunk: string) {
    if (!this.opened) throw new Error('port not open');
    this.written.push(chunk);
    if (this.autoRespond) {
      const response = this.autoRespond(chunk.trim());
      if (response !== null) {
        // Deliver asynchronously and split across chunks to exercise buffering.
        const mid = Math.floor(response.length / 2);
        setTimeout(() => this.emitData(response.slice(0, mid)), 0);
        setTimeout(() => this.emitData(response.slice(mid)), 1);
      }
    }
  }
  onData(listener: (chunk: string) => void) { this.dataListeners.push(listener); }
  onClose(listener: () => void) { this.closeListeners.push(listener); }
  isOpen() { return this.opened; }
  emitData(chunk: string) { this.dataListeners.forEach((listener) => listener(chunk)); }
}

async function testSerialTransportProtocol() {
  const port = new FakeSerialPort();
  port.autoRespond = (line) => {
    const frame = JSON.parse(line) as TransportFrame;
    return `${JSON.stringify({ id: frame.id, ok: true, data: { angle: frame.args?.angle } })}\n`;
  };
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });

  // Sending before connect must throw offline, not write anything.
  let threw = false;
  try {
    await transport.send({ id: 'x1', cmd: 'read_distance' });
  } catch (error) {
    threw = error instanceof TransportOfflineError;
  }
  assert(threw, 'send before connect must throw TransportOfflineError');
  const writtenBeforeConnect: number = port.written.length;
  assert(writtenBeforeConnect === 0, 'nothing may be written before connect');

  await transport.connect();
  const response = await transport.sendActuation(
    { id: 'x2', cmd: 'move_to_angle', args: { angle: 90 } },
    ACTUATION_TICKET
  );
  assert(response.ok === true, 'serial round-trip must succeed');
  assert(response.id === 'x2', 'response must be matched by id');
  const writtenAfterSend: number = port.written.length;
  assert(writtenAfterSend === 1 && port.written[0].indexOf('"move_to_angle"') >= 0, 'frame must be written as JSON line');

  // Malformed line must be recorded as protocol error, not treated as success.
  port.autoRespond = null;
  const pendingTimeout = transport.send({ id: 'x3', cmd: 'read_distance' }).then(
    () => { throw new Error('timeout expected'); },
    (error: Error) => error
  );
  port.emitData('not-json\n');
  const timeoutError = await pendingTimeout;
  assert(timeoutError.message.indexOf('timeout') >= 0, 'unanswered request must time out');
  assert(
    (transport.getLastProtocolError() ?? '').indexOf('malformed') >= 0,
    'malformed device line must be surfaced as protocol error'
  );

  // Port close must fail pending requests and flip connectivity.
  await transport.disconnect();
  assert(transport.isConnected() === false, 'disconnect must report not connected');

  // Disconnect is idempotent; a second call must not try to close an already
  // closed serial port (real serialport rejects that operation).
  await transport.disconnect();
  assert(port.closeCalls === 1, 'repeated disconnect must close the physical port only once');
}

async function testRawSendRefusesActuationFrames() {
  // Audit 1.1 structural invariant: holding a transport reference is NOT
  // enough to actuate. Plain send() must refuse actuation frames before a
  // single byte reaches the wire.
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });
  await transport.connect();

  const error = await transport
    .send({ id: 'bypass-1', cmd: 'move_to_angle', args: { angle: 45 } })
    .then(
      () => { throw new Error('raw send() must refuse actuation frames'); },
      (err: Error) => err
    );
  assert(
    error.message.indexOf('actuation_requires_gate') === 0,
    `refusal must be explicit actuation_requires_gate, got: ${error.message}`
  );
  assert(port.written.length === 0, 'refused actuation frame must put zero bytes on the wire');

  // A forged ticket must be refused by sendActuation as well.
  const forged = await transport
    .sendActuation(
      { id: 'bypass-2', cmd: 'move_to_angle', args: { angle: 45 } },
      Symbol('forged') as unknown as ActuationTicket
    )
    .then(
      () => { throw new Error('forged ticket must be refused'); },
      (err: Error) => err
    );
  assert(
    forged.message.indexOf('invalid_actuation_ticket') === 0,
    `forged ticket refusal must be explicit, got: ${forged.message}`
  );
  assert(port.written.length === 0, 'forged-ticket frame must put zero bytes on the wire');

  await transport.disconnect();
}

async function testAdapterExecuteRequiresGateTicket() {
  // Audit 1.1 defense-in-depth: even a direct (untyped) adapter.execute call
  // without the gate ticket fails closed with signalSent=false, and the
  // legitimate gate path still works.
  const transport = new FakeTransport();
  await transport.connect();
  const adapter = new Esp32DeviceAdapter(transport, ESP32_SERVO_RIG_CAPABILITIES);

  const rogue = await (adapter.execute as unknown as (
    command: HardwareCommand,
    ticket: unknown
  ) => Promise<{ ok: boolean; signalSent: boolean; detail: string }>)(
    servoCommand(45),
    Symbol('forged')
  );
  assert(rogue.ok === false, 'ticketless execute must fail');
  assert(rogue.signalSent === false, 'ticketless execute must not send any signal');
  assert(
    rogue.detail.indexOf('invalid_actuation_ticket') === 0,
    `ticketless execute must fail with invalid_actuation_ticket, got: ${rogue.detail}`
  );
  assert(transport.sentFrames.length === 0, 'ticketless execute must put zero frames on the wire');

  // Read-only capability stays available without any ticket involvement.
  const distanceReading = await adapter.readDistance('hc-sr04');
  assert(distanceReading !== null && distanceReading.value === 42, 'read path must remain available without a ticket');

  // The sanctioned gate path still actuates.
  const { adapter: gateAdapter, gate } = buildGate(transport);
  void gateAdapter;
  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  assert(outcome.status === 'executed', `gate path must still execute, got: ${outcome.status} (${outcome.reason})`);
}

async function testProtocolErrorSurfacesInFailureDetails() {
  // Audit 3.1: a timeout caused by garbled device output must carry the
  // protocol-level cause in the failure detail, not just "timeout".
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 300 });
  await transport.connect();
  const adapter = new Esp32DeviceAdapter(transport, ESP32_SERVO_RIG_CAPABILITIES);

  const pending = adapter.readDistanceDetailed('hc-sr04');
  port.emitData('not-json\n');
  const detailed = await pending;
  assert(detailed.reading === null, 'garbled response must not produce a reading');
  assert(
    (detailed.error ?? '').indexOf('last protocol error:') >= 0
      && (detailed.error ?? '').indexOf('malformed') >= 0,
    `failure detail must carry the protocol error, got: ${detailed.error}`
  );
  await transport.disconnect();
}

async function testSetupAdvisorClassifications() {
  const { adviceForFailure, interpretProbe } = await import('../../lib/hardware/SetupAdvisor');

  assert(adviceForFailure('Access denied').code === 'port_busy', 'busy port must classify as port_busy');
  assert(adviceForFailure('device response timeout after 3000ms').code === 'no_response', 'timeout must classify as no_response');
  assert(adviceForFailure('serialport_not_installed: ...').code === 'serialport_missing', 'missing serialport must classify');
  assert(adviceForFailure('no echo pulse (sensor disconnected)').code === 'sensor_no_echo', 'no echo must classify');
  assert(adviceForFailure('???').code === 'unknown_failure', 'unknown failures surface verbatim');
  assert(adviceForFailure('???').zh.indexOf('???') >= 0, 'unknown failure advice must include the raw error');

  const ready = interpretProbe({
    diagnoseOk: true,
    diagnoseData: { firmware: 'realitywarden-esp32', firmwareVersion: '0.1.4', protocolVersion: 4, sensorInterface: 'pulse_width', sensorModel: 'HC-SR04-compatible', successfulEchoes: 3, deviceMs: 1234 }
  });
  assert(ready.identity?.firmwareVersion === '0.1.4' && ready.identity.reportsDeviceMs, 'ready probe must yield identity');
  assert(ready.advice.length === 1 && ready.advice[0].code === 'ready', 'healthy device must yield a single ready advice');

  const outdated = interpretProbe({
    diagnoseOk: true,
    diagnoseData: { firmware: 'realitywarden-esp32', firmwareVersion: '0.1.2', sensorInterface: 'pulse_width', successfulEchoes: 3, deviceMs: 5 }
  });
  assert(outdated.advice.some((item) => item.code === 'firmware_outdated'), 'old firmware must advise upgrade');

  const noClock = interpretProbe({
    diagnoseOk: true,
    diagnoseData: { firmware: 'realitywarden-esp32', firmwareVersion: '0.1.4', sensorInterface: 'pulse_width', successfulEchoes: 3 }
  });
  assert(noClock.advice.some((item) => item.code === 'no_device_clock' && item.severity === 'error'), 'missing deviceMs must be an error (gate will block)');

  const legacyNoClock = interpretProbe({ diagnoseOk: false, diagnoseError: 'unsupported cmd', legacyReadOk: true, legacyDeviceMs: false });
  assert(legacyNoClock.identity?.legacy === true, 'unsupported diagnose + working reads = legacy identity');
  assert(legacyNoClock.advice.some((item) => item.code === 'legacy_no_clock' && item.severity === 'error'), 'legacy without clock must demand reflash');

  const deadEcho = interpretProbe({
    diagnoseOk: true,
    diagnoseData: { firmware: 'realitywarden-esp32', firmwareVersion: '0.1.4', sensorInterface: 'pulse_width', successfulEchoes: 0, deviceMs: 5 }
  });
  assert(deadEcho.advice.some((item) => item.code === 'sensor_no_echo'), 'zero echoes must surface sensor wiring advice');

  // 0.1.5 source build with the serial TTL (IOE-SR05) sensor variant is a
  // first-class accepted firmware: no outdated warning, ready when clocked.
  const serialTtlReady = interpretProbe({
    diagnoseOk: true,
    diagnoseData: { firmware: 'realitywarden-esp32', firmwareVersion: '0.1.5', protocolVersion: 4, sensorInterface: 'serial_ttl', sensorModel: 'IOE-SR05', successfulFrames: 3, deviceMs: 42 }
  });
  assert(serialTtlReady.identity?.sensorInterface === 'serial_ttl', 'serial_ttl probe must yield its interface');
  assert(!serialTtlReady.advice.some((item) => item.code === 'firmware_outdated'), '0.1.5 must not be flagged outdated');
  assert(serialTtlReady.advice.length === 1 && serialTtlReady.advice[0].code === 'ready', 'clocked serial_ttl device must be ready');
}

async function testSerialTransportRejectsDuplicatePendingIds() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });
  await transport.connect();

  const first = transport.send({ id: 'duplicate', cmd: 'read_distance' });
  const duplicateError = await transport.send({ id: 'duplicate', cmd: 'read_distance' }).then(
    () => { throw new Error('duplicate id rejection expected'); },
    (error: Error) => error
  );
  assert(duplicateError.message.indexOf('duplicate_request_id') >= 0, 'duplicate pending id must fail loudly');
  assert(port.written.length === 1, 'duplicate pending id must not put a second frame on the wire');

  port.emitData(`${JSON.stringify({ id: 'duplicate', ok: true, data: { distanceCm: 42 } })}\n`);
  const response = await first;
  assert(response.ok === true, 'the original request must retain ownership of its response id');
  await transport.disconnect();
}

async function testSerialTransportSerializesLifecycle() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });

  // Two renderer/runtime callers can race connect(). The physical port must be
  // opened once; a second open on serialport fails with "already open".
  await Promise.all([transport.connect(), transport.connect()]);
  assert(transport.isConnected() === true, 'concurrent connect calls must leave the transport connected');
  assert(port.openCalls === 1, 'concurrent connect calls must open the physical port exactly once');

  // Lifecycle calls are applied in invocation order. Reconnect must wait for
  // the close to finish instead of racing open against an in-progress close.
  await Promise.all([transport.disconnect(), transport.connect()]);
  assert(transport.isConnected() === true, 'disconnect followed by connect must finish connected');
  const closeCallsAfterReconnect: number = port.closeCalls;
  const openCallsAfterReconnect: number = port.openCalls;
  assert(closeCallsAfterReconnect === 1 && openCallsAfterReconnect === 2,
    'ordered reconnect must perform exactly one close and one new open');
  await transport.disconnect();
}

async function testSerialTransportRetiresAmbiguousRequestIds() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 20 });
  await transport.connect();

  const timeout = await transport.send({ id: 'late-id', cmd: 'read_distance' }).then(
    () => { throw new Error('timeout expected'); },
    (error: Error) => error
  );
  assert(timeout.message.indexOf('timeout') >= 0, 'first request must time out');

  const reused = await transport.send({ id: 'late-id', cmd: 'read_distance' }).then(
    () => { throw new Error('retired request id must be rejected'); },
    (error: Error) => error
  );
  assert(reused instanceof TransportFrameRejectedError, 'retired id rejection must be known pre-wire failure');
  assert(reused.message.indexOf('reused_request_id') === 0, 'ambiguous timed-out id must not be reused');
  assert(port.written.length === 1, 'retired id retry must put zero additional frames on the wire');

  // A late response remains unmatched; it can never claim ownership of a new
  // request with the same logical id.
  port.emitData(`${JSON.stringify({ id: 'late-id', ok: true, data: { distanceCm: 42 } })}\n`);
  assert((transport.getLastProtocolError() ?? '').indexOf('unmatched') >= 0, 'late response must be surfaced as unmatched');
  await transport.disconnect();
}

async function testRejectedFramesReportZeroSignal() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });
  await transport.connect();
  const adapter = new Esp32DeviceAdapter(transport, ESP32_SERVO_RIG_CAPABILITIES);
  const gate = new HardwareExecutionGate(adapter, new SafetyMonitor(), new RuntimeAuditLog());

  const emptyId = await gate.run({
    command: { ...servoCommand(45), id: '' },
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  assert(emptyId.status === 'failed', 'invalid request id must fail before the wire');
  assert(emptyId.result.signalSent === false, 'pre-wire id rejection must report signalSent=false');
  assert(port.written.length === 0, 'invalid request id must emit zero bytes');

  const oversized = await gate.run({
    command: { ...servoCommand(45), id: `huge-${'界'.repeat(600)}` },
    sensorReadings: [reading(100)],
    nowMs: NOW
  });
  assert(oversized.status === 'failed', 'frame larger than firmware input buffer must fail locally');
  assert(oversized.reason.indexOf('outgoing_frame_too_large') === 0, 'oversized frame must have an explicit reason');
  assert(oversized.result.signalSent === false, 'oversized pre-wire rejection must report signalSent=false');
  assert(port.written.length === 0, 'oversized request must emit zero bytes');
  await transport.disconnect();
}

async function testSerialTransportClearsPartialDataAcrossReconnect() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });
  await transport.connect();
  port.emitData('{"id":"stale"');
  await transport.disconnect();
  await transport.connect();

  const pending = transport.send({ id: 'fresh', cmd: 'read_distance' });
  port.emitData(`${JSON.stringify({ id: 'fresh', ok: true, data: { distanceCm: 21 } })}\n`);
  const response = await pending;
  assert(response.ok === true, 'partial bytes from a previous connection must not corrupt a fresh response');
  assert(transport.getLastProtocolError() === null, 'reconnect must reset stale protocol errors');
  await transport.disconnect();
}

async function testSerialTransportBoundsMalformedInput() {
  const port = new FakeSerialPort();
  const transport = new SerialEsp32Transport(port, { requestTimeoutMs: 500 });
  await transport.connect();
  const pending = transport.send({ id: 'after-noise', cmd: 'read_distance' });
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  port.emitData('x'.repeat(5000));
  assert((transport.getLastProtocolError() ?? '').indexOf('oversized') >= 0, 'oversized unterminated input must be discarded');

  // This JSON is a suffix of the same oversized physical line, not a new
  // frame. It must be discarded through the newline and cannot resolve the
  // pending request.
  port.emitData(`${JSON.stringify({ id: 'after-noise', ok: true, data: { distanceCm: 18 } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(settled === false, 'suffix of an oversized line must never be parsed as a response');

  // Parser is synchronized after that newline; the next complete line works.
  port.emitData(`${JSON.stringify({ id: 'after-noise', ok: true, data: { distanceCm: 18 } })}\n`);
  assert((await pending).ok === true, 'transport must recover after discarding oversized noise');
  await transport.disconnect();

  for (const requestTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try {
      // eslint-disable-next-line no-new
      new SerialEsp32Transport(new FakeSerialPort(), { requestTimeoutMs });
    } catch {
      threw = true;
    }
    assert(threw, `invalid request timeout ${requestTimeoutMs} must be rejected`);
  }
}

async function testConditioningRejectsNonFiniteValuesAndThresholds() {
  const { DistanceInterlock, MedianFilter } = await import('../../lib/hardware/SensorConditioning');
  const filter = new MedianFilter(3);
  assert(filter.push(Number.POSITIVE_INFINITY) === null, 'median filter must reject +Infinity');
  assert(filter.push(Number.NEGATIVE_INFINITY) === null, 'median filter must reject -Infinity');
  assert(filter.push(10) === 10, 'finite sample remains usable after rejected values');

  for (const options of [
    { lockBelowCm: Number.NEGATIVE_INFINITY, releaseAboveCm: 12 },
    { lockBelowCm: 10, releaseAboveCm: Number.POSITIVE_INFINITY },
    { lockBelowCm: -1, releaseAboveCm: 12 }
  ]) {
    let threw = false;
    try {
      // eslint-disable-next-line no-new
      new DistanceInterlock(options);
    } catch {
      threw = true;
    }
    assert(threw, `invalid distance thresholds must be rejected: ${JSON.stringify(options)}`);
  }

  const interlock = new DistanceInterlock({ lockBelowCm: 10, releaseAboveCm: 12 });
  assert(interlock.update(Number.POSITIVE_INFINITY).locked === true, 'non-finite reading must fail closed');
}

async function testMedianFilterRejectsNoise() {
  const { MedianFilter, buildConservativeMedianReading } = await import('../../lib/hardware/SensorConditioning');
  const filter = new MedianFilter(5);
  assert(filter.median() === null, 'empty filter must report null (fail closed), never a fake value');
  filter.push(100);
  filter.push(101);
  filter.push(3);    // noise spike downward
  filter.push(99);
  const median = filter.push(100);
  assert(median === 100, `median of [100,101,3,99,100] must be 100, got ${median}`);
  filter.push(NaN);
  assert(filter.median() === 100, 'NaN samples must be rejected, not poison the window');

  const conditioned = buildConservativeMedianReading([
    reading(20, 1400, 1000),
    reading(100, 100, 2300),
    reading(21, 50, 2350)
  ]);
  assert(conditioned?.value === 21, 'conditioned reading must use the median sensor value');
  assert(conditioned?.timestampMs === NOW - 1400, 'conditioned reading must preserve the oldest host timestamp');
  assert(conditioned?.deviceTimestampMs === 1000, 'conditioned reading must preserve the oldest device timestamp');
}

async function testDistanceInterlockHysteresis() {
  const { DistanceInterlock } = await import('../../lib/hardware/SensorConditioning');
  const interlock = new DistanceInterlock({ lockBelowCm: 10, releaseAboveCm: 12 });

  let state = interlock.update(20);
  assert(state.locked === false, 'clear distance must not lock');
  assert(state.effectiveMinSafeDistanceCm === 10, 'unlocked threshold must equal lockBelowCm');

  state = interlock.update(9);
  assert(state.locked === true, 'distance below lockBelowCm must lock');
  assert(state.effectiveMinSafeDistanceCm === 12, 'locked threshold must rise to releaseAboveCm');

  state = interlock.update(10.5); // inside hysteresis band
  assert(state.locked === true, 'inside the band the interlock must STAY locked (no flapping)');

  state = interlock.update(11.9); // still inside band
  assert(state.locked === true, '11.9 < releaseAboveCm must stay locked');

  state = interlock.update(12.1);
  assert(state.locked === false, 'above releaseAboveCm must unlock');

  state = interlock.update(11); // band again, now from unlocked side
  assert(state.locked === false, 'inside the band from the unlocked side must stay unlocked');

  state = interlock.update(null);
  assert(state.locked === true, 'missing data must lock (fail closed)');

  // Conservativeness invariant: effective threshold never below lockBelowCm.
  for (const value of [5, 10.5, 13, null, 8]) {
    state = interlock.update(value as number | null);
    assert(state.effectiveMinSafeDistanceCm >= 10, 'effective threshold must never drop below lockBelowCm');
  }

  let threw = false;
  try {
    // eslint-disable-next-line no-new
    new DistanceInterlock({ lockBelowCm: 10, releaseAboveCm: 10 });
  } catch {
    threw = true;
  }
  assert(threw, 'releaseAboveCm <= lockBelowCm must be rejected at construction');
}

// -- audit 2.1 regression tests --------------------------------------------

async function testEmptyOverridesStillEnforceDeviceInterlock() {
  // THE audit 2.1 gate: the device capability declares a required hc-sr04
  // interlock. The caller supplies NO interlock overrides and NO readings.
  // The command must still be blocked (default-block), with zero hardware
  // signal — the interlock cannot be skipped by omitting caller policy.
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, audit, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: []
    // interlockOverrides intentionally omitted
  });

  assert(outcome.status === 'blocked', 'device-declared interlock must block even with no caller policy');
  assert(outcome.reason.indexOf('sensor_missing') === 0, `reason must be sensor_missing, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'blocked interlock must not reach adapter.execute()');
  assert(transport.sentFrames.length === 0, 'blocked interlock must put zero frames on the wire');
  const blockedEntry = audit.list().find((entry) => entry.code === 'hardware_command_blocked');
  assert(blockedEntry, 'block decision must be audited');
  assert(blockedEntry.hardwareSignalSent === false, 'blocked audit entry must have hardwareSignalSent=false');
}

async function testCallerCannotReplaceOrMutateDevicePolicy() {
  const sourceCapabilities = ESP32_SERVO_RIG_CAPABILITIES.map((capability) => ({
    ...capability,
    argumentLimits: capability.argumentLimits.map((limit) => ({ ...limit })),
    requiredSensorInterlocks: capability.requiredSensorInterlocks.map((requirement) => ({ ...requirement }))
  }));
  const transport = new FakeTransport();
  await transport.connect();
  const adapter = new SpyAdapter(transport, sourceCapabilities);
  const gate = new HardwareExecutionGate(adapter, new SafetyMonitor(), new RuntimeAuditLog());

  // Mutate the caller-owned source after adapter construction and also pass a
  // malicious per-call policy with no interlocks. Neither may affect the gate.
  sourceCapabilities[0].requiredSensorInterlocks = [];
  sourceCapabilities[0].argumentLimits[0].max = 999;
  const maliciousPolicy = sourceCapabilities.map((capability) => ({
    ...capability,
    requiredSensorInterlocks: []
  }));
  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: maliciousPolicy,
    sensorReadings: [],
    nowMs: NOW
  });

  assert(outcome.status === 'blocked', 'caller-supplied policy must not replace device-owned interlocks');
  assert(outcome.reason.indexOf('sensor_missing') === 0, 'adapter policy must still require the distance sensor');
  assert(adapter.executeCalls === 0, 'policy bypass attempt must not reach adapter.execute()');
  assert(transport.sentFrames.length === 0, 'policy bypass attempt must put zero frames on the wire');
}

async function testGenericNumericCapabilityBoundsFailClosed() {
  const monitor = new SafetyMonitor();
  const command: HardwareCommand = {
    id: 'future-spin',
    deviceId: 'future-device',
    capabilityId: 'spin_motor' as never,
    args: { rpm: 120 }
  };
  const base = {
    command,
    sensorReadings: [],
    nowMs: NOW
  };

  const allowed = monitor.evaluateHardwareCommand({
    ...base,
    capabilityLimits: [{
      capabilityId: 'spin_motor' as never,
      argumentLimits: [{ argument: 'rpm', min: 0, max: 200, unit: 'rpm' }],
      actuation: true,
      requiredSensorInterlocks: []
    }]
  });
  assert(allowed.ok, `generic bounded numeric capability should pass, got: ${allowed.reason}`);

  const outOfRange = monitor.evaluateHardwareCommand({
    ...base,
    command: { ...command, args: { rpm: 500 } },
    capabilityLimits: [{
      capabilityId: 'spin_motor' as never,
      argumentLimits: [{ argument: 'rpm', min: 0, max: 200 }],
      actuation: true,
      requiredSensorInterlocks: []
    }]
  });
  assert(!outOfRange.ok && outOfRange.reason.indexOf('argument_out_of_range') === 0, 'future numeric capability must enforce its declared range');

  const undeclared = monitor.evaluateHardwareCommand({
    ...base,
    capabilityLimits: [{
      capabilityId: 'spin_motor' as never,
      argumentLimits: [],
      actuation: true,
      requiredSensorInterlocks: []
    }]
  });
  assert(!undeclared.ok && undeclared.reason.indexOf('unbounded_numeric_argument') === 0, 'undeclared numeric actuation argument must default-block');

  const missing = monitor.evaluateHardwareCommand({
    ...base,
    capabilityLimits: [{
      capabilityId: 'spin_motor' as never,
      actuation: true,
      requiredSensorInterlocks: []
    } as never]
  });
  assert(!missing.ok && missing.reason.indexOf('invalid_capability_policy') === 0, 'missing numeric argument-limit declaration must default-block');

  const malformed = monitor.evaluateHardwareCommand({
    ...base,
    capabilityLimits: [{
      capabilityId: 'spin_motor' as never,
      argumentLimits: [{ argument: 'rpm', min: 200, max: 0 }],
      actuation: true,
      requiredSensorInterlocks: []
    }]
  });
  assert(!malformed.ok && malformed.reason.indexOf('invalid_capability_policy') === 0, 'inverted capability bounds must default-block');
}

async function testBaselineInterlockEnforcedWithoutOverride() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  // 11cm > baseline 10cm, fresh + plausible, no override => executes.
  const pass = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(11)],
    nowMs: NOW
  });
  assert(pass.status === 'executed', `11cm above baseline must execute, got ${pass.status}:${pass.reason}`);
  assert(adapter.executeCalls === 1, 'allowed command must reach adapter once');

  // 9cm < baseline 10cm, no override => blocked by the capability baseline.
  const block = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(9)],
    nowMs: NOW
  });
  assert(block.status === 'blocked', 'below-baseline distance must block via capability baseline');
  assert(block.reason.indexOf('min_safe_distance_violation') === 0, `reason must be min_safe_distance_violation, got: ${block.reason}`);
  assert(adapter.executeCalls === 1, 'blocked command must not reach adapter again');
}

async function testInterlockOverrideCanOnlyTighten() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  // Tightening override (15 > baseline 10): 11cm now below the tightened
  // threshold => blocked with min_safe_distance_violation at 15.
  const tightened = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(11)],
    interlockOverrides: [{ sensorId: 'hc-sr04', minSafeDistanceCm: 15 }],
    nowMs: NOW
  });
  assert(tightened.status === 'blocked', 'tighter override must be able to block a reading that passes baseline');
  assert(tightened.reason.indexOf('min_safe_distance_violation') === 0, `reason must be min_safe_distance_violation, got: ${tightened.reason}`);
  assert(tightened.reason.indexOf('min=15') >= 0, `blocked at the tightened threshold, got: ${tightened.reason}`);

  // Loosening override (5 < baseline 10): rejected explicitly, never applied
  // (invariant 3: no silent correction). Caller's raw value preserved in reason.
  const loosened = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(11)],
    interlockOverrides: [{ sensorId: 'hc-sr04', minSafeDistanceCm: 5 }],
    nowMs: NOW
  });
  assert(loosened.status === 'blocked', 'looser override must be rejected, not silently applied');
  assert(loosened.reason.indexOf('invalid_interlock_override') === 0, `reason must be invalid_interlock_override, got: ${loosened.reason}`);
  assert(loosened.reason.indexOf('requested=5') >= 0, `caller raw override value must be preserved in reason, got: ${loosened.reason}`);
  assert(adapter.executeCalls === 0, 'no override case reached the adapter');
}

async function testOverrideForUndeclaredSensorRejected() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    interlockOverrides: [{ sensorId: 'phantom-lidar', minSafeDistanceCm: 50 }],
    nowMs: NOW
  });
  assert(outcome.status === 'blocked', 'override for a sensor the capability does not declare must be rejected');
  assert(outcome.reason.indexOf('invalid_interlock_override') === 0, `reason must be invalid_interlock_override, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'rejected override must not reach adapter.execute()');
}

// -- audit 2.2 regression tests --------------------------------------------

async function testActuationRequiresDeviceTimestamp() {
  // Decision 2: no device-side timestamp => actuation blocked (never a silent
  // fallback to host arrival time). Reads are unaffected (see next test).
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, audit, gate } = buildGate(transport);

  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [readingNoDeviceTs(100)],
    nowMs: NOW
  });
  assert(outcome.status === 'blocked', 'actuation without device timestamp must be blocked');
  assert(outcome.reason.indexOf('device_timestamp_unavailable') === 0, `reason must be device_timestamp_unavailable, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'device_timestamp_unavailable block must not reach adapter.execute()');
  const blockedEntry = audit.list().find((entry) => entry.code === 'hardware_command_blocked');
  assert(blockedEntry && blockedEntry.hardwareSignalSent === false, 'block must be audited with hardwareSignalSent=false');
}

async function testReadsAllowedWithoutDeviceTimestamp() {
  // Reads never actuate, so the device-timestamp requirement does not gate them.
  const transport = new FakeTransport();
  await transport.connect();
  const { gate } = buildGate(transport);

  const outcome = await gate.run({
    command: { id: 'read-x', deviceId: 'esp32-servo-rig', capabilityId: 'read_distance', args: {} },
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [readingNoDeviceTs(100)],
    nowMs: NOW
  });
  assert(outcome.status === 'executed', 'read_distance must stay available even without a device timestamp');
}

async function testFrozenSensorBlocksActuationNotOverridable() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);

  // Healthy-looking reading, but the sensor is latched frozen by the host.
  const outcome = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    frozenSensorIds: new Set(['hc-sr04']),
    nowMs: NOW
  });
  assert(outcome.status === 'blocked', 'frozen sensor must block actuation');
  assert(outcome.reason.indexOf('sensor_frozen') === 0, `reason must be sensor_frozen, got: ${outcome.reason}`);
  assert(adapter.executeCalls === 0, 'frozen block must not reach adapter.execute()');

  // An override cannot un-freeze: sensor_frozen still wins.
  const withOverride = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    interlockOverrides: [{ sensorId: 'hc-sr04', minSafeDistanceCm: 10 }],
    frozenSensorIds: new Set(['hc-sr04']),
    nowMs: NOW
  });
  assert(withOverride.status === 'blocked' && withOverride.reason.indexOf('sensor_frozen') === 0, 'frozen must not be overridable');
  assert(adapter.executeCalls === 0, 'frozen-with-override must still not reach adapter.execute()');
}

async function testStuckValueDetectorFrozenSemantics() {
  const { StuckValueDetector } = await import('../../lib/hardware/SensorConditioning');

  // Value stuck AND device clock stuck across 5 samples => frozen (latched).
  const stuck = new StuckValueDetector({ sampleWindow: 5 });
  let frozen = false;
  for (let i = 0; i < 5; i += 1) frozen = stuck.push(42, 1000);
  assert(frozen === true, 'identical value + non-advancing clock over the window must latch frozen');
  // Latch persists even when a healthy advancing sample arrives.
  assert(stuck.push(50, 2000) === true, 'frozen must latch until reset, not self-clear');
  stuck.reset();
  assert(stuck.isFrozen() === false, 'reset must clear the frozen latch');

  // Value identical but device clock ADVANCING => a real static object, never frozen.
  const moving = new StuckValueDetector({ sampleWindow: 5 });
  let movingFrozen = false;
  for (let i = 0; i < 6; i += 1) movingFrozen = moving.push(42, 1000 + i * 60);
  assert(movingFrozen === false, 'identical value with a live advancing clock must NOT be flagged frozen');
}

async function testDeviceClockBaseline() {
  const { DeviceClockBaseline } = await import('../../lib/hardware/SensorConditioning');
  const baseline = new DeviceClockBaseline();
  assert(baseline.established() === false, 'baseline starts unestablished');
  assert(baseline.hasAdvanced(1000) === true, 'first sample counts as advanced');
  baseline.establish(1000);
  assert(baseline.established() === true, 'establish sets the baseline');
  assert(baseline.deviceElapsedMs(1300) === 300, 'device elapsed measured from baseline');
  assert(baseline.hasAdvanced(1000) === false, 'a non-advancing device clock is detected');
  baseline.update(1300);
  assert(baseline.hasAdvanced(1300) === false, 'equal timestamp is not an advance');
  assert(baseline.hasAdvanced(1400) === true, 'a larger timestamp is an advance');
  baseline.reset();
  assert(baseline.established() === false, 'reset clears the baseline');
}

async function testInvalidSafetyMetadataFailsClosed() {
  const cases: Array<{ name: string; reading: SensorReading; nowMs?: number; reason: string }> = [
    {
      name: 'non-finite safety clock',
      reading: reading(100),
      nowMs: Number.NaN,
      reason: 'invalid_safety_clock'
    },
    {
      name: 'non-finite host timestamp',
      reading: { ...reading(100), timestampMs: Number.NaN },
      reason: 'sensor_timestamp_invalid'
    },
    {
      name: 'future host timestamp',
      reading: { ...reading(100), timestampMs: NOW + 1 },
      reason: 'sensor_timestamp_future'
    },
    {
      name: 'non-finite device timestamp',
      reading: { ...reading(100), deviceTimestampMs: Number.POSITIVE_INFINITY },
      reason: 'device_timestamp_invalid'
    },
    {
      name: 'negative device timestamp',
      reading: { ...reading(100), deviceTimestampMs: -1 },
      reason: 'device_timestamp_invalid'
    },
    {
      name: 'wrong sensor unit',
      reading: { ...reading(100), unit: 'deg' },
      reason: 'sensor_type_mismatch'
    },
    {
      name: 'wrong sensor capability',
      reading: { ...reading(100), capabilityId: 'move_to_angle' },
      reason: 'sensor_type_mismatch'
    }
  ];

  for (const testCase of cases) {
    const transport = new FakeTransport();
    await transport.connect();
    const { adapter, gate } = buildGate(transport);
    const outcome = await gate.run({
      command: servoCommand(45),
      capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
      sensorReadings: [testCase.reading],
      nowMs: testCase.nowMs !== undefined ? testCase.nowMs : NOW
    });
    assert(outcome.status === 'blocked', `${testCase.name} must block actuation`);
    assert(outcome.reason.indexOf(testCase.reason) === 0, `${testCase.name} reason must be ${testCase.reason}`);
    assert(adapter.executeCalls === 0, `${testCase.name} must not reach adapter.execute()`);
    assert(transport.sentFrames.length === 0, `${testCase.name} must put zero frames on the wire`);
  }

  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);
  const badOverride = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    interlockOverrides: [{ sensorId: 'hc-sr04', minSafeDistanceCm: Number.NaN }],
    nowMs: NOW
  });
  assert(badOverride.status === 'blocked', 'NaN interlock override must fail closed');
  assert(badOverride.reason.indexOf('invalid_interlock_override') === 0, 'NaN override must report invalid_interlock_override');
  assert(adapter.executeCalls === 0 && transport.sentFrames.length === 0, 'NaN override must emit zero hardware frames');

  const duplicateOverride = await gate.run({
    command: servoCommand(45),
    capabilityLimits: ESP32_SERVO_RIG_CAPABILITIES,
    sensorReadings: [reading(100)],
    interlockOverrides: [
      { sensorId: 'hc-sr04', minSafeDistanceCm: 12 },
      { sensorId: 'hc-sr04', minSafeDistanceCm: 15 }
    ],
    nowMs: NOW
  });
  assert(duplicateOverride.status === 'blocked', 'duplicate interlock overrides must be rejected as ambiguous');
  assert(duplicateOverride.reason.indexOf('invalid_interlock_override') === 0, 'duplicate override must report invalid_interlock_override');
}

async function testStuckValueDetectorRejectsInvalidWindows() {
  const { StuckValueDetector } = await import('../../lib/hardware/SensorConditioning');
  for (const sampleWindow of [0, -1, 1.5, Number.NaN]) {
    let threw = false;
    try {
      // eslint-disable-next-line no-new
      new StuckValueDetector({ sampleWindow });
    } catch {
      threw = true;
    }
    assert(threw, `invalid stuck-value sampleWindow ${sampleWindow} must be rejected`);
  }
}

class ScriptedSensorReader {
  calls = 0;

  constructor(private readonly results: SensorReadResult[]) {}

  async readDistanceDetailed(): Promise<SensorReadResult> {
    const index = Math.min(this.calls, this.results.length - 1);
    this.calls += 1;
    const result = this.results[index];
    return {
      ...result,
      reading: result.reading ? { ...result.reading } : null
    };
  }
}

async function testPollingPublishesAndInvalidatesFailedEvidence() {
  const reader = new ScriptedSensorReader([
    { reading: reading(100, 0, 1000) },
    { reading: null, error: 'ultrasonic timeout' }
  ]);
  const poller = new DistanceSensorPollingService(reader, {
    intervalMs: 100,
    sampleWindow: 3,
    now: () => NOW
  });
  const states: string[] = [];
  const unsubscribe = poller.subscribe((snapshot) => states.push(snapshot.state));

  const healthy = await poller.pollOnce();
  assert(healthy.state === 'healthy' && healthy.readings.length === 1, 'successful polling must publish fresh evidence');
  healthy.readings[0].value = 999;
  assert(poller.snapshot().readings[0].value === 100, 'subscriber snapshots must not mutate authoritative evidence');

  const degraded = await poller.pollOnce();
  assert(degraded.state === 'degraded', 'failed polling must publish a degraded state');
  assert(degraded.readings.length === 0, 'failed polling must clear prior evidence instead of reusing a last-good value');
  assert(degraded.lastError === 'ultrasonic timeout', 'poll failure reason must remain explicit');
  assert(states.join(',') === 'idle,healthy,degraded', 'subscriber must observe each evidence generation');
  unsubscribe();
}

async function testPollingLatchesDeviceClockRegression() {
  const reader = new ScriptedSensorReader([
    { reading: reading(100, 0, 1000) },
    { reading: reading(100, 0, 900) },
    { reading: reading(100, 0, 1100) }
  ]);
  const poller = new DistanceSensorPollingService(reader, {
    intervalMs: 100,
    sampleWindow: 3,
    now: () => NOW
  });

  assert((await poller.pollOnce()).state === 'healthy', 'initial advancing device clock must be healthy');
  const regressed = await poller.pollOnce();
  assert(regressed.state === 'frozen', 'device clock regression must latch a frozen state');
  assert(regressed.readings.length === 1, 'clock regression must preserve typed evidence for an explicit sensor_frozen gate reason');
  assert(regressed.frozenSensorIds.has('hc-sr04'), 'clock regression must enter the non-overridable frozen set');
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);
  const blocked = await gate.run({
    command: servoCommand(45),
    sensorReadings: regressed.readings,
    frozenSensorIds: regressed.frozenSensorIds,
    nowMs: regressed.observedAtMs
  });
  assert(blocked.status === 'blocked' && blocked.reason.indexOf('sensor_frozen') === 0, 'latched polling evidence must reach the gate as explicit sensor_frozen');
  assert(adapter.executeCalls === 0 && transport.sentFrames.length === 0, 'clock-frozen evidence must emit zero actuation frames');
  assert((await poller.pollOnce()).state === 'frozen', 'a later advancing value must not silently clear the clock latch');

  poller.resetSensorLatch();
  const recovered = await poller.pollOnce();
  assert(recovered.state === 'healthy', 'explicit reset followed by fresh evidence may recover polling');
}

async function testSequenceStopsOnChangedInterlock() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);
  const reader = new ScriptedSensorReader([
    { reading: reading(100, 0, 1000) },
    { reading: reading(5, 0, 1100) },
    { reading: reading(100, 0, 1200) }
  ]);
  const poller = new DistanceSensorPollingService(reader, {
    intervalMs: 100,
    sampleWindow: 5,
    now: () => NOW
  });
  const runner = new HardwareActionSequenceRunner(gate, poller);

  const result = await runner.run([servoCommand(30), servoCommand(60), servoCommand(90)]);
  assert(result.status === 'interrupted', 'unsafe sensor change must interrupt a multi-step action');
  assert(result.reason.indexOf('interlock:min_safe_distance_violation') === 0, 'interruption must preserve the gate reason');
  assert(result.completedSteps === 1 && result.steps.length === 2, 'only the first primitive may complete');
  assert(result.steps[0].sensorGeneration !== result.steps[1].sensorGeneration, 'each primitive must use a new sensor generation');
  assert(reader.calls === 2, 'the runner must stop polling once the sequence is interrupted');
  assert(adapter.executeCalls === 1, 'blocked second primitive must never reach adapter.execute()');
  assert(transport.sentFrames.length === 1, 'blocked and later primitives must put zero further actuation frames on the wire');
}

async function testSequenceStopsWhenPollingLosesSensor() {
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);
  const reader = new ScriptedSensorReader([
    { reading: reading(100, 0, 1000) },
    { reading: null, error: 'sensor disconnected' },
    { reading: reading(100, 0, 1200) }
  ]);
  const poller = new DistanceSensorPollingService(reader, {
    intervalMs: 100,
    now: () => NOW
  });
  const runner = new HardwareActionSequenceRunner(gate, poller);

  const result = await runner.run([servoCommand(30), servoCommand(60), servoCommand(90)]);
  assert(result.status === 'interrupted', 'missing sensor evidence must interrupt the sequence');
  assert(result.reason.indexOf('interlock:sensor_missing') === 0, 'missing poll must default-block through SafetyMonitor');
  assert(result.completedSteps === 1 && result.steps.length === 2, 'no later primitive may execute after evidence loss');
  assert(adapter.executeCalls === 1 && transport.sentFrames.length === 1, 'evidence loss must result in zero further frames');
}

async function testBlockedJogIsNotRecordable() {
  const previous = [45];
  const after = waypointAfterJog(previous, 50, {
    status: 'blocked',
    signalSent: false,
    signalState: 'not_sent',
    executionEvidence: 'not_executed'
  });
  assert(after.join(',') === '45', 'a blocked jog must not change the recorded waypoint list');
  assert(previous.join(',') === '45', 'waypoint handling must not mutate caller state');
}

async function testDisconnectedRealMirrorClearsStaleTelemetry() {
  const disconnected = visibleRealHardwareTelemetry(false, 42.5, 90);
  assert(disconnected.connected === false, 'disconnected mirror must report disconnected');
  assert(disconnected.distanceCm === null && disconnected.lastCommandAngle === null, 'disconnected mirror must erase stale distance and command angle');
  const invalid = visibleRealHardwareTelemetry(true, Number.NaN, Number.POSITIVE_INFINITY);
  assert(invalid.distanceCm === null && invalid.lastCommandAngle === null, 'invalid connected telemetry must not appear as current state');
}

async function testTeachReplayStopsAfterBlockedStep() {
  const mapped = hardwareCommandsFromTeachTaskDsl({
    task_id: 'teach-replay-test',
    intent: 'replay recorded open-loop commands',
    risk_level: 'low',
    steps: [30, 60, 90].map((angle, index) => ({
      id: `teach-${index}`,
      action: 'move_to_angle',
      value: angle,
      speed: 'slow',
      force: 'low'
    }))
  } as unknown as TaskDSL, 'teach-test');
  assert(mapped.ok, 'validated teach TaskDSL must map to hardware commands');
  const transport = new FakeTransport();
  await transport.connect();
  const { adapter, gate } = buildGate(transport);
  const reader = new ScriptedSensorReader([
    { reading: reading(100, 0, 1000) },
    { reading: reading(5, 0, 1100) },
    { reading: reading(100, 0, 1200) }
  ]);
  const runner = new HardwareActionSequenceRunner(gate, new DistanceSensorPollingService(reader, {
    intervalMs: 100,
    sampleWindow: 5,
    now: () => NOW
  }));
  const result = await runner.run(mapped.commands);
  assert(result.status === 'interrupted' && result.completedSteps === 1, 'teach replay must terminate at the first blocked step');
  assert(result.steps.length === 2 && reader.calls === 2, 'blocked teach replay must not poll or evaluate later steps');
  assert(adapter.executeCalls === 1 && transport.sentFrames.length === 1, 'blocked teach replay must emit zero subsequent actuation frames');
}

async function testRealCommandParserExplicitOnlyNeverGuesses() {
  const zhSeq = parseRealNaturalCommand('\u8f6c\u523045\u5ea6\uff0c\u518d\u56de\u523090\u00b0\uff0c\u7136\u540e\u5f52\u96f6');
  assert(zhSeq.ok && zhSeq.angles.join(',') === '45,90,0', 'explicit zh angle tokens must parse in order');
  const enSeq = parseRealNaturalCommand('turn to 12.5 degrees then back to zero');
  assert(enSeq.ok && enSeq.angles.join(',') === '12.5,0', 'explicit en angle tokens must parse in order');
  const bare = parseRealNaturalCommand('turn to 45');
  assert(!bare.ok && bare.reason === 'no_explicit_angle', 'a bare number without a degree marker must be rejected, not guessed');
  const ambiguous = parseRealNaturalCommand('wait 5 seconds then move to 45\u00b0');
  assert(!ambiguous.ok && ambiguous.reason === 'ambiguous_number', 'a leftover non-angle number must reject the whole command');
  const empty = parseRealNaturalCommand('   ');
  assert(!empty.ok && empty.reason === 'empty_command', 'empty text must be rejected');
  const intent = parseRealNaturalCommand('please dance');
  assert(!intent.ok && intent.reason === 'no_explicit_angle', 'intent words without explicit angles must never be guessed into motion');
  const many = parseRealNaturalCommand(Array.from({ length: 17 }, (_, i) => `${i}\u00b0`).join(' '));
  assert(!many.ok && many.reason === 'too_many_steps', 'sequences beyond the governed limit must be rejected');
}

async function testRealCommandOutOfRangeRejectedDownstreamNeverClamped() {
  const oob = parseRealNaturalCommand('turn to 200\u00b0');
  assert(oob.ok && oob.angles.join(',') === '200', 'the parser must pass explicit out-of-range angles through unmodified (no clamping)');
  const checked = validateActionManifest(
    buildTeachManifest('real_nl_command', 'turn to 200 degrees', oob.angles),
    REAL_SERVO_TEACH_DEVICE_META,
    REAL_TEACH_BUILTIN_INTENT_IDS
  );
  assert(!checked.ok && checked.code === 'invalid_value', 'the authoritative validator must reject the out-of-range angle instead of clamping it');
}

async function testRealExecutionReleaseApprovalIsVersionAndDigestBound() {
  const sourceEvidence = join(process.cwd(), 'docs', 'acceptance', 'evidence');
  const approved = verifyRealExecutionReleaseApproval({ appVersion: '0.5.1', evidenceDir: sourceEvidence });
  assert(approved.approved && approved.evidenceCount === 4, 'the exact owner-reviewed release evidence must approve the matching app version');

  const fixture = mkdtempSync(join(tmpdir(), 'realitywarden-release-approval-'));
  try {
    for (const evidence of REAL_EXECUTION_RELEASE_APPROVAL.evidence) {
      copyFileSync(join(sourceEvidence, evidence.file), join(fixture, evidence.file));
    }
    writeFileSync(join(fixture, 'arbitrary-extra.json'), '{}', 'utf8');
    assert(verifyRealExecutionReleaseApproval({ appVersion: '0.5.1', evidenceDir: fixture }).approved, 'unrelated files must grant no authority and must not alter the exact approved set');

    writeFileSync(join(fixture, REAL_EXECUTION_RELEASE_APPROVAL.evidence[1].file), '{"scenario":2}', 'utf8');
    const tampered = verifyRealExecutionReleaseApproval({ appVersion: '0.5.1', evidenceDir: fixture });
    assert(!tampered.approved && tampered.reason.startsWith('approved_evidence_digest_mismatch:'), 'tampering an approved scenario must fail closed before semantic use');

    const wrongVersion = verifyRealExecutionReleaseApproval({ appVersion: '0.5.2', evidenceDir: sourceEvidence });
    assert(!wrongVersion.approved && wrongVersion.reason === 'release_version_not_approved:0.5.2', 'evidence approved for one app version must not unlock another version');

    const arbitraryOnly = mkdtempSync(join(tmpdir(), 'realitywarden-arbitrary-evidence-'));
    try {
      for (let index = 0; index < 4; index += 1) writeFileSync(join(arbitraryOnly, `${index}.json`), '{}', 'utf8');
      const arbitrary = verifyRealExecutionReleaseApproval({ appVersion: '0.5.1', evidenceDir: arbitraryOnly });
      assert(!arbitrary.approved && arbitrary.evidenceCount === 0, 'four arbitrary JSON files must never satisfy the release approval');
    } finally {
      rmSync(arbitraryOnly, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function main() {
  const tests: Array<[string, () => Promise<void>]> = [
    ['blocked command never reaches hardware', testBlockedNeverReachesHardware],
    ['sensor missing => default-block', testSensorMissingDefaultBlocks],
    ['distance read preserves device error diagnostics', testDistanceReadPreservesDeviceError],
    ['sensor stale => default-block', testSensorStaleDefaultBlocks],
    ['sensor invalid => default-block', testSensorInvalidDefaultBlocks],
    ['min safe distance interlock blocks actuation', testMinSafeDistanceInterlock],
    ['offline transport never fakes success', testOfflineTransportNeverFakesSuccess],
    ['allowed command executes with signalSent=true', testAllowedCommandExecutesAndAudits],
    ['audit 4.1: attempted delivery is never reported as acknowledged', testAttemptedDeliveryIsNotReportedAsAcknowledged],
    ['reads stay available while actuation locked out', testReadsAllowedWhileActuationLockedOut],
    ['unsupported capability fails loudly', testUnsupportedCapabilityFailsLoudly],
    ['every audit entry carries hardwareSignalSent', testEveryAuditEntryCarriesHardwareSignalSent],
    ['audit 2.1: empty caller policy + device interlock => blocked, zero signal', testEmptyOverridesStillEnforceDeviceInterlock],
    ['caller cannot replace or mutate device safety policy', testCallerCannotReplaceOrMutateDevicePolicy],
    ['audits 2.3/5.2: generic numeric capability bounds fail closed', testGenericNumericCapabilityBoundsFailClosed],
    ['audit 2.1: capability baseline interlock enforced without override', testBaselineInterlockEnforcedWithoutOverride],
    ['audit 2.1: interlock override can only tighten, loosening rejected', testInterlockOverrideCanOnlyTighten],
    ['audit 2.1: override for undeclared sensor rejected', testOverrideForUndeclaredSensorRejected],
    ['audit 2.2: actuation requires a device-side timestamp', testActuationRequiresDeviceTimestamp],
    ['audit 2.2: reads allowed without a device timestamp', testReadsAllowedWithoutDeviceTimestamp],
    ['audit 2.2: frozen sensor blocks actuation and is not overridable', testFrozenSensorBlocksActuationNotOverridable],
    ['audit 2.2: stuck-value detector frozen semantics (value+clock)', testStuckValueDetectorFrozenSemantics],
    ['audit 2.2: device clock baseline advance/elapsed/reset', testDeviceClockBaseline],
    ['invalid safety metadata fails closed with zero signal', testInvalidSafetyMetadataFailsClosed],
    ['stuck-value detector rejects invalid windows', testStuckValueDetectorRejectsInvalidWindows],
    ['sensor polling publishes generations and invalidates failed evidence', testPollingPublishesAndInvalidatesFailedEvidence],
    ['sensor polling latches device-clock regression until explicit reset', testPollingLatchesDeviceClockRegression],
    ['multi-step action stops with zero further frames when interlock changes', testSequenceStopsOnChangedInterlock],
    ['multi-step action stops with zero further frames when sensor polling fails', testSequenceStopsWhenPollingLosesSensor],
    ['jog-teach: blocked jog is not recordable', testBlockedJogIsNotRecordable],
    ['REAL mirror: disconnect erases stale telemetry', testDisconnectedRealMirrorClearsStaleTelemetry],
    ['jog-teach replay: blocked step emits zero subsequent frames', testTeachReplayStopsAfterBlockedStep],
    ['real NL command: explicit tokens only, never guesses', testRealCommandParserExplicitOnlyNeverGuesses],
    ['real NL command: out-of-range rejected downstream, never clamped', testRealCommandOutOfRangeRejectedDownstreamNeverClamped],
    ['REAL release approval is version/scenario/digest bound', testRealExecutionReleaseApprovalIsVersionAndDigestBound],
    ['serial transport protocol behaves honestly', testSerialTransportProtocol],
    ['audit 1.1: raw transport send() refuses actuation frames', testRawSendRefusesActuationFrames],
    ['audit 1.1: adapter.execute requires the gate ticket', testAdapterExecuteRequiresGateTicket],
    ['audit 3.1: protocol error surfaces in failure details', testProtocolErrorSurfacesInFailureDetails],
    ['setup advisor classifies failures and probe results', testSetupAdvisorClassifications],
    ['serial transport rejects duplicate pending ids', testSerialTransportRejectsDuplicatePendingIds],
    ['serial transport serializes connect/disconnect lifecycle', testSerialTransportSerializesLifecycle],
    ['serial transport retires ambiguous timed-out ids', testSerialTransportRetiresAmbiguousRequestIds],
    ['pre-wire frame rejection reports zero signal', testRejectedFramesReportZeroSignal],
    ['serial transport clears partial data across reconnect', testSerialTransportClearsPartialDataAcrossReconnect],
    ['serial transport bounds malformed input and validates timeouts', testSerialTransportBoundsMalformedInput],
    ['median filter rejects noise, never fakes data', testMedianFilterRejectsNoise],
    ['conditioning rejects non-finite values and thresholds', testConditioningRejectsNonFiniteValuesAndThresholds],
    ['distance interlock hysteresis stays conservative', testDistanceInterlockHysteresis]
  ];

  for (const [name, test] of tests) {
    await test();
    console.log(`ok - ${name}`);
  }
  console.log(`Real hardware safety invariant tests passed (${tests.length} tests).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
