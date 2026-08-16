import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  inspectCompatibility,
  type CompatibilityInspection,
} from "../../apps/cli/compatibility";
import type { Ros2DiscoveryReport } from "../../packages/robot-integrations";

const NOW = new Date("2026-08-16T06:40:00.000Z");
const urJoints = [
  "shoulder_pan_joint",
  "shoulder_lift_joint",
  "elbow_joint",
  "wrist_1_joint",
  "wrist_2_joint",
  "wrist_3_joint",
];

function genericReport(): Ros2DiscoveryReport {
  return {
    rosAvailable: true,
    rosDistro: "jazzy",
    rmwImplementation: "rmw_fastrtps_cpp",
    rosDomainId: "7",
    jointStateSources: [{
      name: "/joint_states",
      types: ["sensor_msgs/msg/JointState"],
      publishers: [{ nodeName: "state_bridge", nodeNamespace: "/" }],
      sample: {
        jointNames: ["joint_a", "joint_b"],
        positions: [0, 0],
        observedAt: NOW.toISOString(),
      },
    }],
    trajectoryActionServers: [{
      name: "/trajectory_controller/follow_joint_trajectory",
      types: ["control_msgs/action/FollowJointTrajectory"],
      servers: [{ nodeName: "trajectory_controller", nodeNamespace: "/" }],
    }],
    nodes: [{ name: "state_bridge", namespace: "/" }],
    services: [],
    controllerManagers: [],
    robotDescriptions: [],
  };
}

function officialReport(): Ros2DiscoveryReport {
  return {
    ...genericReport(),
    jointStateSources: [{
      name: "/joint_states",
      types: ["sensor_msgs/msg/JointState"],
      sample: {
        jointNames: urJoints,
        positions: urJoints.map(() => 0),
        observedAt: NOW.toISOString(),
      },
    }],
    trajectoryActionServers: [{
      name: "/scaled_joint_trajectory_controller/follow_joint_trajectory",
      types: ["control_msgs/action/FollowJointTrajectory"],
    }],
    services: [{
      name: "/controller_manager/list_controllers",
      types: ["controller_manager_msgs/srv/ListControllers"],
    }],
    controllerManagers: [{
      namespace: "/",
      serviceName: "/controller_manager/list_controllers",
      controllers: [
        { name: "io_and_status_controller", type: "ur_controllers/GPIOController", state: "active", claimedInterfaces: [] },
        { name: "speed_scaling_state_broadcaster", type: "ur_controllers/SpeedScalingStateBroadcaster", state: "active", claimedInterfaces: [] },
        {
          name: "scaled_joint_trajectory_controller",
          type: "ur_controllers/ScaledJointTrajectoryController",
          state: "active",
          claimedInterfaces: urJoints.map((joint) => `${joint}/position`),
        },
      ],
    }],
    robotDescriptions: [{
      topic: "/robot_description",
      xml: '<robot name="ur5e"><link name="ur_description_base" /></robot>',
    }],
  };
}

test("inspection emits an approval-only candidate from an unverified generic boundary", () => {
  const result = inspectCompatibility(genericReport(), NOW);
  assert.equal(result.compatibilityStatus, "compatible_unverified");
  assert.equal(result.ddsGraphReachable, true);
  assert.equal(result.jointState.fresh, true);
  assert.equal(result.controller.name, "trajectory_controller");
  assert.equal(result.ros2ControlPresent, false);
  assert.equal(result.shadowRunnable, true);
  assert.equal(result.referenceRunRunnable, true);
  assert.equal(result.candidateApprovalRequired, true);
  assert.ok(result.executionConfigurationCandidate);
  assert.match(result.detectedDeviceIdentity ?? "", /^graph:/);
  assert.match(result.detectedRobotIdentity ?? "", /^protocol:/);
  assert.equal(result.executionConfigurationCandidate?.jointOrder.join(","), "joint_a,joint_b");
  assert.match(result.diagnostics.at(-1) ?? "", /requires explicit release approval/);
});

test("standard compatibility statuses are deterministic and do not add support claims", () => {
  assert.equal(
    inspectCompatibility(officialReport(), NOW).compatibilityStatus,
    "officially_supported",
  );
  assert.equal(
    inspectCompatibility({ ...officialReport(), rosDistro: "humble" }, NOW).compatibilityStatus,
    "compatible_unverified",
  );
  assert.equal(
    inspectCompatibility({ ...genericReport(), trajectoryActionServers: [] }, NOW).compatibilityStatus,
    "insufficient_information",
  );
  assert.equal(
    inspectCompatibility({
      ...genericReport(),
      rosAvailable: false,
      nodes: [],
      jointStateSources: [],
      trajectoryActionServers: [],
    }, NOW).compatibilityStatus,
    "incompatible",
  );
});

test("compatibility inspect uses only shared read-only discovery and supports json/write", () => {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-compatibility-"));
  try {
    const reportPath = join(temporary, "report.json");
    const invocationPath = join(temporary, "invocation.json");
    const sidecarPath = join(temporary, "read-only-sidecar.cjs");
    const outputPath = join(temporary, "inspection.json");
    const liveReport = {
      ...genericReport(),
      jointStateSources: genericReport().jointStateSources.map((source) => ({
        ...source,
        sample: source.sample ? { ...source.sample, observedAt: new Date().toISOString() } : null,
      })),
    };
    writeFileSync(reportPath, JSON.stringify(liveReport), "utf8");
    writeFileSync(
      sidecarPath,
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync(process.env.RLSOK_TEST_INVOCATION, JSON.stringify(process.argv.slice(2)));',
        'process.stdout.write(fs.readFileSync(process.env.RLSOK_TEST_REPORT, "utf8"));',
      ].join("\n"),
      "utf8",
    );
    const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
    const before = readdirSync(temporary).sort();
    const jsonRun = spawnSync(process.execPath, [
      cli,
      "compatibility",
      "inspect",
      "--json",
      "--python",
      process.execPath,
      "--sidecar",
      sidecarPath,
      "--discovery-timeout-ms",
      "1000",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        RLSOK_TEST_INVOCATION: invocationPath,
        RLSOK_TEST_REPORT: reportPath,
        RLSOK_DISCOVERY_FIXTURE: "",
        RLSOK_SETUP_DISCOVERY_FIXTURE: "",
      },
    });
    assert.equal(jsonRun.status, 0, jsonRun.stderr);
    const json = JSON.parse(jsonRun.stdout) as CompatibilityInspection;
    assert.equal(json.compatibilityStatus, "compatible_unverified");
    assert.equal(json.candidateApprovalRequired, true);
    assert.deepEqual(JSON.parse(readFileSync(invocationPath, "utf8")), [
      "--discover",
      "--discovery-timeout-seconds",
      "1",
    ]);
    const afterInspect = readdirSync(temporary).sort();
    assert.deepEqual(afterInspect, [...before, "invocation.json"].sort());

    const writeRun = spawnSync(process.execPath, [
      cli,
      "compatibility",
      "inspect",
      "--write",
      outputPath,
    ], {
      encoding: "utf8",
      env: { ...process.env, RLSOK_DISCOVERY_FIXTURE: reportPath },
    });
    assert.equal(writeRun.status, 0, writeRun.stderr);
    assert.match(writeRun.stdout, /Compatibility status: compatible_unverified/);
    const written = JSON.parse(readFileSync(outputPath, "utf8")) as CompatibilityInspection;
    assert.equal(written.candidateApprovalRequired, true);
    assert.equal(written.executionConfigurationCandidate?.schemaVersion, 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
