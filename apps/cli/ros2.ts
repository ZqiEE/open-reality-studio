import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { load } from "js-yaml";
import {
  CloudConnectedRos2Workflow,
  FileProposalReplayRegistry,
  RlsokCloudClient,
  executionMode,
  loadCloudClientConfig,
} from "../../packages/cloud-client";
import {
  appendEvidence,
  verifyEvidenceBundle,
  type ChainedEvidence,
  type EvidenceBundle,
  type ExecutionEvidence,
} from "../../packages/core/evidence";
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec,
} from "../../packages/core/exec-spec";
import type { EvidenceSink } from "../../packages/core/execution-gate";
import {
  executionConfigurationSchema,
  type ExecutionConfiguration,
} from "../../packages/core/execution-configuration";
import type { ReleaseRecord } from "../../packages/core/release-policy";
import {
  InMemoryReleaseResolver,
  InMemoryReleaseRecordStore,
  Ros2ReferenceGateway,
  ros2ProposalEnvelopeSchema,
} from "../../packages/ros2-reference-gateway";
import { PythonRos2SidecarTransport } from "../../packages/ros2-reference-gateway/sidecar";
import { operatorFailureReport } from "./operator-report";

type Options = Record<string, string>;
const MAXIMUM_PROPOSAL_BYTES = 65_536;

function configRoot(source: NodeJS.ProcessEnv = process.env): string {
  return source.RLSOK_CONFIG_HOME
    ?? (source.XDG_CONFIG_HOME
      ? join(source.XDG_CONFIG_HOME, "rlsok")
      : join(homedir(), ".config", "rlsok"));
}

export function defaultRos2EvidencePath(
  scope: "standalone" | "cloud",
  mode: "shadow" | "run",
  spec: ExecutablePolicySpec,
  runId = randomUUID(),
): string {
  const prefix = scope === "cloud" ? "ros2-cloud" : "ros2";
  return resolve(
    "evidence",
    `${prefix}-${mode}-${executablePolicyHash(spec)}-${runId}.json`,
  );
}

function synchronizeDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function synchronizeDirectoryEntryChain(path: string): void {
  if (process.platform === "win32") return;
  let cursor = resolve(path);
  while (true) {
    const parent = dirname(cursor);
    if (parent === cursor) return;
    synchronizeDirectory(parent);
    cursor = parent;
  }
}

function ensureDurableDirectory(path: string): void {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (true) {
    try {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("private_output_parent_invalid");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(cursor);
      cursor = parent;
    }
  }
  let existing = cursor;
  while (true) {
    const stat = lstatSync(existing);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("private_output_parent_invalid");
    }
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  for (const directory of missing.reverse()) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("private_output_parent_invalid");
    }
    synchronizeDirectory(dirname(directory));
  }
  let verified = resolve(path);
  while (true) {
    const stat = lstatSync(verified);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("private_output_parent_invalid");
    }
    const parent = dirname(verified);
    if (parent === verified) break;
    verified = parent;
  }
  // Another process may have created any observed component but crashed before
  // syncing its parent. Every user of the path completes that durability chain.
  synchronizeDirectoryEntryChain(path);
}

