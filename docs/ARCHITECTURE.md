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

## Configuration provenance and semantic binding

`ExecutionConfiguration` is versioned. Version 1 is frozen: its schema and
historical digest projection remain unchanged for existing releases and Cloud
contract fixtures. Version 2 separates an approved source-of-truth definition
from observations that naturally change while the deployment is running.

The version 2 configuration digest contains exactly:

- `schemaVersion`;
- stable device and robot identity;
- the command interface type and logical endpoint;
- controller implementation identity and version;
- the explicit joint-to-command-index mapping;
- declared limits and frame-contract digests;
- canonical configuration provenance.

Provenance entries identify their stable source and purpose. A content source
binds its SHA-256 digest. A software source binds its version. A deterministic
generated source binds the source-input digest plus generator identity and
version; the generated output does not need a second independent digest.
Provenance entries are unordered and canonicalized by unique source identity.
Duplicate source identities are rejected rather than resolved by precedence.
An adapter selects provenance per approved execution dependency. A semantic
contract for an IMU, controller, or other interface is a content/software source
with an interface-scoped identity when that approval consumes it; unrelated
interfaces are omitted rather than globally ignored. Thus a selected sign,
timing, lifecycle, resource, or failure-semantics change invalidates approval
even when its ROS topic/type or controller/action surface is unchanged.

Lower-level ros2_control and hardware_interface behavior follows the same
provenance rule. A runtime/API/configuration change is execution-relevant unless
the integration explicitly qualifies a compatibility envelope and normalizes
the observed runtime to that stable envelope identity. Merely retaining the
same public interface is not evidence of compatibility.

The version 2 digest excludes the observation timestamp, ROS/RMW environment
observations, incidental discovery and diagnostic values, and display/UI
metadata. These fields describe when and where the configuration was observed;
they do not silently redefine execution semantics. There are no configurable
ignore paths: every field is assigned to the schema's semantic or observational
side explicitly.

For physical execution, adapters should select the base robot description,
actuator/sensor configuration, controller interfaces, command semantics, and
execution-relevant runtime/software/configuration sources. Simulator worlds,
visual assets, incidental plugins, and unrelated environment noise stay outside
the digest by default. A simulator-specific source is included only when it
actually defines a selected execution semantic.

The existing configuration gate remains the only authorization path:
approved digest, observed digest, evaluate, execute-time refresh, then dispatch.
A changed semantic or provenance digest produces `configuration_mismatch` and
cannot reach the dispatcher. Evidence records the expected and observed digest
plus their configuration schema versions, not source contents or filesystem
paths.

Generic ROS discovery continues to emit a version 1 observational candidate. It
cannot authenticate a controller package, calibration source, generator, or
source file and therefore must not fabricate version 2 provenance. Such facts
must come from an explicit trusted setup or adapter input. DDS participants,
transport enumerations, namespaces, container IDs, and simulator-specific
deployment values are not durable physical identity without a stable,
authenticated mapping.

## Runtime attestation boundary

An ExecSpec may require a deterministic set of runtime capabilities. A trusted
adapter or external monitor supplies a versioned `RuntimeAttestation` containing
its source identity, observation time, continuity token, and currently available
capabilities. Core compares required and available capability strings as sets;
it does not interpret natural language or infer physical safety from raw sensor
data.

Configuration provenance answers which stable inputs and semantic contracts
define the approved execution setup. Runtime attestation remains separate and
answers whether required runtime facts and capabilities are valid now. Neither
mechanism substitutes for the other.

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
contracts, resolves the active release, invokes Core, and records dispatch
evidence.

`experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py` is an untrusted
transport process. It subscribes to proposal and `JointState` topics and uses
`FollowJointTrajectory` for goals. JSONL IPC is the only
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

Evidence distinguishes `not_sent` from `attempted_unconfirmed`. A queued
pre-dispatch rejection is `not_sent`; controller goal acceptance begins the
execution-side boundary and remains `attempted_unconfirmed` unless a terminal
result is recorded. Revocation prevents a later dispatch but sends no cancel,
stop, hold, zero, or retry command. Controlled or safety-rated stopping of an
already executing trajectory is outside RLSOK. Entries are canonicalized,
SHA-256 hash-chained, and verified against the bundle release identity.

## Security limits

The gateway rejects malformed or oversized proposals, unknown proposer/device
bindings, duplicate proposal IDs, stale state, contract mismatches, changed
release content, invalid permits, and revoked releases. Host compromise,
controller firmware, sensing errors, clock failure, DDS behavior, and physical
hazards remain outside the software guarantee.

Runtime attestation does not replace functional safety, collision detection,
emergency stopping, an E-stop, a safety PLC, or certified controller behavior.
Those protections remain independent of RLSOK authorization.
