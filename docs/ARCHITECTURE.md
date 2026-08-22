# Architecture

```text
ExecSpec
  -> release identity and approval
  -> execution configuration and runtime capability attestation
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
and is bound to the release, action hash, device, controller, execution
configuration, and any required runtime attestation. Any missing, expired,
changed, mismatched, stale, revoked, or unapproved input fails closed. The
release record and configured runtime observations are refreshed immediately
before dispatch.

Shadow has no dispatcher. It records whether the same proposal would pass while
always reporting `hardwareSignalSent: false`.

## Runtime attestation boundary

An ExecSpec may require a deterministic set of runtime capabilities. A trusted
adapter or external monitor supplies a versioned `RuntimeAttestation` containing
its source identity, observation time, continuity token, and currently available
capabilities. Core compares required and available capability strings as sets;
it does not interpret natural language or infer physical safety from raw sensor
data.

Diagnostic, fault, safety, and perception systems may publish authenticated
facts or capabilities for an approved adapter to attest. RLSOK only evaluates
the deterministic requirements approved in the ExecSpec. At permit issuance,
the full attestation digest binds the exact authorized request and detects any
later mutation of that request. Before dispatch, RLSOK obtains a fresh
attestation instead of requiring its full digest to remain identical: a newer
`observedAt` and changes to capabilities not required by the ExecSpec are
expected observations. The refreshed attestation must remain fresh, contain
every required capability, and have the same source identity, source kind,
source version, and continuity token as the issuance attestation. A source or
continuity change fails closed. Evidence records the source and capability
facts, hashes the continuity token, and remains backward compatible when no
capabilities are required.

DDS GUIDs and transport or session identifiers may contribute continuity
evidence. They are not durable authorization identities unless an appropriate
security layer authenticates them.

## ROS 2 boundary

`packages/ros2-reference-gateway/` validates proposal and joint-state
contracts, resolves the active release, invokes Core, and records dispatch or
cancellation evidence.

`experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py` is an untrusted
transport process. It subscribes to proposal and `JointState` topics and uses
`FollowJointTrajectory` for goals and cancellation. JSONL IPC is the only
boundary between it and TypeScript. Python cannot approve a release or issue a
permit.

Because DDS delivery is asynchronous, the reference transport may already hold
a stale cached `JointState` while an active publisher is delivering its next
sample. It waits only within the configured discovery timeout for that next
sample and accepts it only if it is fresh. A missing or stopped publisher, a
sample that stays stale, or a materially future timestamp still fails closed.

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

Runtime attestation does not replace functional safety, collision detection,
emergency stopping, an E-stop, a safety PLC, or certified controller behavior.
Those protections remain independent of RLSOK authorization.
