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

## Degradation and GOLEM capability references

`capabilities.ts` maps an external degradation classifier to available
capabilities. A cleared fault with capability still false remains blocked; a
fresh new continuity observation with restored capability may pass. RLSOK does
not classify or manage faults.

The GOLEM reference consumes only an external `upperBodyMotionReady` verdict
and maps it to `upper_body.motion_ready`. It does not infer collision, contact,
caught state or motor safety. A GOLEM owner/simulator must exercise the fixture
before any support statement is made.

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
