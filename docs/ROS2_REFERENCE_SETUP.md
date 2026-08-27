# ROS 2 reference setup

Use Ubuntu 24.04 with ROS 2 Jazzy, `rclpy`, `control_msgs`, `sensor_msgs`,
`std_msgs`, and `trajectory_msgs`. Source the ROS environment before invoking
RLSOK.

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
npm install
npm run rlsok -- ros2 doctor
npm run rlsok -- ros2 inspect examples/ros2-reference/release.shadow.yaml
```

Doctor must report the expected RMW implementation, domain, topics, controller
action, joint-state status, action-server status, and SROS2 state. Missing ROS
imports return exit code 2.

Joint-state freshness is measured when the sidecar receives the DDS sample.
The original ROS header timestamp is retained as `sourceTimestamp` for
diagnostics, but it is not interpreted as UTC because simulators such as
Gazebo use a simulation epoch. This does not relax `runtimePolicy.maxStateAgeMs`:
the received sample must still be current at the execution boundary.

DDS discovery uses a bounded 15-second window by default. A deployment may set
`--discovery-timeout-ms` or `RLSOK_ROS2_DISCOVERY_TIMEOUT_MS` from 1000 through
120000 milliseconds. Expiry of that window fails closed before Permit
consumption or controller dispatch.

## SROS2

Generate signed deployment artifacts from the deny-by-default reference policy
at `examples/ros2-reference/sros2/policy.xml`, then set:

```bash
export ROS_SECURITY_KEYSTORE=/secure/path/rlsok_keystore
export ROS_SECURITY_ENABLE=true
export ROS_SECURITY_STRATEGY=Enforce
```

The gateway needs only proposal-topic subscription, joint-state subscription,
and action-client access to
`/joint_trajectory_controller/follow_joint_trajectory`.

## Shadow

Start a `JointState` publisher and a proposal publisher in the selected ROS
domain, then run:

```bash
npm run rlsok -- ros2 shadow \
  --release examples/ros2-reference/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/shadow.json
```

Publish JSON proposal envelopes on `/rlsok/action_proposals` as
`std_msgs/msg/String`. The envelope must contain a unique proposal ID, the exact
release/device/proposer identity, a trajectory action, and a current timestamp.
Shadow must keep the controller goal count at zero.

## Reference Run

Reference Run can command motion. Use a separately approved canary or released
ExecSpec, an available `FollowJointTrajectory` server, SROS2 Enforce, a
supervised low-energy environment, and independent safety controls.

```bash
npm run rlsok -- ros2 run \
  --release release.canary.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --allow-reference-run <exact-release-id> \
  --evidence evidence/reference-run.json
```

Stop on stale state, clock skew, discovery changes, SROS2 permissive mode,
controller rejection, timeout, or evidence verification failure. RLSOK
revocation blocks a later dispatch and deliberately sends no cancellation,
stop, hold, zero, or retry command for an already executing trajectory; that
controlled-stop or safety-rated responsibility belongs outside RLSOK.
Blocked and failed cloud-connected executions return a nonzero process status;
when the cloud release identity is known, revocation and other eligibility
denials are written as zero-dispatch Evidence without issuing a Permit.
