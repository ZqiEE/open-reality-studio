# ROS 2 gateway boundary

`packages/ros2-gateway` defines replaceable contracts for:

- `ActionProposalSource<TAction>`;
- `RobotStateSource<TState>`;
- `ControllerSink<TAction>`;
- `ReleaseResolver`.

It includes in-memory proposal/state implementations for tests. Planned
reference adapters cover `FollowJointTrajectory`, `JointJog`, `TwistStamped`,
gripper commands, `JointState`, cancel, and a protective-stop bridge.

This phase does not implement or claim production ROS 2 networking. The
gateway is experimental, a reference adapter boundary, and not safety-rated.
SROS 2 configuration, DDS behavior, controller-specific cancellation, and
protective-stop integration require validation in a complete ROS 2
environment.
