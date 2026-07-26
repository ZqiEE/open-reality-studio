# Architecture

```text
ExecSpec
  -> release identity and approval
  -> fresh state and action validation
  -> short-lived single-use permit
  -> dispatch-time revocation refresh
  -> ROS 2 transport
  -> hash-chained evidence
```

## Core

`packages/core/` owns the ExecSpec schema, canonical hashing, release
transitions, approval identity, revocation, execution eligibility, permits,
Shadow decisions, evidence generation, and evidence verification.

A permit is private, consumed on first use, expires after at most one second,
and is bound to the release, action hash, device, and controller. Any missing,
expired, changed, mismatched, stale, revoked, or unapproved input fails closed.
The release record is refreshed immediately before dispatch.

Shadow has no dispatcher. It records whether the same proposal would pass while
always reporting `hardwareSignalSent: false`.

## ROS 2 boundary

`packages/ros2-reference-gateway/` validates proposal and joint-state
contracts, resolves the active release, invokes Core, and records dispatch or
cancellation evidence.

`experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py` is an untrusted
transport process. It subscribes to proposal and `JointState` topics and uses
`FollowJointTrajectory` for goals and cancellation. JSONL IPC is the only
boundary between it and TypeScript. Python cannot approve a release or issue a
permit.

Reference Run requires:

- a canary or released ExecSpec with matching approval identity;
- exact release-ID confirmation;
- SROS2 with `ROS_SECURITY_STRATEGY=Enforce`;
- an available controller action server;
- fresh joint state;
- a valid Core permit immediately before dispatch.

## Evidence

Evidence distinguishes `not_sent` from `attempted_unconfirmed`. Controller goal
acceptance and cancellation requests do not prove physical motion or a physical
stop. Entries are canonicalized, SHA-256 hash-chained, and verified against the
bundle release identity.

## Security limits

The gateway rejects malformed or oversized proposals, unknown proposer/device
bindings, duplicate proposal IDs, stale state, contract mismatches, changed
release content, invalid permits, and revoked releases. Host compromise,
controller firmware, sensing errors, clock failure, DDS behavior, and physical
hazards remain outside the software guarantee.
