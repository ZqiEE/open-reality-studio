import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { load } from "js-yaml";
import {
  RlsokCloudClient,
  assertFreshStateTimestamp,
  assertLocalRos2Eligibility,
  loadCloudClientConfig,
  verifyCloudEvidence,
} from "../../packages/cloud-client";
import {
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec,
} from "../../packages/core/exec-spec";
import {
  assessOfficialRobotIntegrations,
  type OfficialRobotIntegration,
  type Ros2DiscoveryReport,
} from "../../packages/robot-integrations";
import { ros2ProposalEnvelopeSchema } from "../../packages/ros2-reference-gateway";
import { runRos2Command } from "./ros2";

type Options = Record<string, string>;

interface SetupState {
  version: number;
  releaseId: string;
  deviceId: string;
  controllerId: string;
  artifactPath: string;
  artifactSha256: string;
  jointStateTopic: string;
  controllerAction: string;
  jointNames: string[];
  proposalTopic: string;
  proposerIdentity: string;
  integration: {
    supportLevel: "official" | "generic";
    profileId: string;
    vendor: string | null;
    model: string | null;
    namespace: string;
    physicalValidation: false;
  };
  releasePath: string;
  proposalPath: string;
  evidencePath: string;
  cloudApiUrl: string;
  completedAt: string;
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`expected --option value, got ${name ?? "nothing"}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function configRoot(source: NodeJS.ProcessEnv = process.env): string {
  if (source.RLSOK_CONFIG_HOME) return source.RLSOK_CONFIG_HOME;
  if (source.XDG_CONFIG_HOME) return join(source.XDG_CONFIG_HOME, "rlsok");
  return join(homedir(), ".config", "rlsok");
}

function defaultSidecarPath(): string {
  return resolve(
    __dirname,
    "../../../experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py",
  );
}

function linuxRelease(): Record<string, string> {
  if (!existsSync("/etc/os-release")) return {};
  return Object.fromEntries(
    readFileSync("/etc/os-release", "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^"|"$/g, ""),
        ];
      }),
  );
}

function assertSupportedPlatform(): void {
  if (process.env.RLSOK_SETUP_ACCEPTANCE === "1") return;
  const release = linuxRelease();
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    release.ID !== "ubuntu" ||
    release.VERSION_ID !== "24.04"
  ) {
    throw new Error("physical UR5e validation requires Ubuntu 24.04 x86_64");
  }
}

function writeProtected(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesBelow(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  visit(root);
  return result;
}

function writeManifest(output: string, status: "PENDING" | "PASSED"): void {
  const excluded = new Set(["manifest.json", "SHA256SUMS"]);
  const files = filesBelow(output)
    .map((path) => relative(output, path).replaceAll("\\", "/"))
    .filter((path) => !excluded.has(path))
    .sort()
    .map((path) => ({ path, sha256: sha256File(join(output, path)) }));
  writeProtected(join(output, "manifest.json"), {
    schema: "rlsok.io/physical-ur5e-validation/v1",
    status,
    generatedAt: new Date().toISOString(),
    files,
  });
  const all = [...files, { path: "manifest.json", sha256: sha256File(join(output, "manifest.json")) }];
  writeProtected(
    join(output, "SHA256SUMS"),
    `${all.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
  );
}

function discover(options: Options): Ros2DiscoveryReport {
  const fixture = process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
  if (fixture) return JSON.parse(readFileSync(fixture, "utf8")) as Ros2DiscoveryReport;
  const python = options.python ?? "python3";
  const sidecar = resolve(options.sidecar ?? defaultSidecarPath());
  const timeout = Number(options["discovery-timeout-seconds"] ?? "25");
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120) {
    throw new Error("--discovery-timeout-seconds must be between 1 and 120");
  }
  const result = spawnSync(
    python,
    [sidecar, "--discover", "--discovery-timeout-seconds", String(timeout)],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`UR5e discovery failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return JSON.parse(result.stdout) as Ros2DiscoveryReport;
}

function selectUr5e(report: Ros2DiscoveryReport, namespace?: string): OfficialRobotIntegration {
  if (!report.rosAvailable) throw new Error("ROS 2 unavailable");
  if (report.rosDistro !== "jazzy") throw new Error(`expected ROS 2 Jazzy; found ${report.rosDistro ?? "none"}`);
  if (report.rmwImplementation !== "rmw_fastrtps_cpp") {
    throw new Error(`expected rmw_fastrtps_cpp; found ${report.rmwImplementation ?? "none"}`);
  }
  const assessment = assessOfficialRobotIntegrations(report);
  if (assessment.status !== "matched") {
    throw new Error(`official UR5e boundary not proven: ${assessment.diagnostics.join("; ")}`);
  }
  const matches = assessment.integrations.filter(
    (candidate) => candidate.model === "UR5e" && (!namespace || candidate.namespace === namespace),
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected one UR5e${namespace ? ` at ${namespace}` : ""}; found ${matches.map((value) => value.namespace).join(", ") || "none"}`,
    );
  }
  return matches[0]!;
}

