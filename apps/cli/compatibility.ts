import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import {
  configurationDigest,
  executionConfigurationV1Schema,
  type ExecutionConfigurationV1,
} from "../../packages/core/execution-configuration";
import {
  assessOfficialRobotIntegrations,
  type OfficialRobotIntegration,
  type Ros2DiscoveryReport,
} from "../../packages/robot-integrations";
import { discoverRos2Environment } from "./ros-discovery";

export type CompatibilityStatus =
  | "officially_supported"
  | "compatible_unverified"
  | "insufficient_information"
  | "incompatible";

export interface CompatibilityInspection {
  schemaVersion: 1;
  inspectedAt: string;
  rosDistro: string | null;
  rmwImplementation: string | null;
  rosDomainId: string;
  ddsGraphReachable: boolean;
  detectedDeviceIdentity: string | null;
  detectedRobotIdentity: string | null;
  jointState: {
    topic: string | null;
    jointNames: string[];
    observedAt: string | null;
    ageMs: number | null;
    fresh: boolean;
  };
  controller: {
    name: string | null;
    followJointTrajectoryAction: string | null;
    jointOrder: string[];
  };
  ros2ControlPresent: boolean;
  shadowRunnable: boolean;
  referenceRunRunnable: boolean;
  compatibilityStatus: CompatibilityStatus;
  diagnostics: string[];
  executionConfigurationCandidate: ExecutionConfigurationV1 | null;
  configurationDigestCandidate: string | null;
  candidateApprovalRequired: true;
}

