import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
import type { ReleaseRecord } from "../../packages/core/release-policy";
import {
  configurationDigest,
  executionConfigurationV1Schema,
  executionConfigurationV2Schema,
  type ExecutionConfiguration,
  type ExecutionConfigurationV1,
  type ExecutionConfigurationV2,
} from "../../packages/core/execution-configuration";
import {
  InMemoryReleaseResolver,
  InMemoryReleaseRecordStore,
  Ros2ReferenceGateway,
  ros2ProposalEnvelopeSchema,
  type JointStateSnapshot,
  type JointTrajectoryAction,
  type Ros2DoctorReport,
  type Ros2ReferenceTransport,
} from "../../packages/ros2-reference-gateway";
import { PythonRos2SidecarTransport } from "../../packages/ros2-reference-gateway/sidecar";
import { observeGenericRosExecutionConfiguration } from "../../apps/cli/ros2";

const H = (character: string) => character.repeat(64);
const NOW = new Date("2026-07-26T12:00:00.000Z");

function configuration(
  overrides: Partial<ExecutionConfigurationV1> = {},
): ExecutionConfigurationV1 {
  return executionConfigurationV1Schema.parse({
    schemaVersion: 1,
    deviceIdentity: "arm-01",
    robotIdentity: "reference-arm",
    rosDistro: "test",
    rmwImplementation: "rmw_test_cpp",
    jointState: {
      topic: "/joint_states",
      messageType: "sensor_msgs/msg/JointState",
    },
    controller: {
      name: "joint_trajectory_controller",
      followJointTrajectoryAction:
        "/joint_trajectory_controller/follow_joint_trajectory",
      actionType: "control_msgs/action/FollowJointTrajectory",
    },
    jointOrder: ["joint_a", "joint_b"],
    adapter: { identity: "ros2-reference-gateway", version: "1.3.1" },
    observedAt: NOW.toISOString(),
    ...overrides,
  });
}

function configurationV2(): ExecutionConfigurationV2 {
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: "arm-01",
      robot: "reference-arm",
    },
    semanticContract: {
      command: {
        interfaceType: "control_msgs/action/FollowJointTrajectory",
        endpoint: "/joint_trajectory_controller/follow_joint_trajectory",
      },
      controller: {
        implementation:
          "joint_trajectory_controller/JointTrajectoryController",
        version: "4.20.0",
      },
      jointCommandMapping: [
        { joint: "joint_a", commandIndex: 0 },
        { joint: "joint_b", commandIndex: 1 },
      ],
    },
    provenance: [
      {
        kind: "generated",
        sourceIdentity: "controller/generated",
        purpose: "controller_configuration",
        inputSha256: H("4"),
        generator: {
          identity: "trusted-reference-adapter",
          version: "1.0.0",
        },
      },
    ],
    observation: {
      observedAt: NOW.toISOString(),
      environment: {
        rosDistro: "test",
        rmwImplementation: "rmw_test_cpp",
      },
    },
  });
}