function environmentProof(report: Ros2DiscoveryReport, integration: OfficialRobotIntegration) {
  return {
    platform: process.platform,
    architecture: process.arch,
    rosDistro: report.rosDistro,
    rmwImplementation: report.rmwImplementation,
    rosDomainId: report.rosDomainId,
    integration: {
      profileId: integration.profileId,
      vendor: integration.vendor,
      model: integration.model,
      namespace: integration.namespace,
      controllerName: integration.controllerName,
      controllerType: integration.controllerType,
      controllerAction: integration.controllerAction,
      jointStateTopic: integration.jointStateTopic,
      jointNames: integration.jointNames,
      robotDescriptionSha256: integration.robotDescriptionSha256,
    },
  };
}

function readSetup(): SetupState {
  const path = join(configRoot(), "setup.json");
  if (!existsSync(path)) throw new Error("setup state missing; complete 'rlsok setup' first");
  return JSON.parse(readFileSync(path, "utf8")) as SetupState;
}

function readRelease(path: string): ExecutablePolicySpec {
  const parsed = executablePolicySpecSchema.safeParse(load(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`invalid approved release: ${parsed.error.message}`);
  return parsed.data;
}

function assertExpected(name: string, expected: string, operation: () => void) {
  try {
    operation();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason !== expected) throw new Error(`${name}: expected ${expected}; found ${reason}`);
    return {
      name,
      result: "PASS",
      reason,
      controllerGoalsAttempted: 0,
      hardwareSignalSent: false,
    };
  }
  throw new Error(`${name}: expected ${expected}, but the authority check passed`);
}

export function runUr5eNegativeChecks(
  release: ExecutablePolicySpec,
  proposalInput: unknown,
  controllerIdentity: string,
) {
  const proposal = ros2ProposalEnvelopeSchema.parse(proposalInput);
  const exact = assertLocalRos2Eligibility(
    release,
    proposal,
    controllerIdentity,
    "shadow",
  );
  const now = new Date();
  return [
    {
      name: "exact-release-robot-controller-binding",
      result: exact ? "PASS" : "FAIL",
      controllerGoalsAttempted: 0,
      hardwareSignalSent: false,
    },
    assertExpected("release-mismatch", "release_id_mismatch", () =>
      assertLocalRos2Eligibility(
        release,
        { ...proposal, releaseId: `${proposal.releaseId}-mismatch` },
        controllerIdentity,
        "shadow",
      ),
    ),
    assertExpected("robot-mismatch", "device_not_allowed", () =>
      assertLocalRos2Eligibility(
        release,
        { ...proposal, deviceId: `${proposal.deviceId}-mismatch` },
        controllerIdentity,
        "shadow",
      ),
    ),
    assertExpected("controller-mismatch", "controller_identity_mismatch", () =>
      assertLocalRos2Eligibility(release, proposal, "0".repeat(64), "shadow"),
    ),
    assertExpected("expired-release-authority", "release_expired", () =>
      assertLocalRos2Eligibility(
        {
          ...release,
          deployment: { ...release.deployment, expiresAt: "2000-01-01T00:00:00.000Z" },
        },
        proposal,
        controllerIdentity,
        "shadow",
        now,
      ),
    ),
    assertExpected("stale-robot-state", "state_stale_or_invalid", () =>
      assertFreshStateTimestamp(
        new Date(now.getTime() - release.runtimePolicy.maxStateAgeMs - 1).toISOString(),
        release.runtimePolicy.maxStateAgeMs,
        now,
      ),
    ),
  ];
}

function assertPhysicalInputs(options: Options) {
  return {
    operator: required(options, "operator"),
    robotSerial: required(options, "robot-serial"),
    attestation:
      "Operator attests this session is connected to a physical UR5e using the official Universal Robots ROS 2 Driver. This attestation is not a safety certification.",
  };
}

