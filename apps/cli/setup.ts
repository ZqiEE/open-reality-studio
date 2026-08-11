import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname, homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { dump } from "js-yaml";
import {
  RlsokCloudClient,
  loadCloudClientConfig,
} from "../../packages/cloud-client";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import {
  executablePolicySpecSchema,
  type ExecutablePolicySpec,
} from "../../packages/core/exec-spec";
import { readStoredCloudCredentials } from "../../packages/cloud-client/credentials";
import { openBrowser, runPairCommand } from "./pair";
import { runRos2Command } from "./ros2";

type Options = Record<string, string | true>;

interface DiscoveryReport {
  rosAvailable: boolean;
  rosDistro: string | null;
  rmwImplementation: string | null;
  rosDomainId: string;
  jointStateSources: Array<{
    name: string;
    types: string[];
    sample: {
      jointNames: string[];
      positions: number[];
      observedAt: string;
    } | null;
  }>;
  trajectoryActionServers: Array<{ name: string; types: string[] }>;
  nodes: string[];
}

interface SetupState {
  version: 1;
  releaseId: string;
  deviceId: string;
  controllerId: string;
  artifactPath: string;
  artifactSha256: string;
  jointStateTopic: string;
  controllerAction: string;
  releasePath: string;
  proposalPath: string;
  evidencePath: string;
  cloudApiUrl: string;
  completedAt: string;
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name?.startsWith("--"))
      throw new Error(`Unexpected argument ${name ?? ""}. Run rlsok setup --help.`);
    const key = name.slice(2);
    if (["non-interactive", "no-browser", "json", "help"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Option --${key} requires a value.`);
    options[key] = value;
  }
  return options;
}

function option(options: Options, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function dataRoot(source: NodeJS.ProcessEnv = process.env): string {
  if (source.RLSOK_DATA_HOME) return source.RLSOK_DATA_HOME;
  if (source.XDG_DATA_HOME) return join(source.XDG_DATA_HOME, "rlsok");
  return join(homedir(), ".local", "share", "rlsok");
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
    throw new Error(
      `This Zero-to-Shadow release supports Ubuntu 24.04 x86_64. Found ${process.platform}/${process.arch}${release.PRETTY_NAME ? ` (${release.PRETTY_NAME})` : ""}. Use a supported machine; RLSOK will not guess across unvalidated robot environments.`,
    );
  }
}

function discover(options: Options): DiscoveryReport {
  const fixture = process.env.RLSOK_SETUP_DISCOVERY_FIXTURE;
  if (fixture) return JSON.parse(readFileSync(fixture, "utf8")) as DiscoveryReport;
  const timeout = Number(option(options, "discovery-timeout-ms") ?? "15000");
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000)
    throw new Error("Discovery timeout must be between 1000 and 120000 ms.");
  const python = option(options, "python") ?? "python3";
  const sidecar = resolve(option(options, "sidecar") ?? defaultSidecarPath());
  const result = spawnSync(
    python,
    [
      sidecar,
      "--discover",
      "--discovery-timeout-seconds",
      String(timeout / 1_000),
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error)
    throw new Error(
      `RLSOK could not start Python 3 (${result.error.message}). Install python3 and source /opt/ros/jazzy/setup.bash, then run rlsok setup again.`,
    );
  let report: DiscoveryReport;
  try {
    report = JSON.parse(result.stdout) as DiscoveryReport;
  } catch {
    throw new Error(
      `ROS discovery did not return a valid report. Run 'rlsok ros2 doctor' for technical diagnostics.${result.stderr.trim() ? ` Detail: ${result.stderr.trim()}` : ""}`,
    );
  }
  return report;
}

async function choose<T extends { name: string }>(
  label: string,
  values: T[],
  selected: string | undefined,
  nonInteractive: boolean,
): Promise<T> {
  if (selected) {
    const match = values.find((value) => value.name === selected);
    if (!match)
      throw new Error(
        `${label} '${selected}' was not found. Detected: ${values.map((value) => value.name).join(", ") || "none"}.`,
      );
    return match;
  }
  if (values.length === 1) return values[0]!;
  if (values.length === 0)
    throw new Error(`No ${label} was detected.`);
  if (nonInteractive || !process.stdin.isTTY)
    throw new Error(
      `Multiple ${label} choices were detected. Re-run with the corresponding explicit option. Choices: ${values.map((value) => value.name).join(", ")}.`,
    );
  process.stdout.write(`\nChoose ${label}:\n`);
  values.forEach((value, index) =>
    process.stdout.write(`  ${index + 1}. ${value.name}\n`),
  );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Selection [1-${values.length}]: `);
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !values[index])
      throw new Error("Invalid selection. Run rlsok setup again.");
    return values[index]!;
  } finally {
    terminal.close();
  }
}