function release(
  mode: "shadow" | "canary" | "released" = "shadow",
): ExecutablePolicySpec {
  const boundConfiguration = configuration();
  return executablePolicySpecSchema.parse({
    apiVersion: "realitywarden.io/v1alpha1",
    kind: "ExecutablePolicy",
    metadata: {
      name: "ros2-reference-arm",
      releaseId: `ros2-${mode}-001`,
      createdAt: "2026-07-25T00:00:00.000Z",
    },
    model: {
      artifact: "artifacts/reference-policy",
      sha256: H("a"),
      framework: "ros2",
      policyType: "joint-trajectory",
      codeRevision: "phase3",
    },
    actionContract: {
      representation: "trajectory",
      dimension: 2,
      jointOrder: ["joint_a", "joint_b"],
      units: { position: "radian", velocity: "radian_per_second" },
      normalizerSha256: H("b"),
      preprocessorSha256: H("c"),
      postprocessorSha256: H("d"),
    },
    robot: {
      profileId: "reference-arm",
      profileSha256: H("e"),
      urdfSha256: H("f"),
      controllerType: "joint_trajectory_controller",
      controllerConfigSha256: H("1"),
    },
    runtimePolicy: {
      policySha256: H("2"),
      maxStateAgeMs: 500,
      maxConfigurationAgeMs: 500,
      failClosed: true,
    },
    executionConfiguration: boundConfiguration,
    approvedConfigurationDigest: configurationDigest(boundConfiguration),
    evidence: {
      scenarioPackId: "ros2-reference-v1",
      testReportSha256: H("3"),
      status: "approved",
      approvedBy: "release@example.test",
      approvedAt: "2026-07-25T01:00:00.000Z",
    },
    deployment: {
      allowedDeviceIds: ["arm-01"],
      mode,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  });
}

function record(spec: ExecutablePolicySpec): ReleaseRecord {
  const identity = executablePolicyHash(spec);
  return {
    releaseId: spec.metadata.releaseId,
    state: spec.deployment.mode,
    executablePolicyHash: identity,
    approvedIdentityHash: identity,
    approvedConfigurationDigest: spec.approvedConfigurationDigest,
    approvedBy: "release@example.test",
    approvedAt: "2026-07-25T01:00:00.000Z",
  };
}

function releaseV2(): ExecutablePolicySpec {
  const base = release("shadow");
  const boundConfiguration = configurationV2();
  return executablePolicySpecSchema.parse({
    ...base,
    metadata: {
      ...base.metadata,
      releaseId: "ros2-shadow-v2-001",
    },
    executionConfiguration: boundConfiguration,
    approvedConfigurationDigest: configurationDigest(boundConfiguration),
  });
}

function action(): JointTrajectoryAction {
  return {
    representation: "trajectory",
    jointNames: ["joint_a", "joint_b"],
    points: [
      {
        positions: [0.1, -0.1],
        velocities: [0, 0],
        timeFromStartMs: 250,
      },
    ],
    units: { position: "radian", velocity: "radian_per_second" },
  };
}

function proposal(
  spec: ExecutablePolicySpec,
  proposalId = "proposal-1",
): string {
  return JSON.stringify({
    proposalId,
    releaseId: spec.metadata.releaseId,
    deviceId: "arm-01",
    proposerIdentity: "planner@example.test",
    actionRepresentation: "trajectory",
    actionPayload: action(),
    createdAt: NOW.toISOString(),
  });
}

class SpyTransport implements Ros2ReferenceTransport {
  handler?: (payload: string) => Promise<void>;
  state?: JointStateSnapshot = {
    names: ["joint_a", "joint_b"],
    positions: [0, 0],
    observedAt: NOW.toISOString(),
  };
  dispatches = 0;
  cancellations = 0;
  accepted = true;
  dispatchError?: string;

  async subscribeProposals(
    handler: (payload: string) => Promise<void>,
  ): Promise<void> {
    this.handler = handler;
  }
  async getFreshJointState(): Promise<JointStateSnapshot> {
    if (!this.state) throw new Error("joint_state_missing");
    return this.state;
  }
  async dispatchTrajectory(): ReturnType<Ros2ReferenceTransport["dispatchTrajectory"]> {
    this.dispatches += 1;
    if (this.dispatchError) throw new Error(this.dispatchError);
    return {
      accepted: this.accepted,
      completed: this.accepted,
      succeeded: this.accepted,
      status: this.accepted ? 4 : 0,
      errorCode: this.accepted ? 0 : -1,
      detail: this.accepted ? "accepted" : "unavailable",
    };
  }
  async cancelActiveGoal(): Promise<{ requested: boolean; detail: string }> {
    this.cancellations += 1;
    return { requested: true, detail: "cancel_requested" };
  }
  async doctor(): Promise<Ros2DoctorReport> {
    return {
      rosAvailable: true,
      rosDistro: "test",
      rmwImplementation: null,
      rosDomainId: "0",
      proposalTopic: "/rlsok/action_proposals",
      jointStateTopic: "/joint_states",
      controllerAction: "/joint_trajectory_controller/follow_joint_trajectory",
      jointStateFresh: Boolean(this.state),
      actionServerAvailable: this.accepted,
      sros2Enabled: false,
      limitations: ["test_spy"],
    };
  }
  async close(): Promise<void> {}
}

function setup(mode: "shadow" | "run") {
  const spec = release(mode === "shadow" ? "shadow" : "released");
  const resolver = new InMemoryReleaseResolver();
  resolver.bind("arm-01", "planner@example.test", spec);
  const store = new InMemoryReleaseRecordStore(
    new Map([[spec.metadata.releaseId, record(spec)]]),
  );
  const transport = new SpyTransport();
  const entries: ExecutionEvidence[] = [];
  let configurationObservations = [spec.executionConfiguration!];
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: store,
    transport,
    evidence: {
      append: (entry) => {
        entries.push(entry);
      },
    },
    executionConfiguration: async () => (
      configurationObservations.length > 1
        ? configurationObservations.shift()
        : configurationObservations[0]
    ),
    now: () => NOW,
  });
  return {
    spec,
    resolver,
    store,
    transport,
    entries,
    gateway,
    observeConfigurations: (...observations: ExecutionConfiguration[]) => {
      configurationObservations = observations;
    },
  };
}