async function preflight(options: Options): Promise<number> {
  assertSupportedPlatform();
  const output = resolve(required(options, "output"));
  const attestation = assertPhysicalInputs(options);
  const report = discover(options);
  const integration = selectUr5e(report, options["robot-namespace"]);
  writeProtected(join(output, "preflight.json"), {
    status: "PASS",
    hardwareValidation: "PENDING",
    observedAt: new Date().toISOString(),
    ...attestation,
    environment: environmentProof(report, integration),
    responsibilityBoundary: [
      "RLSOK provides execution authorization.",
      "RLSOK is not functional safety, an E-stop, a safety PLC, collision avoidance, trajectory safety, or motion planning.",
      "Universal Robots safety mechanisms and operator responsibility remain required.",
    ],
  });
  writeProtected(
    join(output, "operator-workflow.txt"),
    "1. Run preflight.\n2. Run rlsok setup and complete independent approval.\n3. Run record.\n4. Revoke the exact release in Hosted Cloud.\n5. Run finalize.\n6. Verify SHA256SUMS.\n",
  );
  writeManifest(output, "PENDING");
  process.stdout.write(`UR5e preflight PASS; hardware validation remains PENDING. Artifact: ${output}\n`);
  return 0;
}

async function record(options: Options): Promise<number> {
  assertSupportedPlatform();
  const output = resolve(required(options, "output"));
  const attestation = assertPhysicalInputs(options);
  const setup = readSetup();
  if (
    setup.integration.supportLevel !== "official" ||
    setup.integration.vendor !== "Universal Robots" ||
    setup.integration.model !== "UR5e"
  ) {
    throw new Error("setup state is not bound to the official UR5e integration");
  }
  const report = discover(options);
  const integration = selectUr5e(report, setup.integration.namespace);
  if (
    integration.controllerAction !== setup.controllerAction ||
    integration.jointStateTopic !== setup.jointStateTopic ||
    JSON.stringify(integration.jointNames) !== JSON.stringify(setup.jointNames)
  ) {
    throw new Error("live UR5e graph no longer matches the approved setup binding");
  }
  const release = readRelease(setup.releasePath);
  if (release.metadata.releaseId !== setup.releaseId) throw new Error("setup release identity mismatch");
  if (sha256File(setup.artifactPath) !== setup.artifactSha256) {
    throw new Error("protected policy artifact digest mismatch");
  }
  const evidence = JSON.parse(readFileSync(setup.evidencePath, "utf8")) as {
    cloudEvidenceId?: string;
    decision?: string;
    controllerGoalsAttempted?: number;
    hardwareSignalSent?: boolean;
    evidenceVerified?: boolean;
  };
  if (
    evidence.decision !== "allowed" ||
    evidence.controllerGoalsAttempted !== 0 ||
    evidence.hardwareSignalSent !== false ||
    evidence.evidenceVerified !== true ||
    !evidence.cloudEvidenceId
  ) {
    throw new Error("setup Shadow Evidence does not prove verified zero dispatch");
  }
  const cloud = new RlsokCloudClient(loadCloudClientConfig());
  const cloudEvidence = await cloud.getEvidence(evidence.cloudEvidenceId);
  const cloudVerification = verifyCloudEvidence(cloudEvidence);
  if (!cloudVerification.ok) throw new Error(cloudVerification.reason);
  const proposal = JSON.parse(readFileSync(setup.proposalPath, "utf8"));
  const checks = runUr5eNegativeChecks(
    release,
    proposal,
    release.robot.controllerConfigSha256,
  );
  mkdirSync(output, { recursive: true, mode: 0o700 });
  copyFileSync(setup.evidencePath, join(output, "shadow-evidence.json"));
  writeProtected(join(output, "binding.json"), {
    ...attestation,
    releaseId: setup.releaseId,
    executablePolicyHash: executablePolicyHash(release),
    artifactSha256: setup.artifactSha256,
    deviceId: setup.deviceId,
    controllerRegistryId: setup.controllerId,
    controllerIdentity: release.robot.controllerConfigSha256,
    environment: environmentProof(report, integration),
  });
  writeProtected(join(output, "negative-checks.json"), {
    status: "PASS",
    checks,
    machineVerifiableZeroDispatch: checks.every(
      (check) => check.controllerGoalsAttempted === 0 && check.hardwareSignalSent === false,
    ),
  });
  writeProtected(join(output, "record.json"), {
    status: "PASS",
    hardwareValidation: "PENDING_REVOCATION_CHECK",
    cloudEvidenceId: evidence.cloudEvidenceId,
    cloudEvidenceVerified: true,
    controllerGoalsAttempted: 0,
    hardwareSignalSent: false,
  });
  writeManifest(output, "PENDING");
  process.stdout.write(`UR5e Shadow and negative checks PASS; revoke ${setup.releaseId} in Hosted Cloud, then run finalize.\n`);
  return 0;
}

