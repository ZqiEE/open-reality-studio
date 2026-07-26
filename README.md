# RLSOK

RLSOK ReleaseGate is a release-control and execution-gating system for learned robot policies.
It binds an approved model, action contract, robot/controller
identity, runtime policy, deployment scope, and evidence into one ExecSpec.
Only an eligible, unchanged release can obtain a short-lived execution permit.

The supported path is:

```text
ExecSpec → check → release/approval → permit → Execution Gate
         → ROS 2 Reference Gateway → evidence → revoke/inspect
```

Shadow is the default. Reference Run is experimental and requires an exact
release-ID confirmation, SROS2 enforcement, an available controller action
server, fresh JointState, and a canary or released ExecSpec.

## Safety boundary

RLSOK is not functional-safety software, a motion planner, a hard real-time
controller, an E-stop, a safety PLC, or a certified robot controller.
Independent safety systems and controller limits remain mandatory.

Proposal sources and the Python ROS process are untrusted. TypeScript Core owns
release resolution, policy, permits, dispatch eligibility, revocation, and
evidence. Blocked decisions and Shadow observations cannot dispatch.

## Install

Requirements: Node.js 22.12+ and npm 10.5+.

```bash
npm install
npm run build
npm test
```

## ExecSpec

A complete example is
[`examples/ros2-reference/release.shadow.yaml`](examples/ros2-reference/release.shadow.yaml).
Its essential identity is:

```yaml
apiVersion: realitywarden.io/v1alpha1
kind: ExecutablePolicy
metadata:
  releaseId: ros2-shadow-demo-001
actionContract:
  representation: trajectory
deployment:
  allowedDeviceIds: [arm-01]
  mode: shadow
```

The published `realitywarden.io` schema identifier is retained only so existing
ExecSpecs and evidence remain verifiable.

```bash
npm run rlsok -- check examples/ros2-reference/release.shadow.yaml
```

## Shadow quick start

```bash
npm run rlsok -- ros2 shadow \
  --release examples/ros2-reference/release.shadow.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --evidence evidence/shadow.json
```

Shadow records decisions and always reports zero controller goals.

## Reference Run

Reference Run may move a robot. Use an isolated, supervised environment with
independent safety controls:

```bash
export ROS_SECURITY_ENABLE=true
export ROS_SECURITY_STRATEGY=Enforce
npm run rlsok -- ros2 run \
  --release release.canary.yaml \
  --device arm-01 \
  --proposer planner@example.test \
  --allow-reference-run <exact-release-id> \
  --evidence evidence/reference-run.json
```

## Evidence

```bash
npm run rlsok -- verify-evidence evidence/shadow.json
```

Evidence is canonicalized and hash-chained. Signal state distinguishes
not-sent from attempted/unconfirmed dispatch; controller acceptance does not
prove physical motion.

## ROS 2 status and validation

The ROS 2 reference implementation is tested at the contract and process-boundary level.
Live DDS, SROS2, controller and physical-robot validation require an appropriate ROS 2 environment and are not claimed unless actually completed.

Current automated validation covers release identity, approval invalidation,
single-use bound permits, fail-closed decisions, Shadow zero-dispatch,
revocation refresh, cancellation evidence, ROS message/action contracts, and
transport boundaries.

See [architecture](docs/ARCHITECTURE.md), [CLI reference](docs/CLI.md),
[ROS 2 setup](docs/ROS2_REFERENCE_SETUP.md),
[security](docs/SECURITY.md), and the
[design-partner guide](docs/DESIGN_PARTNER_GUIDE.md).
