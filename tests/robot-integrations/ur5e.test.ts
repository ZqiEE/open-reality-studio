import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOfficialRobotIntegrations,
  type Ros2DiscoveryReport,
} from "../../packages/robot-integrations";

const joints = [
  "shoulder_pan_joint",
  "shoulder_lift_joint",
  "elbow_joint",
  "wrist_1_joint",
  "wrist_2_joint",
  "wrist_3_joint",
];

function ur5eReport(namespace = "/"): Ros2DiscoveryReport {
  const path = (name: string) =>
    namespace === "/" ? `/${name}` : `${namespace}/${name}`;
  return {
    rosAvailable: true,
    rosDistro: "jazzy",
    rmwImplementation: "rmw_fastrtps_cpp",
    rosDomainId: "0",
    nodes: [],
    jointStateSources: [
      {
        name: path("joint_states"),
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
        name: path("scaled_joint_trajectory_controller/follow_joint_trajectory"),
        types: ["control_msgs/action/FollowJointTrajectory"],
      },
    ],
    robotDescriptions: [
      {
        topic: path("robot_description"),
        xml: '<robot name="ur5e"><link name="ur_description_base"/></robot>',
      },
    ],
    controllerManagers: [
      {
        namespace,
        serviceName: path("controller_manager/list_controllers"),
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
}

test("official UR5e profile binds model, namespace, controller and stable joint order", () => {
  const assessment = assessOfficialRobotIntegrations(ur5eReport("/cell_a"));
  assert.equal(assessment.status, "matched");
  if (assessment.status !== "matched") return;
  assert.equal(assessment.integrations.length, 1);
  const integration = assessment.integrations[0]!;
  assert.equal(integration.model, "UR5e");
  assert.equal(integration.namespace, "/cell_a");
  assert.equal(
    integration.controllerAction,
    "/cell_a/scaled_joint_trajectory_controller/follow_joint_trajectory",
  );
  assert.deepEqual(integration.jointNames, joints);
  assert.equal(integration.physicalValidation, false);
});

test("recognized UR5e with an inactive motion controller fails closed", () => {
  const report = ur5eReport();
  report.controllerManagers![0]!.controllers[2]!.state = "inactive";
  const assessment = assessOfficialRobotIntegrations(report);
  assert.equal(assessment.status, "unsupported");
  if (assessment.status === "unsupported")
    assert.match(assessment.diagnostics.join(" "), /not active/);
});

test("an unknown ROS graph remains explicit generic protocol support", () => {
  const report = ur5eReport();
  report.controllerManagers = [];
  report.robotDescriptions = [];
  const assessment = assessOfficialRobotIntegrations(report);
  assert.equal(assessment.status, "unknown");
});