async function testContract(): Promise<void> {
  const spec = release();
  assert.equal(
    ros2ProposalEnvelopeSchema.parse(JSON.parse(proposal(spec))).actionPayload
      .points.length,
    1,
  );
  assert.throws(() => ros2ProposalEnvelopeSchema.parse({}));
  await assert.rejects(
    setup("shadow").gateway.handlePayload("{"),
    /malformed_json/,
  );
  await assert.rejects(
    setup("shadow").gateway.handlePayload("x".repeat(70_000)),
    /payload_too_large/,
  );

  const duplicate = setup("shadow");
  await duplicate.gateway.handlePayload(proposal(duplicate.spec));
  await assert.rejects(
    duplicate.gateway.handlePayload(proposal(duplicate.spec)),
    /proposal_id_duplicate/,
  );
  const unknown = setup("shadow");
  const raw = JSON.parse(proposal(unknown.spec)) as Record<string, unknown>;
  raw.proposerIdentity = "unbound@example.test";
  await assert.rejects(
    unknown.gateway.handlePayload(JSON.stringify(raw)),
    /active_release_not_found/,
  );
}

async function testShadow(): Promise<void> {
  const passing = setup("shadow");
  const result = await passing.gateway.handlePayload(proposal(passing.spec));
  assert.equal(result.decision, "allowed");
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(result.controllerGoalCount, 0);
  assert.equal(passing.transport.dispatches, 0);
  assert.equal(
    passing.entries.at(-1)?.executionEvidence,
    "shadow_not_dispatched",
  );

  const wrongJoint = setup("shadow");
  const raw = JSON.parse(proposal(wrongJoint.spec)) as any;
  raw.actionPayload.jointNames.reverse();
  assert.equal(
    (await wrongJoint.gateway.handlePayload(JSON.stringify(raw))).reason,
    "joint_order_mismatch",
  );
  assert.equal(wrongJoint.transport.dispatches, 0);

  const missing = setup("shadow");
  missing.transport.state = undefined;
  assert.equal(
    (await missing.gateway.handlePayload(proposal(missing.spec))).reason,
    "joint_state_missing",
  );
  assert.equal(missing.transport.dispatches, 0);

  const stale = setup("shadow");
  stale.transport.state = {
    names: ["joint_a", "joint_b"],
    positions: [0, 0],
    observedAt: "2026-07-26T11:00:00.000Z",
  };
  assert.equal(
    (await stale.gateway.handlePayload(proposal(stale.spec))).reason,
    "state_stale_or_invalid",
  );
}

