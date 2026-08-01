# Product quickstart

RLSOK currently supports Node.js 22.12 or later for the ReleaseGate and tests a
real DDS reference path with ROS 2 Jazzy on Ubuntu 24.04 in CI. The ROS 2 path
uses a simulated `FollowJointTrajectory` action server; acceptance by that fake
controller is not physical motion.

RLSOK determines whether a specific release is eligible for the configured controller path.

RLSOK does not determine whether the resulting physical motion is safe.

Independent E-stops, safety PLCs, certified controllers, motion limits,
mechanical safeguards, site procedures, and hazard analysis remain required.

## Standalone Shadow

Prerequisites: Node.js 22.12+, npm 10.5+, and a clean checkout or installed
RLSOK tarball.

```bash
npm ci
npm run build
node dist/apps/cli/rlsok.js shadow \
  examples/ros2-reference/release.shadow.yaml \
  examples/standalone-shadow/proposal.json \
  evidence/standalone-shadow.json
node dist/apps/cli/rlsok.js verify-evidence evidence/standalone-shadow.json
```

Expected output reports `controllerGoalsAttempted: 0` and
`hardwareSignalSent: false`. This mode enforces the local exact release,
approval identity, device, action hash, state freshness, runtime policy, and
Shadow no-dispatch boundary. It does not contact the cloud, ROS 2, a simulator,
or a controller. Invalid input exits non-zero. Remove the generated `evidence/`
directory to clean up.

## Cloud-connected Shadow

Prerequisites: sibling clean checkouts of `rlsok` and `rlsok-cloud`, Docker with
Compose, Node.js 22.12+, and a Linux or macOS development host. No Production,
Cloudflare, or physical-robot credential is used.

```bash
cd ../rlsok-cloud
npm run demo:e2e
```

The command creates an isolated PostgreSQL database and loopback-only Fastify
API, creates separate release-manager, approver, runtime, and auditor
credentials, then invokes the cloud-connected product command for Shadow,
simulated Reference Run, and a revocation race. It verifies both Permit
bindings, zero Shadow/race controller goals, one simulated Reference goal,
cloud Evidence, authenticated approval identity, complete chain export, and
backup/restore. It removes all temporary containers, data, credentials, and
files on success or failure.

For manual cloud commands, set configuration outside the command line:

```bash
export RLSOK_EXECUTION_MODE=cloud-connected
export RLSOK_CLOUD_API_URL=https://your-isolated-api.example
export RLSOK_CLOUD_API_KEY_FILE=/secure/path/rlsok-api-key
rlsok cloud get-release fixture-release-001
rlsok ros2 shadow \
  --release release.shadow.yaml \
  --device fixture-arm-01 \
  --proposer runtime-gateway \
  --evidence evidence/cloud-shadow.json
```

Cloud-connected mode never falls back to standalone. API, version, TLS,
timeout, response, approval, revocation, or Permit failures deny the operation.
Export and verify every record offline:

```bash
rlsok cloud evidence export --output evidence/cloud-chain.json
rlsok cloud verify-evidence-chain evidence/cloud-chain.json
```

## Reference Run

Prerequisites: Ubuntu 24.04, ROS 2 Jazzy, `control_msgs`, `sensor_msgs`,
`std_msgs`, `trajectory_msgs`, a fresh `JointState` source, and an explicit
test-only `FollowJointTrajectory` action server. Use a canary release and exact
release confirmation:

```bash
RLSOK_EXECUTION_MODE=cloud-connected rlsok ros2 run \
  --release release.canary.yaml \
  --device fixture-arm-01 \
  --proposer test-proposer \
  --allow-reference-run fixture-canary-001 \
  --evidence evidence/reference-run.json
```

Reference Run enforces local release identity, approval, action/device/controller
binding, fresh state, local Permit expiry/single-use, and a final release-state
refresh. The command itself invokes `CloudConnectedDispatchBoundary`; customers
do not need to assemble a TypeScript integration. It refreshes cloud state and
atomically consumes the cloud Permit immediately before the adapter call. An
unavailable cloud, stale state, changed content, mismatch, revocation, expired
or consumed Permit, unavailable controller, rejection, timeout, or ambiguous
cancellation fails closed and writes Evidence where identity is available.
ROS simulation timestamps are preserved for diagnostics while freshness is
measured at DDS receipt, so Gazebo simulation time does not require a custom
timestamp adapter. DDS discovery remains bounded and configurable; exceeding
the bound fails before Permit consumption or dispatch.

The reference path is experimental, is not hard real-time or safety-rated, and
does not support arbitrary ROS 2 distributions, simulators, controllers,
model formats, operating systems, or robots.
