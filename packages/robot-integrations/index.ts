import { UniversalRobotsUr5eProfile } from "./universal-robots-ur5e";
import type {
  OfficialRobotIntegration,
  RobotIntegrationAssessment,
  RobotIntegrationProfile,
  Ros2DiscoveryReport,
} from "./types";

export * from "./types";

export const officialRobotIntegrationProfiles: readonly RobotIntegrationProfile[] = [
  new UniversalRobotsUr5eProfile(),
];

export function assessOfficialRobotIntegrations(
  report: Ros2DiscoveryReport,
): RobotIntegrationAssessment {
  const integrations: OfficialRobotIntegration[] = [];
  const unsupported: string[] = [];
  for (const profile of officialRobotIntegrationProfiles) {
    const assessment = profile.assess(report);
    if (assessment.status === "matched")
      integrations.push(...assessment.integrations);
    if (assessment.status === "unsupported")
      unsupported.push(...assessment.diagnostics);
  }
  if (integrations.length > 0) return { status: "matched", integrations };
  if (unsupported.length > 0)
    return { status: "unsupported", diagnostics: unsupported };
  return {
    status: "unknown",
    diagnostics: [
      "No officially tested robot integration profile matched this ROS graph. Generic ROS 2 protocol support remains available, but it is not official robot support.",
    ],
  };
}
