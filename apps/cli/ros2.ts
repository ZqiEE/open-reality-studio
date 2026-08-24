import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { load } from "js-yaml";
import {
  CloudConnectedRos2Workflow,
  RlsokCloudClient,
  executionMode,
  loadCloudClientConfig,
} from "../../packages/cloud-client";
import {
  appendEvidence,
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
} from "../../packages/ros2-reference-gateway";
import { PythonRos2SidecarTransport } from "../../packages/ros2-reference-gateway/sidecar";
import { operatorFailureReport } from "./operator-report";

type Options = Record<string, string>;

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
  const result = spawnSync(python, [
    sidecar,
    `--${operation}`,
    "--discovery-timeout-seconds",
    String(discoveryTimeoutMs(options) / 1_000),
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 2;
}

class FileEvidenceSink implements EvidenceSink {
  private entries: ChainedEvidence[] = [];

  constructor(
    private readonly release: ExecutablePolicySpec,
    private readonly outputPath: string,
  ) {}

  append(evidence: ExecutionEvidence): void {
    this.entries = [...this.entries, appendEvidence(this.entries, evidence)];
    const bundle: EvidenceBundle = {
      apiVersion: "realitywarden.io/v1alpha1",
      kind: "EvidenceBundle",
      releaseId: this.release.metadata.releaseId,
      executablePolicyHash: executablePolicyHash(this.release),
      createdAt: new Date().toISOString(),
      entries: this.entries,
      testReportSha256: this.release.evidence.testReportSha256,
    };
    mkdirSync(dirname(this.outputPath), { recursive: true });
    writeFileSync(
      this.outputPath,
      `${JSON.stringify(bundle, null, 2)}\n`,
      "utf8",
    );
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
    options.evidence ??
      `evidence/ros2-cloud-${mode}-${spec.metadata.releaseId}.json`,
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
  let doctor = await transport.doctor();
  if (mode === "run" && !doctor.actionServerAvailable) {
    doctor = await waitForControllerDiscovery(transport, doctor, discoveryTimeout);
  }
  process.stdout.write(
    `${JSON.stringify({
      executionMode: "cloud-connected",
      mode,
      evidencePath,
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
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(
        evidencePath,
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
        { encoding: "utf8", mode: 0o600 },
      );
    },
  });
  if (options["proposal-file"]) {
    const payload = readFileSync(resolve(options["proposal-file"]), "utf8");
    const parsed = JSON.parse(payload) as {
      deviceId?: unknown;
      proposerIdentity?: unknown;
    };
    if (
      parsed.deviceId !== deviceId ||
      parsed.proposerIdentity !== proposerIdentity
    ) {
      throw new Error("proposal_identity_mismatch");
    }
    const result = await workflow.runProposal(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    reportPreDispatchBlock(result);
    await transport.close();
    return result.decision === "allowed" ? 0 : 2;
  }
  let completed = false;
  let completionExitCode = 0;
  let resolveCompletion: () => void = () => undefined;
  let rejectCompletion: (error: Error) => void = () => undefined;
  const completion = new Promise<void>((resolveDone, rejectDone) => {
    resolveCompletion = resolveDone;
    rejectCompletion = rejectDone;
  });
  await transport.subscribeProposals(async (payload) => {
    if (completed) return;
    completed = true;
    try {
      const parsed = JSON.parse(payload) as {
        deviceId?: unknown;
        proposerIdentity?: unknown;
      };
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
    await completion;
  } else {
    await Promise.race([
      completion,
      new Promise<void>((resolveDone) => {
        process.once("SIGINT", resolveDone);
        process.once("SIGTERM", resolveDone);
      }),
    ]);
  }
  await transport.close();
  return completionExitCode;
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
    options.evidence ?? `evidence/ros2-${mode}-${spec.metadata.releaseId}.json`,
  );
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity:
      options["controller-identity"] ?? spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: records,
    transport,
    evidence: new FileEvidenceSink(spec, evidencePath),
    executionConfiguration: () =>
      observeGenericRosExecutionConfiguration(spec, transport, deviceId),
  });
  let report = await transport.doctor();
  if (mode === "run" && !report.actionServerAvailable) {
    report = await waitForControllerDiscovery(transport, report, discoveryTimeout);
  }
  process.stdout.write(
    `${JSON.stringify({ mode, evidencePath, doctor: report }, null, 2)}\n`,
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
  await gateway.start((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
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
  await transport.close();
  return 0;
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
