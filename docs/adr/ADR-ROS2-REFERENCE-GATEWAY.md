# ADR: Python rclpy sidecar for the ROS 2 reference gateway

- Status: Accepted
- Date: 2026-07-26
- Scope: Experimental/reference integration only

## Decision

Use one ROS implementation: a Python `rclpy` sidecar connected to the
TypeScript RLSOK Core by newline-delimited JSON. Do not add a Node DDS client.

The sidecar may subscribe to `std_msgs/String` proposals and
`sensor_msgs/JointState`, send/cancel
`control_msgs/action/FollowJointTrajectory` goals, and inspect the graph. It
must not resolve releases, evaluate policy, mint or validate permits, decide
Shadow/Run eligibility, perform revocation, or write evidence.

`trajectory_msgs/JointTrajectory` is the goal's message type; it is not an
action. The action contract is `control_msgs/action/FollowJointTrajectory`.

## Why

`rclpy` uses the installed ROS graph, RMW selection, discovery, action
semantics, and SROS2 configuration without introducing a second DDS stack.
Keeping all trust decisions in the existing TypeScript Core preserves one
admission path and makes the sidecar replaceable and untrusted.

The IPC boundary adds latency and is not hard realtime. That is acceptable for
this reference gateway and must not be hidden by product claims.

## Rejected alternatives

- A Node ROS/DDS implementation: a second transport stack and duplicated graph
  behavior without reducing the trusted Core.
- Policy checks in Python: creates two authorities and a bypass risk.
- Calling `trajectory_msgs` an action: technically incorrect.
- Production or safety claims: unsupported by this implementation.

## Validation status

Contract, Shadow, restricted Run, cancellation, permit binding, evidence, and
no-bypass behavior are automated with a transport spy. The development host
used for phase 3 has no `ros2` executable or `rclpy`, so live DDS, SROS2,
controller, timing, and physical cancellation validation remain explicitly
unverified until the design-partner runbook is executed.
