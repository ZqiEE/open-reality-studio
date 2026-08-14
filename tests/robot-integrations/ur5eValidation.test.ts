import assert from "node:assert/strict";
import {
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
import { executablePolicySpecSchema } from "../../packages/core/exec-spec";
import type { Ros2DiscoveryReport } from "../../packages/robot-integrations";

const fixture = JSON.parse(
  readFileSync("fixtures/cloud-contract/v1/release.json", "utf8"),
) as { execSpec: unknown; action: unknown };

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
  const joints = [
    "shoulder_pan_joint",
    "shoulder_lift_joint",
    "elbow_joint",
    "wrist_1_joint",
    "wrist_2_joint",
    "wrist_3_joint",
  ];
  const report: Ros2DiscoveryReport = {
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
          jointNames: [...joints].reverse(),
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
            claimedInterfaces: joints.map((joint) => `${joint}/position`),
          },
        ],
      },
    ],
  };
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