async function testReferenceRun(): Promise<void> {
  const passing = setup("run");
  const result = await passing.gateway.handlePayload(proposal(passing.spec));
  assert.equal(result.decision, "allowed");
  assert.equal(passing.transport.dispatches, 1);
  assert.equal(result.controllerGoalCount, 1);

  const drift = setup("run");
  const approvedConfiguration = drift.spec.executionConfiguration;
  if (approvedConfiguration?.schemaVersion !== 1) {
    throw new Error("ROS 2 reference fixture must use ExecutionConfiguration v1");
  }
  drift.observeConfigurations(
    approvedConfiguration,
    configuration({
      controller: {
        ...approvedConfiguration.controller,
        followJointTrajectoryAction: "/changed/follow_joint_trajectory",
      },
    }),
  );
  const drifted = await drift.gateway.handlePayload(proposal(drift.spec));
  assert.equal(drifted.decision, "failed");
  assert.match(drifted.reason, /execution_permit_invalid/);
  assert.equal(drift.transport.dispatches, 0);
  assert.equal(drift.entries.at(-1)?.decisionReason, "configuration_mismatch");
  assert.equal(drift.entries.at(-1)?.hardwareSignalSent, false);

  const mismatch = setup("run");
  const raw = JSON.parse(proposal(mismatch.spec)) as Record<string, unknown>;
  raw.releaseId = "other-release";
  const blocked = await mismatch.gateway.handlePayload(JSON.stringify(raw));
  assert.equal(blocked.reason, "release_id_mismatch");
  assert.equal(mismatch.transport.dispatches, 0);

  const unavailable = setup("run");
  unavailable.transport.accepted = false;
  const failed = await unavailable.gateway.handlePayload(
    proposal(unavailable.spec),
  );
  assert.equal(failed.decision, "failed");
  assert.match(failed.reason, /controller_goal_rejected/);
  assert.equal(unavailable.transport.dispatches, 1);
}

async function testV2ObservationBoundary(): Promise<void> {
  const spec = releaseV2();
  const transport = new SpyTransport();
  const genericObservation = async () => observeGenericRosExecutionConfiguration(
    spec,
    transport as unknown as PythonRos2SidecarTransport,
    "arm-01",
  );

  assert.equal(
    await genericObservation(),
    undefined,
    "generic ROS discovery must not copy approved v2 provenance or semantics",
  );

  const resolver = new InMemoryReleaseResolver();
  resolver.bind("arm-01", "planner@example.test", spec);
  const store = new InMemoryReleaseRecordStore(
    new Map([[spec.metadata.releaseId, record(spec)]]),
  );
  const genericGateway = new Ros2ReferenceGateway({
    mode: "shadow",
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: store,
    transport,
    evidence: { append: () => {} },
    executionConfiguration: genericObservation,
    now: () => NOW,
  });
  const genericResult = await genericGateway.handlePayload(proposal(spec));
  assert.equal(genericResult.decision, "blocked");
  assert.equal(genericResult.reason, "configuration_missing");
  assert.equal(genericResult.hardwareSignalSent, false);
  assert.equal(transport.dispatches, 0);

  const trustedTransport = new SpyTransport();
  const trustedGateway = new Ros2ReferenceGateway({
    mode: "shadow",
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: store,
    transport: trustedTransport,
    evidence: { append: () => {} },
    executionConfiguration: async () => spec.executionConfiguration,
    now: () => NOW,
  });
  const trustedResult = await trustedGateway.handlePayload(
    proposal(spec, "trusted-v2-proposal"),
  );
  assert.equal(trustedResult.decision, "allowed");
  assert.match(trustedResult.reason, /^shadow_observation_only:/);
  assert.equal(trustedResult.hardwareSignalSent, false);
  assert.equal(trustedTransport.dispatches, 0);
}

async function testRevocation(): Promise<void> {
  const active = setup("run");
  await active.gateway.handlePayload(proposal(active.spec));
  await active.gateway.revoke(active.spec.metadata.releaseId, "operator_stop");
  assert.equal(active.transport.cancellations, 1);
  assert.match(
    active.entries.at(-1)?.decisionReason ?? "",
    /release_revoked:cancel_requested/,
  );
  assert.equal(
    active.entries.at(-1)?.hardwareSignalState,
    "attempted_unconfirmed",
  );
  assert.equal(
    active.entries.at(-1)?.executionEvidence,
    "cancellation_requested",
  );
  const next = JSON.parse(proposal(active.spec, "proposal-2")) as Record<
    string,
    unknown
  >;
  const blocked = await active.gateway.handlePayload(JSON.stringify(next));
  assert.equal(blocked.decision, "blocked");
  assert.equal(active.transport.dispatches, 1);
}

