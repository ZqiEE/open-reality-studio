import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runUr5eNegativeChecks,
  runUr5eValidationCommand,
} from "../../apps/cli/validate-ur5e";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import {
  executablePolicyHash,
  executablePolicySpecSchema,
} from "../../packages/core/exec-spec";
import { configurationDigest } from "../../packages/core/execution-configuration";
import type { Ros2DiscoveryReport } from "../../packages/robot-integrations";

const fixture = JSON.parse(
  readFileSync("fixtures/cloud-contract/v1/release.json", "utf8"),
) as { execSpec: unknown; action: unknown };

const ur5eJoints = [
  "shoulder_pan_joint",
  "shoulder_lift_joint",
  "elbow_joint",
  "wrist_1_joint",
  "wrist_2_joint",
  "wrist_3_joint",
];

function ur5eDiscoveryReport(): Ros2DiscoveryReport {
  return {
    rosAvailable: true,
    rosDistro: "jazzy",
    rmwImplementation: "rmw_fastrtps_cpp",
    rosDomainId: "17",
    nodes: [],
    jointStateSources: [
      {
        name: "/cell_a/joint_states",
        types: ["sensor_msgs/msg/JointState"],
        sample: {
          jointNames: [...ur5eJoints].reverse(),
          positions: [6, 5, 4, 3, 2, 1],
          observedAt: new Date().toISOString(),
        },
      },
    ],
    trajectoryActionServers: [
      {
        name: "/cell_a/scaled_joint_trajectory_controller/follow_joint_trajectory",
        types: ["control_msgs/action/FollowJointTrajectory"],
      },
    ],
    robotDescriptions: [
      {
        topic: "/cell_a/robot_description",
        xml: '<robot name="ur5e"><link name="ur_description_base"/></robot>',
      },
    ],
    controllerManagers: [
      {
        namespace: "/cell_a",
        serviceName: "/cell_a/controller_manager/list_controllers",
        controllers: [
          {
            name: "gpio_controller",
            type: "ur_controllers/GPIOController",
            state: "active",
            claimedInterfaces: [],
          },
          {
            name: "speed_scaling_state_broadcaster",
            type: "ur_controllers/SpeedScalingStateBroadcaster",
            state: "active",
            claimedInterfaces: [],
          },
          {
            name: "scaled_joint_trajectory_controller",
            type: "ur_controllers/ScaledJointTrajectoryController",
            state: "active",
            claimedInterfaces: ur5eJoints.map((joint) => `${joint}/position`),
          },
        ],
      },
    ],
  };
}

test("physical UR5e validation negatives use the production local authority checks", () => {
  const release = executablePolicySpecSchema.parse(fixture.execSpec);
  const proposal = {
    proposalId: "physical-ur5e-validation",
    releaseId: release.metadata.releaseId,
    deviceId: release.deployment.allowedDeviceIds[0],
    proposerIdentity: "validation-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt: new Date().toISOString(),
  };
  const checks = runUr5eNegativeChecks(
    release,
    proposal,
    release.robot.controllerConfigSha256,
  );
  assert.deepEqual(
    checks.map((check) => [check.name, check.result]),
    [
      ["exact-release-robot-controller-binding", "PASS"],
      ["release-mismatch", "PASS"],
      ["robot-mismatch", "PASS"],
      ["controller-mismatch", "PASS"],
      ["expired-release-authority", "PASS"],
      ["stale-robot-state", "PASS"],
    ],
  );
  assert.ok(checks.every((check) => check.controllerGoalsAttempted === 0));
  assert.ok(checks.every((check) => check.hardwareSignalSent === false));
});

