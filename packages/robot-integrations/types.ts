export interface DiscoveredJointStateSource {
  name: string;
  types: string[];
  publishers?: Array<{ nodeName: string; nodeNamespace: string }>;
  sample: {
    jointNames: string[];
    positions: number[];
    observedAt: string;
  } | null;
}

export interface DiscoveredTrajectoryActionServer {
  name: string;
  types: string[];
  servers?: Array<{ nodeName: string; nodeNamespace: string }>;
}

export interface DiscoveredController {
  name: string;
  type: string;
  state: string;
  claimedInterfaces: string[];
}

export interface DiscoveredControllerManager {
  namespace: string;
  serviceName: string;
  controllers: DiscoveredController[];
}

export interface DiscoveredRobotDescription {
  topic: string;
  publishers?: Array<{ nodeName: string; nodeNamespace: string }>;
  xml: string;
}

export interface Ros2DiscoveryReport {
  rosAvailable: boolean;
  rosDistro: string | null;
  rmwImplementation: string | null;
  rosDomainId: string;
  jointStateSources: DiscoveredJointStateSource[];
  trajectoryActionServers: DiscoveredTrajectoryActionServer[];
  nodes: Array<string | { name: string; namespace: string }>;
  services?: Array<{ name: string; types: string[] }>;
  controllerManagers?: DiscoveredControllerManager[];
  robotDescriptions?: DiscoveredRobotDescription[];
}

export interface OfficialRobotIntegration {
  supportLevel: "official";
  profileId: string;
  profileVersion: number;
  displayName: string;
  vendor: string;
  model: string;
  namespace: string;
  jointStateTopic: string;
  controllerAction: string;
  controllerName: string;
  controllerType: string;
  controllerManagerService: string;
  jointNames: string[];
  robotDescriptionSha256: string;
  diagnostics: string[];
  validatedEnvironment: string;
  physicalValidation: false;
}

export type RobotIntegrationAssessment =
  | { status: "matched"; integrations: OfficialRobotIntegration[] }
  | { status: "unknown"; diagnostics: string[] }
  | { status: "unsupported"; diagnostics: string[] };

export interface RobotIntegrationProfile {
  readonly id: string;
  readonly displayName: string;
  assess(report: Ros2DiscoveryReport): RobotIntegrationAssessment;
}