async function finalize(options: Options): Promise<number> {
  assertSupportedPlatform();
  const output = resolve(required(options, "output"));
  const attestation = assertPhysicalInputs(options);
  const setup = readSetup();
  const cloud = new RlsokCloudClient(loadCloudClientConfig());
  const current = await cloud.getRelease(setup.releaseId);
  if (current.state !== "revoked") {
    throw new Error(`release ${setup.releaseId} is ${current.state}; revoke this exact release in Hosted Cloud before finalizing`);
  }
  const evidencePath = join(output, "revocation-evidence.json");
  const args = [
    "shadow",
    "--release",
    setup.releasePath,
    "--device",
    setup.deviceId,
    "--proposer",
    setup.proposerIdentity,
    "--joint-state-topic",
    setup.jointStateTopic,
    "--controller-action",
    setup.controllerAction,
    "--proposal-topic",
    setup.proposalTopic,
    "--proposal-file",
    setup.proposalPath,
    "--once",
    "true",
    "--evidence",
    evidencePath,
  ];
  if (options.python) args.push("--python", options.python);
  if (options.sidecar) args.push("--sidecar", options.sidecar);
  const exit = await runRos2Command(args);
  if (exit !== 2) throw new Error(`revoked Shadow expected blocked exit 2; found ${exit}`);
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
    decision?: string;
    reason?: string;
    controllerGoalsAttempted?: number;
    hardwareSignalSent?: boolean;
    evidenceVerified?: boolean;
  };
  if (
    evidence.decision !== "blocked" ||
    evidence.reason !== "cloud_release_not_eligible:revoked" ||
    evidence.controllerGoalsAttempted !== 0 ||
    evidence.hardwareSignalSent !== false ||
    evidence.evidenceVerified !== true
  ) {
    throw new Error("revocation Evidence did not prove a verified zero-dispatch denial");
  }
  writeProtected(join(output, "result.json"), {
    status: "PASSED",
    completedAt: new Date().toISOString(),
    ...attestation,
    releaseId: setup.releaseId,
    checks: {
      preflight: "PASS",
      exactBinding: "PASS",
      independentApproval: "PASS",
      shadowZeroDispatch: "PASS",
      releaseRobotControllerMismatch: "PASS",
      staleAndExpiredAuthority: "PASS",
      revocation: "PASS",
      evidenceVerification: "PASS",
    },
    controllerGoalsAttemptedDuringShadowAndDenial: 0,
    hardwareSignalSentDuringShadowAndDenial: false,
    responsibilityBoundary:
      "This validates execution authorization behavior only; it is not a functional-safety or motion-safety certification.",
  });
  writeManifest(output, "PASSED");
  process.stdout.write(`Physical UR5e validation artifact PASSED: ${output}\n`);
  return 0;
}

export function ur5eValidationUsage(): string {
  return [
    "Physical UR5e validation",
    "",
    "rlsok validate-ur5e preflight --output <directory> --operator <name> --robot-serial <serial>",
    "rlsok validate-ur5e record --output <directory> --operator <name> --robot-serial <serial>",
    "rlsok validate-ur5e finalize --output <directory> --operator <name> --robot-serial <serial>",
  ].join("\n");
}

export async function runUr5eValidationCommand(args: string[]): Promise<number> {
  const [phase, ...rest] = args;
  if (!phase || phase === "help" || phase === "--help") {
    process.stdout.write(`${ur5eValidationUsage()}\n`);
    return phase ? 0 : 2;
  }
  const options = parseOptions(rest);
  if (phase === "preflight") return preflight(options);
  if (phase === "record") return record(options);
  if (phase === "finalize") return finalize(options);
  throw new Error(`unknown validate-ur5e phase '${phase}'`);
}
