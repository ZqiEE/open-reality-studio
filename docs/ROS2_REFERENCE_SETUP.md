# ROS 2 reference setup and Shadow runbook

## Supported reference environment

- Ubuntu 24.04
- ROS 2 Jazzy
- Python from the sourced ROS environment with `rclpy`
- `control_msgs`, `trajectory_msgs`, `sensor_msgs`, and `std_msgs`
- a `FollowJointTrajectory` action server

Do not begin with an unknown or production robot. Use an isolated domain,
simulator, or powered-down controller first. Keep the independent E-Stop and
certified safety system available.

## Preflight

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
rlsok ros2 doctor
rlsok ros2 inspect
npm run test:ros2-reference
```

Confirm topic names, joint order, radians, controller action name, proposer
identity, exact device allowlist, clock synchronization, and fresh
`/joint_states`. `doctor` is diagnostic; it does not certify safety.

## Shadow first

The release must have `deployment.mode: shadow` and a matching Shadow release
record:

```bash
rlsok ros2 shadow \
  --release examples/ros2-releasegate-demo/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/ros2-shadow.json
```

Publish proposals and verify:

- policy decisions appear in the evidence bundle;
- `hardwareSignalSent` is false;
- `controllerGoalCount` remains zero;
- no goal appears on the controller action server;
- malformed, duplicate, mismatched, stale, and unknown identities fail closed.

## Restricted reference Run

Only after reviewing Shadow evidence, create an independently approved
`canary` or `released` ExecSpec. Run requires an exact, repeated release ID:

```bash
rlsok ros2 run \
  --release release.canary.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --allow-reference-run ros2-canary-001 \
  --evidence evidence/ros2-run.json
```

Use reduced speed/force limits in the certified controller and one supervised
test trajectory. Revoke the release through the hosting Core integration and
verify both the cancellation evidence and independent observation of the
robot. The standalone CLI does not provide a remote revocation service.

## Stop conditions

Stop and investigate on clock skew, stale/missing state, discovery changes,
unexpected nodes, SROS2 permissive mode, controller rejection, cancellation
ambiguity, evidence verification failure, or any motion not matching the
reviewed proposal.
