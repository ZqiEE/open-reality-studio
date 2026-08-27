# Feedback adapter reference contracts

These are runnable normalization references, not new supported robots. Core
continues to consume only selected configuration identity and normalized
`RuntimeAttestation` capability/freshness/continuity facts.

## Signed edge authorization

`packages/edge-authorization/snapshot.ts` defines a Cloud/approval-side Ed25519
snapshot bounded to release content, action, configuration, device, controller,
time and revocation epoch. Refresh happens outside the hardware-write path. The
robot-side final boundary performs local verification immediately before one
dispatch, consumes the boundary once, and has no Cloud/network dependency,
retry, stop or zero-command fallback. Its Evidence fields identify schema,
snapshot, signing key, revocation epoch and signed-object digest.

## DDS command-path trust

`packages/adapter-references/command-path.ts` normalizes one command-critical
path. `ready` and authenticated trust are separate. The Fast DDS reference only
emits a trusted capability when a DDS Security-aware local monitor reports a
matched writer/reader, authenticated participant, enforced governance and
validated permissions. A ROS name or GUID alone remains `unknown`. Unrelated
participants are deliberately outside this scoped input and cannot globally
deny execution. The executable fixture is not a claim that arbitrary RMW APIs
expose portable rejection reasons; CycloneDDS extraction remains an external
adapter gate under the same contract.

The diagnostic state preserves three cases: `authenticated`, `unknown`, and
`untrusted`. A monitor may report `untrusted` only for an explicit rejection of
the configured command path. Missing or insufficient proof remains `unknown`.
Both non-authenticated states emit no trusted capability and therefore fail
closed. Participant authentication alone is insufficient: governance and
permissions for the configured path must also be proven.

## Selected observed-state epoch

`selectedObservedStateRuntimeAttestation` is the generic last-mile reference
for a command that depends on an execution-relevant state transition. The
integration explicitly names one selected state contract and capability. Its
adapter owns an opaque `stateEpoch`, changes it on a relevant transition, and
keeps it stable across unrelated sensor or environment noise. `ready` emits the
selected capability; `not_ready`, `unknown`, missing, or stale input emits no
trusted capability or otherwise fails closed.

No additional Permit or Core schema field is required. The existing Permit is
already exact-action, release, device, controller, configuration and
short-TTL/single-use bound. When a selected capability is required,
`RuntimeAttestation` is refreshed immediately before dispatch. The issuance
attestation digest protects the queued request from mutation; source identity
and version protect the selected monitor contract; and the continuity token
binds the selected state epoch. A changed epoch records
`runtime_continuity_changed`, while missing, stale, or unknown observations
record `runtime_attestation_missing`, `runtime_attestation_stale`, or
`runtime_capability_missing`, all with `hardwareSignalSent: false`. A newer
timestamp or a change to an unrequired capability is not a global invalidator.

This contract must not contain raw sensor streams or whole-world state. It
does not add stop, hold, zero, retry, or safety behavior after a controller has
accepted execution.

## Degradation and GOLEM capability references

`capabilities.ts` maps an external degradation classifier to available
capabilities. A cleared fault with capability still false remains blocked; a
fresh new continuity observation with restored capability may pass. RLSOK does
not classify or manage faults.

The GOLEM reference expects exactly a schema-v1 report containing
`sourceIdentity`, `observedAt`, `continuityToken`, `monitorVersion`, and the
external boolean verdict `upperBodyMotionReady`. It maps only a fresh `true`
verdict to `upper_body.motion_ready`. This means only that the selected external
monitor says the upper-body motion capability needed by the next command is
available. It does not mean that RLSOK detected collision, contact, caught
state, motor safety, or a safety-rated condition.

Review examples:

- ALLOW eligibility: the ExecSpec explicitly requires
  `upper_body.motion_ready`; the report is present, fresh and continuous; the
  monitor identity/version match; and `upperBodyMotionReady` is `true`.
- BLOCK: the verdict is `false`, missing, stale, malformed/unknown, produced by
  a replacement monitor, or has changed continuity. The exact Core diagnostic
  is recorded in Evidence and `hardwareSignalSent` remains `false`.
- Shadow uses the same eligibility facts but never dispatches, including when
  every fact would otherwise allow Run.

RLSOK never infers contact and never sends a cancellation, controlled stop,
hold, zero command, or retry for an executing H12 trajectory. A GOLEM
owner/simulator must exercise the fixture before any support statement is
made. The questions reserved for Max/CorrellLab are: (1) is this exact monitor
report the correct owner boundary, (2) does `upper_body.motion_ready` accurately
name the capability needed before a new H12 command, (3) which transitions must
rotate continuity, and (4) which concrete Shadow fixtures represent ready,
not-ready, missing, stale, and monitor-replacement cases?

## Inference provenance and selected integration identities

`inference-provenance.ts` collects only declared Python, PyTorch, NumPy, custom
package and optionally CUDA identities. Missing or changed required versions
fail; unrelated environment packages are ignored. It never runs `pip freeze`
or hashes an entire environment.

`examples/adapter-references/selected-identity-references.json` gives executable
schemas for Clearpath generator inputs, CANopen command-path state, Nav2
velocity-smoother limits, Elite model identity, CRANE-X7 selected limits and
device serial/calibration binding. Every fixture declares volatile exclusions,
fail-closed mismatch behavior and the real external test still required. These
contracts close the design ambiguity without fabricating vendor support.

The same file includes two generic, non-vendor contracts. The physical
execution identity selects only the base robot description, actuator/sensor
configuration, controller interfaces, command semantics, and execution-relevant
runtime/software/configuration sources on which the approval depends. An
interface semantic source is scoped by its `sourceIdentity`; for example, an
IMU sign/timing contract is included only when that approval consumes the IMU.
Changing a selected semantic source changes the v2 configuration digest, while
an unselected interface, simulator world, visual asset, incidental plugin, or
unrelated environment observation does not enter physical identity by default.

The ros2_control runtime contract applies the same rule below an unchanged
topic/action interface. Lifecycle, resource, timing, and failure semantics are
selected execution provenance and a change invalidates approval. An adapter may
instead emit a stable compatibility-envelope source only when the integration
explicitly defines and qualifies that envelope; version similarity or an
unchanged public interface is not enough. This is adapter normalization into
existing v2 provenance, not a new Core subsystem.
