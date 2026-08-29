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

The CRANE-X7 fixture makes four source roles explicit without blindly hashing
them together. Selected URDF hardware limits and selected ros2_control
hardware-drive limits/configuration are static approval provenance. MoveIt
planning constraints are selected only when the approved command or trajectory
semantics depend on planner output; an unrelated MoveIt change is otherwise
excluded. Live encoder/controller posture remains fresh runtime state, or an
explicitly selected observed-state continuity input, and is never frozen into
static approval identity. Missing, stale, or unknown selected live posture
fails closed. This is a generic reference contract, not CRANE-X7 integration or
support.

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

## Nav2 Jazzy execution-boundary reference

Runtime v1.4.5 does not implement a Nav2 adapter or dispatch
`nav2_msgs/action/FollowPath`. Its executable ROS 2 reference accepts only
`control_msgs/action/FollowJointTrajectory`, and the Husarion reference
explicitly excludes Nav2. The `nav2-velocity-smoother` entry is therefore a
future adapter contract, not a supported integration or a claim that the current
Runtime observes Nav2. No current v1.4.5 Run request can supply a Nav2 controller
selector through the strict trajectory proposal schema.

The version-specific review used the upstream Navigation2 `jazzy` branch at
commit `f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501`. An adapter for a different
Nav2 version must inspect that version's definitions rather than projecting the
Jazzy fields onto it.

| Jazzy input                                                            | Classification                                                                      | Authorization reason                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feedback` (`OPEN_LOOP` / `CLOSED_LOOP`)                               | stable execution-critical approved input                                            | It selects whether constraint deltas start from the last smoothed command or odometry. `OPEN_LOOP` is command-space smoothing and is not evidence of the robot's measured physical state.         |
| `scale_velocities`                                                     | stable execution-critical approved input                                            | It changes whether all velocity axes are scaled together when one axis reaches an acceleration/deceleration constraint.                                                                           |
| `smoothing_frequency`                                                  | stable execution-critical approved input                                            | It changes the interval over which acceleration/deceleration constraints are applied and therefore changes emitted command behavior with identical numeric limits.                                |
| `max_velocity`, `min_velocity`, `max_accel`, `max_decel`               | stable execution-critical approved input                                            | These are the selected numeric command-space constraints.                                                                                                                                         |
| `deadband_velocity`                                                    | stable execution-critical approved input                                            | It changes which otherwise valid outputs are replaced with zero.                                                                                                                                  |
| `velocity_timeout`                                                     | stable execution-critical approved input                                            | It changes when missing input causes the smoother to publish a decelerating zero command and then stop publishing.                                                                                |
| `odom_topic`, `odom_duration`, selected odometry frame/source identity | stable execution-critical approved input only in `CLOSED_LOOP`                      | They select and smooth the observation used as current velocity. In `OPEN_LOOP` they are not consumed by the smoothing decision and are non-authorizing configuration.                            |
| current odometry/velocity sample                                       | volatile observed input                                                             | Its value changes continuously and must not be frozen into approval identity. A trusted adapter may require freshness and continuity without hashing the sample value into static approval.       |
| `stamp_smoothed_velocity_with_smoothing_time`                          | Jazzy-specific stable input when downstream command semantics consume the timestamp | It changes the timestamp placed on emitted commands. If the selected consumer ignores timestamps, the adapter may explicitly classify it as irrelevant instead of silently omitting the decision. |
| `use_realtime_priority`                                                | irrelevant/non-authorizing for this reference                                       | It changes scheduling priority, not the selected mathematical command mapping. RLSOK is not a real-time or functional-safety monitor.                                                             |
| unrelated parameters and graph participants                            | irrelevant/non-authorizing configuration                                            | They do not enter the selected command path or command semantics and must not cause global invalidation.                                                                                          |

`nav2.command_path.ready` may be emitted only when an integration-owned observer
proves the resolved command path, not merely that a smoother node is alive or
configured. The minimum proof is the controller output feeding the approved
velocity-smoother input, the approved smoother output feeding each selected
execution-critical gate, and the final output reaching the selected base command
consumer. If `nav2_collision_monitor` is selected in that path, its identity,
selected command-semantic configuration, and placement are stable approved
inputs; it is not mandatory when absent. Raw collision observations remain
volatile. Unknown or bypassed topology emits no ready capability and blocks
before hardware dispatch.

Jazzy's `FollowPath` goal exposes `controller_id`, `goal_checker_id`, and
`progress_checker_id`; it does not expose `path_handler_id`. Allowed plugin
implementation/version/configuration identities are approval-time facts. The
exact resolved selector for the current goal is a pre-dispatch fact and must be
inside the immutable action authorized and handed to the transport. Empty
selectors must be resolved to the actual single/default plugin before the final
check. Recording a selector after dispatch, approving only the loaded plugin
set, or reading a mutable caller-owned goal and then dispatching it is
insufficient.

A future adapter must negatively test same-limit changes to feedback, frequency,
scaling, deadband and timeout; CLOSED_LOOP odometry source changes; smoother or
optional-gate bypass; and substitution of each version-exposed goal selector.
Every denial must record expected and observed facts with hardware dispatch
`NO`. Positive controls must show that an approved selector passes, a volatile
odometry sample change alone does not invalidate static approval, and Shadow
remains zero-dispatch. Until that adapter and simulated graph exist, these tests
remain an external implementation gate rather than v1.4.5 test claims.

## Execution-critical launch and hardware binding

Selected ROS 2 launch semantics can belong to the approved setup when they
choose an execution-critical path, such as mock or simulated components versus
real hardware. The adapter should bind the smallest stable inputs that determine
that choice. It must not mirror the complete Python launch program or all
runtime configuration into RLSOK, because doing so creates noisy invalidation
and a second source that must be maintained in parallel with the ROS stack.

For a mobile base, a useful minimum execution-binding boundary can select the
`ros2_control` hardware component, drive controller, and wheel mapping that
jointly determine how commands reach the motors. These are integration-owned
configuration identities represented through existing v2 provenance. Sensor
bringup, unrelated launch arguments, and live robot state are not included by
default. This records CRANE+ and Lidarbot architecture feedback; it is not a
CRANE+ or Lidarbot integration, validation, endorsement, or new Core feature.