function writePrivateAtomic(path: string, content: string): void {
  ensureDurableDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.rlsok-tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    if (process.platform !== "win32") {
      chmodSync(path, 0o600);
      synchronizeDirectory(dirname(path));
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function reservePrivateOutput(path: string): void {
  ensureDurableDirectory(dirname(path));
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "wx", 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (process.platform !== "win32") {
      chmodSync(path, 0o600);
      synchronizeDirectory(dirname(path));
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("evidence_output_already_exists");
    }
    throw error;
  }
}

/** Owns one explicit result path for one process run and never adopts old bytes. */
export class PrivateResultFile {
  constructor(private readonly outputPath: string) {
    reservePrivateOutput(outputPath);
  }

  write(content: string): void {
    writePrivateAtomic(this.outputPath, content);
  }
}

export function parseProposalIdentity(payload: string): {
  deviceId: string;
  proposerIdentity: string;
} {
  try {
    if (Buffer.byteLength(payload, "utf8") > MAXIMUM_PROPOSAL_BYTES) {
      throw new Error("proposal_payload_too_large");
    }
    const proposal = ros2ProposalEnvelopeSchema.parse(JSON.parse(payload));
    return {
      deviceId: proposal.deviceId,
      proposerIdentity: proposal.proposerIdentity,
    };
  } catch {
    throw new Error("proposal_invalid");
  }
}

/**
 * Serializes live proposal evaluation with one bounded pending slot.
 *
 * DDS/readline callbacks can arrive while an earlier Cloud/final-boundary
 * evaluation is still running.  An unbounded Promise chain would make stale
 * authority accumulate in memory; dropping every later callback would make
 * `rlsok observe` silently stop after its first proposal.  This processor
 * keeps at most one next proposal and reports explicit backpressure beyond it.
 */
export class BoundedProposalProcessor {
  private active = false;
  private pending: string | undefined;

  constructor(
    private readonly handle: (payload: string) => Promise<void>,
    private readonly onError: (error: Error) => void,
    private readonly onOverflow: () => void,
  ) {}

  async submit(payload: string): Promise<"processed" | "queued" | "rejected"> {
    if (Buffer.byteLength(payload, "utf8") > MAXIMUM_PROPOSAL_BYTES) {
      this.onError(new Error("proposal_payload_too_large"));
      return "rejected";
    }
    if (this.active) {
      if (this.pending === undefined) {
        this.pending = payload;
        return "queued";
      }
      this.onOverflow();
      return "rejected";
    }
    this.active = true;
    let current: string | undefined = payload;
    try {
      while (current !== undefined) {
        try {
          await this.handle(current);
        } catch (error) {
          this.onError(
            error instanceof Error
              ? error
              : new Error("cloud_ros2_workflow_failed"),
          );
        }
        current = this.pending;
        this.pending = undefined;
      }
      return "processed";
    } finally {
      this.active = false;
    }
  }
}

function reportPreDispatchBlock(result: {
  decision: string;
  reason: string;
  controllerGoalsAttempted: number;
  hardwareSignalSent: boolean;
}): void {
  if (
    result.decision === "allowed" ||
    result.controllerGoalsAttempted !== 0 ||
    result.hardwareSignalSent
  )
    return;
  process.stderr.write(
    operatorFailureReport("BLOCKED", result.reason, {
      observed: result.reason,
      reason: result.reason,
      hardwareDispatch: "NO",
      nextAction:
        "Review the verified Evidence and restore the exact approved release, configuration, credentials, and Cloud authority before retrying.",
    }),
  );
}

function parseOptions(args: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`expected --option value, got ${name ?? "nothing"}`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function discoveryTimeoutMs(options: Options): number {
  const raw =
    options["discovery-timeout-ms"] ??
    process.env.RLSOK_ROS2_DISCOVERY_TIMEOUT_MS ??
    "15000";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 120_000) {
    throw new Error("ROS 2 discovery timeout must be an integer from 1000 to 120000 ms");
  }
  return value;
}

export function proposalTimeoutMs(
  options: Readonly<Options>,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw =
    options["proposal-timeout-ms"] ??
    environment.RLSOK_ROS2_PROPOSAL_TIMEOUT_MS ??
    "30000";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 600_000) {
    throw new Error(
      "ROS 2 proposal timeout must be an integer from 1000 to 600000 ms",
    );
  }
  return value;
}

