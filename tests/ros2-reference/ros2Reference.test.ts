import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
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
import type { EvidenceSink } from "../../packages/core/execution-gate";
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
  ros2DoctorReportSchema,
  ros2ProposalEnvelopeSchema,
  type JointStateSnapshot,
  type JointTrajectoryAction,
  type Ros2DoctorReport,
  type Ros2ReferenceTransport,
  type Ros2ProposalReplayRegistry,
} from "../../packages/ros2-reference-gateway";
import {
  FileProposalReplayRegistry,
  InMemoryProposalReplayRegistry,
} from "../../packages/cloud-client/replay-registry";
import { PythonRos2SidecarTransport } from "../../packages/ros2-reference-gateway/sidecar";
import {
  FileEvidenceSink,
  PrivateResultFile,
  defaultRos2EvidencePath,
  observeGenericRosExecutionConfiguration,
  runRos2Command,
} from "../../apps/cli/ros2";

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

function setup(
  mode: "shadow" | "run",
  proposalReplayRegistry?: Ros2ProposalReplayRegistry | null,
  evidenceFactory?: (spec: ExecutablePolicySpec) => EvidenceSink,
) {
  const spec = release(mode === "shadow" ? "shadow" : "released");
  const resolver = new InMemoryReleaseResolver();
  resolver.bind("arm-01", "planner@example.test", spec);
  const store = new InMemoryReleaseRecordStore(
    new Map([[spec.metadata.releaseId, record(spec)]]),
  );
  const transport = new SpyTransport();
  const entries: ExecutionEvidence[] = [];
  const evidence = evidenceFactory?.(spec) ?? {
    append: (entry: ExecutionEvidence) => {
      entries.push(entry);
    },
  };
  let configurationObservations = [spec.executionConfiguration!];
  const gateway = new Ros2ReferenceGateway({
    mode,
    controllerIdentity: spec.robot.controllerConfigSha256,
    releaseResolver: resolver,
    releaseRecords: store,
    transport,
    evidence,
    proposalReplayRegistry: proposalReplayRegistry === null
      ? undefined
      : proposalReplayRegistry ?? (mode === "run"
        ? new InMemoryProposalReplayRegistry()
        : undefined),
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

async function testReplayPersistence(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "rlsok-standalone-replay-"));
  try {
    const replayPath = join(root, "replay", "nested");
    const first = setup(
      "run",
      new FileProposalReplayRegistry(replayPath),
    );
    const firstResult = await first.gateway.handlePayload(proposal(first.spec));
    assert.equal(firstResult.decision, "allowed", JSON.stringify(firstResult));
    assert.equal(first.transport.dispatches, 1);

    const restarted = setup(
      "run",
      new FileProposalReplayRegistry(replayPath),
    );
    const duplicate = await restarted.gateway.handlePayload(
      proposal(restarted.spec),
    );
    assert.equal(duplicate.decision, "blocked");
    assert.equal(duplicate.reason, "proposal_id_duplicate");
    assert.equal(restarted.transport.dispatches, 0);
    assert.equal(
      restarted.entries.at(-1)?.decisionReason,
      "proposal_id_duplicate",
    );

    const invalidRegistry = setup("run", {
      claim: () => "unexpected" as never,
    });
    const unavailable = await invalidRegistry.gateway.handlePayload(
      proposal(invalidRegistry.spec),
    );
    assert.equal(unavailable.decision, "blocked");
    assert.equal(unavailable.reason, "proposal_replay_registry_unavailable");
    assert.equal(invalidRegistry.transport.dispatches, 0);

    const observed = setup("shadow");
    await observed.gateway.handlePayload(proposal(observed.spec));
    const entry = observed.entries[0];
    assert.ok(entry);
    const firstEvidencePath = join(root, "evidence", "run-one.json");
    const firstSink = new FileEvidenceSink(observed.spec, firstEvidencePath);
    firstSink.append(entry);
    const originalBytes = readFileSync(firstEvidencePath);
    assert.throws(
      () => new FileEvidenceSink(observed.spec, firstEvidencePath),
      /evidence_output_already_exists/,
    );
    assert.deepEqual(readFileSync(firstEvidencePath), originalBytes);

    const secondEvidencePath = join(root, "evidence", "run-two.json");
    const secondSink = new FileEvidenceSink(observed.spec, secondEvidencePath);
    secondSink.append({ ...entry, proposalId: "second-run-proposal" });
    for (const path of [firstEvidencePath, secondEvidencePath]) {
      const bundle = JSON.parse(readFileSync(path, "utf8")) as EvidenceBundle;
      assert.deepEqual(verifyEvidenceBundle(bundle), { ok: true });
    }

    const delayedEvidencePath = join(root, "evidence", "delayed.json");
    const delayedSink = new FileEvidenceSink(observed.spec, delayedEvidencePath);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const delayedDecisionAt = new Date().toISOString();
    delayedSink.append({
      ...entry,
      proposalId: "delayed-proposal",
      decisionMadeAt: delayedDecisionAt,
    });
    const delayedBundle = JSON.parse(
      readFileSync(delayedEvidencePath, "utf8"),
    ) as EvidenceBundle;
    assert.ok(Date.parse(delayedBundle.createdAt) >= Date.parse(delayedDecisionAt));
    assert.deepEqual(
      verifyEvidenceBundle(delayedBundle),
      { ok: true },
    );

    const futureEvidencePath = join(root, "evidence", "future.json");
    const futureSink = new FileEvidenceSink(observed.spec, futureEvidencePath);
    assert.throws(
      () => futureSink.append({
        ...entry,
        proposalId: "future-proposal",
        decisionMadeAt: new Date(Date.now() + 1_000).toISOString(),
      }),
      /evidence_bundle_invalid:evidence_time_inconsistent/,
    );
    assert.equal(readFileSync(futureEvidencePath).length, 0);

    const resultPath = join(root, "evidence", "cloud-result.json");
    const resultOwner = new PrivateResultFile(resultPath);
    resultOwner.write("first-run\n");
    assert.throws(
      () => new PrivateResultFile(resultPath),
      /evidence_output_already_exists/,
    );
    assert.equal(readFileSync(resultPath, "utf8"), "first-run\n");

    const unsafeIdSpec = executablePolicySpecSchema.parse({
      ...observed.spec,
      metadata: {
        ...observed.spec.metadata,
        releaseId: "/../../package",
      },
    });
    const evidenceRoot = resolve("evidence");
    for (const scope of ["standalone", "cloud"] as const) {
      const path = defaultRos2EvidencePath(
        scope,
        "shadow",
        unsafeIdSpec,
        "00000000-0000-4000-8000-000000000001",
      );
      const withinRoot = relative(evidenceRoot, path);
      assert.equal(isAbsolute(withinRoot), false);
      assert.doesNotMatch(withinRoot, /^\.\.(?:[\\/]|$)/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testContract(): Promise<void> {
  const spec = release();
  assert.equal(
    ros2ProposalEnvelopeSchema.parse(JSON.parse(proposal(spec))).actionPayload
      .points.length,
    1,
  );
  assert.throws(() => ros2ProposalEnvelopeSchema.parse({}));
  assert.throws(
    () => setup("run", null),
    /proposal_replay_registry_required/,
  );
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
  const duplicateResult = await duplicate.gateway.handlePayload(
    proposal(duplicate.spec),
  );
  assert.equal(duplicateResult.decision, "blocked");
  assert.equal(duplicateResult.reason, "proposal_id_duplicate");
  const unknown = setup("shadow");
  const raw = JSON.parse(proposal(unknown.spec)) as Record<string, unknown>;
  raw.proposerIdentity = "unbound@example.test";
  await assert.rejects(
    unknown.gateway.handlePayload(JSON.stringify(raw)),
    /active_release_not_found/,
  );

  const serialized = setup("run");
  let releaseState: (() => void) | undefined;
  const stateHeld = new Promise<void>((resolveState) => {
    releaseState = resolveState;
  });
  const stateRequested = new Promise<void>((resolveRequested) => {
    serialized.transport.getFreshJointState = async () => {
      resolveRequested();
      await stateHeld;
      return serialized.transport.state!;
    };
  });
  const results: string[] = [];
  await serialized.gateway.start((result) => results.push(result.reason));
  const first = serialized.transport.handler!(
    proposal(serialized.spec, "serialized-first"),
  );
  await stateRequested;
  await assert.rejects(
    serialized.transport.handler!(
      proposal(serialized.spec, "serialized-concurrent"),
    ),
    /proposal_backpressure/,
  );
  releaseState?.();
  await first;
  assert.deepEqual(results, ["reference_goal_dispatched"]);
  assert.equal(serialized.transport.dispatches, 1);
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
  const capacityRoot = mkdtempSync(join(tmpdir(), "rlsok-evidence-capacity-"));
  try {
    const atCapacity = setup(
      "run",
      undefined,
      (spec) => new FileEvidenceSink(
        spec,
        join(capacityRoot, "full.json"),
        { maxEntries: 0 },
      ),
    );
    const capacityResult = await atCapacity.gateway.handlePayload(
      proposal(atCapacity.spec, "capacity-block"),
    );
    assert.equal(capacityResult.decision, "failed");
    assert.equal(capacityResult.reason, "evidence_entry_capacity_exceeded");
    assert.equal(capacityResult.hardwareSignalSent, false);
    assert.equal(atCapacity.transport.dispatches, 0);
  } finally {
    rmSync(capacityRoot, { recursive: true, force: true });
  }

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
  assert.equal(failed.hardwareSignalSent, true);
  assert.equal(failed.controllerGoalCount, 1);

  const acceptedOnly = setup("run");
  acceptedOnly.transport.dispatchTrajectory = async () => {
    acceptedOnly.transport.dispatches += 1;
    return { accepted: true, detail: "accepted_without_terminal_result" };
  };
  const unconfirmed = await acceptedOnly.gateway.handlePayload(
    proposal(acceptedOnly.spec, "accepted-only"),
  );
  assert.equal(unconfirmed.decision, "failed");
  assert.match(unconfirmed.reason, /controller_result_unconfirmed/);
  assert.equal(unconfirmed.hardwareSignalSent, true);
  assert.equal(acceptedOnly.transport.dispatches, 1);

  const malformedResult = setup("run");
  malformedResult.transport.dispatchTrajectory = async () => {
    malformedResult.transport.dispatches += 1;
    return {
      accepted: true,
      completed: true,
      succeeded: true,
      status: Number.MAX_SAFE_INTEGER + 1,
      detail: "x".repeat(501),
    };
  };
  const malformedFailure = await malformedResult.gateway.handlePayload(
    proposal(malformedResult.spec, "malformed-controller-result"),
  );
  assert.equal(malformedFailure.decision, "failed");
  assert.equal(malformedFailure.reason, "controller_result_invalid");
  assert.equal(malformedFailure.hardwareSignalSent, true);
  assert.equal(malformedResult.entries.at(-1)?.decisionReason, "controller_result_invalid");
  assert.equal(malformedResult.transport.dispatches, 1);
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
  assert.equal(active.entries.at(-1)?.hardwareSignalState, "attempted_unconfirmed");
  const entriesBeforeRevocation = active.entries.length;
  await active.gateway.revoke(active.spec.metadata.releaseId, "operator_stop");
  assert.equal(active.entries.length, entriesBeforeRevocation);
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "packages/ros2-reference-gateway/index.ts"), "utf8"),
    /cancelActiveGoal/,
  );
  assert.doesNotMatch(
    readFileSync(
      join(process.cwd(), "experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py"),
      "utf8",
    ),
    /operation == ["']cancel["']/,
  );
  const next = JSON.parse(proposal(active.spec, "proposal-2")) as Record<
    string,
    unknown
  >;
  const blocked = await active.gateway.handlePayload(JSON.stringify(next));
  assert.equal(blocked.decision, "blocked");
  assert.equal(active.transport.dispatches, 1);
  assert.equal(active.entries.at(-1)?.decisionReason, "release_revoked");
  assert.equal(active.entries.at(-1)?.hardwareSignalSent, false);
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
  const timeoutResult = await timeout.gateway.handlePayload(proposal(timeout.spec));
  assert.equal(timeoutResult.hardwareSignalSent, true);
  assert.equal(timeoutResult.controllerGoalCount, 1);
  assert.equal(
    timeoutResult.reason,
    "controller_dispatch_unknown:ros_action_request_timeout",
  );
  assert.equal(
    timeout.entries.at(-1)?.decisionReason,
    "controller_dispatch_unknown:ros_action_request_timeout",
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
    createdAt: chain.at(-1)!.evidence.decisionMadeAt,
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
  const validDoctorReport = await new SpyTransport().doctor();
  assert.deepEqual(
    ros2DoctorReportSchema.parse(validDoctorReport),
    validDoctorReport,
  );
  assert.throws(
    () => ros2DoctorReportSchema.parse({
      ...validDoctorReport,
      unexpectedAuthority: true,
    }),
    /Unrecognized key/,
  );
  assert.throws(
    () => ros2DoctorReportSchema.parse({
      ...validDoctorReport,
      limitations: ["x".repeat(257)],
    }),
    /String must contain at most 256 character/,
  );
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
  const sidecarTestPython = process.platform === "win32" ? "python" : "python3";
  const sidecarTests = spawnSync(
    sidecarTestPython,
    [
      join(
        root,
        "experimental/ros2-reference-sidecar/test_rlsok_ros2_sidecar.py",
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    sidecarTests.status,
    0,
    `Python sidecar regressions failed: ${sidecarTests.stderr || sidecarTests.stdout}`,
  );
  assert.doesNotMatch(
    discoveryNode,
    /wait_for_service\(timeout_sec=0\.0\)/,
    "controller-manager discovery must not permanently skip a newly created unmatched service client",
  );
  assert.match(
    sidecar,
    /matching_deadline[\s\S]+subscribe_graph_sources\(\)[\s\S]+start_ready_controller_requests\(\)[\s\S]+joint_sources_matched\(\)[\s\S]+controller_services_matched\(\)[\s\S]+sample_deadline/,
    "late graph endpoints must be subscribed during the bounded DDS matching window",
  );
  assert.match(
    discoveryNode,
    /subscribed_joint_topics[\s\S]+name in self\.subscribed_joint_topics[\s\S]+self\.subscribed_joint_topics\.add\(name\)/,
    "repeated graph refresh must not create duplicate JointState subscriptions",
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
  const hangingTransport = new PythonRos2SidecarTransport({
    pythonExecutable: process.execPath,
    sidecarPath: join(__dirname, "hangingSidecar.js"),
    discoveryTimeoutMs: 1_000,
  });
  const hangStartedAt = Date.now();
  await assert.rejects(
    hangingTransport.doctor(),
    /ros2_sidecar_doctor_timeout/,
  );
  assert.ok(Date.now() - hangStartedAt < 3_000);
  await assert.rejects(
    hangingTransport.doctor(),
    /ros2_sidecar_doctor_timeout/,
    "a poisoned sidecar channel must never auto-restart",
  );
  await hangingTransport.close();

  const oversizedTransport = new PythonRos2SidecarTransport({
    pythonExecutable: process.execPath,
    sidecarPath: join(__dirname, "oversizedSidecar.js"),
    discoveryTimeoutMs: 1_000,
  });
  await assert.rejects(
    oversizedTransport.doctor(),
    /ros2_sidecar_response_too_large/,
  );
  await oversizedTransport.close();

  const unsolicitedTransport = new PythonRos2SidecarTransport({
    pythonExecutable: process.execPath,
    sidecarPath: join(__dirname, "unsolicitedSidecar.js"),
    discoveryTimeoutMs: 1_000,
  });
  await assert.rejects(
    unsolicitedTransport.doctor(),
    /ros2_sidecar_unsolicited_response/,
  );
  await unsolicitedTransport.close();

  const primitiveReplyTransport = new PythonRos2SidecarTransport({
    pythonExecutable: process.execPath,
    sidecarPath: join(__dirname, "invalidProtocolSidecar.js"),
    proposalTopic: "/primitive-doctor-reply",
    discoveryTimeoutMs: 1_000,
  });
  await assert.rejects(
    primitiveReplyTransport.doctor(),
    /ros2_sidecar_response_malformed/,
  );
  await assert.rejects(
    primitiveReplyTransport.doctor(),
    /ros2_sidecar_response_malformed/,
    "a primitive JSON response must poison the sidecar channel",
  );
  await primitiveReplyTransport.close();

  const invalidDoctorTransport = new PythonRos2SidecarTransport({
    pythonExecutable: process.execPath,
    sidecarPath: join(__dirname, "invalidProtocolSidecar.js"),
    discoveryTimeoutMs: 1_000,
  });
  await assert.rejects(
    invalidDoctorTransport.doctor(),
    /ros2_sidecar_doctor_report_invalid/,
  );
  await assert.rejects(
    invalidDoctorTransport.doctor(),
    /ros2_sidecar_doctor_report_invalid/,
    "an invalid Doctor report must poison the sidecar channel",
  );
  await invalidDoctorTransport.close();

  const oneShotStartedAt = Date.now();
  await assert.rejects(
    runRos2Command([
      "doctor",
      "--python",
      process.execPath,
      "--sidecar",
      join(__dirname, "hangingOneShotSidecar.js"),
      "--discovery-timeout-ms",
      "1000",
    ]),
    /ros2_sidecar_one_shot_timeout/,
  );
  assert.ok(Date.now() - oneShotStartedAt < 5_000);
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
      cli.indexOf("await transport.subscribeProposals("),
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
  "ros2-replay-persistence": testReplayPersistence,
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
