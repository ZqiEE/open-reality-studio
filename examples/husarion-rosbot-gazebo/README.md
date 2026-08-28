# Husarion ROSbot Gazebo reference integration for RLSOK execution authorization

This example demonstrates:

`learned-policy proposal -> RLSOK authorization -> ROS 2 velocity command publish`

Deployment or simulation availability does not itself authorize a velocity
command. Shadow evaluates the same Core release, configuration, state, action,
and optional RuntimeAttestation checks as Run, but publishes no ROS command of
any value—not even a zero-valued stop command.

This is a Gazebo reference integration. It is not certified Husarion support,
functional safety, collision prevention, emergency stopping, or physical-robot
validation. RLSOK does not replace Husarion's mux/controller behavior, robot
safety mechanisms, or operator responsibility.

## Pinned upstream contract

The example is based on the official
[`husarion/rosbot_ros`](https://github.com/husarion/rosbot_ros) `jazzy` branch at
commit [`7c7bfa449011905be63442b6c0ca98b35131cabc`](https://github.com/husarion/rosbot_ros/tree/7c7bfa449011905be63442b6c0ca98b35131cabc).

At that commit:

- the differential `robot_model:=rosbot` public command input is relative topic
  `cmd_vel` with `geometry_msgs/msg/TwistStamped`;
- the example uses only `linear.x` (m/s) and `angular.z` (rad/s);
- `twist_mux_controller` assigns `cmd_vel` to its `unknown` input at priority 1;
- the mux, not RLSOK, arbitrates this input against `autonomous/cmd_vel`
  (priority 10) and `manual/cmd_vel` (priority 100), then writes the selected
  command to the drive controller's ros2_control reference interfaces;
- filtered state is available as `odometry/filtered` with
  `nav_msgs/msg/Odometry`.

The exact controller file is
[`rosbot_controller/config/rosbot/controllers.yaml`](https://github.com/husarion/rosbot_ros/blob/7c7bfa449011905be63442b6c0ca98b35131cabc/rosbot_controller/config/rosbot/controllers.yaml).
Its pinned SHA-256, computed from the repository's LF Git blob and verified
against the Linux workspace file, is
`207508c19de20bcfec44aefc6f09ed833cc6a33b63c78aade427817928302aba`.

The RLSOK-owned boundary is therefore:

```text
RLSOK permit -> publish namespaced cmd_vel (TwistStamped)
             -> Husarion twist_mux_controller
             -> differential drive controller reference interfaces
             -> Gazebo simulated drive
```

RLSOK never publishes to wheel, firmware, motor, or drive-controller-private
interfaces; changes controller-manager state; or alters mux priorities.

## 1. Start the official Gazebo simulation

Prepare the official Jazzy workspace using Husarion's pinned source and its
documented `vcs import`, `rosdep`, and `colcon build` steps. Then:

```bash
cd ~/rosbot_ws
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 launch rosbot_gazebo simulation.yaml robot_model:=rosbot rviz:=False
```

For a namespaced simulation, add `namespace:=robot1` and pass
`--namespace robot1` to the RLSOK command below. The adapter always resolves the
logical boundary to `/<namespace>/cmd_vel`; arbitrary topic overrides are not
accepted.

## 2. Start the RLSOK reference integration in Shadow

From this RLSOK repository after `npm ci`:

```bash
source /opt/ros/jazzy/setup.bash
npm run demo:husarion-rosbot-gazebo -- \
  --mode shadow \
  --release examples/husarion-rosbot-gazebo/release.shadow.json \
  --controller-config "$HOME/rosbot_ws/src/rosbot_ros/rosbot_controller/config/rosbot/controllers.yaml" \
  --device-identity rosbot-gazebo-01 \
  --robot-identity husarion-rosbot-gazebo \
  --proposal examples/husarion-rosbot-gazebo/proposal.json \
  --evidence examples/husarion-rosbot-gazebo/evidence.shadow.json \
  --proposer-identity learned-policy@example.test \
  --use-sim-time true \
  --namespace ''
```

The operator-supplied controller path is the explicit trusted observation
boundary. For every prepare and execute observation, the integration re-reads
that current workspace file, computes its SHA-256, and builds the complete v2
identity from fixed adapter semantics plus the separately supplied device and
robot identities. The observation time records that verification; a checked-in
or stale observation is never made fresh by the consumer. The approved release
is not an input to observation, and generic ROS discovery is not treated as
provenance authentication. Missing or unreadable input, a stale observation,
or any digest/identity mismatch fails closed.

`execution-configuration.v2.json` records the pinned approval input for review;
it is not consumed as a current runtime observation.

Expected result fields include:

```json
{
  "mode": "shadow",
  "decision": "allowed",
  "hardwareSignalSent": false,
  "publicationCount": 0
}
```

The command waits for a valid `odometry/filtered` observation and fails closed
if it is absent, malformed, older than 500 ms, or future-dated.

## 3. Submit the reference proposal

The command above submits `proposal.json` as a one-command learned-policy
proposal. It contains the deterministic action identity: representation,
message type, logical target, frame, supported fields, and units. Unknown,
malformed, or non-finite fields are rejected.

There is deliberately no continuous command stream. One authorized Run
proposal causes one publish attempt. Shadow causes none.

## 4. Observe and verify Evidence

```bash
npm run rlsok -- verify-evidence \
  examples/husarion-rosbot-gazebo/evidence.shadow.json \
  --release examples/husarion-rosbot-gazebo/release.shadow.json
```

This verifies internal chain consistency and binds the bundle to the supplied
release identity; authenticity still requires a trusted Cloud checkpoint or
equivalent provenance record. Evidence binds the release and action identities, expected/observed
configuration digest and schema version, decision/reason, state observation,
and publication attempt state. For Shadow it records
`hardwareSignalSent=false`, `hardwareSignalState=not_sent`, and
`executionEvidence=shadow_not_dispatched`.

With all other command publishers quiet, this optional observation should time
out without receiving a message during the Shadow command:

```bash
timeout 5 ros2 topic echo /cmd_vel geometry_msgs/msg/TwistStamped
test "$?" -eq 124
```

The deterministic CI proof is stronger and publisher-specific: the fake
transport counts RLSOK publication attempts and requires exactly zero for every
Shadow path.

## 5. Run mode (Gazebo only)

Run mode uses a separately bound released fixture and proposal:

```bash
source /opt/ros/jazzy/setup.bash
npm run demo:husarion-rosbot-gazebo -- \
  --mode run \
  --release examples/husarion-rosbot-gazebo/release.run.json \
  --controller-config "$HOME/rosbot_ws/src/rosbot_ros/rosbot_controller/config/rosbot/controllers.yaml" \
  --device-identity rosbot-gazebo-01 \
  --robot-identity husarion-rosbot-gazebo \
  --proposal examples/husarion-rosbot-gazebo/proposal.run.json \
  --evidence examples/husarion-rosbot-gazebo/evidence.run.json \
  --proposer-identity learned-policy@example.test \
  --use-sim-time true \
  --namespace ''
```

An allowed proposal consumes its opaque single-use Core permit and publishes
exactly one `TwistStamped` to `cmd_vel`. Release revocation/ineligibility,
configuration drift or refresh failure, missing/stale/future odometry, action
contract failure, and permit reuse all block before another publication.

That replay registry and Permit are single-use only within one live TypeScript
gateway process. They are not persisted across a crash or restart. This Gazebo
example therefore does not prove durable exactly-once dispatch, crash recovery,
or restart-safe replay rejection. Do not use it for those claims and do not
silently retry an unknown publication outcome.

Do not run this reference command against a physical ROSbot. Physical ROSbot
validation was not performed and is outside this example's evidence boundary.

## Automated validation

```bash
npm run test:husarion-rosbot
```

The normal RLSOK verification matrix includes this suite without downloading or
building Husarion or Gazebo. A separate, path-scoped GitHub Actions workflow,
`Husarion ROSbot Gazebo acceptance`, imports and builds the pinned official
workspace, launches its headless Gazebo simulation, and runs the live Shadow,
Run, and configuration-mismatch acceptance cases. The workflow uploads its ROS
graph, controller state, command/odometry observations, logs, and Evidence on
both success and failure.

The acceptance runner creates a new private proof directory per run, keeps its
independent command observer alive through each command plus a settle interval,
records resolved namespaced topics and environment/source identities, cleans up
every background process, and writes a machine-readable manifest with
`SHA256SUMS`.

Out of scope: Nav2, Open-RMF, joystick/mux priority changes, new velocity
limits, collision or obstacle semantics, E-stop behavior, Webots, physical
ROSbot claims, Hosted Cloud changes, RuntimeAttestation redesign, configuration
schema changes, and generic topic interception.
