# Architecture

RLSOK has one trusted decision path:

```text
untrusted proposal
  → exact device + proposer release resolution
  → ExecSpec identity and lifecycle check
  → fresh robot state and action-contract check
  → runtime policy
  → short-lived single-use permit
  → dispatch-time release refresh
  → untrusted ROS transport
  → evidence chain
```

## Core responsibilities

- `packages/exec-spec`: strict executable release schema and content identity.
- `packages/action-contract`: action shape, dimensions, units, and hashes.
- `packages/robot-profile`: robot/controller compatibility identity.
- `packages/release-policy`: lifecycle, approval, expiry, device binding, and
  revocation.
- `packages/execution-gate`: fail-closed evaluation, Shadow, and private
  permits bound to action, release, device, and controller.
- `packages/evidence`: canonical JSON, SHA-256, chained evidence, and
  verification.
- `packages/ros2-reference-gateway`: ROS proposal validation, Shadow/Run,
  cancellation, and evidence orchestration.

The `realitywarden.io/v1alpha1` API string is an isolated published schema
identifier, not an active product or command name.

## ROS process boundary

`experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py` is the only ROS
implementation. It uses rclpy for:

- `std_msgs/String` proposal subscription;
- `sensor_msgs/JointState` observation;
- `control_msgs/action/FollowJointTrajectory` goals and cancellation;
- graph doctor and inspection.

JSONL IPC connects it to Core. Python has no release, policy, permit,
revocation, or evidence authority.

## Operating modes

Shadow uses `ShadowExecutionGate`, has no dispatcher, and records `not_sent`.
Reference Run requires a canary/released release, exact CLI confirmation,
SROS2 `Enforce`, controller availability, and a valid Core permit.

Revocation is terminal. Core refreshes the release record immediately before
dispatch and requests cancellation for an active reference goal.
