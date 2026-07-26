# RLSOK

Release control for executable robot policies.

**Only RLSOK releases reach the robot.**

RLSOK is the next product phase of RealityWarden ReleaseGate. RLSOK binds model
artifacts, action contracts, robot and controller profiles, runtime policies,
approval identities, and test evidence into one executable release. Modified,
expired, revoked, unapproved, or incorrectly bound releases are blocked before
they reach the designated robot controller.

RLSOK means **Release OK**: an admission result for a particular executable
release and target. It is not a functional-safety certification, an E-Stop, a
safety PLC, a certified robot controller, or a guarantee that robot motion is
safe. It does not train models, plan motion, perceive the environment, provide
hard real-time control, or claim to prevent every accident.

## What is implemented

| Capability | Status |
| --- | --- |
| Headless ReleaseGate Core | Implemented |
| Strict ExecSpec, ActionContract and RobotProfile schemas | Implemented |
| Release approval, expiry, revocation and binding checks | Implemented |
| Fail-closed Execution Gate and single-use action-bound permits | Implemented |
| Shadow Mode | Implemented |
| Canonical hashing and tamper-evident Evidence chains | Implemented |
| ROS 2 gateway interface contract | Implemented |
| Live ROS 2 / DDS / SROS 2 network integration | Not implemented |
| Functional-safety rating or production certification | No |

The ROS 2 package is an interface boundary with in-memory reference adapters.
It does not establish a live DDS graph or provide SROS 2 deployment.

## Quick start

Requirements: Node.js 22.12 or newer and npm 10.5.1 or newer.

```bash
npm install
npm run rlsok -- build --model model.json --action-contract action.json \
  --robot-profile robot.json --runtime-policy policy.json \
  --evidence evidence.json --out release.json
npm run rlsok -- check release.json
npm run rlsok -- diff previous-release.json release.json
npm run rlsok -- verify-evidence evidence-bundle.json
```

The compatibility command `rw` invokes the same CLI implementation:

```bash
npm run rw -- check release.json
```

For an installed binary, the intended spelling is `rlsok build`, `rlsok check`,
`rlsok diff`, and `rlsok verify-evidence`.

Run the headless core checks with:

```bash
npm run build
npm run test:releasegate
```

Inspect the headless daemon composition boundary with:

```bash
npm run daemon
```

The repository supplies the UI-free `ReleaseGateDaemon` composition root, but
does not ship a preconfigured network transport or robot adapter. A deployment
must embed it with an explicit Execution Gate, adapter, and supervised transport.

## Execution model

```text
Policy / VLA / Agent
        ↓
Action Proposal
        ↓
Release Resolver
        ↓
Execution Gate
        ↓
Adapter
        ↓
Robot Controller
```

```text
Model + ActionContract + RobotProfile + RuntimePolicy + Evidence
                              ↓
                           ExecSpec
                              ↓
                      Release Approval
```

Proposal sources are untrusted and have no execution authority. This includes
models, agents, network messages, and the retained natural-language compiler
example. An allowed action must still match its approved release, action hash,
fresh robot state, runtime policy, and one-time permit.

## Optional development tools and compatibility

The existing Next.js/Electron desktop is retained as an **optional development
and visualization tool**, not the default RLSOK product:

```bash
npm run lab
npm run lab:build
```

The ESP32 rig is a reference execution adapter used to exercise fail-closed
hardware invariants. It is not the primary product target.

Marketplace and Manual Import are not RLSOK product features. Their public UI
has been removed; limited internal code remains only where stable project-file,
release-tooling, or diagnostic compatibility still depends on it.

Historical identifiers remain intentionally compatible:

- `RealityWarden` in already published formats and records
- the `rw` command
- `realitywarden.io` schema API versions
- existing evidence/release IDs, package names, and import paths

## Security boundary

The trusted boundary is the strict schema, release state machine, resolver,
Execution Gate, opaque permit registry, and evidence verifier. Missing, stale,
future, invalid, or mismatched state fails closed. Out-of-bounds actions are
rejected rather than clamped. A blocked decision cannot dispatch an adapter
call, and evidence records whether a hardware signal was actually sent.

See [product positioning](./docs/PRODUCT_POSITIONING.md),
[security boundary](./docs/SECURITY_BOUNDARY.md), and
[contributing](./CONTRIBUTING.md).

## Validation

```bash
npm run typecheck
npm run build
npm run test:releasegate
npm run verify
```

RLSOK by RealityWarden.
