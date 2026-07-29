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
  InMemoryReleaseResolver,
  InMemoryReleaseRecordStore,
  Ros2ReferenceGateway,
  ros2ProposalEnvelopeSchema,
  type JointStateSnapshot,
  type JointTrajectoryAction,
  type Ros2DoctorReport,
  type Ros2ReferenceTransport,
} from "../../packages/ros2-reference-gateway";

const H = (character: string) => character.repeat(64);
const NOW = new Date("2026-07-26T12:00:00.000Z");

function release(
  mode: "shadow" | "canary" | "released" = "shadow",
): ExecutablePolicySpec {
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
      failClosed: true,
    },
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
    approvedBy: "release@example.test",
    approvedAt: "2026-07-25T01:00:00.000Z",
  };
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
  async dispatchTrajectory(): Promise<{ accepted: boolean; detail: string }> {
    this.dispatches += 1;
    if (this.dispatchError) throw new Error(this.dispatchError);
    return {
      accepted: this.accepted,
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
    now: () => NOW,
  });
  return { spec, resolver, store, transport, entries, gateway };
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
