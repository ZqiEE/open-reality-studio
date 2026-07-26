# RLSOK

RLSOK ReleaseGate validates an executable robot-policy release, binds approval
to its exact content, issues a short-lived single-use execution permit, gates
ROS 2 dispatch, and writes verifiable evidence.

## Boundary

RLSOK is not functional-safety software, a motion planner, an E-stop, a safety
PLC, a certified controller, or a hard real-time system. Independent safety
systems and controller limits remain required. Shadow is the default mode.

## Install

Requires Node.js 22.12 or later, npm 10.5 or later, and Python 3 for the ROS 2
sidecar.

```bash
npm install
npm run build
npm test
```

## ExecSpec

The complete runnable example is
[`examples/ros2-reference/release.shadow.yaml`](examples/ros2-reference/release.shadow.yaml).

```yaml
apiVersion: realitywarden.io/v1alpha1
kind: ExecutablePolicy
metadata:
  releaseId: ros2-shadow-demo-001
deployment:
  allowedDeviceIds: [arm-01]
  mode: shadow
```

The published schema identifier is retained so current ExecSpecs and evidence
remain verifiable.

## Check

```bash
npm run rlsok -- check examples/ros2-reference/release.shadow.yaml
```

## Shadow Mode

```bash
npm run rlsok -- ros2 shadow \
  --release examples/ros2-reference/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/shadow.json
```

Shadow evaluates proposals and writes evidence but never sends a controller
goal.

## Evidence verification

```bash
npm run rlsok -- verify-evidence examples/ros2-reference/evidence.json
```

## ROS 2 validation boundary

Automated tests cover Core invariants, ROS message/action contracts, process
boundaries, fail-closed behavior, Shadow zero-dispatch, revocation refresh,
cancellation, timeout and rejection evidence. Live DDS, SROS2, controller and
physical-robot validation require an appropriate ROS 2 environment and are not
claimed unless actually completed.

See [architecture](docs/ARCHITECTURE.md) and
[ROS 2 setup](docs/ROS2_REFERENCE_SETUP.md).

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