type Options = Record<string, string | true>;

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name?.startsWith("--")) {
      throw new Error(`Unexpected argument ${name ?? ""}. Run rlsok compatibility inspect --help.`);
    }
    const key = name.slice(2);
    if (["json", "help"].includes(key)) {
      options[key] = true;
      continue;
    }
    if (!["write", "python", "sidecar", "discovery-timeout-ms"].includes(key)) {
      throw new Error(`Unknown option --${key}. Run rlsok compatibility inspect --help.`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${key} requires a value.`);
    }
    options[key] = value;
  }
  return options;
}

function option(options: Options, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function externalGraphReachable(report: Ros2DiscoveryReport): boolean {
  if (!report.rosAvailable) return false;
  const externalNodes = report.nodes.filter((node) => {
    const name = typeof node === "string" ? node : node.name;
    return name !== "rlsok_environment_discovery";
  });
  return Boolean(
    externalNodes.length ||
      report.jointStateSources.length ||
      report.trajectoryActionServers.length ||
      report.controllerManagers?.length ||
      report.robotDescriptions?.length,
  );
}

function controllerName(actionName: string): string {
  const parent = actionName.replace(/\/follow_joint_trajectory$/, "");
  return parent.split("/").filter(Boolean).at(-1) ?? parent;
}

function chooseOfficial(
  report: Ros2DiscoveryReport,
): { integration: OfficialRobotIntegration | null; diagnostics: string[]; unsupported: boolean } {
  const assessment = assessOfficialRobotIntegrations(report);
  if (assessment.status === "matched") {
    if (assessment.integrations.length === 1) {
      return { integration: assessment.integrations[0]!, diagnostics: [], unsupported: false };
    }
    return {
      integration: null,
      diagnostics: [
        `Multiple official integration boundaries were detected (${assessment.integrations.map((value) => value.namespace).join(", ")}); select one during setup.`,
      ],
      unsupported: false,
    };
  }
  return {
    integration: null,
    diagnostics: assessment.diagnostics,
    unsupported: assessment.status === "unsupported",
  };
}

export function inspectCompatibility(
  report: Ros2DiscoveryReport,
  now: Date = new Date(),
): CompatibilityInspection {
  const diagnostics: string[] = [];
  const graphReachable = externalGraphReachable(report);
  const official = chooseOfficial(report);
  diagnostics.push(...official.diagnostics);

  const validJointSources = report.jointStateSources.filter((source) => (
    source.types.includes("sensor_msgs/msg/JointState") &&
    source.sample !== null &&
    source.sample.jointNames.length > 0 &&
    source.sample.jointNames.length === source.sample.positions.length &&
    new Set(source.sample.jointNames).size === source.sample.jointNames.length
  ));
  const trajectoryActions = report.trajectoryActionServers.filter((action) => (
    action.types.includes("control_msgs/action/FollowJointTrajectory")
  ));

  const jointSource = official.integration
    ? validJointSources.find((source) => source.name === official.integration!.jointStateTopic) ?? null
    : validJointSources.length === 1
      ? validJointSources[0]!
      : null;
  const trajectoryAction = official.integration
    ? trajectoryActions.find((action) => action.name === official.integration!.controllerAction) ?? null
    : trajectoryActions.length === 1
      ? trajectoryActions[0]!
      : null;
  const jointOrder = official.integration?.jointNames ?? jointSource?.sample?.jointNames ?? [];
  const observedAt = jointSource?.sample?.observedAt ?? null;
  const ageMs = observedAt ? now.getTime() - Date.parse(observedAt) : null;
  const jointStateFresh = ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 5_000;
  const ros2ControlPresent = Boolean(
    report.controllerManagers?.length ||
      report.services?.some((service) => (
        service.types.includes("controller_manager_msgs/srv/ListControllers")
      )),
  );

  if (!report.rosAvailable) diagnostics.push("ROS 2 is not available in this environment.");
  else if (!graphReachable) diagnostics.push("ROS 2 is available, but no external DDS graph was detected.");
  if (!report.rosDistro) diagnostics.push("ROS distribution could not be determined.");
  if (!report.rmwImplementation) diagnostics.push("RMW implementation could not be determined.");
  if (validJointSources.length === 0) diagnostics.push("No complete JointState source was detected.");
  else if (!official.integration && validJointSources.length > 1) diagnostics.push("Multiple JointState sources were detected; no unambiguous candidate can be emitted.");
  if (jointSource && !jointStateFresh) diagnostics.push("The selected JointState sample is stale or has an invalid timestamp.");
  if (trajectoryActions.length === 0) diagnostics.push("No FollowJointTrajectory action server was detected.");
  else if (!official.integration && trajectoryActions.length > 1) diagnostics.push("Multiple FollowJointTrajectory actions were detected; no unambiguous candidate can be emitted.");
  if (!ros2ControlPresent) diagnostics.push("ros2_control was not detected; a custom bridge may still provide the protocol boundary.");

  const graphBoundaryComplete = Boolean(
    report.rosAvailable &&
      graphReachable &&
      report.rosDistro &&
      report.rmwImplementation &&
      jointSource?.sample &&
      jointStateFresh &&
      trajectoryAction &&
      jointOrder.length > 0,
  );

  let candidate: ExecutionConfigurationV1 | null = null;
  let detectedDeviceIdentity: string | null = null;
  let detectedRobotIdentity: string | null = null;
  if (graphBoundaryComplete && jointSource?.sample && trajectoryAction) {
    const description = official.integration
      ? report.robotDescriptions?.find((value) => (
          sha256(value.xml) === official.integration!.robotDescriptionSha256
        ))
      : report.robotDescriptions?.length === 1
        ? report.robotDescriptions[0]
        : undefined;
    detectedRobotIdentity = official.integration?.robotDescriptionSha256 ?? (
      description
        ? sha256(description.xml)
        : `protocol:${sha256(canonicalJson({ jointStateTopic: jointSource.name, jointOrder }))}`
    );
    detectedDeviceIdentity = `graph:${sha256(canonicalJson({
      rosDomainId: report.rosDomainId,
      integrationProfileId: official.integration?.profileId ?? null,
      integrationNamespace: official.integration?.namespace ?? null,
      jointStateTopic: jointSource.name,
      jointPublishers: jointSource.publishers ?? [],
      trajectoryAction: trajectoryAction.name,
      actionServers: trajectoryAction.servers ?? [],
    }))}`;
    candidate = executionConfigurationV1Schema.parse({
      schemaVersion: 1,
      deviceIdentity: detectedDeviceIdentity,
      robotIdentity: detectedRobotIdentity,
      rosDistro: report.rosDistro,
      rmwImplementation: report.rmwImplementation,
      jointState: {
        topic: jointSource.name,
        messageType: "sensor_msgs/msg/JointState",
      },
      controller: {
        name: official.integration?.controllerName ?? controllerName(trajectoryAction.name),
        followJointTrajectoryAction: trajectoryAction.name,
        actionType: "control_msgs/action/FollowJointTrajectory",
      },
      jointOrder,
      adapter: { identity: "rlsok-ros2-sidecar", version: "1.3.1" },
      observedAt: now.toISOString(),
    });
  }

  let compatibilityStatus: CompatibilityStatus;
  if (!report.rosAvailable || official.unsupported) compatibilityStatus = "incompatible";
  else if (!candidate) compatibilityStatus = "insufficient_information";
  else if (
    official.integration &&
    report.rosDistro === "jazzy" &&
    report.rmwImplementation === "rmw_fastrtps_cpp"
  ) compatibilityStatus = "officially_supported";
  else compatibilityStatus = "compatible_unverified";

  if (candidate) {
    diagnostics.push(
      "executionConfigurationCandidate is observational only and requires explicit release approval before Reference Run.",
    );
  }

  return {
    schemaVersion: 1,
    inspectedAt: now.toISOString(),
    rosDistro: report.rosDistro,
    rmwImplementation: report.rmwImplementation,
    rosDomainId: report.rosDomainId,
    ddsGraphReachable: graphReachable,
    detectedDeviceIdentity,
    detectedRobotIdentity,
    jointState: {
      topic: jointSource?.name ?? null,
      jointNames: jointOrder,
      observedAt,
      ageMs,
      fresh: jointStateFresh,
    },
    controller: {
      name: trajectoryAction
        ? official.integration?.controllerName ?? controllerName(trajectoryAction.name)
        : null,
      followJointTrajectoryAction: trajectoryAction?.name ?? null,
      jointOrder,
    },
    ros2ControlPresent,
    shadowRunnable: graphBoundaryComplete,
    referenceRunRunnable: graphBoundaryComplete,
    compatibilityStatus,
    diagnostics,
    executionConfigurationCandidate: candidate,
    configurationDigestCandidate: candidate ? configurationDigest(candidate) : null,
    candidateApprovalRequired: true,
  };
}

export function compatibilityUsage(): string {
  return [
    "usage: rlsok compatibility inspect [--json] [--write <file>] [options]",
    "",
    "Read-only ROS 2 compatibility inspection. It never publishes, sends an action goal,",
    "changes a controller, creates an approval, or requests a permit.",
    "",
    "  --json                        print the complete machine-readable report",
    "  --write <file>                write the complete JSON report to a file",
    "  --discovery-timeout-ms <ms>   discovery timeout (1000-120000)",
    "  --python <path>               Python executable for the existing discovery sidecar",
    "  --sidecar <path>              existing RLSOK ROS 2 discovery sidecar",
  ].join("\n");
}

function humanReport(result: CompatibilityInspection): string {
  const value = (input: string | null): string => input ?? "unknown";
  return [
    "RLSOK Compatibility Inspection",
    `Compatibility status: ${result.compatibilityStatus}`,
    `ROS distro: ${value(result.rosDistro)}`,
    `RMW: ${value(result.rmwImplementation)}`,
    `DDS graph reachable: ${result.ddsGraphReachable ? "yes" : "no"}`,
    `Device identity: ${value(result.detectedDeviceIdentity)}`,
    `Robot identity: ${value(result.detectedRobotIdentity)}`,
    `JointState: ${value(result.jointState.topic)} (${result.jointState.jointNames.join(", ") || "no joints"}; ${result.jointState.fresh ? "fresh" : "not fresh"})`,
    `Controller: ${value(result.controller.name)}`,
    `FollowJointTrajectory: ${value(result.controller.followJointTrajectoryAction)}`,
    `Joint order: ${result.controller.jointOrder.join(", ") || "unknown"}`,
    `ros2_control: ${result.ros2ControlPresent ? "present" : "not detected"}`,
    `RLSOK Shadow runnable: ${result.shadowRunnable ? "yes" : "no"}`,
    `Reference Run environment ready: ${result.referenceRunRunnable ? "yes" : "no"}`,
    `Execution configuration candidate: ${result.executionConfigurationCandidate ? "emitted (approval required)" : "not emitted"}`,
    ...result.diagnostics.map((diagnostic) => `- ${diagnostic}`),
  ].join("\n");
}

export async function runCompatibilityCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(`${compatibilityUsage()}\n`);
    return 0;
  }
  if (subcommand !== "inspect") {
    throw new Error("Expected 'rlsok compatibility inspect'.");
  }
  const options = parseOptions(rest);
  if (options.help) {
    process.stdout.write(`${compatibilityUsage()}\n`);
    return 0;
  }
  const report = discoverRos2Environment({
    timeoutMs: Number(option(options, "discovery-timeout-ms") ?? "15000"),
    pythonExecutable: option(options, "python"),
    sidecarPath: option(options, "sidecar"),
  });
  const inspection = inspectCompatibility(report);
  const json = `${JSON.stringify(inspection, null, 2)}\n`;
  const outputPath = option(options, "write");
  if (outputPath) writeFileSync(resolve(outputPath), json, "utf8");
  process.stdout.write(options.json ? json : `${humanReport(inspection)}\n`);
  return 0;
}