async function testEvidence(): Promise<void> {
  const rejected = setup("run");
  rejected.transport.accepted = false;
  await rejected.gateway.handlePayload(proposal(rejected.spec));
  assert.equal(rejected.entries.at(-1)?.decision, "failed");
  assert.equal(
    rejected.entries.at(-1)?.hardwareSignalState,
    "attempted_unconfirmed",
  );
  assert.equal(rejected.entries.at(-1)?.executionEvidence, "dispatch_failed");

  const timeout = setup("run");
  timeout.transport.dispatchError = "ros_action_request_timeout";
  await timeout.gateway.handlePayload(proposal(timeout.spec));
  assert.equal(
    timeout.entries.at(-1)?.decisionReason,
    "ros_action_request_timeout",
  );
  assert.equal(
    timeout.entries.at(-1)?.hardwareSignalState,
    "attempted_unconfirmed",
  );
  assert.equal(timeout.entries.at(-1)?.executionEvidence, "dispatch_failed");

  let chain: ChainedEvidence[] = [];
  for (const entry of rejected.entries)
    chain = [...chain, appendEvidence(chain, entry)];
  const bundle: EvidenceBundle = {
    apiVersion: "realitywarden.io/v1alpha1",
    kind: "EvidenceBundle",
    releaseId: rejected.spec.metadata.releaseId,
    executablePolicyHash: executablePolicyHash(rejected.spec),
    createdAt: NOW.toISOString(),
    entries: chain,
  };
  assert.deepEqual(verifyEvidenceBundle(bundle), { ok: true });
}

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory()
      ? sourceFiles(child)
      : /\.(?:ts|js|py)$/.test(name)
        ? [child]
        : [];
  });
}

