import { createHash, randomUUID } from "node:crypto";
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
import {
  configurationDigest,
  executionConfigurationSchema,
} from "../../packages/core/execution-configuration";
import { readStoredCloudCredentials } from "../../packages/cloud-client/credentials";
import {
  assessOfficialRobotIntegrations,
  type OfficialRobotIntegration,
  type Ros2DiscoveryReport,
} from "../../packages/robot-integrations";
import { openBrowser, runPairCommand } from "./pair";
import { runRos2Command } from "./ros2";
import { discoverRos2Environment } from "./ros-discovery";

type Options = Record<string, string | true>;

type DiscoveryReport = Ros2DiscoveryReport;

interface SetupState {
  version: 2;
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
    displayName: string;
    vendor: string | null;
    model: string | null;
    namespace: string;
    validatedEnvironment: string | null;
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

function positionsInJointOrder(
  source: NonNullable<DiscoveryReport["jointStateSources"][number]["sample"]>,
  jointNames: string[],
): number[] {
  const positions = new Map(
    source.jointNames.map((name, index) => [name, source.positions[index]!] as const),
  );
  const ordered = jointNames.map((name) => positions.get(name));
  if (ordered.some((value) => value === undefined))
    throw new Error(
      "The observed JointState changed while setup was binding the robot boundary. RLSOK failed closed; retry while the driver is stable.",
    );
  return ordered as number[];
}

async function chooseOfficialIntegration(
  integrations: OfficialRobotIntegration[],
  namespace: string | undefined,
  nonInteractive: boolean,
): Promise<OfficialRobotIntegration> {
  const normalizedNamespace = namespace
    ? `/${namespace}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/"
    : undefined;
  if (normalizedNamespace) {
    const match = integrations.find(
      (integration) => integration.namespace === normalizedNamespace,
    );
    if (!match)
      throw new Error(
        `--robot-namespace '${namespace}' did not identify an official integration. Detected: ${integrations.map((integration) => `${integration.model} at ${integration.namespace}`).join(", ")}.`,
      );
    return match;
  }
  if (integrations.length === 1) return integrations[0]!;
  if (nonInteractive || !process.stdin.isTTY)
    throw new Error(
      `Multiple official robot integrations were detected. Re-run with --robot-namespace. Choices: ${integrations.map((integration) => `${integration.model} at ${integration.namespace}`).join(", ")}.`,
    );
  process.stdout.write("\nChoose the robot integration:\n");
  integrations.forEach((integration, index) =>
    process.stdout.write(
      `  ${index + 1}. ${integration.vendor} ${integration.model} at ${integration.namespace}\n`,
    ),
  );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Selection [1-${integrations.length}]: `);
    const selected = integrations[Number(answer) - 1];
    if (!selected) throw new Error("Invalid selection. Run rlsok setup again.");
    return selected;
  } finally {
    terminal.close();
  }
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
  urdfSha256: string;
  jointNames: string[];
  releaseId: string;
  integrationProfileId: string;
  controllerType: string;
  rosDistro: string;
  rmwImplementation: string;
  jointStateTopic: string;
  controllerName: string;
  controllerAction: string;
}): ExecutablePolicySpec {
  const identityTransform = sha256(
    canonicalJson({ kind: "identity-transform", version: 1 }),
  );
  const executionConfiguration = executionConfigurationSchema.parse({
    schemaVersion: 1,
    deviceIdentity: input.deviceId,
    robotIdentity: input.robotHash,
    rosDistro: input.rosDistro,
    rmwImplementation: input.rmwImplementation,
    jointState: {
      topic: input.jointStateTopic,
      messageType: "sensor_msgs/msg/JointState",
    },
    controller: {
      name: input.controllerName,
      followJointTrajectoryAction: input.controllerAction,
      actionType: "control_msgs/action/FollowJointTrajectory",
    },
    jointOrder: input.jointNames,
    adapter: { identity: "rlsok-ros2-sidecar", version: "1.3.1" },
    observedAt: new Date().toISOString(),
  });
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
      profileId: input.integrationProfileId,
      profileSha256: input.robotHash,
      urdfSha256: input.urdfSha256,
      controllerType: input.controllerType,
      controllerConfigSha256: input.controllerHash,
    },
    runtimePolicy: {
      policySha256: sha256(
        canonicalJson({ failClosed: true, maxStateAgeMs: 1000, version: 1 }),
      ),
      maxStateAgeMs: 1000,
      maxConfigurationAgeMs: 5000,
      failClosed: true,
    },
    executionConfiguration,
    approvedConfigurationDigest: configurationDigest(executionConfiguration),
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
    "  --robot-namespace <name>       select a robot only when several are detected",
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
  const report = discoverRos2Environment({
    fixturePath: process.env.RLSOK_SETUP_DISCOVERY_FIXTURE,
    timeoutMs: Number(option(options, "discovery-timeout-ms") ?? "30000"),
    pythonExecutable: option(options, "python"),
    sidecarPath: option(options, "sidecar"),
  });
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
  const assessment = assessOfficialRobotIntegrations(report);
  if (assessment.status === "unsupported")
    throw new Error(
      `RLSOK recognized a robot family but could not prove a supported boundary. It will not silently downgrade to generic ROS 2.\n${assessment.diagnostics.map((diagnostic) => `  - ${diagnostic}`).join("\n")}`,
    );
  const integration =
    assessment.status === "matched"
      ? await chooseOfficialIntegration(
          assessment.integrations,
          option(options, "robot-namespace"),
          nonInteractive,
        )
      : null;
  const jointSource = integration
    ? report.jointStateSources.find(
        (source) => source.name === integration.jointStateTopic,
      )!
    : await choose(
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
  const controller = integration
    ? report.trajectoryActionServers.find(
        (action) => action.name === integration.controllerAction,
      )!
    : await choose(
        "FollowJointTrajectory server (--controller-action)",
        report.trajectoryActionServers,
        option(options, "controller-action"),
        nonInteractive,
      );
  const jointNames = integration
    ? integration.jointNames
    : jointSource.sample!.jointNames;
  const observedPositions = positionsInJointOrder(jointSource.sample!, jointNames);
  const integrationState: SetupState["integration"] = integration
    ? {
        supportLevel: "official",
        profileId: integration.profileId,
        displayName: integration.displayName,
        vendor: integration.vendor,
        model: integration.model,
        namespace: integration.namespace,
        validatedEnvironment: integration.validatedEnvironment,
        physicalValidation: false,
      }
    : {
        supportLevel: "generic",
        profileId: "generic-ros2-follow-joint-trajectory-v1",
        displayName: "Generic ROS 2 protocol boundary (not an official robot integration)",
        vendor: null,
        model: null,
        namespace: "/",
        validatedEnvironment: null,
        physicalValidation: false,
      };
  process.stdout.write(
    `  [ok] Ubuntu 24.04 x86_64\n  [ok] ROS 2 Jazzy\n  [ok] Fast DDS\n  [ok] ${integration ? `Official ${integration.vendor} ${integration.model} integration at ${integration.namespace}` : integrationState.displayName}\n  [ok] ${jointNames.length}-joint execution boundary verified\n`,
  );

  process.stdout.write("\n[2/6] Binding the policy artifact and ROS boundary...\n");
  const sourceArtifact = await artifactInput(options);
  if (!existsSync(sourceArtifact) || !lstatSync(sourceArtifact).isFile())
    throw new Error(`Policy artifact is not a regular file: ${sourceArtifact}`);
  const artifactSha256 = await hashFile(sourceArtifact);
  const artifactSize = lstatSync(sourceArtifact).size;
  if (artifactSize < 1)
    throw new Error("The policy artifact is empty. Choose the actual policy file and retry.");
  const deviceName =
    option(options, "device-name") ??
    (integration
      ? `${integration.vendor} ${integration.model} ${integration.namespace}`
      : hostname());
  const proposalTopic =
    integration && integration.namespace !== "/"
      ? `${integration.namespace}/rlsok/action_proposals`
      : "/rlsok/action_proposals";
  const proposerIdentity = `policy-${artifactSha256.slice(0, 12)}`;
  const boundary = {
    version: 2,
    rosDistro: report.rosDistro,
    rmwImplementation: report.rmwImplementation,
    rosDomainId: report.rosDomainId,
    jointStateTopic: jointSource.name,
    jointNames,
    controllerAction: controller.name,
    integrationProfileId: integrationState.profileId,
    robotNamespace: integrationState.namespace,
    robotDescriptionSha256: integration?.robotDescriptionSha256 ?? null,
    controllerManagerService: integration?.controllerManagerService ?? null,
    controllerType:
      integration?.controllerType ?? "control_msgs/action/FollowJointTrajectory",
  };
  const boundaryHash = sha256(canonicalJson(boundary));
  const deviceId = `${slug(deviceName)}-${boundaryHash.slice(0, 8)}`;
  const controllerId = `trajectory-${sha256(canonicalJson({ action: controller.name, joints: jointNames, type: integration?.controllerType ?? null })).slice(0, 12)}`;
  const controllerHash = sha256(
    canonicalJson({
      action: controller.name,
      actionType: "control_msgs/action/FollowJointTrajectory",
      joints: jointNames,
      controllerType: integration?.controllerType ?? null,
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
    urdfSha256: integration?.robotDescriptionSha256 ?? boundaryHash,
    jointNames,
    releaseId,
    integrationProfileId: integrationState.profileId,
    controllerType:
      integration?.controllerType ?? "control_msgs/action/FollowJointTrajectory",
    rosDistro: report.rosDistro!,
    rmwImplementation: report.rmwImplementation!,
    jointStateTopic: jointSource.name,
    controllerName:
      integration?.controllerName ??
      controller.name.split("/").filter(Boolean).at(-2) ??
      controller.name,
    controllerAction: controller.name,
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
    proposerIdentity,
    actionRepresentation: "trajectory",
    actionPayload: {
      representation: "trajectory",
      jointNames,
      points: [
        {
          positions: observedPositions,
          velocities: observedPositions.map(() => 0),
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
    proposerIdentity,
    "--joint-state-topic",
    jointSource.name,
    "--controller-action",
    controller.name,
    "--proposal-topic",
    proposalTopic,
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
    version: 2,
    releaseId,
    deviceId,
    controllerId,
    artifactPath,
    artifactSha256,
    jointStateTopic: jointSource.name,
    controllerAction: controller.name,
    jointNames,
    proposalTopic,
    proposerIdentity,
    integration: integrationState,
    releasePath,
    proposalPath,
    evidencePath,
    cloudApiUrl: apiUrl,
    completedAt: new Date().toISOString(),
  };
  const statePath = join(configRoot(), "setup.json");
  writeProtected(statePath, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(
    `\n[6/6] Zero-to-Shadow complete.\n  ✓ Live JointState observed\n  ✓ Exact approved release evaluated\n  ✓ Controller goals attempted: 0\n  ✓ Hardware signal sent: false\n  ✓ Evidence verified by hash\n  Evidence: ${evidencePath}\n  Configuration: ${statePath}\n\nStart continuous policy observation with 'rlsok observe'. Your policy can call 'from rlsok import propose; propose(action)' without ROS topic or action names. Shadow never sends a hardware signal; moving to canary remains a separate explicit release decision with independent safety controls.\n`,
  );
  return 0;
}