async function artifactInput(options: Options): Promise<string> {
  const specified = option(options, "artifact");
  if (specified) return resolve(specified);
  if (options["non-interactive"] || !process.stdin.isTTY)
    throw new Error(
      "RLSOK needs the policy artifact to bind. Re-run with --artifact /path/to/policy.",
    );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return resolve(
      await terminal.question("Policy artifact file to observe in Shadow: "),
    );
  } finally {
    terminal.close();
  }
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "robot"
  );
}

function writeProtected(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

function createSpec(input: {
  artifactName: string;
  artifactSha256: string;
  deviceId: string;
  controllerHash: string;
  robotHash: string;
  boundaryHash: string;
  jointNames: string[];
  releaseId: string;
}): ExecutablePolicySpec {
  const identityTransform = sha256(
    canonicalJson({ kind: "identity-transform", version: 1 }),
  );
  return executablePolicySpecSchema.parse({
    apiVersion: "realitywarden.io/v1alpha1",
    kind: "ExecutablePolicy",
    metadata: {
      name: `First Shadow for ${input.deviceId}`,
      releaseId: input.releaseId,
      createdAt: new Date().toISOString(),
    },
    model: {
      artifact: `artifacts/${input.artifactSha256}`,
      sha256: input.artifactSha256,
      framework: "custom",
      policyType: "joint-trajectory",
      codeRevision: `sha256:${input.artifactSha256}`,
    },
    actionContract: {
      representation: "trajectory",
      dimension: input.jointNames.length,
      jointOrder: input.jointNames,
      units: { position: "radian", velocity: "radian_per_second" },
      normalizerSha256: identityTransform,
      preprocessorSha256: identityTransform,
      postprocessorSha256: identityTransform,
    },
    robot: {
      profileId: input.deviceId,
      profileSha256: input.robotHash,
      urdfSha256: input.boundaryHash,
      controllerType: "FollowJointTrajectory",
      controllerConfigSha256: input.controllerHash,
    },
    runtimePolicy: {
      policySha256: sha256(
        canonicalJson({ failClosed: true, maxStateAgeMs: 1000, version: 1 }),
      ),
      maxStateAgeMs: 1000,
      failClosed: true,
    },
    evidence: {
      scenarioPackId: "zero-to-shadow-v1",
      testReportSha256: input.boundaryHash,
      status: "tested",
      approvedBy: "",
      approvedAt: "",
    },
    deployment: {
      allowedDeviceIds: [input.deviceId],
      mode: "shadow",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
}

async function waitForApproval(
  cloud: RlsokCloudClient,
  releaseId: string,
  timeoutMinutes: number,
): Promise<ExecutablePolicySpec> {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  process.stdout.write("Waiting for independent approval");
  while (Date.now() < deadline) {
    const release = await cloud.getRelease(releaseId);
    if (release.state === "revoked")
      throw new Error("The onboarding release was revoked in Cloud. Start setup again with a new release name.");
    if (release.state === "approved") {
      process.stdout.write(" approved.\n");
      const parsed = executablePolicySpecSchema.safeParse(release.execSpec);
      if (!parsed.success || parsed.data.evidence.status !== "approved")
        throw new Error("Cloud approved the release but did not return a finalized ExecSpec. Contact RLSOK support with the release ID.");
      return parsed.data;
    }
    process.stdout.write(".");
    await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  }
  process.stdout.write("\n");
  throw new Error(
    `Approval did not complete within ${timeoutMinutes} minutes. The draft remains in Cloud; run rlsok setup again after an independent Workspace administrator approves it.`,
  );
}

export function setupUsage(): string {
  return [
    "usage: rlsok setup [options]",
    "",
    "Zero-to-Shadow guides a supported Ubuntu 24.04 / ROS 2 Jazzy / Fast DDS system from",
    "environment discovery through Hosted Cloud pairing and verified Shadow.",
    "",
    "  --artifact <file>              policy artifact to bind",
    "  --joint-state-topic <name>     choose a discovered JointState source",
    "  --controller-action <name>     choose a discovered FollowJointTrajectory server",
    "  --device-name <name>           human-readable robot/device name",
    "  --cloud <url>                  Hosted Cloud API (default https://api.rlsok.com)",
    "  --non-interactive              require explicit choices when ambiguous",
    "  --no-browser                   print browser URLs instead of opening them",
  ].join("\n");
}

export async function runSetupCommand(args: string[]): Promise<number> {
  const options = parseOptions(args);
  if (options.help) {
    process.stdout.write(`${setupUsage()}\n`);
    return 0;
  }
  assertSupportedPlatform();
  process.stdout.write("RLSOK Zero-to-Shadow\n\n[1/6] Detecting the supported environment...\n");
  const report = discover(options);
  if (!report.rosAvailable)
    throw new Error(
      "ROS 2 is not available in this terminal. Install ROS 2 Jazzy, then run 'source /opt/ros/jazzy/setup.bash' and retry.",
    );
  if (report.rosDistro !== "jazzy")
    throw new Error(
      `RLSOK expected ROS 2 Jazzy but found '${report.rosDistro ?? "no sourced distribution"}'. Source /opt/ros/jazzy/setup.bash and retry.`,
    );
  if (report.rmwImplementation !== "rmw_fastrtps_cpp")
    throw new Error(
      `RLSOK expected Fast DDS (rmw_fastrtps_cpp) but found '${report.rmwImplementation ?? "unknown"}'. Run 'export RMW_IMPLEMENTATION=rmw_fastrtps_cpp' before setup.`,
    );
  const nonInteractive = Boolean(options["non-interactive"]);
  if (report.jointStateSources.length === 0)
    throw new Error(
      "RLSOK expected at least one sensor_msgs/msg/JointState source but found none. Start the robot state publisher, confirm 'ros2 topic list -t' shows JointState, and verify ROS_DOMAIN_ID matches the robot graph.",
    );
  if (!report.jointStateSources.some((source) => source.sample))
    throw new Error(
      `RLSOK found JointState topics (${report.jointStateSources.map((source) => source.name).join(", ")}) but received no valid sample. Check one with 'ros2 topic echo --once <topic>' and retry while it is publishing.`,
    );
  if (report.trajectoryActionServers.length === 0)
    throw new Error(
      "RLSOK expected a control_msgs/action/FollowJointTrajectory server but found none. Start ros2_control, confirm the controller is active with 'ros2 control list_controllers', then inspect 'ros2 action list -t'.",
    );
  const jointSource = await choose(
    "JointState source (--joint-state-topic)",
    report.jointStateSources.filter(
      (source) =>
        source.sample &&
        source.sample.jointNames.length > 0 &&
        source.sample.jointNames.length === source.sample.positions.length,
    ),
    option(options, "joint-state-topic"),
    nonInteractive,
  );
  const controller = await choose(
    "FollowJointTrajectory server (--controller-action)",
    report.trajectoryActionServers,
    option(options, "controller-action"),
    nonInteractive,
  );
  process.stdout.write(
    `  [ok] Ubuntu 24.04 x86_64\n  [ok] ROS 2 Jazzy\n  [ok] Fast DDS\n  [ok] ${jointSource.name} (${jointSource.sample!.jointNames.length} joints)\n  [ok] ${controller.name}\n`,
  );

  process.stdout.write("\n[2/6] Binding the policy artifact and ROS boundary...\n");
  const sourceArtifact = await artifactInput(options);
  if (!existsSync(sourceArtifact) || !lstatSync(sourceArtifact).isFile())
    throw new Error(`Policy artifact is not a regular file: ${sourceArtifact}`);
  const artifactSha256 = await hashFile(sourceArtifact);
  const artifactSize = lstatSync(sourceArtifact).size;
  if (artifactSize < 1)
    throw new Error("The policy artifact is empty. Choose the actual policy file and retry.");
  const deviceName = option(options, "device-name") ?? hostname();
  const boundary = {
    version: 1,
    rosDistro: report.rosDistro,
    rmwImplementation: report.rmwImplementation,
    rosDomainId: report.rosDomainId,
    jointStateTopic: jointSource.name,
    jointNames: jointSource.sample!.jointNames,
    controllerAction: controller.name,
  };
  const boundaryHash = sha256(canonicalJson(boundary));
  const deviceId = `${slug(deviceName)}-${boundaryHash.slice(0, 8)}`;
  const controllerId = `trajectory-${sha256(canonicalJson({ action: controller.name, joints: jointSource.sample!.jointNames })).slice(0, 12)}`;
  const controllerHash = sha256(
    canonicalJson({
      action: controller.name,
      actionType: "control_msgs/action/FollowJointTrajectory",
      joints: jointSource.sample!.jointNames,
      rmwImplementation: report.rmwImplementation,
    }),
  );
  const robotHash = sha256(
    canonicalJson({ deviceId, jointStateTopic: jointSource.name, boundary }),
  );
  const releaseId =
    option(options, "release-name") ??
    `first-shadow-${slug(deviceName)}-${artifactSha256.slice(0, 8)}-${randomUUID().slice(0, 6)}`;
  const spec = createSpec({
    artifactName: basename(sourceArtifact),
    artifactSha256,
    deviceId,
    controllerHash,
    robotHash,
    boundaryHash,
    jointNames: jointSource.sample!.jointNames,
    releaseId,
  });
  const root = dataRoot();
  const artifactPath = join(root, "artifacts", artifactSha256);
  mkdirSync(dirname(artifactPath), { recursive: true, mode: 0o700 });
  if (!existsSync(artifactPath)) copyFileSync(sourceArtifact, artifactPath);
  if ((await hashFile(artifactPath)) !== artifactSha256)
    throw new Error("The protected local artifact copy failed digest verification. Remove it and retry setup.");
  if (process.platform !== "win32") chmodSync(artifactPath, 0o400);
  const releasePath = join(root, "releases", `${releaseId}.yaml`);
  const proposalPath = join(root, "proposals", `${releaseId}.json`);
  const evidencePath = join(root, "evidence", `${releaseId}.json`);
  writeProtected(releasePath, dump(spec, { noRefs: true, lineWidth: 100 }));
  process.stdout.write(
    `  ✓ SHA-256 ${artifactSha256}\n  ✓ Generated device and controller bindings\n  ✓ Saved inspectable release at ${releasePath}\n`,
  );

  const apiUrl = option(options, "cloud") ?? "https://api.rlsok.com";
  process.stdout.write("\n[3/6] Pairing with Hosted RLSOK Cloud...\n");
  const storedCredentials = readStoredCloudCredentials();
  if (!storedCredentials) {
    const pairArgs = ["--cloud", apiUrl];
    if (options["no-browser"]) pairArgs.push("--no-browser");
    await runPairCommand(pairArgs);
  } else if (
    storedCredentials.apiUrl.replace(/\/$/, "") !== apiUrl.replace(/\/$/, "")
  ) {
    process.stdout.write(
      `  Existing pairing is for ${storedCredentials.apiUrl}; pairing this runtime with ${apiUrl}.\n`,
    );
    const pairArgs = ["--cloud", apiUrl, "--replace"];
    if (options["no-browser"]) pairArgs.push("--no-browser");
    await runPairCommand(pairArgs);
  } else {
    process.stdout.write("  ✓ Existing protected Cloud pairing found.\n");
  }
  const activeCredentials = readStoredCloudCredentials();
  if (!activeCredentials)
    throw new Error("Cloud pairing completed without stored runtime credentials. Run 'rlsok pair' and retry.");
  const cloud = new RlsokCloudClient(
    loadCloudClientConfig({
      ...process.env,
      RLSOK_CLOUD_API_URL: activeCredentials.apiUrl,
      RLSOK_CLOUD_API_KEY: activeCredentials.apiKey,
    }),
  );

  process.stdout.write("\n[4/6] Creating the exact Shadow draft...\n");
  const draft = await cloud.createZeroToShadowDraft({
    artifact: {
      name: basename(sourceArtifact),
      mediaType: "application/octet-stream",
      sha256: artifactSha256,
      sizeBytes: artifactSize,
    },
    controller: {
      controllerId,
      displayName: controller.name,
      profileSha256: controllerHash,
      rosActionName: controller.name,
    },
    robot: {
      robotId: deviceId,
      displayName: deviceName,
      profileSha256: robotHash,
      controllerId,
    },
    execSpec: spec,
  });
  process.stdout.write(
    `  ✓ Draft ${draft.releaseId} created without uploading policy bytes.\n  Approval: ${draft.approvalUrl}\n`,
  );
  if (!options["no-browser"]) openBrowser(draft.approvalUrl);
  const approvalTimeout = Number(option(options, "approval-timeout-minutes") ?? "30");
  if (!Number.isFinite(approvalTimeout) || approvalTimeout <= 0 || approvalTimeout > 1440)
    throw new Error("Approval timeout must be between 1 and 1440 minutes.");
  const approvedSpec = await waitForApproval(cloud, releaseId, approvalTimeout);
  writeProtected(releasePath, dump(approvedSpec, { noRefs: true, lineWidth: 100 }));

  process.stdout.write("\n[5/6] Running Shadow against the live ROS 2 boundary...\n");
  if ((await hashFile(artifactPath)) !== approvedSpec.model.sha256)
    throw new Error(
      "The local policy artifact changed after approval. RLSOK refused to run Shadow. Start setup again so the changed artifact receives a new identity and approval.",
    );
  const proposal = {
    proposalId: `first-shadow-${randomUUID()}`,
    releaseId,
    deviceId,
    proposerIdentity: "rlsok-zero-to-shadow",
    actionRepresentation: "trajectory",
    actionPayload: {
      representation: "trajectory",
      jointNames: jointSource.sample!.jointNames,
      points: [
        {
          positions: jointSource.sample!.positions,
          velocities: jointSource.sample!.positions.map(() => 0),
          timeFromStartMs: 1000,
        },
      ],
      units: { position: "radian", velocity: "radian_per_second" },
    },
    createdAt: new Date().toISOString(),
  };
  writeProtected(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const shadowArgs = [
    "shadow",
    "--release",
    releasePath,
    "--device",
    deviceId,
    "--proposer",
    "rlsok-zero-to-shadow",
    "--joint-state-topic",
    jointSource.name,
    "--controller-action",
    controller.name,
    "--proposal-file",
    proposalPath,
    "--once",
    "true",
    "--evidence",
    evidencePath,
  ];
  if (option(options, "python"))
    shadowArgs.push("--python", option(options, "python")!);
  if (option(options, "sidecar"))
    shadowArgs.push("--sidecar", option(options, "sidecar")!);
  const shadowExit = await runRos2Command(shadowArgs);
  if (shadowExit !== 0)
    throw new Error("Shadow was blocked. Review the explanation above, correct the environment, and run rlsok setup again.");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
    decision?: string;
    hardwareSignalSent?: boolean;
    controllerGoalsAttempted?: number;
    evidenceVerified?: boolean;
  };
  if (
    evidence.decision !== "allowed" ||
    evidence.hardwareSignalSent !== false ||
    evidence.controllerGoalsAttempted !== 0 ||
    evidence.evidenceVerified !== true
  )
    throw new Error("Shadow returned an unexpected Evidence result. RLSOK kept dispatch disabled; run with RLSOK_DEBUG=1 and contact support.");

  const state: SetupState = {
    version: 1,
    releaseId,
    deviceId,
    controllerId,
    artifactPath,
    artifactSha256,
    jointStateTopic: jointSource.name,
    controllerAction: controller.name,
    releasePath,
    proposalPath,
    evidencePath,
    cloudApiUrl: apiUrl,
    completedAt: new Date().toISOString(),
  };
  const statePath = join(configRoot(), "setup.json");
  writeProtected(statePath, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(
    `\n[6/6] Zero-to-Shadow complete.\n  ✓ Live JointState observed\n  ✓ Exact approved release evaluated\n  ✓ Controller goals attempted: 0\n  ✓ Hardware signal sent: false\n  ✓ Evidence verified by hash\n  Evidence: ${evidencePath}\n  Configuration: ${statePath}\n\nRLSOK is now observing this ROS 2 execution boundary in Shadow. Keep Shadow enabled while you review Evidence; moving to canary requires a separate explicit release decision and independent safety controls.\n`,
  );
  return 0;
}
