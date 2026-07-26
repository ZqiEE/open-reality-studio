# RLSOK phase 3 report

Date: 2026-07-26

Branch: `refactor/rlsok-product-cleanup`
Validated commit before this report: `a1bcf8594b2fc7ef0b931b528e9708b3e8a9b637`

## Outcome

Phase 1–2 history is recoverable and split into reviewable commits. Phase 3
adds one experimental ROS 2 implementation: an untrusted Python/rclpy
transport sidecar behind the TypeScript ReleaseGate Core. Shadow is the
default. Restricted Run requires a canary/released ExecSpec plus an exact
`--allow-reference-run <release-id>` confirmation.

This is a reference gateway, not production integration, functional safety,
hard realtime, an E-Stop, a protective stop, or a certified controller.

## Recovery and preservation

Before consolidation, the dirty tree was captured under the locally excluded
`.recovery/rlsok-phase-1-2/`:

- complete verified Git bundle;
- tracked text and binary patches;
- status, name, stat, submodule, branch, and untracked manifests;
- 51/51 untracked files in `untracked-files.zip`;
- ZIP SHA-256:
  `451E1C9A7BBCBF0D7C04589D6793867A2D22923E6BC7777BBCA328148AE6BB3A`.

The `.tar` attempt in that directory is incomplete and must not be used.
`.fuse_hidden*` files were never deleted, moved, staged, or modified. No
repository-wide reset, clean, restore, or checkout operation was used.

The phase 1–2 attribution is recorded in
`docs/refactor/2026-07-26-working-tree-attribution.md`.

## Commit history

Phase 1–2:

1. `8fac701` docs: define releasegate product boundary
2. `dc51919` feat: add executable policy specification
3. `1e343a8` feat: add release lifecycle and revocation
4. `c4aecaa` refactor: extract execution gate and permit boundary
5. `a10dbdc` feat: add tamper-evident execution evidence
6. `a344d56` feat: add releasegate cli daemon and gateway contracts
7. `271bc96` test: enforce releasegate and rlsok boundaries
8. `ad9c1a9` chore: preserve and classify existing working tree changes
9. `442207d` docs: rebrand product as RLSOK ReleaseGate
10. `fe357fa` chore: remove obsolete product surfaces
11. `ec0a883` refactor: isolate optional lab and legacy integrations
12. `e81a640` refactor: make RLSOK core the default product entrypoint

Phase 3:

1. `803eae3` feat: add experimental ROS 2 reference gateway
2. `580c7e7` test: exercise ROS 2 shadow and reference execution
3. `a7f495f` docs: add ROS 2 design partner reference pack
4. `058447b` fix: recheck revocation at ROS 2 dispatch
5. `a1bcf85` test: update ROS 2 release status assertion

## Architecture and safety properties

- Python owns ROS transport only: proposal/JointState subscriptions,
  `control_msgs/action/FollowJointTrajectory`, cancel, doctor, and inspect.
- TypeScript owns strict schema parsing, exact release/device/proposer
  resolution, policy, state freshness, permits, dispatch eligibility,
  revocation, and chained evidence.
- Permits are private, short-lived, single-use, and bound to action hash,
  release, device, and controller identity.
- The release record is refreshed immediately before dispatch; revocation or a
  refresh failure consumes the permit and blocks.
- Shadow has no dispatcher and records zero controller goals.
- Run records attempted/unconfirmed dispatch honestly. Controller acceptance
  is not proof of physical motion.
- Run checks SROS2 `Enforce` and controller availability before registering
  the proposal handler.
- Active reference goals receive a cancellation request after revocation.
  Cancellation evidence is not proof that motion stopped.
- Proposal payloads are strict, size-bounded, identity-bound, duplicate
  rejected, dimension/order/unit checked, and require fresh JointState.

## CLI and automation

Implemented:

- `rlsok ros2 shadow` (also the default `rlsok ros2` operation);
- `rlsok ros2 run`;
- `rlsok ros2 inspect`;
- `rlsok ros2 doctor`;
- `test:ros2-contract`;
- `test:ros2-shadow`;
- `test:ros2-run`;
- `test:ros2-revocation`;
- `test:ros2-evidence`;
- `test:ros2-no-bypass`;
- default/core and manual full GitHub Actions workflows;
- optional ROS 2 Jazzy environment workflow.

## Validation

Passed:

- `npm run typecheck`;
- `npm run build`;
- `npm run test:releasegate` — 11 categories;
- `npm run test:ros2-reference` — 6 categories;
- demo ExecSpec via `rlsok check` — `PASS`;
- `npm run verify` — complete historical matrix, exit 0, including:
  - conformance, desktop, support, accessibility, assets, release and launch
    closure;
  - protocol, SDK/ecosystem, governance, onboarding, runtime/compiler,
    autonomy, assets, Marketplace, reporting and receipts;
  - real hardware safety invariants — 49 tests;
  - reference-servo suites and virtual loopback;
  - LLM compiler, Action Manifest and manual import suites.

The first full run exposed two obsolete “ROS 2 not implemented” assertions.
The committed release assertion was updated. The conformance assertion lives
inside a pre-existing shared dirty file and was minimally updated in the
working tree so the complete matrix could run, but the file was deliberately
not staged wholesale.

## Environment limitation

The phase 3 Windows host has no `ros2` executable and no `rclpy`; ROS
environment variables were unset. `rlsok ros2 doctor` correctly reports:

- `rosAvailable: false`;
- `jointStateFresh: false`;
- `actionServerAvailable: false`;
- `detail: No module named 'rclpy'`;
- a non-zero diagnostic exit.

Therefore live DDS discovery, RMW behavior, SROS2 enforcement, action-server
interoperability, timing, physical actuation, and physical cancellation were
not validated or claimed. The Jazzy CI environment checks imports and an
honest empty-graph report. The design-partner guide is the required path for
live Shadow, constrained canary, SROS2, and physical cancellation evidence.

## Preserved working tree

Pre-existing UI/Electron/shared changes and `.fuse_hidden*` remain outside the
phase commits. No staged changes remain after this report commit. Review
`git status --short` and the attribution report before any later staging.
