'use client';

/**
 * REAL HARDWARE panel (v0.3, separately gated execution boundary).
 *
 * Scope is deliberately narrow and honest (invariant 6: simulation and
 * reality visibly distinct):
 * - explicit REAL HARDWARE identity, styled unlike any simulation panel
 * - serial connection wizard: list ports -> connect -> handshake
 * - read-only live distance from the HC-SR04 (read_distance capability)
 * - real actuation remains evidence-locked, operator-confirmed, and routed
 *   through the authoritative HardwareExecutionGate chain.
 *
 * Every state shown is real: no bridge (web build) says so, a failed
 * handshake says so, and "connected" appears only after the device answered
 * a read_distance request.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateActionManifest } from '@/lib/action-manifest/ActionManifest';
import type { ActionManifest } from '@/lib/action-manifest/ActionManifest';
import { adviceForFailure, interpretProbe } from '@/lib/hardware/SetupAdvisor';
import type { FirmwareIdentity, SetupAdvice } from '@/lib/hardware/SetupAdvisor';
import type { RealHardwareTelemetry } from '@/types/realHardwareTelemetry';
import { visibleRealHardwareTelemetry } from '@/lib/hardware/RealHardwareTelemetry';
import {
  REAL_SERVO_TEACH_DEVICE_META,
  REAL_TEACH_BUILTIN_INTENT_IDS,
  buildTeachManifest,
  waypointAfterJog
} from '@/lib/hardware/TeachMode';
import { parseRealNaturalCommand } from '@/lib/hardware/RealCommandParser';
import { parseServoIntent } from '@/lib/hardware/ServoIntentParser';
import { prepareRealProposalFromIntent, extractManifestAngles } from '@/lib/hardware/ReferenceServoPreflight';
import type { RealProposalResult } from '@/lib/hardware/ReferenceServoPreflight';
import { formatReferenceServoPreflight } from '@/lib/hardware/ReferenceServoPreflightView';
import { recordReferenceServoPreflightDecision } from '@/lib/hardware/ReferenceServoPreflightAudit';
import { RuntimeAuditLog } from '@/lib/runtime/RuntimeAuditLog';
import type { RuntimeAuditEntry } from '@/lib/runtime/RuntimeAuditLog';

export interface HardwareBridgeResult {
  ok: boolean;
  error?: string;
  distanceCm?: number;
  ports?: Array<{ path: string; label?: string }>;
  diagnoseOk?: boolean;
  diagnoseData?: Record<string, unknown>;
  diagnoseError?: string;
}

export interface HardwareProbeResult {
  ok: boolean;
  error?: string;
  diagnoseOk?: boolean;
  diagnoseData?: Record<string, unknown>;
  diagnoseError?: string;
  legacyReadOk?: boolean;
  legacyDeviceMs?: boolean;
}

export interface HardwareAutoDetectResult {
  ok: boolean;
  error?: string;
  results?: Array<HardwareProbeResult & { path: string; label?: string }>;
}

export interface HardwareBridge {
  listPorts: () => Promise<HardwareBridgeResult>;
  connect: (portPath: string) => Promise<HardwareBridgeResult>;
  readDistance: () => Promise<HardwareBridgeResult>;
  disconnect: () => Promise<HardwareBridgeResult>;
  /** Optional (older desktop builds): read-only probe / auto-detect. */
  probe?: (portPath: string) => Promise<HardwareProbeResult>;
  autoDetect?: () => Promise<HardwareAutoDetectResult>;
  /** Real execution (product path): locked until acceptance evidence exists. */
  executionStatus?: () => Promise<HardwareExecutionLock>;
  firmwarePlan?: (portPath: string, request: unknown) => Promise<HardwareFirmwarePlanResult>;
  flashFirmware?: (portPath: string, request: unknown, expectedSha256: string, confirm: boolean) => Promise<HardwareFirmwareFlashResult>;
  execute?: (portPath: string, angle: number, confirm: boolean) => Promise<HardwareExecuteOutcome>;
  executeManifest?: (portPath: string, manifest: unknown, confirm: boolean) => Promise<HardwareExecuteOutcome>;
}

export interface HardwareFirmwarePlanResult {
  ok: boolean;
  error?: string;
  unavailable?: boolean;
  plan?: {
    file: string;
    sha256: string;
    version: string;
    sensorInterface: string;
    address: number;
    byteLength: number;
  };
}

export interface HardwareFirmwareFlashResult extends HardwareBridgeResult {
  flashed?: boolean;
  reconnected?: boolean;
  version?: string;
  sha256?: string;
  chip?: string;
}

export interface HardwareExecutionLock {
  locked: boolean;
  reason?: string;
  evidenceCount?: number;
}

export interface HardwareExecuteOutcome {
  ok: boolean;
  error?: string;
  status?: 'executed' | 'failed' | 'blocked';
  reason?: string;
  executionMode?: string;
  signalSent?: boolean;
  signalState?: 'not_sent' | 'attempted_unconfirmed' | 'device_acknowledged';
  executionEvidence?: 'not_executed' | 'delivery_unconfirmed' | 'device_rejected' | 'command_acknowledged_open_loop' | 'read_response';
  physicalOutcomeVerified?: boolean;
  detail?: string;
  distanceCm?: number;
  readErrors?: string[];
  lastAcknowledgedAngle?: number;
  sequenceStatus?: string;
  completedSteps?: number;
  attemptedSteps?: number;
}

function bridge(): HardwareBridge | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { openReality?: { hardware?: HardwareBridge } };
  return host.openReality?.hardware ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'flashing';