export async function waitForFirstProposal(
  completion: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      completion,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("proposal_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function waitForOneShotProposal(
  firstProposal: Promise<void>,
  completion: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await waitForFirstProposal(firstProposal, timeoutMs);
  await completion;
}

function readRelease(path: string): ExecutablePolicySpec {
  const resolved = resolve(path);
  if (!existsSync(resolved))
    throw new Error(`release input does not exist: ${path}`);
  const parsed = executablePolicySpecSchema.safeParse(
    load(readFileSync(resolved, "utf8")),
  );
  if (!parsed.success)
    throw new Error(`invalid release: ${parsed.error.message}`);
  return parsed.data;
}

function defaultSidecarPath(): string {
  return resolve(__dirname, "../../../experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py");
}

async function waitForControllerDiscovery(
  transport: PythonRos2SidecarTransport,
  initial: Awaited<ReturnType<PythonRos2SidecarTransport["doctor"]>>,
  timeoutMs: number,
) {
  let report = initial;
  const deadline = Date.now() + timeoutMs;
  while (!report.actionServerAvailable && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    report = await transport.doctor();
  }
  return report;
}

export async function observeGenericRosExecutionConfiguration(
  spec: ExecutablePolicySpec,
  transport: PythonRos2SidecarTransport,
  deviceId: string,
): Promise<ExecutionConfiguration | undefined> {
  const approved = spec.executionConfiguration;
  if (!approved) return undefined;
  // Generic ROS graph discovery cannot authenticate v2 provenance or the full
  // semantic identity. Returning no observation makes v2 fail closed; trusted
  // callers may still supply a complete v2 value through the gateway callback.
  if (approved.schemaVersion === 2) return undefined;
  const doctor = await transport.doctor();
  const state = await transport.getFreshJointState(
    spec.runtimePolicy.maxStateAgeMs,
  );
  if (!doctor.rosDistro || !doctor.rmwImplementation) return undefined;
  return executionConfigurationSchema.parse({
    ...approved,
    deviceIdentity: deviceId,
    rosDistro: doctor.rosDistro,
    rmwImplementation: doctor.rmwImplementation,
    jointState: {
      topic: doctor.jointStateTopic,
      messageType: "sensor_msgs/msg/JointState",
    },
    controller: {
      ...approved.controller,
      followJointTrajectoryAction: doctor.controllerAction,
    },
    jointOrder: state.names,
    observedAt: new Date().toISOString(),
  });
}

function runOneShot(operation: "doctor" | "inspect", options: Options): number {
  const python =
    options.python ?? (process.platform === "win32" ? "python" : "python3");
  const sidecar = resolve(options.sidecar ?? defaultSidecarPath());
  const timeoutMs = discoveryTimeoutMs(options);
  const result = spawnSync(python, [
    sidecar,
    `--${operation}`,
    "--discovery-timeout-seconds",
    String(timeoutMs / 1_000),
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs + 2_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") throw new Error("ros2_sidecar_one_shot_timeout");
    if (code === "ENOBUFS") throw new Error("ros2_sidecar_one_shot_output_too_large");
    throw result.error;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 2;
}

export class FileEvidenceSink implements EvidenceSink {
  private entries: ChainedEvidence[] = [];
  private serializedBytes = 0;
  private readonly limits: {
    maxEntries: number;
    maxBytes: number;
    dispatchReserveBytes: number;
  };

  constructor(
    private readonly release: ExecutablePolicySpec,
    private readonly outputPath: string,
    limits: Partial<{
      maxEntries: number;
      maxBytes: number;
      dispatchReserveBytes: number;
    }> = {},
  ) {
    this.limits = {
      maxEntries: limits.maxEntries ?? 10_000,
      maxBytes: limits.maxBytes ?? 64 * 1024 * 1024,
      // Proposal and sidecar response frames are independently bounded. This
      // margin covers one complete terminal record before hardware is called.
      dispatchReserveBytes: limits.dispatchReserveBytes ?? 512 * 1024,
    };
    if (
      !Number.isInteger(this.limits.maxEntries) || this.limits.maxEntries < 0 ||
      !Number.isInteger(this.limits.maxBytes) || this.limits.maxBytes < 1 ||
      !Number.isInteger(this.limits.dispatchReserveBytes) ||
      this.limits.dispatchReserveBytes < 1
    ) {
      throw new Error("evidence_limits_invalid");
    }
    reservePrivateOutput(this.outputPath);
  }

  assertWritableBeforeDispatch(): void {
    if (this.entries.length >= this.limits.maxEntries) {
      throw new Error("evidence_entry_capacity_exceeded");
    }
    if (
      this.serializedBytes >
      this.limits.maxBytes - this.limits.dispatchReserveBytes
    ) {
      throw new Error("evidence_file_capacity_exceeded");
    }
  }

  append(evidence: ExecutionEvidence): void {
    if (this.entries.length >= this.limits.maxEntries) {
      throw new Error("evidence_entry_capacity_exceeded");
    }
    const entries = [...this.entries, appendEvidence(this.entries, evidence)];
    const decisionMadeAt = Date.parse(evidence.decisionMadeAt);
    if (!Number.isFinite(decisionMadeAt)) {
      throw new Error("evidence_bundle_invalid:evidence_time_inconsistent");
    }
    const createdAtMs = Date.now();
    if (decisionMadeAt > createdAtMs) {
      throw new Error("evidence_bundle_invalid:evidence_time_inconsistent");
    }
    const bundle: EvidenceBundle = {
      apiVersion: "realitywarden.io/v1alpha1",
      kind: "EvidenceBundle",
      releaseId: this.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(this.release),
      createdAt: new Date(createdAtMs).toISOString(),
      entries,
      testReportSha256: this.release.evidence.testReportSha256,
    };
    const verification = verifyEvidenceBundle(bundle, {
      now: new Date(createdAtMs),
    });
    if (!verification.ok) {
      throw new Error(`evidence_bundle_invalid:${verification.reason}`);
    }
    const content = `${JSON.stringify(bundle, null, 2)}\n`;
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > this.limits.maxBytes) {
      throw new Error("evidence_file_capacity_exceeded");
    }
    writePrivateAtomic(this.outputPath, content);
    this.entries = entries;
    this.serializedBytes = contentBytes;
  }
}

async function runCloudConnectedGateway(
  mode: "shadow" | "run",
  options: Options,
): Promise<number> {
  const spec = readRelease(required(options, "release"));
  if (mode === "shadow" && spec.deployment.mode !== "shadow") {
    throw new Error(
      "shadow requires a release whose deployment.mode is shadow",
    );
  }
  if (mode === "run") {
    if (!["canary", "released"].includes(spec.deployment.mode)) {
      throw new Error("run requires a canary or released release");
    }
    if (options["allow-reference-run"] !== spec.metadata.releaseId) {
      throw new Error(
        `run requires --allow-reference-run ${spec.metadata.releaseId} (exact release confirmation)`,
      );
    }
  }
  const deviceId = required(options, "device");
  const proposerIdentity = required(options, "proposer");
  const evidencePath = resolve(
    options.evidence ?? defaultRos2EvidencePath("cloud", mode, spec),
  );
  const replayRegistryPath = resolve(
    options["replay-registry"] ?? join(
      configRoot(),
      "replay",
      "cloud-ros2",
      executablePolicyHash(spec),
    ),
  );
  const replayRegistry = new FileProposalReplayRegistry(replayRegistryPath);
  const replayRegistryReadiness = replayRegistry.checkReady();
  if (!replayRegistryReadiness.ready) {
    throw new Error(
      `proposal_replay_registry_${replayRegistryReadiness.reason}`,
    );
  }
  const localResultFile = new PrivateResultFile(evidencePath);
  const discoveryTimeout = discoveryTimeoutMs(options);
  const transport = new PythonRos2SidecarTransport({
    pythonExecutable:
      options.python ?? (process.platform === "win32" ? "python" : "python3"),
    sidecarPath: resolve(options.sidecar ?? defaultSidecarPath()),
    proposalTopic: options["proposal-topic"],
    jointStateTopic: options["joint-state-topic"],
    controllerAction: options["controller-action"],
    jointOrder: spec.actionContract.jointOrder,
    discoveryTimeoutMs: discoveryTimeout,
  });
  try {
  let doctor = await transport.doctor();
  if (mode === "run" && !doctor.actionServerAvailable) {
    doctor = await waitForControllerDiscovery(transport, doctor, discoveryTimeout);
  }
  process.stdout.write(
    `${JSON.stringify({
      executionMode: "cloud-connected",
      mode,
      evidencePath,
      replayRegistryPath,
      replayRegistry: replayRegistryReadiness,
      doctor,
    })}\n`,
  );
  if (!doctor.rosAvailable) throw new Error("ROS 2 unavailable");
  if (mode === "run" && !doctor.actionServerAvailable) {
    throw new Error("controller action server unavailable");
  }
  if (mode === "run" && !doctor.sros2Enabled) {
    throw new Error(
      "cloud-connected reference run requires SROS2 with ROS_SECURITY_STRATEGY=Enforce",
    );
  }
  const workflow = new CloudConnectedRos2Workflow({
    mode,
    release: spec,
    cloud: new RlsokCloudClient(loadCloudClientConfig()),
    transport,
    proposalReplayRegistry: replayRegistry,
    controllerIdentity:
      options["controller-identity"] ?? spec.robot.controllerConfigSha256,
    executionConfiguration: () =>
      observeGenericRosExecutionConfiguration(spec, transport, deviceId),
    beforeFinalBoundary:
      process.env.RLSOK_TEST_FINAL_BOUNDARY_READY_FILE &&
      process.env.RLSOK_TEST_FINAL_BOUNDARY_CONTINUE_FILE
        ? async () => {
            const ready = resolve(
              process.env.RLSOK_TEST_FINAL_BOUNDARY_READY_FILE!,
            );
            const proceed = resolve(
              process.env.RLSOK_TEST_FINAL_BOUNDARY_CONTINUE_FILE!,
            );
            writeFileSync(ready, "ready\n", { encoding: "utf8", mode: 0o600 });
            const deadline = Date.now() + 10_000;
            while (!existsSync(proceed)) {
              if (Date.now() >= deadline) {
                throw new Error("test_final_boundary_hook_timeout");
              }
              await new Promise((resolveWait) => setTimeout(resolveWait, 25));
            }
          }
        : undefined,
    localEvidence: (result) => {
      localResultFile.write(
        `${JSON.stringify(
          {
            ...result,
            responsibilityBoundary: [
              "RLSOK determines whether a specific release is eligible for the configured controller path.",
              "RLSOK does not determine whether the resulting physical motion is safe.",
            ],
          },
          null,
          2,
        )}\n`,
      );
    },
  });
  if (options["proposal-file"]) {
    const payload = readFileSync(resolve(options["proposal-file"]), "utf8");
    const parsed = parseProposalIdentity(payload);
    if (
      parsed.deviceId !== deviceId ||
      parsed.proposerIdentity !== proposerIdentity
    ) {
      throw new Error("proposal_identity_mismatch");
    }
    const result = await workflow.runProposal(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    reportPreDispatchBlock(result);
    return result.decision === "allowed" ? 0 : 2;
  }
  let completed = false;
  let completionExitCode = 0;
  let resolveCompletion: () => void = () => undefined;
  let rejectCompletion: (error: Error) => void = () => undefined;
  let resolveFirstProposal: () => void = () => undefined;
  const completion = new Promise<void>((resolveDone, rejectDone) => {
    resolveCompletion = resolveDone;
    rejectCompletion = rejectDone;
  });
  const firstProposal = new Promise<void>((resolveReceived) => {
    resolveFirstProposal = resolveReceived;
  });
  const evaluatePayload = async (payload: string) => {
      const parsed = parseProposalIdentity(payload);
      if (
        parsed.deviceId !== deviceId ||
        parsed.proposerIdentity !== proposerIdentity
      ) {
        throw new Error("proposal_identity_mismatch");
      }
      const result = await workflow.runProposal(payload);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      reportPreDispatchBlock(result);
      completionExitCode = result.decision === "allowed" ? 0 : 2;
  };
  const continuous = new BoundedProposalProcessor(
    evaluatePayload,
    (error) => {
      process.stderr.write(
        operatorFailureReport("BLOCKED", error.message, {
          observed: error.message,
          reason: error.message,
          hardwareDispatch: mode === "shadow" ? "NO" : "UNKNOWN",
          nextAction:
            "Inspect the rejected proposal and verified Evidence; restore current authority before submitting another proposal.",
        }),
      );
    },
    () => {
      process.stderr.write(
        operatorFailureReport("BLOCKED", "proposal_backpressure", {
          observed: "more than one proposal arrived during an active evaluation",
          reason: "proposal_backpressure",
          hardwareDispatch: "NO",
          nextAction:
            "Slow the proposal publisher and submit a fresh uniquely identified proposal after the active evaluation completes.",
        }),
      );
    },
  );
  await transport.subscribeProposals(async (payload) => {
    if (options.once !== "true") {
      await continuous.submit(payload);
      return;
    }
    if (completed) return;
    completed = true;
    resolveFirstProposal();
    try {
      await evaluatePayload(payload);
      resolveCompletion();
    } catch (error) {
      rejectCompletion(
        error instanceof Error
          ? error
          : new Error("cloud_ros2_workflow_failed"),
      );
    }
  });
  if (options.once === "true") {
    try {
      await waitForOneShotProposal(
        firstProposal,
        completion,
        proposalTimeoutMs(options),
      );
    } catch (error) {
      completed = true;
      throw error;
    }
  } else {
    await Promise.race([
      completion,
      new Promise<void>((resolveDone) => {
        process.once("SIGINT", resolveDone);
        process.once("SIGTERM", resolveDone);
      }),
    ]);
  }
  return completionExitCode;
  } finally {
    await transport.close();
  }
}

async function runGateway(
  mode: "shadow" | "run",
  options: Options,
): Promise<number> {
  const spec = readRelease(required(options, "release"));
  if (mode === "shadow" && spec.deployment.mode !== "shadow") {
    throw new Error(
      "shadow requires a release whose deployment.mode is shadow",
    );
  }
  if (mode === "run") {
    if (!["canary", "released"].includes(spec.deployment.mode)) {
      throw new Error("run requires a canary or released release");
    }
    if (options["allow-reference-run"] !== spec.metadata.releaseId) {
      throw new Error(
        `run requires --allow-reference-run ${spec.metadata.releaseId} (exact release confirmation)`,
      );
    }
  }
  const deviceId = required(options, "device");
  const proposerIdentity = required(options, "proposer");
  if (!spec.deployment.allowedDeviceIds.includes(deviceId)) {
    throw new Error(`device ${deviceId} is not allowed by this release`);
  }
  const identity = executablePolicyHash(spec);
  const releaseRecord: ReleaseRecord = {
    releaseId: spec.metadata.releaseId,
    state: spec.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedBy: spec.evidence.approvedBy,
    approvedAt: spec.evidence.approvedAt,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
  };
  const resolver = new InMemoryReleaseResolver();
  resolver.bind(deviceId, proposerIdentity, spec);
  const records = new InMemoryReleaseRecordStore(
    new Map([[spec.metadata.releaseId, releaseRecord]]),
  );
  const discoveryTimeout = discoveryTimeoutMs(options);
  const transport = new PythonRos2SidecarTransport({
    pythonExecutable:
      options.python ?? (process.platform === "win32" ? "python" : "python3"),
    sidecarPath: resolve(options.sidecar ?? defaultSidecarPath()),
    proposalTopic: options["proposal-topic"],
    jointStateTopic: options["joint-state-topic"],
    controllerAction: options["controller-action"],
    jointOrder: spec.actionContract.jointOrder,
    discoveryTimeoutMs: discoveryTimeout,
  });
  const evidencePath = resolve(
    options.evidence
      ?? defaultRos2EvidencePath("standalone", mode, spec),
  );
  const replayRegistryPath = resolve(
    options["replay-registry"] ?? join(
      configRoot(),
      "replay",
      "standalone-ros2",
      executablePolicyHash(spec),
    ),
  );
  const replayRegistry = new FileProposalReplayRegistry(replayRegistryPath);
  const replayRegistryReadiness = replayRegistry.checkReady();
  if (!replayRegistryReadiness.ready) {
    throw new Error(
      `proposal_replay_registry_${replayRegistryReadiness.reason}`,
    );
  }
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity:
      options["controller-identity"] ?? spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: records,
    transport,
    evidence: new FileEvidenceSink(spec, evidencePath),
    proposalReplayRegistry: replayRegistry,
    executionConfiguration: () =>
      observeGenericRosExecutionConfiguration(spec, transport, deviceId),
  });
  try {
  let report = await transport.doctor();
  if (mode === "run" && !report.actionServerAvailable) {
    report = await waitForControllerDiscovery(transport, report, discoveryTimeout);
  }
  process.stdout.write(
    `${JSON.stringify({
      mode,
      evidencePath,
      replayRegistryPath,
      replayRegistry: replayRegistryReadiness,
      doctor: report,
    }, null, 2)}\n`,
  );
  if (!report.rosAvailable) throw new Error("ROS 2 unavailable");
  if (mode === "run" && !report.sros2Enabled) {
    throw new Error(
      "reference run requires SROS2 with ROS_SECURITY_STRATEGY=Enforce",
    );
  }
  if (mode === "run" && !report.actionServerAvailable) {
    throw new Error("controller action server unavailable");
  }
  const processor = new BoundedProposalProcessor(
    async (payload) => {
      const result = await gateway.handlePayload(payload);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    },
    (error) => {
      process.stderr.write(
        operatorFailureReport("BLOCKED", error.message, {
          observed: error.message,
          reason: error.message,
          hardwareDispatch: "NO",
          nextAction:
            "Inspect the proposal and durable replay registry, then submit a fresh uniquely identified proposal.",
        }),
      );
    },
    () => {
      process.stderr.write(
        operatorFailureReport("BLOCKED", "proposal_backpressure", {
          observed: "more than one proposal arrived during an active evaluation",
          reason: "proposal_backpressure",
          hardwareDispatch: "NO",
          nextAction:
            "Slow the publisher and submit a fresh uniquely identified proposal after the active evaluation completes.",
        }),
      );
    },
  );
  await transport.subscribeProposals(async (payload) => {
    await processor.submit(payload);
  });
  process.stdout.write(
    mode === "shadow"
      ? "Shadow observation active; controller dispatch is disabled. Press Ctrl+C to stop.\n"
      : "Experimental reference execution active. Press Ctrl+C to stop.\n",
  );
  await new Promise<void>((resolveDone) => {
    const stop = () => resolveDone();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
  } finally {
    await transport.close();
  }
}

export function ros2Usage(): string {
  return [
    "usage:",
    "  rlsok ros2 [shadow] --release <spec> --device <id> --proposer <identity> [--evidence <path>]",
    "  rlsok ros2 run --release <spec> --device <id> --proposer <identity> --allow-reference-run <release-id>",
    "  rlsok ros2 doctor [--python <path>] [--sidecar <path>]",
    "  rlsok ros2 inspect [<release>] [--python <path>] [--sidecar <path>]",
    "",
    "Set RLSOK_EXECUTION_MODE=cloud-connected to require the versioned cloud",
    "release, Permit, final refresh/consumption, and cloud Evidence path.",
    "Cloud credentials are read only from environment/protected-file settings.",
    "Cloud --once true waits at most --proposal-timeout-ms (default 30000) for",
    "the first proposal, then waits for that proposal's bounded evaluation to finish.",
    "CLI proposal claims persist under the RLSOK config directory;",
    "--replay-registry selects an explicit local durable registry path.",
    "",
    "ROS 2 support is experimental/reference-only, not safety-rated, and not hard realtime.",
  ].join("\n");
}

export async function runRos2Command(args: string[]): Promise<number> {
  const operation = args[0] && !args[0].startsWith("--") ? args[0] : "shadow";
  const inspectRelease =
    operation === "inspect" && args[1] && !args[1].startsWith("--")
      ? args[1]
      : undefined;
  if (inspectRelease) readRelease(inspectRelease);
  const optionArgs =
    operation === "shadow" && args[0]?.startsWith("--")
      ? args
      : args.slice(inspectRelease ? 2 : 1);
  const options = parseOptions(optionArgs);
  if (operation === "doctor" || operation === "inspect")
    return runOneShot(operation, options);
  if (operation === "shadow" || operation === "run") {
    return executionMode() === "cloud-connected"
      ? runCloudConnectedGateway(operation, options)
      : runGateway(operation, options);
  }
  if (operation === "help" || operation === "--help") {
    process.stdout.write(`${ros2Usage()}\n`);
    return 0;
  }
  throw new Error(`unknown ros2 operation: ${operation}`);
}
