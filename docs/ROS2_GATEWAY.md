# ROS 2 reference gateway

`packages/ros2-gateway` defines replaceable contracts for:

- `ActionProposalSource<TAction>`;
- `RobotStateSource<TState>`;
- `ControllerSink<TAction>`;
- `ReleaseResolver`.

It includes in-memory proposal/state implementations for tests.

`packages/ros2-reference-gateway` now supplies an experimental live reference
path:

1. an untrusted `std_msgs/String` proposal arrives on
   `/rlsok/action_proposals`;
2. TypeScript resolves the exact release/device/proposer binding;
3. Core validates the trajectory contract and fresh `JointState`;
4. Shadow Mode records the decision with zero controller goals; or
5. restricted Run Mode obtains a one-use, action/release/device/controller
   bound permit before the Python sidecar can request a
   `control_msgs/action/FollowJointTrajectory` goal.

Revocation is rechecked at dispatch and requests cancellation of the active
goal. A cancellation request is evidence, not proof that physical motion
stopped.

The Python sidecar owns transport only. It has no policy, permit, release, or
evidence authority. See the [ADR](./adr/ADR-ROS2-REFERENCE-GATEWAY.md),
[setup runbook](./ROS2_REFERENCE_SETUP.md), and
[SROS2 reference policy](./SROS2_REFERENCE_POLICY.md).

This gateway remains experimental, not safety-rated, not hard realtime, and
not a replacement for a certified controller, protective stop, or E-Stop.
