# ROS 2 reference setup

Reference environment:

- Ubuntu 24.04;
- ROS 2 Jazzy;
- sourced Python environment with rclpy;
- `control_msgs`, `trajectory_msgs`, `sensor_msgs`, and `std_msgs`;
- a `control_msgs/action/FollowJointTrajectory` server.

This is experimental, not safety-rated, and not hard real-time. Begin with an
isolated domain and simulator or powered-down controller. Keep independent
safety controls available.

## Preflight

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=42
npm run rlsok -- ros2 doctor
npm run rlsok -- ros2 inspect
npm run ros2:test
```

Confirm exact topic/action names, joint order, radians, device allowlist,
proposer identity, clock synchronization, and fresh JointState.

## Shadow

```bash
npm run rlsok -- ros2 shadow \
  --release examples/ros2-reference/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/shadow.json
```

Publish proposals using `examples/ros2-reference/proposal.json`. Verify all
decisions have `hardwareSignalSent: false`, goal count remains zero, and
malformed, duplicate, mismatched, stale, and unknown input blocks.

## SROS2

```bash
export ROS_SECURITY_KEYSTORE=/secure/path/rlsok_keystore
export ROS_SECURITY_ENABLE=true
export ROS_SECURITY_STRATEGY=Enforce
```

Review `docs/SECURITY.md` and the reference policy before Run.

## Reference Run

Create a separately approved canary/released ExecSpec from reviewed Shadow
evidence. Run requires its exact release ID:

```bash
npm run rlsok -- ros2 run \
  --release release.canary.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --allow-reference-run <exact-release-id> \
  --evidence evidence/reference-run.json
```

Use a supervised, low-energy test. Compare RLSOK cancellation evidence with
controller logs and physical observation; evidence of a request is not proof
that motion stopped.

Stop on clock skew, discovery changes, SROS2 permissive mode, stale state,
controller rejection, cancellation ambiguity, or evidence verification
failure.