export function RealHardwarePanel({
  language,
  actions,
  onSaveAction,
  onTelemetryChange
}: {
  language: 'zh' | 'en';
  actions: readonly ActionManifest[];
  onSaveAction: (manifest: ActionManifest) => void;
  onTelemetryChange?: (telemetry: RealHardwareTelemetry) => void;
}) {
  const zh = language === 'zh';
  const [expanded, setExpanded] = useState(false);
  const [ports, setPorts] = useState<Array<{ path: string; label?: string }>>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [distanceCm, setDistanceCm] = useState<number | null>(null);
  const [listing, setListing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [identity, setIdentity] = useState<FirmwareIdentity | null>(null);
  const [advice, setAdvice] = useState<SetupAdvice[]>([]);
  const [execLock, setExecLock] = useState<HardwareExecutionLock | null>(null);
  const [execAngle, setExecAngle] = useState('45');
  const [execConfirmed, setExecConfirmed] = useState(false);
  const [firmwareRequest, setFirmwareRequest] = useState<unknown>({ source: 'reviewed_prebuilt' });
  const [firmwareOrderName, setFirmwareOrderName] = useState<string | null>(null);
  const [firmwarePlan, setFirmwarePlan] = useState<HardwareFirmwarePlanResult['plan'] | null>(null);
  const [firmwareError, setFirmwareError] = useState<string | null>(null);
  const [firmwareConfirmed, setFirmwareConfirmed] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [firmwareFeedback, setFirmwareFeedback] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execOutcome, setExecOutcome] = useState<HardwareExecuteOutcome | null>(null);
  const [nlText, setNlText] = useState('');
  const [nlFeedback, setNlFeedback] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<RealProposalResult | null>(null);
  const preflightAuditLogRef = useRef<RuntimeAuditLog | null>(null);
  const [preflightReceipts, setPreflightReceipts] = useState<RuntimeAuditEntry[]>([]);
  const [lastRequestedAngle, setLastRequestedAngle] = useState<number | null>(null);
  const [lastCommandAngle, setLastCommandAngle] = useState<number | null>(null);
  const [waypoints, setWaypoints] = useState<number[]>([]);
  const [teachActionId, setTeachActionId] = useState('taught_motion');
  const [teachActionName, setTeachActionName] = useState(zh ? '\u793a\u6559\u52a8\u4f5c' : 'Taught motion');
  const [teachFeedback, setTeachFeedback] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);
  const mounted = useRef(true);
  // The server-rendered first frame cannot see Electron's preload bridge.
  // Detect it after hydration so the desktop build cannot remain mislabeled
  // as web mode for the lifetime of the panel.
  const [available, setAvailable] = useState(false);

  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setAvailable(bridge() !== null);
    return () => {
      mounted.current = false;
      stopPolling();
      // The main process owns the serial handle. Closing it on unmount avoids
      // leaving the device locked when navigation destroys this panel.
      const api = bridge();
      if (api) void api.disconnect().catch(() => undefined);
      onTelemetryChange?.({ connected: false, distanceCm: null, lastCommandAngle: null });
    };
  }, [onTelemetryChange, stopPolling]);

  useEffect(() => {
    onTelemetryChange?.(visibleRealHardwareTelemetry(status === 'connected', distanceCm, lastCommandAngle));
  }, [distanceCm, lastCommandAngle, onTelemetryChange, status]);

  const refreshPorts = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    setListing(true);
    setLastError(null);
    try {
      const result = await api.listPorts();
      if (!mounted.current) return;
      if (result.ok && result.ports) {
        setPorts(result.ports);
        if (result.ports.length > 0 && !result.ports.some((port) => port.path === selectedPort)) {
          setSelectedPort(result.ports[0].path);
        }
      } else {
        setPorts([]);
        setLastError(result.error ?? 'list ports failed');
      }
    } catch (error) {
      if (mounted.current) {
        setPorts([]);
        setLastError(`list ports failed: ${errorMessage(error)}`);
      }
    } finally {
      if (mounted.current) setListing(false);
    }
  }, [selectedPort]);

  const disconnect = useCallback(async () => {
    stopPolling();
    setDistanceCm(null);
    setStatus('disconnected');
    setLastCommandAngle(null);
    setLastRequestedAngle(null);
    setExecOutcome(null);
    setIdentity(null);
    setFirmwarePlan(null);
    setFirmwareConfirmed(false);
    const api = bridge();
    if (api) {
      try {
        const result = await api.disconnect();
        if (!result.ok && mounted.current) setLastError(result.error ?? 'disconnect failed');
      } catch (error) {
        if (mounted.current) setLastError(`disconnect failed: ${errorMessage(error)}`);
      }
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    const generation = pollGeneration.current;
    const poll = async () => {
      const api = bridge();
      if (!api || generation !== pollGeneration.current || !mounted.current) return;
      let reading: HardwareBridgeResult;
      try {
        reading = await api.readDistance();
      } catch (error) {
        reading = { ok: false, error: `read failed: ${errorMessage(error)}` };
      }
      if (generation !== pollGeneration.current || !mounted.current) return;
      if (reading.ok && typeof reading.distanceCm === 'number') {
        setDistanceCm(reading.distanceCm);
        setLastError(null);
      } else {
        // An unreadable sensor is shown as exactly that - never a stale value.
        setDistanceCm(null);
        setLastError(reading.error ?? (language === 'zh' ? '读取失败' : 'read failed'));
      }
      // Schedule only after the current read completes. setInterval allowed a
      // slow 3s request to overlap the next 2s poll and race stale UI updates.
      pollTimer.current = setTimeout(() => void poll(), 2000);
    };
    pollTimer.current = setTimeout(() => void poll(), 2000);
  }, [language, stopPolling]);

  const connect = useCallback(async (portOverride?: string) => {
    const target = portOverride ?? selectedPort;
    const api = bridge();
    if (!api || !target) return;
    setStatus('connecting');
    setLastError(null);
    setDistanceCm(null);
    let result: HardwareBridgeResult;
    try {
      result = await api.connect(target);
    } catch (error) {
      result = { ok: false, error: `connect failed: ${errorMessage(error)}` };
    }
    if (!mounted.current) return;
    if (result.ok) {
      setStatus('connected');
      if (typeof result.distanceCm === 'number') setDistanceCm(result.distanceCm);
      const interpreted = interpretProbe({
        diagnoseOk: result.diagnoseOk === true,
        diagnoseData: result.diagnoseData,
        diagnoseError: result.diagnoseError,
        legacyReadOk: true,
        legacyDeviceMs: typeof result.diagnoseData?.deviceMs === 'number'
      });
      setIdentity(interpreted.identity);
      setAdvice(interpreted.advice);
      startPolling();
      const lockApi = bridge()?.executionStatus;
      if (lockApi) void lockApi().then((lock) => { if (mounted.current) setExecLock(lock); }).catch(() => undefined);
    } else {
      setStatus('disconnected');
      setLastCommandAngle(null);
      setLastRequestedAngle(null);
      setLastError(result.error ?? (zh ? '连接失败' : 'connect failed'));
    }
  }, [selectedPort, startPolling, zh]);

  /** Zero-config path: scan every port, identify the firmware, connect. */
  const autoDetect = useCallback(async () => {
    const api = bridge();
    if (!api?.autoDetect) return;
    setDetecting(true);
    setLastError(null);
    setAdvice([]);
    setIdentity(null);
    try {
      const result = await api.autoDetect();
      if (!mounted.current) return;
      if (!result.ok || !result.results) {
        setLastError(result.error ?? 'auto-detect failed');
        setAdvice([adviceForFailure(result.error ?? 'auto-detect failed')]);
        return;
      }
      setPorts(result.results.map((entry) => ({ path: entry.path, label: entry.label })));
      const hit = result.results.find((entry) => entry.ok && entry.diagnoseOk)
        ?? result.results.find((entry) => entry.ok);
      if (!hit) {
        const firstError = result.results[0]?.error;
        setLastError(zh ? '未发现 RealityWarden 设备' : 'No RealityWarden device found');
        setAdvice([adviceForFailure(firstError ?? (result.results.length === 0 ? 'not found' : 'no valid response'))]);
        return;
      }
      const interpreted = interpretProbe({
        diagnoseOk: hit.diagnoseOk === true,
        diagnoseData: hit.diagnoseData,
        diagnoseError: hit.diagnoseError,
        legacyReadOk: hit.legacyReadOk,
        legacyDeviceMs: hit.legacyDeviceMs
      });
      setIdentity(interpreted.identity);
      setAdvice(interpreted.advice);
      setSelectedPort(hit.path);
      // Auto-connect unless the advisor found a blocker (e.g. no device clock:
      // the gate would refuse everything anyway - surface the fix first).
      if (interpreted.identity && !interpreted.advice.some((item) => item.severity === 'error')) {
        await connect(hit.path);
      }
    } catch (error) {
      if (mounted.current) {
        setLastError(errorMessage(error));
        setAdvice([adviceForFailure(errorMessage(error))]);
      }
    } finally {
      if (mounted.current) setDetecting(false);
    }
  }, [connect, zh]);

  const loadFirmwarePlan = useCallback(async (request: unknown = firmwareRequest) => {
    const api = bridge();
    if (!api?.firmwarePlan || !selectedPort || status !== 'connected') {
      setFirmwarePlan(null);
      return;
    }
    setFirmwareError(null);
    setFirmwareConfirmed(false);
    try {
      const result = await api.firmwarePlan(selectedPort, request);
      if (!mounted.current) return;
      if (result.ok && result.plan) {
        setFirmwarePlan(result.plan);
      } else {
        setFirmwarePlan(null);
        setFirmwareError(result.error ?? 'firmware plan unavailable');
      }
    } catch (error) {
      if (mounted.current) {
        setFirmwarePlan(null);
        setFirmwareError(errorMessage(error));
      }
    }
  }, [firmwareRequest, selectedPort, status]);

  useEffect(() => {
    if (status === 'connected') void loadFirmwarePlan();
    else {
      setFirmwarePlan(null);
      setFirmwareConfirmed(false);
    }
  }, [loadFirmwarePlan, status]);

  const selectWriteOrder = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const request = { source: 'write_order', order: parsed };
      setFirmwareRequest(request);
      setFirmwareOrderName(file.name);
      await loadFirmwarePlan(request);
    } catch (error) {
      setFirmwarePlan(null);
      setFirmwareOrderName(file.name);
      setFirmwareError(`write order rejected: ${errorMessage(error)}`);
    }
  }, [loadFirmwarePlan]);

  const useReviewedPrebuilt = useCallback(async () => {
    const request = { source: 'reviewed_prebuilt' };
    setFirmwareRequest(request);
    setFirmwareOrderName(null);
    await loadFirmwarePlan(request);
  }, [loadFirmwarePlan]);

  const flashFirmware = useCallback(async () => {
    const api = bridge();
    if (!api?.flashFirmware || !selectedPort || !firmwarePlan || !firmwareConfirmed) return;
    setFlashing(true);
    setFirmwareFeedback(null);
    setFirmwareError(null);
    stopPolling();
    setDistanceCm(null);
    setStatus('flashing');
    try {
      const result = await api.flashFirmware(selectedPort, firmwareRequest, firmwarePlan.sha256, firmwareConfirmed);
      if (!mounted.current) return;
      if (result.reconnected) {
        setStatus('connected');
        if (typeof result.distanceCm === 'number') setDistanceCm(result.distanceCm);
        const interpreted = interpretProbe({ diagnoseOk: Boolean(result.diagnoseData), diagnoseData: result.diagnoseData });
        setIdentity(interpreted.identity);
        setAdvice(interpreted.advice);
        startPolling();
      } else {
        setStatus('disconnected');
        setIdentity(null);
        setDistanceCm(null);
        setLastCommandAngle(null);
      }
      if (result.ok) {
        setFirmwareFeedback(zh
          ? `烧录完成；已重连并由 diagnose 验证固件 v${result.version}。`
          : `Flash complete; reconnected and diagnose verified firmware v${result.version}.`);
      } else {
        const detail = result.error ?? 'flash failed';
        setFirmwareError(detail);
        setAdvice([adviceForFailure(detail)]);
      }
    } catch (error) {
      if (mounted.current) {
        const detail = `flash failed without retry: ${errorMessage(error)}`;
        setStatus('disconnected');
        setIdentity(null);
        setFirmwareError(detail);
        setAdvice([adviceForFailure(detail)]);
      }
    } finally {
      if (mounted.current) {
        setFlashing(false);
        setFirmwareConfirmed(false);
      }
    }
  }, [firmwareConfirmed, firmwarePlan, firmwareRequest, selectedPort, startPolling, stopPolling, zh]);



  /** REAL actuation through the compiled gate chain (main process). */
  const executeAngle = useCallback(async (angle: number): Promise<HardwareExecuteOutcome | null> => {
    const api = bridge();
    if (!api?.execute || !selectedPort) return null;
    setLastRequestedAngle(angle);
    setExecuting(true);
    setExecOutcome(null);
    stopPolling(); // main process closes our read connection during execution
    let result: HardwareExecuteOutcome;
    try {
      result = await api.execute(selectedPort, angle, execConfirmed);
    } catch (error) {
      result = { ok: false, error: errorMessage(error) };
    } finally {
      if (mounted.current) {
        setExecuting(false);
        // The execution chain held the port exclusively and has released it;
        // reconnect the read-only panel automatically instead of leaving the
        // operator to do it by hand. A reconnect failure stays visible.
        setStatus('disconnected');
        setDistanceCm(null);
        await connect(selectedPort);
      }
    }
    if (mounted.current) {
      setExecOutcome(result);
      if (result.status === 'executed'
        && result.signalSent === true
        && result.signalState === 'device_acknowledged'
        && result.executionEvidence === 'command_acknowledged_open_loop') {
        setLastCommandAngle(typeof result.lastAcknowledgedAngle === 'number' ? result.lastAcknowledgedAngle : angle);
        setExecAngle(String(typeof result.lastAcknowledgedAngle === 'number' ? result.lastAcknowledgedAngle : angle));
      }
    }
    return result;
  }, [connect, execConfirmed, selectedPort, stopPolling]);

  const executeReal = useCallback(async () => {
    await executeAngle(Number(execAngle));
  }, [execAngle, executeAngle]);

  const jog = useCallback(async (delta: number) => {
    const base = lastCommandAngle ?? Number(execAngle);
    const target = base + delta;
    // Never clamp: even an out-of-range proposal is sent as-is to the gate,
    // which rejects it with zero hardware frames and an honest outcome.
    await executeAngle(target);
  }, [execAngle, executeAngle, lastCommandAngle]);

  const recordWaypoint = useCallback(() => {
    if (waypoints.length >= 16) {
      setTeachFeedback(zh ? '\u8def\u70b9\u4e0a\u9650\u4e3a 16\uff1b\u672a\u8bb0\u5f55\u65b0\u8def\u70b9\u3002' : 'Waypoint limit is 16; no new waypoint was recorded.');
      return;
    }
    if (lastRequestedAngle === null || !execOutcome) {
      setTeachFeedback(zh ? '\u5148\u6210\u529f\u6267\u884c\u4e00\u6b21\u70b9\u52a8\u6216\u89d2\u5ea6\u6307\u4ee4\u3002' : 'Execute a jog or angle command successfully first.');
      return;
    }
    const next = waypointAfterJog(waypoints, lastRequestedAngle, execOutcome);
    if (next.length === waypoints.length) {
      setTeachFeedback(zh ? '\u672c\u6b21\u6307\u4ee4\u672a\u88ab\u8bbe\u5907\u786e\u8ba4\uff0c\u8def\u70b9\u672a\u8bb0\u5f55\u3002' : 'The last command was not acknowledged; no waypoint was recorded.');
      return;
    }
    setWaypoints(next);
    setTeachFeedback(zh ? `\u5df2\u8bb0\u5f55 ${lastRequestedAngle}\u00b0\uff08\u5f00\u73af\u6307\u4ee4\uff09` : `Recorded ${lastRequestedAngle}\u00b0 (open-loop command)`);
  }, [execOutcome, lastRequestedAngle, waypoints, zh]);

  const saveTeachAction = useCallback(() => {
    setTeachFeedback(null);
    if (actions.some((item) => item.action_id === teachActionId)) {
      setTeachFeedback(zh ? `\u52a8\u4f5c ID \u5df2\u5b58\u5728\uff1a${teachActionId}\uff1b\u5df2\u62d2\u7edd\u8986\u76d6\u3002` : `Action ID already exists: ${teachActionId}; overwrite rejected.`);
      return;
    }
    const checked = validateActionManifest(
      buildTeachManifest(teachActionId, teachActionName, waypoints),
      REAL_SERVO_TEACH_DEVICE_META,
      REAL_TEACH_BUILTIN_INTENT_IDS
    );
    if (!checked.ok) {
      setTeachFeedback(`${checked.code}: ${checked.detail}`);
      return;
    }
    onSaveAction(checked.manifest);
    setTeachFeedback(zh ? `\u5df2\u4fdd\u5b58\u52a8\u4f5c ${checked.manifest.action_id}` : `Saved action ${checked.manifest.action_id}`);
  }, [actions, onSaveAction, teachActionId, teachActionName, waypoints, zh]);

  const replayTeachAction = useCallback(async (manifest: ActionManifest) => {
    const api = bridge();
    if (!api?.executeManifest || !selectedPort) return;
    setExecuting(true);
    setExecOutcome(null);
    stopPolling();
    let result: HardwareExecuteOutcome;
    try {
      // The main process distrusts and revalidates this manifest, expands it,
      // then runs every primitive through HardwareActionSequenceRunner.
      result = await api.executeManifest(selectedPort, manifest, execConfirmed);
    } catch (error) {
      result = { ok: false, error: errorMessage(error) };
    } finally {
      if (mounted.current) {
        setExecuting(false);
        setStatus('disconnected');
        setDistanceCm(null);
        await connect(selectedPort);
      }
    }
    if (mounted.current) {
      setExecOutcome(result);
      if (typeof result.lastAcknowledgedAngle === 'number') {
        setLastCommandAngle(result.lastAcknowledgedAngle);
        setExecAngle(String(result.lastAcknowledgedAngle));
      }
    }
  }, [connect, execConfirmed, selectedPort, stopPolling]);

  /**
   * Promote-to-Real natural-language path. The parse result is derived state:
   * editing the text immediately re-parses, so a stale sequence can never be
   * submitted. The manifest built here is an UNTRUSTED proposal; the main
   * process revalidates it with the authoritative Action Manifest validator
   * and runs every primitive through HardwareActionSequenceRunner (new sensor
   * generation + HardwareExecutionGate per step, zero frames after a block).
   */
  const nlParse = useMemo(() => {
    const text = nlText.trim();
    if (text.length === 0) return null;
    // Layer 1: exact rule parser (explicit angles). Layer 2: deterministic
    // vocabulary (named positions / sequences). Neither guesses; if both refuse
    // the whole command is rejected. Whatever they yield is still an UNTRUSTED
    // proposal that must pass the reference-servo preflight before execution.
    const strict = parseRealNaturalCommand(text);
    if (strict.ok) return { ok: true as const, angles: strict.angles };
    const intent = parseServoIntent(text);
    if (intent.ok) return { ok: true as const, angles: intent.angles };
    return { ok: false as const, detail: intent.detail };
  }, [nlText]);

  const executeNaturalCommand = useCallback(async () => {
    setNlFeedback(null);
    if (!nlParse || !nlParse.ok) return;
    const displayName = nlText.trim().slice(0, 60) || 'real nl command';
    // Preflight this REAL-panel intent through the reviewed 1-DOF reference
    // twin before actuation. A block yields no proposal and never reaches the
    // gate. This is local to the reference rig, not the generic left workspace,
    // and adds no IPC or execution channel.
    const preflight = prepareRealProposalFromIntent(nlParse.angles, {
      actionId: 'real_nl_command',
      displayName
    });
    if (!preflight.ok) {
      setNlFeedback(`reference-servo preflight ${preflight.stage} blocked: ${preflight.reason}`);
      return;
    }
    const checked = validateActionManifest(
      buildTeachManifest('real_nl_command', displayName, nlParse.angles),
      REAL_SERVO_TEACH_DEVICE_META,
      REAL_TEACH_BUILTIN_INTENT_IDS
    );
    if (!checked.ok) {
      // Honest rejection from the same authoritative validator the main
      // process uses (e.g. an explicit 200 degrees is out of [0,180]):
      // reject, never clamp, never edit the operator's sequence.
      setNlFeedback(`${checked.code}: ${checked.detail}`);
      return;
    }
    await replayTeachAction(checked.manifest);
  }, [nlParse, nlText, replayTeachAction]);

  const runReferenceServoPreflight = useCallback(() => {
    // Hardware-local dry run through the reviewed 1-DOF reference twin.
    // Nothing here reaches hardware or consumes the generic left simulation.
    setNlFeedback(null);
    if (!nlParse || !nlParse.ok) {
      setPreviewResult(null);
      return;
    }
    const displayName = nlText.trim().slice(0, 60) || 'real nl command';
    const result = prepareRealProposalFromIntent(nlParse.angles, {
      actionId: 'real_nl_command',
      displayName
    });
    setPreviewResult(result);
    // Receipt: record this no-signal preflight into an audit log. It goes
    // through decision(), which enforces the no-signal invariant, so every
    // receipt provably shows hardwareSignalSent=false.
    if (!preflightAuditLogRef.current) preflightAuditLogRef.current = new RuntimeAuditLog();
    recordReferenceServoPreflightDecision(preflightAuditLogRef.current, result, { intent: nlText });
    setPreflightReceipts(preflightAuditLogRef.current.list());
  }, [nlParse, nlText]);

  const preview = previewResult ? formatReferenceServoPreflight(previewResult, zh) : null;

  const preflightAndReplayTeach = useCallback(async (manifest: ActionManifest) => {
    // Saved teach actions use the same hardware-local preflight before replay.
    // A blocked preflight never reaches the real execution gate.
    setNlFeedback(null);
    const extracted = extractManifestAngles(manifest);
    if (!extracted.ok) {
      setTeachFeedback(zh ? `参考伺服器预检拦截：${extracted.reason}` : `Reference-servo preflight blocked: ${extracted.reason}`);
      return;
    }
    const result = prepareRealProposalFromIntent(extracted.angles, {
      actionId: 'teach_replay',
      displayName: manifest.action_id
    });
    setPreviewResult(result);
    if (!preflightAuditLogRef.current) preflightAuditLogRef.current = new RuntimeAuditLog();
    recordReferenceServoPreflightDecision(preflightAuditLogRef.current, result, { intent: `teach:${manifest.action_id}` });
    setPreflightReceipts(preflightAuditLogRef.current.list());
    if (!result.ok) {
      return;
    }
    await replayTeachAction(manifest);
  }, [replayTeachAction, zh]);

  // Advice shown to the operator: structured probe advice wins; otherwise the
  // last raw error is classified on the fly so no failure is ever unexplained.
  const shownAdvice: SetupAdvice[] = advice.length > 0
    ? advice
    : lastError
      ? [adviceForFailure(lastError)]
      : [];
  const teachActions = actions.filter((manifest) => {
    const checked = validateActionManifest(manifest, REAL_SERVO_TEACH_DEVICE_META, REAL_TEACH_BUILTIN_INTENT_IDS);
    return checked.ok;
  });

  const statusText = !available
    ? (zh ? '不可用（仅桌面版）' : 'unavailable (desktop app only)')
    : status === 'connected'
      ? (zh ? `已连接 ${selectedPort}` : `connected ${selectedPort}`)
      : status === 'flashing'
        ? (zh ? `烧录中 · 串口已断开 ${selectedPort}` : `flashing · serial disconnected ${selectedPort}`)
      : status === 'connecting'
        ? (zh ? '连接中…' : 'connecting…')
        : (zh ? '未连接' : 'not connected');
  const dotClass = status === 'connected'
    ? 'bg-status-executed'
    : status === 'connecting' || status === 'flashing'
      ? 'bg-status-warning'
      : 'bg-[#5F6670]';

  return (
    <div
      className="shrink-0 border-t-2 border-status-warning-edge bg-[#171310]"
      data-real-hardware-bridge-ready={available ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left"
        title={zh
          ? '独立的真实硬件边界；执行受证据锁、人工确认和安全门控制。'
          : 'Independent real-hardware boundary; execution requires the evidence lock, operator confirmation, and safety gate.'}
      >
        <span className="rounded-[3px] border border-status-warning-edge bg-status-warning-surface px-1.5 text-[11px] font-bold uppercase tracking-wide text-status-warning">
          REAL HARDWARE
        </span>
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">{statusText}</span>
        <span className="text-[11px] font-bold text-text-secondary">{expanded ? 'v' : '^'}</span>
      </button>
      {expanded && (
        <div className="flex max-h-[calc(100vh-80px)] flex-col gap-2 overflow-y-auto border-t border-[#3a2f1d] px-3 py-2 text-[12px]">
          {!available ? (
            <div className="text-text-secondary">
              {zh
                ? '真实硬件桥接仅在桌面版（Electron）中可用。当前为网页模式，所有运行均为仿真，未向任何硬件发送信号。'
                : 'The real-hardware bridge is only available in the desktop (Electron) build. This is web mode: every run is simulated and no signal reaches any hardware.'}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <select
                  value={selectedPort}
                  onChange={(event) => setSelectedPort(event.target.value)}
                  disabled={status !== 'disconnected'}
                  className="h-7 min-w-0 flex-1 rounded-[3px] border border-border-panel bg-[#0B0C0E] px-1 text-[12px] text-text-primary"
                >
                  {ports.length === 0 && <option value="">{zh ? '（无串口，先点刷新）' : '(no ports - refresh first)'}</option>}
                  {ports.map((port) => (
                    <option key={port.path} value={port.path}>
                      {port.path}{port.label ? ` — ${port.label}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void autoDetect()}
                  disabled={detecting || status !== 'disconnected' || !bridge()?.autoDetect}
                  title={zh
                    ? '扫描所有串口，自动识别 RealityWarden 固件并连接（只读探测，不会驱动舵机）。'
                    : 'Scan every serial port, identify RealityWarden firmware and connect (read-only probe, never actuates).'}
                  className="h-7 rounded-[3px] border border-status-warning-edge px-2 text-[12px] font-semibold text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                >
                  {detecting ? (zh ? '检测中…' : 'Detecting…') : (zh ? '自动检测' : 'Auto-detect')}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshPorts()}
                  disabled={listing || status !== 'disconnected'}
                  className="h-7 rounded-[3px] border border-border-panel px-2 text-[12px] text-text-secondary hover:bg-[#232736] disabled:opacity-40"
                >
                  {listing ? (zh ? '刷新中…' : 'listing…') : (zh ? '刷新' : 'Refresh')}
                </button>
                {status === 'connected' ? (
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    className="h-7 rounded-[3px] border border-[#5A2B2B] px-2 text-[12px] text-[#F87171] hover:bg-[#2A1111]"
                  >
                    {zh ? '断开' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void connect()}
                    disabled={!selectedPort || status === 'connecting'}
                    className="h-7 rounded-[3px] border border-status-warning-edge px-2 text-[12px] text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                  >
                    {status === 'connecting' ? (zh ? '连接中…' : 'Connecting…') : (zh ? '连接' : 'Connect')}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 font-mono text-[12px]">
                <span className="text-text-secondary">{zh ? '距离传感器' : 'distance sensor'}:</span>
                <span className={distanceCm === null ? 'text-text-secondary' : 'text-status-executed'}>
                  {status !== 'connected'
                    ? (zh ? '—（未连接）' : '- (not connected)')
                    : distanceCm === null
                      ? (zh ? '无读数' : 'no reading')
                      : `${distanceCm.toFixed(1)} cm`}
                </span>
              </div>
              {identity && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 font-semibold text-[#38BDF8]">
                    {identity.legacy
                      ? (zh ? 'RealityWarden（旧版固件）' : 'RealityWarden (legacy firmware)')
                      : `RealityWarden v${identity.firmwareVersion ?? '?'}`}
                  </span>
                  {identity.sensorModel && (
                    <span className="rounded-[3px] border border-border-panel bg-[#232529] px-1.5 py-0.5 text-text-secondary">
                      {identity.sensorModel} · {identity.sensorInterface ?? '?'}
                    </span>
                  )}
                  <span className={`rounded-[3px] border px-1.5 py-0.5 font-semibold ${identity.reportsDeviceMs ? 'border-status-executed-edge text-status-executed-soft' : 'border-status-blocked-edge text-status-blocked-soft'}`}>
                    {identity.reportsDeviceMs
                      ? (zh ? '设备时钟正常' : 'device clock OK')
                      : (zh ? '缺设备时钟（会被安全门拦截）' : 'no device clock (gate will block)')}
                  </span>
                </div>
              )}
              {lastError && (
                <div className="break-all font-mono text-[11px] text-status-blocked-soft">{lastError}</div>
              )}
              {shownAdvice.length > 0 && (
                <div className="flex flex-col gap-1">
                  {shownAdvice.map((item) => (
                    <div
                      key={item.code}
                      className={`rounded-[3px] border px-2 py-1 text-[11px] leading-4 ${item.severity === 'ok' ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : item.severity === 'warning' ? 'border-status-warning-edge bg-status-warning-surface text-status-warning' : 'border-status-blocked-edge bg-status-blocked-surface text-status-blocked-soft'}`}
                    >
                      {zh ? item.zh : item.en}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {(status === 'connected' || status === 'flashing') && bridge()?.firmwarePlan && (
            <section
              aria-label={zh ? '固件' : 'Firmware'}
              className="flex flex-col gap-1.5 border-t border-status-warning-edge pt-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-status-warning">{zh ? '固件' : 'Firmware'}</span>
                <span className="text-[10px] text-text-muted">
                  {zh ? '仅限已审镜像 · 不接受任意 BIN/代码' : 'Reviewed images only · no arbitrary BIN/code'}
                </span>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono text-[11px]">
                <span className="text-text-muted">{zh ? '当前版本' : 'current version'}</span>
                <span className="text-text-primary">{identity?.firmwareVersion ?? (zh ? 'diagnose 未确认' : 'not confirmed by diagnose')}</span>
                <span className="text-text-muted">{zh ? '当前接口' : 'current interface'}</span>
                <span className="text-text-primary">{identity?.sensorInterface ?? (zh ? 'diagnose 未确认' : 'not confirmed by diagnose')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void useReviewedPrebuilt()}
                  disabled={flashing}
                  className="h-7 rounded-[3px] border border-status-warning-edge px-2 text-[11px] font-semibold text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                >
                  {zh ? '使用仓库已审镜像' : 'Use reviewed prebuilt'}
                </button>
                <label className="flex h-7 cursor-pointer items-center rounded-[3px] border border-border-panel px-2 text-[11px] text-text-secondary hover:bg-[#232736]">
                  {zh ? '载入写入令 JSON' : 'Load write-order JSON'}
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={flashing}
                    className="sr-only"
                    onChange={(event) => void selectWriteOrder(event.target.files?.[0])}
                  />
                </label>
                {firmwareOrderName && <span className="max-w-40 truncate text-[10px] text-text-muted">{firmwareOrderName}</span>}
              </div>
              {firmwarePlan && (
                <div className="rounded-[3px] border border-status-warning-edge bg-status-warning-surface px-2 py-1.5 text-[11px] leading-4">
                  <div><span className="text-text-muted">{zh ? '目标端口' : 'target port'}:</span> <span className="font-mono text-status-warning">{selectedPort}</span></div>
                  <div><span className="text-text-muted">{zh ? '镜像版本/接口' : 'image version/interface'}:</span> <span className="font-mono text-text-primary">v{firmwarePlan.version} · {firmwarePlan.sensorInterface}</span></div>
                  <div className="break-all"><span className="text-text-muted">sha256:</span> <span className="font-mono text-text-primary">{firmwarePlan.sha256}</span></div>
                  <div className="text-text-muted">{(firmwarePlan.byteLength / 1024 / 1024).toFixed(2)} MiB · {zh ? '合并镜像地址' : 'merged image address'} 0x{firmwarePlan.address.toString(16)}</div>
                </div>
              )}
              {firmwareError && (
                <div role="alert" className="rounded-[3px] border border-status-blocked-edge bg-status-blocked-surface px-2 py-1 text-[11px] leading-4 text-status-blocked-soft">
                  {firmwareError}
                </div>
              )}
              {firmwareFeedback && <div role="status" className="text-[11px] text-status-executed-soft">{firmwareFeedback}</div>}
              <label className="flex items-start gap-1.5 text-[11px] leading-4 text-text-secondary">
                <input
                  type="checkbox"
                  checked={firmwareConfirmed}
                  disabled={!firmwarePlan || flashing}
                  onChange={(event) => setFirmwareConfirmed(event.target.checked)}
                />
                {zh
                  ? '我已核对上方目标端口、镜像版本和 sha256，并确认现在可以断开串口连接进行烧录。'
                  : 'I verified the target port, image version, and sha256 above, and confirm the serial connection may be closed for flashing.'}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void flashFirmware()}
                  disabled={!firmwarePlan || !firmwareConfirmed || flashing || !bridge()?.flashFirmware}
                  className="h-7 rounded-[3px] border border-status-blocked-edge px-2 text-[11px] font-bold text-status-blocked-soft hover:bg-status-blocked-surface disabled:opacity-40"
                >
                  {flashing ? (zh ? '烧录中（不会静默重试）…' : 'Flashing (no silent retry)…') : (zh ? '烧录已审固件' : 'Flash reviewed firmware')}
                </button>
                <span className="text-[10px] text-text-muted">
                  {zh ? '完成后自动重连并运行 diagnose' : 'Reconnects and runs diagnose after completion'}
                </span>
              </div>
              {identity?.sensorInterface === 'serial_ttl' && (
                <div className="text-[11px] font-semibold text-status-warning">
                  {zh ? '该配置暂无已审镜像；不会回退到现场编译。' : 'No reviewed image is available for this configuration; there is no live-compile fallback.'}
                </div>
              )}
            </section>
          )}
          {status === 'connected' && bridge()?.execute && (
            <div className="flex flex-col gap-1.5 border-t border-[#3a2f1d] pt-2">
              <div className="flex items-center gap-2">
                <span className="rounded-[3px] border border-status-blocked-edge bg-status-blocked-surface px-1.5 text-[11px] font-bold uppercase tracking-wide text-status-blocked-soft">
                  {zh ? '真机执行' : 'REAL EXECUTION'}
                </span>
                {execLock?.locked === false ? (
                  <span className="text-[11px] text-status-executed-soft">{zh ? `已解锁（验收证据 ${execLock.evidenceCount ?? 0}/4）` : `unlocked (evidence ${execLock.evidenceCount ?? 0}/4)`}</span>
                ) : (
                  <span className="text-[11px] text-status-warning">{zh ? `锁定中（验收证据 ${execLock?.evidenceCount ?? 0}/4）` : `locked (evidence ${execLock?.evidenceCount ?? 0}/4)`}</span>
                )}
              </div>
              {execLock?.locked !== false ? (
                <div className="rounded-[3px] border border-status-warning-edge bg-status-warning-surface px-2 py-1 text-[11px] leading-4 text-status-warning">
                  {zh
                    ? '完成四场景验收并把 4 份审计 JSON 存入 docs/acceptance/evidence/ 后自动解锁（操作卡：docs/acceptance/OPERATOR_CARD.md）。'
                    : 'Unlocks automatically once the four acceptance audit JSON files exist in docs/acceptance/evidence/ (see docs/acceptance/OPERATOR_CARD.md).'}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-secondary">{zh ? '目标角度' : 'target angle'}</span>
                    <input
                      value={execAngle}
                      onChange={(event) => setExecAngle(event.target.value)}
                      inputMode="numeric"
                      className="h-7 w-16 rounded-[3px] border border-border-panel bg-[#0B0C0E] px-2 text-[12px] text-text-primary"
                    />
                    <span className="text-[11px] text-text-secondary">0–180°</span>
                    <button
                      type="button"
                      onClick={() => void executeReal()}
                      disabled={executing || !execConfirmed}
                      className="h-7 rounded-[3px] border border-status-blocked-edge px-2 text-[12px] font-semibold text-status-blocked-soft hover:bg-status-blocked-surface disabled:opacity-40"
                    >
                      {executing ? (zh ? '执行中…' : 'Executing…') : (zh ? '通过安全门执行' : 'Execute via gate')}
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                    <input type="checkbox" checked={execConfirmed} onChange={(event) => setExecConfirmed(event.target.checked)} />
                    {zh ? '我确认设备周围无人且可以安全动作' : 'I confirm the rig area is clear and safe to move'}
                  </label>
                  <div className="text-[11px] leading-4 text-text-muted">
                    {zh
                      ? '执行走完整安全链：传感器采样→中值→互锁→安全门。缺读数/过近/越界都会被拦截并如实审计。'
                      : 'Execution runs the full safety chain: sensor sampling, median, interlock, gate. Missing data / close obstacle / out-of-range all block, honestly audited.'}
                  </div>
                  <div className="mt-1 flex flex-col gap-1.5 border-t border-status-warning-edge pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-bold text-status-warning">
                        {zh ? '自然语言指令（REAL · 规则解析）' : 'Natural-language command (REAL · rule parser)'}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {zh ? '每一步都过安全门' : 'Every step runs the gate'}
                      </span>
                    </div>
                    <input
                      value={nlText}
                      onChange={(event) => { setNlText(event.target.value); setPreviewResult(null); }}
                      placeholder={zh ? '例：转到45度；左边，再归零；居中' : 'e.g. 45 degrees; left then home; center'}
                      className="h-7 w-full rounded-[3px] border border-border-panel bg-[#0B0C0E] px-2 text-[12px] text-text-primary"
                      aria-label={zh ? '自然语言真机指令' : 'Natural-language real command'}
                    />
                    {nlParse && (nlParse.ok ? (
                      <div className="flex flex-wrap items-center gap-1" aria-label={zh ? '解析出的执行步骤' : 'Parsed execution steps'}>
                        {nlParse.angles.map((angle, index) => (
                          <span key={`${index}-${angle}`} className="rounded-[3px] border border-status-warning-edge bg-status-warning-surface px-1.5 py-0.5 font-mono text-[11px] text-status-warning">
                            {index + 1}. {angle}&deg;
                          </span>
                        ))}
                        <span className="text-[10px] text-text-muted">
                          {zh ? `共 ${nlParse.angles.length} 步` : `${nlParse.angles.length} step(s)`}
                        </span>
                      </div>
                    ) : (
                      <div className="text-[11px] leading-4 text-status-warning">
                        {zh ? `无法解析：${nlParse.detail}` : `Cannot parse: ${nlParse.detail}`}
                      </div>
                    ))}
                    {nlFeedback && <div className="text-[11px] leading-4 text-status-warning">{nlFeedback}</div>}
                    <button
                      type="button"
                      onClick={() => runReferenceServoPreflight()}
                      disabled={executing || !nlParse || !nlParse.ok}
                      className="h-7 self-start rounded-[3px] border border-status-warning-edge px-2 text-[12px] font-semibold text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                    >
                      {zh ? '参考伺服器预检（不发信号）' : 'Reference-servo preflight (no signal)'}
                    </button>
                    {preview && (
                      <div
                        className={`rounded-[3px] border px-2 py-1 text-[11px] leading-4 ${preview.ok ? 'border-status-executed-edge text-status-executed-soft' : 'border-status-blocked-edge text-status-blocked-soft'}`}
                        aria-label={zh ? '参考伺服器预检结果' : 'Reference-servo preflight result'}
                      >
                        <div className="font-semibold">{preview.headline}</div>
                        <div className="font-mono text-text-muted">{preview.detail}</div>
                      </div>
                    )}
                    {preflightReceipts.length > 0 && (
                      <div className="flex flex-col gap-0.5 rounded-[3px] border border-border-panel bg-[#0B0C0E] px-2 py-1" aria-label={zh ? '预检回执（未发信号）' : 'Preflight receipts (no signal sent)'}>
                        <div className="text-[10px] font-semibold text-text-muted">
                          {zh ? `参考伺服器预检回执 · ${preflightReceipts.length} 条 · 全部 hardwareSignalSent=false` : `Reference-servo preflight receipts · ${preflightReceipts.length} · all hardwareSignalSent=false`}
                        </div>
                        {preflightReceipts.slice(-4).map((entry) => (
                          <div key={entry.id} className={`font-mono text-[10px] leading-4 ${entry.level === 'warn' ? 'text-status-blocked-soft' : 'text-status-executed-soft'}`}>
                            {entry.code}: {entry.message}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void executeNaturalCommand()}
                      disabled={executing || !execConfirmed || !nlParse || !nlParse.ok || !previewResult?.ok}
                      className="h-7 self-start rounded-[3px] border border-status-blocked-edge px-2 text-[12px] font-semibold text-status-blocked-soft hover:bg-status-blocked-surface disabled:opacity-40"
                    >
                      {executing ? (zh ? '执行中…' : 'Executing…') : (zh ? '通过安全门执行解析序列' : 'Execute parsed sequence via gate')}
                    </button>
                    <div className="text-[10px] leading-4 text-text-muted">
                      {zh
                        ? '确定性理解（非 LLM）：显式角度 + 受控词表（左/中/右/归零、偏左偏右、“X 再 Y”序列）；词表外整条拒绝，绝不猜测；越界角度由验证器与安全门拒绝，绝不钳制。理解结果只是提案，须先通过参考伺服器预检。这不是左侧通用仿真工作区。'
                        : 'Deterministic understanding (not an LLM): explicit angles plus a controlled vocabulary (left/center/right/home, half-left/right, "X then Y" sequences); anything outside it is rejected as a whole, never guessed. Out-of-range angles are rejected downstream, never clamped. The result is only a proposal and must pass the reference-servo preflight. This is not the generic simulation workspace on the left.'}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-col gap-2 border-t border-status-warning-edge pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-bold text-status-warning">
                        {zh ? '\u793a\u6559\u6a21\u5f0f\uff08REAL \u70b9\u52a8\uff09' : 'Teach mode (REAL jog)'}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {zh ? '\u6bcf\u6b21\u70b9\u52a8\u90fd\u662f\u5b8c\u6574 gated \u6307\u4ee4' : 'Every jog is a complete gated command'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[-5, -1, 1, 5].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          onClick={() => void jog(delta)}
                          disabled={executing || !execConfirmed}
                          className="h-7 min-w-10 rounded-[3px] border border-status-warning-edge px-2 font-mono text-[12px] font-bold text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                        >
                          {delta > 0 ? '+' : ''}{delta}&deg;
                        </button>
                      ))}
                      <span className="ml-1 text-[11px] text-text-secondary">
                        {zh ? '\u6700\u540e\u786e\u8ba4\u7684\u6307\u4ee4\u89d2\u5ea6' : 'last acknowledged command'}: {lastCommandAngle === null ? '\u2014' : `${lastCommandAngle}\u00b0`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={recordWaypoint}
                        disabled={executing || waypoints.length >= 16}
                        className="h-7 rounded-[3px] border border-status-executed-edge px-2 text-[11px] font-semibold text-status-executed-soft hover:bg-status-executed-surface disabled:opacity-40"
                      >
                        {zh ? '\u8bb0\u5f55\u8def\u70b9' : 'Record waypoint'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setWaypoints([]); setTeachFeedback(null); }}
                        disabled={waypoints.length === 0}
                        className="h-7 rounded-[3px] border border-border-panel px-2 text-[11px] text-text-secondary disabled:opacity-40"
                      >
                        {zh ? '\u6e05\u7a7a' : 'Clear'}
                      </button>
                      <span className="text-[11px] text-text-muted">{waypoints.length}/16</span>
                    </div>
                    {waypoints.length > 0 && (
                      <ol className="flex flex-wrap gap-1" aria-label={zh ? '\u5df2\u8bb0\u5f55\u8def\u70b9' : 'Recorded waypoints'}>
                        {waypoints.map((angle, index) => (
                          <li key={`${index}-${angle}`} className="flex items-center rounded-[3px] border border-border-panel bg-[#0B0C0E] pl-2 font-mono text-[11px] text-text-primary">
                            {index + 1}. {angle}&deg;
                            <button
                              type="button"
                              onClick={() => setWaypoints((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                              className="ml-1 h-6 px-1.5 text-status-blocked-soft"
                              aria-label={zh ? `\u5220\u9664\u8def\u70b9 ${index + 1}` : `Delete waypoint ${index + 1}`}
                            >
                              x
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
                      <input
                        value={teachActionId}
                        onChange={(event) => setTeachActionId(event.target.value)}
                        aria-label={zh ? '\u52a8\u4f5c ID' : 'Action ID'}
                        placeholder="taught_motion"
                        className="h-7 min-w-0 rounded-[3px] border border-border-panel bg-[#0B0C0E] px-2 text-[11px] text-text-primary"
                      />
                      <input
                        value={teachActionName}
                        onChange={(event) => setTeachActionName(event.target.value)}
                        aria-label={zh ? '\u52a8\u4f5c\u540d\u79f0' : 'Action name'}
                        className="h-7 min-w-0 rounded-[3px] border border-border-panel bg-[#0B0C0E] px-2 text-[11px] text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={saveTeachAction}
                        disabled={waypoints.length === 0}
                        className="h-7 rounded-[3px] border border-status-warning-edge px-2 text-[11px] font-semibold text-status-warning hover:bg-status-warning-surface disabled:opacity-40"
                      >
                        {zh ? '\u4fdd\u5b58\u4e3a\u52a8\u4f5c' : 'Save as action'}
                      </button>
                    </div>
                    {teachActions.length > 0 && (
                      <div className="flex flex-col gap-1 border-t border-[#3a2f1d] pt-1.5">
                        <span className="text-[11px] font-semibold text-text-secondary">{zh ? '\u5df2\u4fdd\u5b58\u7684\u793a\u6559\u52a8\u4f5c' : 'Saved teach actions'}</span>
                        {teachActions.map((manifest) => (
                          <div key={manifest.action_id} className="flex items-center gap-2 text-[11px]">
                            <span className="min-w-0 flex-1 truncate text-text-primary">{manifest.action_id} &middot; {manifest.steps.length} {zh ? '\u6b65' : 'steps'}</span>
                            <button
                              type="button"
                              onClick={() => void preflightAndReplayTeach(manifest)}
                              disabled={executing || !execConfirmed}
                              className="h-7 rounded-[3px] border border-status-blocked-edge px-2 font-semibold text-status-blocked-soft hover:bg-status-blocked-surface disabled:opacity-40"
                            >
                              {zh ? '\u901a\u8fc7\u5b89\u5168\u95e8\u56de\u653e' : 'Replay via gate'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {teachFeedback && <div role="status" className="break-all text-[11px] text-status-warning">{teachFeedback}</div>}
                  </div>
                </>
              )}
              {execOutcome && (
                <div className={`rounded-[3px] border px-2 py-1 font-mono text-[11px] leading-4 ${execOutcome.status === 'executed' ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-blocked-edge bg-status-blocked-surface text-status-blocked-soft'}`}>
                  <div>
                    [{execOutcome.executionMode ?? 'real_hardware'}] {execOutcome.status ?? 'error'}
                    {typeof execOutcome.signalSent === 'boolean' ? ` · hardwareSignalSent=${String(execOutcome.signalSent)}` : ''}
                    {execOutcome.signalState ? ` · ${execOutcome.signalState}` : ''}
                    {typeof execOutcome.distanceCm === 'number' ? ` · ${execOutcome.distanceCm.toFixed(1)} cm` : ''}
                  </div>
                  <div className="break-all">{execOutcome.reason ?? execOutcome.error ?? execOutcome.detail}</div>
                  {execOutcome.executionEvidence === 'command_acknowledged_open_loop' && (
                    <div className="mt-1 border-t border-status-executed-edge pt-1 font-sans font-semibold">
                      {zh
                        ? '设备已确认命令；SG90 为开环舵机，物理角度/到位状态未经反馈验证。'
                        : 'Device acknowledged the command; the open-loop SG90 provides no feedback proving physical angle or arrival.'}
                    </div>
                  )}
                  {execOutcome.signalState === 'attempted_unconfirmed' && (
                    <div className="mt-1 border-t border-status-blocked-edge pt-1 font-sans font-semibold">
                      {zh
                        ? '主机已尝试发送，但设备未确认交付；不得视为未动作，也不得视为执行成功。'
                        : 'Host transmission was attempted but delivery was not acknowledged; treat this as neither known-safe non-motion nor successful execution.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-[#3a2f1d] pt-1.5 text-[11px] text-text-secondary">
            {zh
              ? 'AI Command Terminal 默认运行仿真；真实执行只存在于此独立危险边界，并受证据锁、逐次人工确认与完整安全门控制。'
              : 'AI Command Terminal runs simulation by default. Real actuation exists only inside this independent danger boundary with evidence lock, per-run confirmation, and the full safety gate.'}
          </div>
        </div>
      )}
    </div>
  );
}
