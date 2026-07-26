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
controller rejection, timeout, cancellation ambiguity, or evidence verification
failure. A cancellation request is not proof that physical motion stopped.