test("physical UR5e preflight writes a checksum-verifiable PENDING artifact", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-ur5e-validation-"));
  const discoveryPath = join(temporary, "discovery.json");
  const output = join(temporary, "proof");
  const report = ur5eDiscoveryReport();
  writeFileSync(discoveryPath, JSON.stringify(report));
  const oldAcceptance = process.env.RLSOK_SETUP_ACCEPTANCE;
  const oldFixture = process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
  process.env.RLSOK_SETUP_ACCEPTANCE = "1";
  process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = discoveryPath;
  try {
    assert.equal(
      await runUr5eValidationCommand([
        "preflight",
        "--output",
        output,
        "--operator",
        "Acceptance Operator",
        "--robot-serial",
        "UR5E-TEST-ONLY",
      ]),
      0,
    );
    const preflight = JSON.parse(
      readFileSync(join(output, "preflight.json"), "utf8"),
    );
    const manifest = JSON.parse(
      readFileSync(join(output, "manifest.json"), "utf8"),
    );
    assert.equal(preflight.hardwareValidation, "PENDING");
    assert.equal(preflight.environment.integration.model, "UR5e");
    assert.equal(manifest.status, "PENDING");
    assert.equal(manifest.phase, "preflight");
    assert.equal(manifest.sessionId, preflight.sessionId);
    assert.match(readFileSync(join(output, "SHA256SUMS"), "utf8"), /preflight\.json/);
    assert.doesNotMatch(JSON.stringify(preflight), /use_mock_hardware/);
  } finally {
    if (oldAcceptance === undefined) delete process.env.RLSOK_SETUP_ACCEPTANCE;
    else process.env.RLSOK_SETUP_ACCEPTANCE = oldAcceptance;
    if (oldFixture === undefined) delete process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
    else process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = oldFixture;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("physical UR5e validation cannot skip, change identity, or tamper with preflight", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-ur5e-phase-guard-"));
  const discoveryPath = join(temporary, "discovery.json");
  const output = join(temporary, "proof");
  writeFileSync(discoveryPath, JSON.stringify(ur5eDiscoveryReport()));
  const oldAcceptance = process.env.RLSOK_SETUP_ACCEPTANCE;
  const oldFixture = process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
  process.env.RLSOK_SETUP_ACCEPTANCE = "1";
  process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = discoveryPath;
  const identity = [
    "--output",
    output,
    "--operator",
    "Phase Operator",
    "--robot-serial",
    "UR5E-PHASE-001",
  ];
  try {
    await assert.rejects(
      runUr5eValidationCommand(["finalize", ...identity]),
      /validation_manifest_missing/,
    );
    assert.equal(await runUr5eValidationCommand(["preflight", ...identity]), 0);
    await assert.rejects(
      runUr5eValidationCommand([
        "record",
        "--output",
        output,
        "--operator",
        "Different Operator",
        "--robot-serial",
        "UR5E-PHASE-001",
      ]),
      /validation_operator_mismatch/,
    );
    await assert.rejects(
      runUr5eValidationCommand([
        "record",
        "--output",
        output,
        "--operator",
        "Phase Operator",
        "--robot-serial",
        "UR5E-PHASE-OTHER",
      ]),
      /validation_robot_serial_mismatch/,
    );
    await assert.rejects(
      runUr5eValidationCommand(["finalize", ...identity]),
      /validation_manifest_identity_invalid/,
    );
    await assert.rejects(
      runUr5eValidationCommand(["preflight", ...identity]),
      /validation_output_must_be_empty_for_preflight/,
    );
    writeFileSync(
      join(output, "preflight.json"),
      `${readFileSync(join(output, "preflight.json"), "utf8")} `,
    );
    await assert.rejects(
      runUr5eValidationCommand(["record", ...identity]),
      /validation_artifact_hash_mismatch:preflight\.json/,
    );
  } finally {
    if (oldAcceptance === undefined) delete process.env.RLSOK_SETUP_ACCEPTANCE;
    else process.env.RLSOK_SETUP_ACCEPTANCE = oldAcceptance;
    if (oldFixture === undefined) delete process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
    else process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = oldFixture;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("physical UR5e record binds setup, release, environment, and Cloud Evidence", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-ur5e-record-chain-"));
  const discoveryPath = join(temporary, "discovery.json");
  const output = join(temporary, "proof");
  const configHome = join(temporary, "config");
  const setupDirectory = join(configHome, "rlsok");
  const artifactPath = join(temporary, "policy.bin");
  const releasePath = join(temporary, "release.json");
  const proposalPath = join(temporary, "proposal.json");
  const setupEvidencePath = join(temporary, "setup-evidence.json");
  mkdirSync(setupDirectory, { recursive: true });
  writeFileSync(discoveryPath, JSON.stringify(ur5eDiscoveryReport()));
  writeFileSync(artifactPath, "phase-chain-policy\n");
  const artifactSha256 = sha256("phase-chain-policy\n");
  const releaseId = "ur5e-phase-chain-test";
  const deviceId = "ur5e-phase-chain-device";
  const controllerAction =
    "/cell_a/scaled_joint_trajectory_controller/follow_joint_trajectory";
  const configuration = {
    ...(executablePolicySpecSchema.parse(fixture.execSpec)
      .executionConfiguration as Record<string, unknown>),
    schemaVersion: 1 as const,
    deviceIdentity: deviceId,
    robotIdentity: "ur5e-phase-chain-robot",
    rosDistro: "jazzy",
    rmwImplementation: "rmw_fastrtps_cpp",
    jointState: {
      topic: "/cell_a/joint_states",
      messageType: "sensor_msgs/msg/JointState" as const,
    },
    controller: {
      name: "scaled_joint_trajectory_controller",
      followJointTrajectoryAction: controllerAction,
      actionType: "control_msgs/action/FollowJointTrajectory" as const,
    },
    jointOrder: ur5eJoints,
    adapter: { identity: "rlsok-ros2-sidecar", version: "1.3.1" },
    observedAt: new Date().toISOString(),
  };
  const baseRelease = executablePolicySpecSchema.parse(fixture.execSpec);
  const release = executablePolicySpecSchema.parse({
    ...baseRelease,
    metadata: { ...baseRelease.metadata, releaseId },
    model: { ...baseRelease.model, sha256: artifactSha256 },
    actionContract: {
      ...baseRelease.actionContract,
      dimension: ur5eJoints.length,
      jointOrder: ur5eJoints,
    },
    robot: {
      ...baseRelease.robot,
      profileId: "universal-robots-ur5e-ros2-driver-jazzy",
    },
    executionConfiguration: configuration,
    approvedConfigurationDigest: configurationDigest(configuration),
    deployment: {
      ...baseRelease.deployment,
      allowedDeviceIds: [deviceId],
      mode: "shadow",
    },
  });
  writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
  const action = {
    representation: "trajectory",
    jointNames: ur5eJoints,
    points: [{ positions: ur5eJoints.map(() => 0), timeFromStartMs: 1000 }],
    units: { position: "radian", velocity: "radian_per_second" },
  };
  const proposal = {
    proposalId: "ur5e-phase-chain-proposal",
    releaseId,
    deviceId,
    proposerIdentity: "phase-policy",
    actionRepresentation: "trajectory",
    actionPayload: action,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const permitId = randomUUID();
  const evidenceId = randomUUID();
  const createdAt = new Date().toISOString();
  const cloudEvidenceBody = {
    sequence: 0,
    previousHash: null,
    releaseId,
    permitId,
    decision: "allowed",
    hardwareSignalSent: false,
    payload: {
      contractVersion: "rlsok-cloud/v1",
      evaluationMode: "shadow",
      contentHash: executablePolicyHash(release),
      actionHash: sha256(canonicalJson(action)),
      deviceId,
      controllerId: release.robot.controllerConfigSha256,
      expectedConfigurationDigest: release.approvedConfigurationDigest,
      observedConfigurationDigest: release.approvedConfigurationDigest,
      localPermitConsumed: true,
      controllerGoalsAttempted: 0,
      reason: "shadow_permit_evaluated_no_controller_call",
    },
    createdAt,
  };
  const cloudEvidence = {
    apiVersion: "rlsok-cloud/v1",
    id: evidenceId,
    ...cloudEvidenceBody,
    evidenceHash: sha256(canonicalJson(cloudEvidenceBody)),
  };
  writeFileSync(
    setupEvidencePath,
    `${JSON.stringify(
      {
        executionMode: "cloud-connected",
        mode: "shadow",
        releaseId,
        proposalId: proposal.proposalId,
        decision: "allowed",
        reason: "shadow_permit_evaluated_no_controller_call",
        cloudPermitId: permitId,
        cloudPermitConsumed: true,
        localPermitConsumed: true,
        controllerGoalsAttempted: 0,
        hardwareSignalSent: false,
        cloudEvidenceId: evidenceId,
        evidenceVerified: true,
      },
      null,
      2,
    )}\n`,
  );
  const setup = {
    version: 2,
    releaseId,
    deviceId,
    controllerId: "trajectory-phase-chain",
    artifactPath,
    artifactSha256,
    jointStateTopic: "/cell_a/joint_states",
    controllerAction,
    jointNames: ur5eJoints,
    proposalTopic: "/cell_a/rlsok/action_proposals",
    proposerIdentity: proposal.proposerIdentity,
    integration: {
      supportLevel: "official",
      profileId: "universal-robots-ur5e-ros2-driver-jazzy",
      vendor: "Universal Robots",
      model: "UR5e",
      namespace: "/cell_a",
      physicalValidation: false,
    },
    releasePath,
    proposalPath,
    evidencePath: setupEvidencePath,
    cloudApiUrl: "http://127.0.0.1:43111",
    completedAt: new Date().toISOString(),
  };
  const setupPath = join(setupDirectory, "setup.json");
  writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`);

  const oldAcceptance = process.env.RLSOK_SETUP_ACCEPTANCE;
  const oldFixture = process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
  const oldConfigHome = process.env.XDG_CONFIG_HOME;
  const oldApiUrl = process.env.RLSOK_CLOUD_API_URL;
  const oldApiKey = process.env.RLSOK_CLOUD_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.RLSOK_SETUP_ACCEPTANCE = "1";
  process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = discoveryPath;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.RLSOK_CLOUD_API_URL = setup.cloudApiUrl;
  process.env.RLSOK_CLOUD_API_KEY = "phase-chain-test-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(cloudEvidence), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const identity = [
    "--output",
    output,
    "--operator",
    "Phase Operator",
    "--robot-serial",
    "UR5E-PHASE-002",
  ];
  try {
    assert.equal(await runUr5eValidationCommand(["preflight", ...identity]), 0);
    assert.equal(await runUr5eValidationCommand(["record", ...identity]), 0);
    const manifest = JSON.parse(
      readFileSync(join(output, "manifest.json"), "utf8"),
    ) as { phase: string; sessionId: string };
    const record = JSON.parse(
      readFileSync(join(output, "record.json"), "utf8"),
    ) as { sessionId: string; releaseId: string };
    assert.equal(manifest.phase, "record");
    assert.equal(record.sessionId, manifest.sessionId);
    assert.equal(record.releaseId, releaseId);

    await assert.rejects(
      runUr5eValidationCommand([
        "finalize",
        "--output",
        output,
        "--operator",
        "Changed Operator",
        "--robot-serial",
        "UR5E-PHASE-002",
      ]),
      /validation_operator_mismatch/,
    );
    writeFileSync(
      setupPath,
      `${JSON.stringify({ ...setup, deviceId: "changed-device" }, null, 2)}\n`,
    );
    await assert.rejects(
      runUr5eValidationCommand(["finalize", ...identity]),
      /validation_setup_changed_after_record/,
    );
    writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`);
    writeFileSync(
      discoveryPath,
      JSON.stringify({ ...ur5eDiscoveryReport(), rosDomainId: "18" }),
    );
    await assert.rejects(
      runUr5eValidationCommand(["finalize", ...identity]),
      /validation_environment_changed/,
    );
    writeFileSync(discoveryPath, JSON.stringify(ur5eDiscoveryReport()));
    writeFileSync(
      join(output, "binding.json"),
      `${readFileSync(join(output, "binding.json"), "utf8")} `,
    );
    await assert.rejects(
      runUr5eValidationCommand(["finalize", ...identity]),
      /validation_artifact_hash_mismatch:binding\.json/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldAcceptance === undefined) delete process.env.RLSOK_SETUP_ACCEPTANCE;
    else process.env.RLSOK_SETUP_ACCEPTANCE = oldAcceptance;
    if (oldFixture === undefined) delete process.env.RLSOK_UR5E_DISCOVERY_FIXTURE;
    else process.env.RLSOK_UR5E_DISCOVERY_FIXTURE = oldFixture;
    if (oldConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfigHome;
    if (oldApiUrl === undefined) delete process.env.RLSOK_CLOUD_API_URL;
    else process.env.RLSOK_CLOUD_API_URL = oldApiUrl;
    if (oldApiKey === undefined) delete process.env.RLSOK_CLOUD_API_KEY;
    else process.env.RLSOK_CLOUD_API_KEY = oldApiKey;
    rmSync(temporary, { recursive: true, force: true });
  }
});
