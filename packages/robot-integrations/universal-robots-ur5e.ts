import { createHash } from "node:crypto";
import type {
  DiscoveredController,
  DiscoveredJointStateSource,
  DiscoveredRobotDescription,
  OfficialRobotIntegration,
  RobotIntegrationAssessment,
  RobotIntegrationProfile,
  Ros2DiscoveryReport,
} from "./types";

const profileId = "universal-robots-ur5e-ros2-driver-jazzy";
const urJointSuffixes = [
  "shoulder_pan_joint",
  "shoulder_lift_joint",
  "elbow_joint",
  "wrist_1_joint",
  "wrist_2_joint",
  "wrist_3_joint",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeNamespace(value: string): string {
  const normalized = `/${value}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "" ? "/" : normalized;
}

function inNamespace(namespace: string, relative: string): string {
  const root = normalizeNamespace(namespace);
  return root === "/" ? `/${relative}` : `${root}/${relative}`;
}

function modelFromDescription(description: DiscoveredRobotDescription):
  | "ur5e"
  | "other-ur"
  | null {
  const xml = description.xml.toLowerCase();
  if (!xml.includes("ur_description") && !xml.includes("universal_robot"))
    return null;
  if (/ur5e(?:[^a-z0-9]|$)/.test(xml)) return "ur5e";
  if (/ur(?:3e?|10e?|16e|20|30)(?:[^a-z0-9]|$)/.test(xml)) return "other-ur";
  return null;
}

function descriptionNamespace(topic: string): string {
  return normalizeNamespace(topic.replace(/\/robot_description$/, "") || "/");
}

function canonicalUrJointOrder(names: string[]): string[] | null {
  if (new Set(names).size !== names.length || names.length !== urJointSuffixes.length)
    return null;
  const prefixCandidates = names
    .filter((name) => name.endsWith(urJointSuffixes[0]))
    .map((name) => name.slice(0, -urJointSuffixes[0].length));
  for (const prefix of prefixCandidates) {
    const ordered = urJointSuffixes.map((suffix) => `${prefix}${suffix}`);
    if (ordered.every((name) => names.includes(name))) return ordered;
  }
  return null;
}

function controllerByType(
  controllers: DiscoveredController[],
  type: string,
): DiscoveredController | undefined {
  return controllers.find((controller) => controller.type === type);
}

function sourceForNamespace(
  report: Ros2DiscoveryReport,
  namespace: string,
): DiscoveredJointStateSource | undefined {
  return report.jointStateSources.find(
    (source) => source.name === inNamespace(namespace, "joint_states"),
  );
}

export class UniversalRobotsUr5eProfile implements RobotIntegrationProfile {
  readonly id = profileId;
  readonly displayName = "Universal Robots UR5e — official ROS 2 driver";

  assess(report: Ros2DiscoveryReport): RobotIntegrationAssessment {
    const managers = report.controllerManagers ?? [];
    const descriptions = report.robotDescriptions ?? [];
    const hasUrController = managers.some((manager) =>
      manager.controllers.some((controller) =>
        controller.type.startsWith("ur_controllers/"),
      ),
    );
    const urDescriptions = descriptions.filter(
      (description) => modelFromDescription(description) !== null,
    );
    if (!hasUrController && urDescriptions.length === 0) {
      return {
        status: "unknown",
        diagnostics: [
          "No official Universal Robots ROS 2 driver identity was detected.",
        ],
      };
    }

    const diagnostics: string[] = [];
    const integrations: OfficialRobotIntegration[] = [];
    for (const manager of managers) {
      const namespace = normalizeNamespace(manager.namespace);
      const description = urDescriptions.find(
        (candidate) => descriptionNamespace(candidate.topic) === namespace,
      );
      if (!description) {
        if (manager.controllers.some((controller) => controller.type.startsWith("ur_controllers/")))
          diagnostics.push(
            `${namespace}: UR controllers were found, but no same-namespace robot_description identified the robot model.`,
          );
        continue;
      }
      const model = modelFromDescription(description);
      if (model === "other-ur") {
        diagnostics.push(
          `${namespace}: the official Universal Robots driver was detected, but this RLSOK release officially integrates only UR5e.`,
        );
        continue;
      }
      if (model !== "ur5e") continue;

      const gpio = controllerByType(
        manager.controllers,
        "ur_controllers/GPIOController",
      );
      const speedScaling = controllerByType(
        manager.controllers,
        "ur_controllers/SpeedScalingStateBroadcaster",
      );
      const motion = controllerByType(
        manager.controllers,
        "ur_controllers/ScaledJointTrajectoryController",
      );
      if (!gpio || !speedScaling || !motion) {
        diagnostics.push(
          `${namespace}: UR5e description found, but the same controller manager did not expose GPIOController, SpeedScalingStateBroadcaster, and ScaledJointTrajectoryController together.`,
        );
        continue;
      }
      if (motion.state !== "active") {
        diagnostics.push(
          `${namespace}: ${motion.name} is '${motion.state}', not active. Activate the UR scaled trajectory controller and retry.`,
        );
        continue;
      }
      const controllerAction = inNamespace(
        namespace,
        `${motion.name}/follow_joint_trajectory`,
      );
      if (
        !report.trajectoryActionServers.some(
          (action) =>
            action.name === controllerAction &&
            action.types.includes("control_msgs/action/FollowJointTrajectory"),
        )
      ) {
        diagnostics.push(
          `${namespace}: active ${motion.name} did not expose its FollowJointTrajectory action.`,
        );
        continue;
      }
      const jointSource = sourceForNamespace(report, namespace);
      const jointNames = jointSource?.sample
        ? canonicalUrJointOrder(jointSource.sample.jointNames)
        : null;
      if (!jointSource?.sample || !jointNames) {
        diagnostics.push(
          `${namespace}: UR5e controllers were detected, but ${inNamespace(namespace, "joint_states")} did not provide one complete six-joint UR5e sample.`,
        );
        continue;
      }
      const claimedPositionJoints = motion.claimedInterfaces
        .filter((value) => value.endsWith("/position"))
        .map((value) => value.slice(0, -"/position".length));
      if (
        claimedPositionJoints.length > 0 &&
        (claimedPositionJoints.length !== jointNames.length ||
          !jointNames.every((joint) => claimedPositionJoints.includes(joint)))
      ) {
        diagnostics.push(
          `${namespace}: the active trajectory controller's claimed joints do not match the UR5e JointState set.`,
        );
        continue;
      }
      integrations.push({
        supportLevel: "official",
        profileId,
        profileVersion: 1,
        displayName: `${this.displayName} at ${namespace}`,
        vendor: "Universal Robots",
        model: "UR5e",
        namespace,
        jointStateTopic: jointSource.name,
        controllerAction,
        controllerName: motion.name,
        controllerType: motion.type,
        controllerManagerService: manager.serviceName,
        jointNames,
        robotDescriptionSha256: sha256(description.xml),
        diagnostics: [
          "UR5e model identified from same-namespace robot_description.",
          "UR GPIO, speed-scaling, and active scaled trajectory controllers verified in one controller manager.",
          "JointState, controller claims, and FollowJointTrajectory action verified as one six-joint boundary.",
        ],
        validatedEnvironment:
          "Ubuntu 24.04 x86_64, ROS 2 Jazzy, Fast DDS, official Universal Robots ROS 2 driver, official-driver mock-hardware simulation",
        physicalValidation: false,
      });
    }

    if (integrations.length > 0) return { status: "matched", integrations };
    return {
      status: "unsupported",
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              "Universal Robots driver signals were present, but they did not form a validated UR5e integration boundary.",
            ],
    };
  }
}
