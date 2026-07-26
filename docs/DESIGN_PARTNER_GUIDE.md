# ROS 2 design-partner evaluation guide

The evaluation target is evidence about integration fit, not a production or
safety acceptance.

## Entry criteria

- isolated ROS 2 Jazzy domain and named technical owner;
- simulator or supervised low-energy robot cell;
- independent E-Stop/protective stop;
- stable joint order and `FollowJointTrajectory` controller;
- synchronized clocks and SROS2 enforcement;
- reviewed Shadow ExecSpec with exact device/proposer binding.

## Required sessions

1. Run `doctor`, `inspect`, and all reference tests.
2. Run at least 100 Shadow proposals with zero controller goals.
3. Exercise malformed payload, wrong release/device/proposer, duplicate ID,
   missing/stale state, joint mismatch, expired release, and revoked release.
4. Verify evidence chains independently.
5. If approved by the partner's safety owner, run one constrained canary goal.
6. Revoke during an active goal; compare cancellation evidence with controller
   logs and physical observation.

Record the checklist in `design-partner/ros2-reference/EVALUATION_CHECKLIST.md`.

## Exit criteria

No unexplained actuation, no Shadow controller goals, complete evidence,
confirmed deny-by-default graph permissions, and written disposition for every
failure. A successful evaluation means the reference architecture is suitable
for further engineering; it is not authorization for unattended operation.