async function testNoBypass(): Promise<void> {
  const root = process.cwd();
  const sidecar = readFileSync(
    join(root, "experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py"),
    "utf8",
  );
  for (const forbidden of [
    "ReleaseExecutionGate",
    "ExecutionPermit",
    "executablePolicyHash",
  ]) {
    assert(
      !sidecar.includes(forbidden),
      `Python sidecar must not own Core primitive ${forbidden}`,
    );
  }
  assert(
    sidecar.includes("FollowJointTrajectory"),
    "sidecar must use the control_msgs action",
  );
  assert(
    sidecar.includes("datetime.now(timezone.utc)"),
    "JointState freshness must use receipt wall clock, not the ROS simulation epoch",
  );
  assert(
    sidecar.includes("sourceTimestamp"),
    "the source header timestamp must remain available for diagnostics",
  );
  const referenceNode = sidecar.slice(
    sidecar.indexOf("class ReferenceTransportNode"),
    sidecar.indexOf("class DiscoveryNode"),
  );
  const discoveryNode = sidecar.slice(
    sidecar.indexOf("class DiscoveryNode"),
    sidecar.indexOf("def unavailable_report"),
  );
  assert.match(
    referenceNode,
    /def inspect_graph\(/,
    "live graph inspection must remain on ReferenceTransportNode",
  );
  assert.doesNotMatch(
    discoveryNode,
    /self\.action_client|self\.latest_state/,
    "read-only discovery must not depend on transport-only state",
  );
  assert.match(
    discoveryNode,
    /def joint_sources_matched\(/,
    "read-only discovery must expose DDS publisher matching readiness",
  );
  assert.match(
    discoveryNode,
    /def start_ready_controller_requests\([\s\S]+client\.service_is_ready\(\)[\s\S]+client\.call_async\(/,
    "controller-manager discovery must wait for DDS service matching before its one read-only request",
  );
  assert.doesNotMatch(
    discoveryNode,
    /wait_for_service\(timeout_sec=0\.0\)/,
    "controller-manager discovery must not permanently skip a newly created unmatched service client",
  );
  assert.match(
    sidecar,
    /matching_deadline[\s\S]+start_ready_controller_requests\(\)[\s\S]+joint_sources_matched\(\)[\s\S]+controller_services_matched\(\)[\s\S]+sample_deadline/,
    "sampling must receive a full bounded window after JointState and controller-service DDS matching",
  );
  assert.throws(
    () => new PythonRos2SidecarTransport({
      pythonExecutable: "python3",
      sidecarPath: "unused",
      discoveryTimeoutMs: 999,
    }),
    /ros2_discovery_timeout_out_of_range/,
  );
  const cachedTransport = new PythonRos2SidecarTransport({
    pythonExecutable: "python3",
    sidecarPath: "unused",
    discoveryTimeoutMs: 1_000,
  });
  const mutableTransport = cachedTransport as unknown as {
    state?: JointStateSnapshot;
  };
  mutableTransport.state = {
    names: ["joint_a"],
    positions: [0],
    observedAt: new Date(Date.now() - 2_000).toISOString(),
  };
  setTimeout(() => {
    mutableTransport.state = {
      names: ["joint_a"],
      positions: [0],
      observedAt: new Date().toISOString(),
    };
  }, 50);
  assert.equal(
    (await cachedTransport.getFreshJointState(1_000)).names[0],
    "joint_a",
    "an active publisher may replace a stale cached sample within the bounded wait",
  );
  mutableTransport.state = {
    names: ["joint_a"],
    positions: [0],
    observedAt: new Date(Date.now() + 1_000).toISOString(),
  };
  await assert.rejects(
    cachedTransport.getFreshJointState(1_000),
    /joint_state_stale/,
    "future timestamps still fail closed",
  );
  assert(
    !sidecar.includes("trajectory_msgs.action"),
    "trajectory_msgs does not define an action",
  );
  const cli = readFileSync(join(root, "apps/cli/ros2.ts"), "utf8");
  assert.match(
    cli,
    /options\[["']allow-reference-run["']\] !== spec\.metadata\.releaseId/,
  );
  assert(cli.includes("ROS_SECURITY_STRATEGY=Enforce"));
  assert(
    cli.indexOf("const report = await transport.doctor()") <
      cli.indexOf("await gateway.start("),
    "Run preflight must complete before proposal subscription",
  );

  const python = process.platform === "win32" ? "python" : "python3";
  const unavailable = spawnSync(
    python,
    [
      "-S",
      join(root, "experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py"),
      "--doctor",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: "" },
    },
  );
  assert.equal(unavailable.status, 2, unavailable.stderr);
  const unavailableReport = JSON.parse(unavailable.stdout) as {
    rosAvailable: boolean;
    detail: string;
  };
  assert.equal(unavailableReport.rosAvailable, false);
  assert.match(unavailableReport.detail, /rclpy/);

  const inspect = spawnSync(
    process.execPath,
    [
      join(root, "scripts/run-rlsok.cjs"),
      "ros2",
      "inspect",
      join(root, "examples/ros2-reference/release.shadow.yaml"),
    ],
    { encoding: "utf8" },
  );
  assert(
    inspect.status === 0 || inspect.status === 2,
    `inspect with a release must reach the sidecar instead of rejecting the positional input: ${inspect.stderr}`,
  );
  const inspectReport = JSON.parse(inspect.stdout) as {
    rosAvailable?: boolean;
    nodes?: string[];
  };
  assert(
    typeof inspectReport.rosAvailable === "boolean" ||
      Array.isArray(inspectReport.nodes),
    "inspect must return either an unavailable report or a live ROS graph",
  );

  const gatewaySources = sourceFiles(
    join(root, "packages/ros2-reference-gateway"),
  ).filter((file) =>
    file.endsWith(`${join("ros2-reference-gateway", "index.ts")}`),
  );
  const directController = /ActionClient|send_goal_async|rclpy/;
  for (const file of gatewaySources) {
    assert(
      !directController.test(readFileSync(file, "utf8")),
      `${file} bypasses the sidecar boundary`,
    );
  }
}

const suites: Record<string, () => Promise<void>> = {
  "ros2-contract": testContract,
  "ros2-shadow": testShadow,
  "ros2-reference": testReferenceRun,
  "ros2-v2-observation-boundary": testV2ObservationBoundary,
  "ros2-revocation": testRevocation,
  "ros2-evidence": testEvidence,
  "ros2-no-bypass": testNoBypass,
};

async function main(): Promise<void> {
  const requested = process.argv[2];
  const selected = requested
    ? [[requested, suites[requested]] as const]
    : Object.entries(suites);
  if (selected.some(([, run]) => !run))
    throw new Error(`unknown suite: ${requested}`);
  for (const [name, run] of selected) {
    await run();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(
    `ROS 2 reference tests passed (${selected.length} categories).\n`,
  );
}

void main();
