# Nav2 execution-boundary review — 2026-08-30

## Baseline and scope

The inspected Runtime baseline is frozen v1.4.5 candidate
`4e9b188a78ff1a770f6333097aec0b418773da88`. The review traced the strict
proposal schema, execution-configuration binding, final gate, ROS 2 transport,
Python sidecar, support documentation, adapter-reference fixture and tests.

Runtime v1.4.5 accepts a trajectory containing joint names, points and units and
dispatches `control_msgs/action/FollowJointTrajectory` through a process-selected
action endpoint. The strict schema has no Nav2 selectors, and the sidecar never
constructs `nav2_msgs/action/FollowPath`. The Husarion ROSbot reference also
states that Nav2 is out of scope. Therefore the feedback does not expose a
reachable authorization bypass in the frozen candidate.

## Upstream version evidence

The only ROS 2 distribution in the v1.4.5 support path is Jazzy. Nav2 itself is
not a supported Runtime integration. For version-specific reference work, the
review pinned upstream Navigation2 `jazzy` commit
`f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501`.
The exact reviewed sources were
[`FollowPath.action`](https://github.com/ros-navigation/navigation2/blob/f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501/nav2_msgs/action/FollowPath.action)
and
[`velocity_smoother.cpp`](https://github.com/ros-navigation/navigation2/blob/f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501/nav2_velocity_smoother/src/velocity_smoother.cpp).

At that revision, `nav2_velocity_smoother` consumes `feedback`,
`scale_velocities`, `smoothing_frequency`, `max_velocity`, `min_velocity`,
`max_accel`, `max_decel`, `deadband_velocity`, `velocity_timeout`, `odom_topic`,
`odom_duration`, `stamp_smoothed_velocity_with_smoothing_time`, and
`use_realtime_priority`. OPEN_LOOP uses the last smoothed command as current
velocity; CLOSED_LOOP uses the selected odometry smoother. The node subscribes
to remappable `cmd_vel` and publishes remappable `cmd_vel_smoothed`.

Jazzy `nav2_msgs/action/FollowPath` contains `controller_id`, `goal_checker_id`,
and `progress_checker_id`. It has no `path_handler_id`; that field belongs to a
different/newer Nav2 contract and must not be fabricated for Jazzy.

## Classification

| Feedback item                             | Classification                                                                           | Finding                                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric smoother limits alone             | TEST/DOC GAP ONLY                                                                        | The old reference text was too narrow. A future adapter must bind selected command semantics, not merely the numeric limit vectors. No executable Nav2 adapter currently consumes the incomplete reference.                     |
| OPEN_LOOP physical-state interpretation   | TEST/DOC GAP ONLY                                                                        | Current product code makes no physical-state claim for Nav2. The reference documentation now states that OPEN_LOOP is command-space smoothing, not measured physical-state enforcement.                                         |
| CLOSED_LOOP odometry source and duration  | TEST/DOC GAP ONLY                                                                        | The current generic v2 provenance model can represent the stable binding and runtime attestation can represent volatile freshness/continuity, but the old Nav2 fixture did not say so.                                          |
| Smoother interposition / command topology | TEST/DOC GAP ONLY                                                                        | `nav2.command_path.ready` previously lacked a precise Nav2 meaning. The reference now requires proof of controller output through the selected smoother and optional gates to the base consumer; node liveness is insufficient. |
| `nav2_collision_monitor`                  | NOT APPLICABLE to v1.4.5; conditional future input                                       | It is not in a current Runtime Nav2 path. A future adapter binds it only when the approved topology actually contains it.                                                                                                       |
| Per-goal controller/checker selectors     | NOT APPLICABLE to the current executable path; TEST/DOC GAP ONLY in the future reference | Current strict `FollowJointTrajectory` action has no caller-controlled selector. A future Jazzy FollowPath adapter must bind exact `controller_id`, `goal_checker_id`, and `progress_checker_id` before dispatch.               |
| `path_handler_id`                         | NOT APPLICABLE for Jazzy                                                                 | The pinned Jazzy action definition does not expose it.                                                                                                                                                                          |
| Generic graph/config mirroring            | OPINION / NOT ADOPTED                                                                    | The contract remains a minimal selected boundary and does not mirror the whole Nav2 parameter file or ROS graph.                                                                                                                |
| Current Core v2 representability          | ALREADY COVERED                                                                          | Selected semantic/provenance digests, required capabilities, freshness and continuity can represent the future adapter facts without a Core schema change.                                                                      |

## Release decision

No current v1.4.5 action can select a different Nav2 controller, checker or
handler because no current action reaches Nav2. No Core, Permit, Evidence,
replay, dispatch, controller or authorization semantics changed. The frozen
candidate remains valid and no replacement v1.4.5 candidate or targeted Ultra
review is required from this finding.

The remaining evidence is external to v1.4.5: a future implementation would need
an actual Jazzy Nav2 adapter and simulated graph proving same-limit semantic
drift, CLOSED_LOOP source drift, topology bypass, exact-selector substitution,
approved-selector success, volatile-sample non-invalidation, Shadow
zero-dispatch, and truthful Evidence with hardware dispatch `NO`.
