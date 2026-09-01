import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
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
import { canonicalJson, sha256 } from "../../packages/core/evidence";
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

type ValidationPhase = "preflight" | "record" | "finalize";

interface ValidationManifest {
  schema: "rlsok.io/physical-ur5e-validation/v1";
  status: "PENDING" | "PASSED";
  phase: ValidationPhase;
  sessionId: string;
  generatedAt: string;
  files: Array<{ path: string; sha256: string }>;
}

interface PreflightRecord {
  schema: "rlsok.io/physical-ur5e-validation-session/v1";
  sessionId: string;
  status: "PASS";
  hardwareValidation: "PENDING";
  operator: string;
  robotSerial: string;
  environment: ReturnType<typeof environmentProof>;
}

interface BindingRecord {
  schema: "rlsok.io/physical-ur5e-validation-binding/v1";
  sessionId: string;
  operator: string;
  robotSerial: string;
  releaseId: string;
  executablePolicyHash: string;
  setupStateSha256: string;
  setupBindingSha256: string;
  releaseFileSha256: string;
  proposalFileSha256: string;
  setupEvidenceFileSha256: string;
  artifactSha256: string;
  environmentSha256: string;
  cloudApiUrl: string;
}

interface RecordPhase {
  schema: "rlsok.io/physical-ur5e-validation-record/v1";
  sessionId: string;
  status: "PASS";
  hardwareValidation: "PENDING_REVOCATION_CHECK";
  operator: string;
  robotSerial: string;
  releaseId: string;
  bindingSha256: string;
  negativeChecksSha256: string;
  shadowEvidenceSha256: string;
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

function sha256RegularFile(path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`${label}_missing`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_non_symlink`);
  }
  return sha256File(path);
}

function readJsonObject<T>(path: string, label: string): T {
  if (!existsSync(path)) throw new Error(`${label}_missing`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_non_symlink`);
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_an_object");
    }
    return value as T;
  } catch (error) {
    throw new Error(
      `${label}_invalid:${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

function writeManifest(
  output: string,
  status: "PENDING" | "PASSED",
  phase: ValidationPhase,
  sessionId: string,
): void {
  const excluded = new Set(["manifest.json", "SHA256SUMS"]);
  const files = filesBelow(output)
    .map((path) => relative(output, path).replaceAll("\\", "/"))
    .filter((path) => !excluded.has(path))
    .sort()
    .map((path) => ({ path, sha256: sha256File(join(output, path)) }));
  writeProtected(join(output, "manifest.json"), {
    schema: "rlsok.io/physical-ur5e-validation/v1",
    status,
    phase,
    sessionId,
    generatedAt: new Date().toISOString(),
    files,
  });
  const all = [...files, { path: "manifest.json", sha256: sha256File(join(output, "manifest.json")) }];
  writeProtected(
    join(output, "SHA256SUMS"),
    `${all.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
  );
}

function readVerifiedManifest(
  output: string,
  phase: ValidationPhase,
  status: "PENDING" | "PASSED",
  requiredFiles: string[],
): ValidationManifest {
  const manifestPath = join(output, "manifest.json");
  const checksumPath = join(output, "SHA256SUMS");
  const manifest = readJsonObject<ValidationManifest>(
    manifestPath,
    "validation_manifest",
  );
  if (
    manifest.schema !== "rlsok.io/physical-ur5e-validation/v1" ||
    manifest.phase !== phase ||
    manifest.status !== status ||
    typeof manifest.sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(manifest.sessionId) ||
    typeof manifest.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("validation_manifest_identity_invalid");
  }
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.path.includes("\\") ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
      ["manifest.json", "SHA256SUMS"].includes(entry.path) ||
      seen.has(entry.path)
    ) {
      throw new Error("validation_manifest_entry_invalid");
    }
    seen.add(entry.path);
    const path = join(output, ...entry.path.split("/"));
    if (!existsSync(path)) throw new Error(`validation_artifact_missing:${entry.path}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`validation_artifact_not_regular:${entry.path}`);
    }
    if (sha256File(path) !== entry.sha256) {
      throw new Error(`validation_artifact_hash_mismatch:${entry.path}`);
    }
  }
  for (const requiredFile of requiredFiles) {
    if (!seen.has(requiredFile)) {
      throw new Error(`validation_artifact_unmanifested:${requiredFile}`);
    }
  }
  if (!existsSync(checksumPath)) throw new Error("validation_checksums_missing");
  const checksumStat = lstatSync(checksumPath);
  if (!checksumStat.isFile() || checksumStat.isSymbolicLink()) {
    throw new Error("validation_checksums_must_be_regular_non_symlink");
  }
  const expectedChecksums = `${[
    ...manifest.files,
    { path: "manifest.json", sha256: sha256File(manifestPath) },
  ]
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n")}\n`;
  if (readFileSync(checksumPath, "utf8") !== expectedChecksums) {
    throw new Error("validation_checksums_mismatch");
  }
  return manifest;
}

function assertSessionIdentity(
  expected: { sessionId: string; operator: string; robotSerial: string },
  actual: { sessionId: string; operator: string; robotSerial: string },
): void {
  if (actual.sessionId !== expected.sessionId) {
    throw new Error("validation_session_mismatch");
  }
  if (actual.operator !== expected.operator) {
    throw new Error("validation_operator_mismatch");
  }
  if (actual.robotSerial !== expected.robotSerial) {
    throw new Error("validation_robot_serial_mismatch");
  }
}

function setupBinding(setup: SetupState) {
  return {
    version: setup.version,
    releaseId: setup.releaseId,
    deviceId: setup.deviceId,
    controllerId: setup.controllerId,
    artifactPath: resolve(setup.artifactPath),
    artifactSha256: setup.artifactSha256,
    jointStateTopic: setup.jointStateTopic,
    controllerAction: setup.controllerAction,
    jointNames: setup.jointNames,
    proposalTopic: setup.proposalTopic,
    proposerIdentity: setup.proposerIdentity,
    integration: setup.integration,
    releasePath: resolve(setup.releasePath),
    proposalPath: resolve(setup.proposalPath),
    evidencePath: resolve(setup.evidencePath),
    cloudApiUrl: setup.cloudApiUrl.replace(/\/+$/, ""),
    completedAt: setup.completedAt,
  };
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

function setupStatePath(): string {
  return join(configRoot(), "setup.json");
}

function readSetup(): SetupState {
  const setup = readJsonObject<SetupState>(setupStatePath(), "setup_state");
  const requiredStrings = [
    setup.releaseId,
    setup.deviceId,
    setup.controllerId,
    setup.artifactPath,
    setup.artifactSha256,
    setup.jointStateTopic,
    setup.controllerAction,
    setup.proposalTopic,
    setup.proposerIdentity,
    setup.releasePath,
    setup.proposalPath,
    setup.evidencePath,
    setup.cloudApiUrl,
    setup.completedAt,
  ];
  if (
    setup.version !== 2 ||
    requiredStrings.some((value) => typeof value !== "string" || value.length === 0) ||
    !/^[a-f0-9]{64}$/.test(setup.artifactSha256) ||
    !Array.isArray(setup.jointNames) ||
    setup.jointNames.length !== 6 ||
    setup.jointNames.some((joint) => typeof joint !== "string" || !joint) ||
    !setup.integration ||
    typeof setup.integration !== "object" ||
    typeof setup.integration.namespace !== "string"
  ) {
    throw new Error("setup_state_invalid");
  }
  return setup;
}

function readRelease(path: string): ExecutablePolicySpec {
  if (!existsSync(path)) throw new Error("approved_release_missing");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("approved_release_must_be_regular_non_symlink");
  }
  const parsed = executablePolicySpecSchema.safeParse(load(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`invalid approved release: ${parsed.error.message}`);
  return parsed.data;
}

function assertSameEnvironment(
  expected: ReturnType<typeof environmentProof>,
  actual: ReturnType<typeof environmentProof>,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error("validation_environment_changed");
  }
}

function cloudConfigForSetup(setup: SetupState) {
  const config = loadCloudClientConfig();
  const configured = config.apiUrl.toString().replace(/\/+$/, "");
  const expected = setup.cloudApiUrl.replace(/\/+$/, "");
  if (configured !== expected) throw new Error("validation_cloud_endpoint_changed");
  return config;
}

function assertSetupReleaseBinding(
  setup: SetupState,
  release: ExecutablePolicySpec,
): void {
  const configuration = release.executionConfiguration;
  if (
    release.metadata.releaseId !== setup.releaseId ||
    release.evidence.status !== "approved" ||
    !release.evidence.approvedBy ||
    !release.evidence.approvedAt ||
    release.model.sha256 !== setup.artifactSha256 ||
    release.robot.profileId !== setup.integration.profileId ||
    !release.deployment.allowedDeviceIds.includes(setup.deviceId) ||
    configuration?.schemaVersion !== 1 ||
    configuration.deviceIdentity !== setup.deviceId ||
    configuration.jointState.topic !== setup.jointStateTopic ||
    configuration.controller.followJointTrajectoryAction !== setup.controllerAction ||
    canonicalJson(configuration.jointOrder) !== canonicalJson(setup.jointNames)
  ) {
    throw new Error("setup_release_binding_mismatch");
  }
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
  if (existsSync(output) && readdirSync(output).length > 0) {
    throw new Error("validation_output_must_be_empty_for_preflight");
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const attestation = assertPhysicalInputs(options);
  const sessionId = randomUUID();
  const report = discover(options);
  const integration = selectUr5e(report, options["robot-namespace"]);
  writeProtected(join(output, "preflight.json"), {
    schema: "rlsok.io/physical-ur5e-validation-session/v1",
    sessionId,
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
  writeManifest(output, "PENDING", "preflight", sessionId);
  process.stdout.write(`UR5e preflight PASS; hardware validation remains PENDING. Artifact: ${output}\n`);
  return 0;
}

async function record(options: Options): Promise<number> {
  assertSupportedPlatform();
  const output = resolve(required(options, "output"));
  const attestation = assertPhysicalInputs(options);
  const manifest = readVerifiedManifest(output, "preflight", "PENDING", [
    "preflight.json",
    "operator-workflow.txt",
  ]);
  const preflight = readJsonObject<PreflightRecord>(
    join(output, "preflight.json"),
    "preflight_record",
  );
  if (
    preflight.schema !== "rlsok.io/physical-ur5e-validation-session/v1" ||
    preflight.status !== "PASS" ||
    preflight.hardwareValidation !== "PENDING"
  ) {
    throw new Error("preflight_record_invalid");
  }
  assertSessionIdentity(
    { sessionId: manifest.sessionId, ...attestation },
    preflight,
  );
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
  const currentEnvironment = environmentProof(report, integration);
  assertSameEnvironment(preflight.environment, currentEnvironment);
  if (
    integration.controllerAction !== setup.controllerAction ||
    integration.jointStateTopic !== setup.jointStateTopic ||
    JSON.stringify(integration.jointNames) !== JSON.stringify(setup.jointNames)
  ) {
    throw new Error("live UR5e graph no longer matches the approved setup binding");
  }
  const release = readRelease(setup.releasePath);
  assertSetupReleaseBinding(setup, release);
  if (sha256RegularFile(setup.artifactPath, "protected_policy_artifact") !== setup.artifactSha256) {
    throw new Error("protected policy artifact digest mismatch");
  }
  const proposal = readJsonObject<Record<string, unknown>>(
    setup.proposalPath,
    "setup_proposal",
  );
  const parsedProposal = ros2ProposalEnvelopeSchema.parse(proposal);
  const evidence = readJsonObject<{
    executionMode?: string;
    mode?: string;
    releaseId?: string;
    proposalId?: string;
    cloudPermitId?: string;
    cloudPermitConsumed?: boolean;
    localPermitConsumed?: boolean;
    cloudEvidenceId?: string;
    decision?: string;
    controllerGoalsAttempted?: number;
    hardwareSignalSent?: boolean;
    evidenceVerified?: boolean;
  }>(setup.evidencePath, "setup_shadow_evidence");
  if (
    evidence.executionMode !== "cloud-connected" ||
    evidence.mode !== "shadow" ||
    evidence.releaseId !== setup.releaseId ||
    evidence.proposalId !== parsedProposal.proposalId ||
    evidence.decision !== "allowed" ||
    evidence.cloudPermitConsumed !== true ||
    evidence.localPermitConsumed !== true ||
    evidence.controllerGoalsAttempted !== 0 ||
    evidence.hardwareSignalSent !== false ||
    evidence.evidenceVerified !== true ||
    !evidence.cloudPermitId ||
    !evidence.cloudEvidenceId
  ) {
    throw new Error("setup Shadow Evidence does not prove verified zero dispatch");
  }
  const cloudConfig = cloudConfigForSetup(setup);
  const cloud = new RlsokCloudClient(cloudConfig);
  const cloudEvidence = await cloud.getEvidence(evidence.cloudEvidenceId);
  const cloudVerification = verifyCloudEvidence(cloudEvidence);
  if (!cloudVerification.ok) throw new Error(cloudVerification.reason);
  const releaseHash = executablePolicyHash(release);
  if (
    cloudEvidence.id !== evidence.cloudEvidenceId ||
    cloudEvidence.releaseId !== setup.releaseId ||
    cloudEvidence.permitId !== evidence.cloudPermitId ||
    cloudEvidence.decision !== "allowed" ||
    cloudEvidence.hardwareSignalSent !== false ||
    cloudEvidence.payload.contractVersion !== "rlsok-cloud/v1" ||
    cloudEvidence.payload.evaluationMode !== "shadow" ||
    cloudEvidence.payload.contentHash !== releaseHash ||
    cloudEvidence.payload.deviceId !== setup.deviceId ||
    cloudEvidence.payload.controllerId !== release.robot.controllerConfigSha256 ||
    cloudEvidence.payload.expectedConfigurationDigest !== release.approvedConfigurationDigest ||
    cloudEvidence.payload.observedConfigurationDigest !== release.approvedConfigurationDigest ||
    cloudEvidence.payload.localPermitConsumed !== true ||
    cloudEvidence.payload.controllerGoalsAttempted !== 0
  ) {
    throw new Error("cloud_shadow_evidence_binding_mismatch");
  }
  const checks = runUr5eNegativeChecks(
    release,
    proposal,
    release.robot.controllerConfigSha256,
  );
  writeProtected(
    join(output, "shadow-evidence.json"),
    readFileSync(setup.evidencePath, "utf8"),
  );
  const binding: BindingRecord & Record<string, unknown> = {
    schema: "rlsok.io/physical-ur5e-validation-binding/v1",
    sessionId: manifest.sessionId,
    ...attestation,
    releaseId: setup.releaseId,
    executablePolicyHash: releaseHash,
    setupStateSha256: sha256RegularFile(setupStatePath(), "setup_state"),
    setupBindingSha256: sha256(canonicalJson(setupBinding(setup))),
    releaseFileSha256: sha256RegularFile(setup.releasePath, "approved_release"),
    proposalFileSha256: sha256RegularFile(setup.proposalPath, "setup_proposal"),
    setupEvidenceFileSha256: sha256RegularFile(
      setup.evidencePath,
      "setup_shadow_evidence",
    ),
    artifactSha256: setup.artifactSha256,
    environmentSha256: sha256(canonicalJson(currentEnvironment)),
    cloudApiUrl: cloudConfig.apiUrl.toString().replace(/\/+$/, ""),
    deviceId: setup.deviceId,
    controllerRegistryId: setup.controllerId,
    controllerIdentity: release.robot.controllerConfigSha256,
    environment: currentEnvironment,
  };
  writeProtected(join(output, "binding.json"), binding);
  const negativeChecks = {
    schema: "rlsok.io/physical-ur5e-negative-checks/v1",
    sessionId: manifest.sessionId,
    releaseId: setup.releaseId,
    status: "PASS",
    checks,
    machineVerifiableZeroDispatch: checks.every(
      (check) => check.controllerGoalsAttempted === 0 && check.hardwareSignalSent === false,
    ),
  };
  writeProtected(join(output, "negative-checks.json"), negativeChecks);
  const recordPhase: RecordPhase & Record<string, unknown> = {
    schema: "rlsok.io/physical-ur5e-validation-record/v1",
    sessionId: manifest.sessionId,
    status: "PASS",
    hardwareValidation: "PENDING_REVOCATION_CHECK",
    ...attestation,
    releaseId: setup.releaseId,
    bindingSha256: sha256File(join(output, "binding.json")),
    negativeChecksSha256: sha256File(join(output, "negative-checks.json")),
    shadowEvidenceSha256: sha256File(join(output, "shadow-evidence.json")),
    cloudEvidenceId: evidence.cloudEvidenceId,
    cloudEvidenceVerified: true,
    controllerGoalsAttempted: 0,
    hardwareSignalSent: false,
  };
  writeProtected(join(output, "record.json"), recordPhase);
  writeManifest(output, "PENDING", "record", manifest.sessionId);
  process.stdout.write(`UR5e Shadow and negative checks PASS; revoke ${setup.releaseId} in Hosted Cloud, then run finalize.\n`);
  return 0;
}

async function finalize(options: Options): Promise<number> {
  assertSupportedPlatform();
  const output = resolve(required(options, "output"));
  const attestation = assertPhysicalInputs(options);
  const manifest = readVerifiedManifest(output, "record", "PENDING", [
    "preflight.json",
    "operator-workflow.txt",
    "shadow-evidence.json",
    "binding.json",
    "negative-checks.json",
    "record.json",
  ]);
  const preflight = readJsonObject<PreflightRecord>(
    join(output, "preflight.json"),
    "preflight_record",
  );
  const binding = readJsonObject<BindingRecord>(
    join(output, "binding.json"),
    "validation_binding",
  );
  const recordPhase = readJsonObject<RecordPhase>(
    join(output, "record.json"),
    "validation_record",
  );
  const negativeChecks = readJsonObject<{
    schema?: string;
    sessionId?: string;
    releaseId?: string;
    status?: string;
    machineVerifiableZeroDispatch?: boolean;
    checks?: Array<{
      name?: string;
      result?: string;
      controllerGoalsAttempted?: number;
      hardwareSignalSent?: boolean;
    }>;
  }>(join(output, "negative-checks.json"), "negative_checks");
  if (
    preflight.schema !== "rlsok.io/physical-ur5e-validation-session/v1" ||
    preflight.status !== "PASS" ||
    preflight.hardwareValidation !== "PENDING" ||
    binding.schema !== "rlsok.io/physical-ur5e-validation-binding/v1" ||
    recordPhase.schema !== "rlsok.io/physical-ur5e-validation-record/v1" ||
    recordPhase.status !== "PASS" ||
    recordPhase.hardwareValidation !== "PENDING_REVOCATION_CHECK" ||
    negativeChecks.schema !== "rlsok.io/physical-ur5e-negative-checks/v1" ||
    negativeChecks.status !== "PASS" ||
    negativeChecks.machineVerifiableZeroDispatch !== true ||
    !Array.isArray(negativeChecks.checks) ||
    negativeChecks.checks.length !== 6 ||
    negativeChecks.checks.some(
      (check) =>
        check.result !== "PASS" ||
        check.controllerGoalsAttempted !== 0 ||
        check.hardwareSignalSent !== false,
    )
  ) {
    throw new Error("recorded_validation_state_invalid");
  }
  for (const phaseIdentity of [preflight, binding, recordPhase]) {
    assertSessionIdentity(
      { sessionId: manifest.sessionId, ...attestation },
      phaseIdentity,
    );
  }
  if (
    negativeChecks.sessionId !== manifest.sessionId ||
    binding.releaseId !== recordPhase.releaseId ||
    negativeChecks.releaseId !== recordPhase.releaseId ||
    recordPhase.bindingSha256 !== sha256File(join(output, "binding.json")) ||
    recordPhase.negativeChecksSha256 !==
      sha256File(join(output, "negative-checks.json")) ||
    recordPhase.shadowEvidenceSha256 !==
      sha256File(join(output, "shadow-evidence.json"))
  ) {
    throw new Error("recorded_validation_binding_mismatch");
  }
  const setup = readSetup();
  if (
    setup.integration.supportLevel !== "official" ||
    setup.integration.vendor !== "Universal Robots" ||
    setup.integration.model !== "UR5e"
  ) {
    throw new Error("setup state is not bound to the official UR5e integration");
  }
  if (
    binding.releaseId !== setup.releaseId ||
    binding.setupStateSha256 !== sha256RegularFile(setupStatePath(), "setup_state") ||
    binding.setupBindingSha256 !== sha256(canonicalJson(setupBinding(setup))) ||
    binding.releaseFileSha256 !== sha256RegularFile(setup.releasePath, "approved_release") ||
    binding.proposalFileSha256 !== sha256RegularFile(setup.proposalPath, "setup_proposal") ||
    binding.setupEvidenceFileSha256 !==
      sha256RegularFile(setup.evidencePath, "setup_shadow_evidence") ||
    binding.artifactSha256 !==
      sha256RegularFile(setup.artifactPath, "protected_policy_artifact")
  ) {
    throw new Error("validation_setup_changed_after_record");
  }
  const release = readRelease(setup.releasePath);
  assertSetupReleaseBinding(setup, release);
  const releaseHash = executablePolicyHash(release);
  if (
    release.metadata.releaseId !== setup.releaseId ||
    binding.executablePolicyHash !== releaseHash
  ) {
    throw new Error("validation_release_changed_after_record");
  }
  const report = discover(options);
  const integration = selectUr5e(report, setup.integration.namespace);
  const currentEnvironment = environmentProof(report, integration);
  assertSameEnvironment(preflight.environment, currentEnvironment);
  if (
    binding.environmentSha256 !== sha256(canonicalJson(currentEnvironment)) ||
    integration.controllerAction !== setup.controllerAction ||
    integration.jointStateTopic !== setup.jointStateTopic ||
    canonicalJson(integration.jointNames) !== canonicalJson(setup.jointNames)
  ) {
    throw new Error("validation_environment_changed_after_record");
  }
  const cloudConfig = cloudConfigForSetup(setup);
  if (binding.cloudApiUrl !== cloudConfig.apiUrl.toString().replace(/\/+$/, "")) {
    throw new Error("validation_cloud_endpoint_changed");
  }
  const cloud = new RlsokCloudClient(cloudConfig);
  const current = await cloud.getRelease(setup.releaseId);
  if (
    current.releaseId !== setup.releaseId ||
    current.contentHash !== releaseHash
  ) {
    throw new Error("cloud_release_binding_mismatch");
  }
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
  const proposal = readJsonObject<Record<string, unknown>>(
    setup.proposalPath,
    "setup_proposal",
  );
  const parsedProposal = ros2ProposalEnvelopeSchema.parse(proposal);
  const evidence = readJsonObject<{
    executionMode?: string;
    mode?: string;
    releaseId?: string;
    proposalId?: string;
    cloudPermitId?: string | null;
    cloudPermitConsumed?: boolean;
    localPermitConsumed?: boolean;
    cloudEvidenceId?: string;
    decision?: string;
    reason?: string;
    controllerGoalsAttempted?: number;
    hardwareSignalSent?: boolean;
    evidenceVerified?: boolean;
  }>(evidencePath, "revocation_evidence");
  if (
    evidence.executionMode !== "cloud-connected" ||
    evidence.mode !== "shadow" ||
    evidence.releaseId !== setup.releaseId ||
    evidence.proposalId !== parsedProposal.proposalId ||
    evidence.decision !== "blocked" ||
    evidence.reason !== "cloud_release_not_eligible:revoked" ||
    evidence.cloudPermitId !== null ||
    evidence.cloudPermitConsumed !== false ||
    evidence.localPermitConsumed !== false ||
    evidence.controllerGoalsAttempted !== 0 ||
    evidence.hardwareSignalSent !== false ||
    evidence.evidenceVerified !== true ||
    !evidence.cloudEvidenceId
  ) {
    throw new Error("revocation Evidence did not prove a verified zero-dispatch denial");
  }
  const cloudEvidence = await cloud.getEvidence(evidence.cloudEvidenceId);
  const cloudVerification = verifyCloudEvidence(cloudEvidence);
  if (!cloudVerification.ok) throw new Error(cloudVerification.reason);
  if (
    cloudEvidence.id !== evidence.cloudEvidenceId ||
    cloudEvidence.releaseId !== setup.releaseId ||
    cloudEvidence.permitId !== null ||
    cloudEvidence.decision !== "blocked" ||
    cloudEvidence.hardwareSignalSent !== false ||
    cloudEvidence.payload.contractVersion !== "rlsok-cloud/v1" ||
    cloudEvidence.payload.evaluationMode !== "denial" ||
    cloudEvidence.payload.contentHash !== releaseHash ||
    cloudEvidence.payload.deviceId !== setup.deviceId ||
    cloudEvidence.payload.controllerId !== release.robot.controllerConfigSha256 ||
    cloudEvidence.payload.expectedConfigurationDigest !== release.approvedConfigurationDigest ||
    cloudEvidence.payload.localPermitConsumed !== false ||
    cloudEvidence.payload.controllerGoalsAttempted !== 0 ||
    cloudEvidence.payload.reason !== "cloud_release_not_eligible:revoked"
  ) {
    throw new Error("cloud_revocation_evidence_binding_mismatch");
  }
  writeProtected(join(output, "result.json"), {
    schema: "rlsok.io/physical-ur5e-validation-result/v1",
    sessionId: manifest.sessionId,
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
  writeManifest(output, "PASSED", "finalize", manifest.sessionId);
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
