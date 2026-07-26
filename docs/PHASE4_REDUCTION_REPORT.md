# Phase 4 Repository Reduction Report

## Result

The active branch now presents one supported product: RLSOK ReleaseGate and its
ROS 2 reference integration.

The retained path is:

```text
ExecSpec
-> check
-> release
-> approval
-> short-lived single-use permit
-> Execution Gate
-> ROS 2 Reference Gateway
-> evidence
-> revoke / inspect
```

Shadow is the default operating mode. Reference Run requires explicit release
confirmation and the reference-run allow flag. The repository is not a
functional-safety system, hard real-time controller, E-stop, safety PLC,
certified controller, or motion planner.

## Recovery checkpoint

The cleanup began on commit `2c552ec31f62fb8a2cd7526c10fc2f5df8a73ae0`.
The committed state is retained by branch
`backup/pre-phase4-ruthless-cleanup`.

External recovery artifacts were created in `F:\xy` before destructive work:

| Artifact | SHA-256 |
| --- | --- |
| `rlsok-pre-phase4-working.patch` | `E5B8DC64831866912FCF52812E293E69F39652421FD08C18D9D98FD4A23F9EBE` |
| `rlsok-pre-phase4-staged.patch` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| `rlsok-pre-phase4-untracked.txt` | `10207D62C4A2DD8F514160225234DF1CFF1D994519E94BED16E7D4609F768AD4` |
| `rlsok-pre-phase4.bundle` | `A4EB5E847933C28739052BCD4F12D3B1069A27183E71DA49549791B93DB8BFD5` |
| `rlsok-pre-phase4-untracked.zip` | `ABE328A69DBCDBEC8610AD8FCAEE3E5B31FAE57DD9B6C683F0C03EDED1C29336` |
| `rlsok-pre-phase4-metrics.json` | `A71B5FE9712807912055CA163766FE535373635FAF9AAD1E0B3F46140EAF6F0F` |

The bundle was verified as complete. The empty staged patch has the expected
SHA-256 of an empty file. No recovery artifact is stored inside the repository.

## Retained implementation

- One public CLI, `rlsok`, with one implementation.
- Core ExecSpec, action contract, robot profile, release-policy, permit,
  execution-gate, evidence, and canonical hashing responsibilities.
- TypeScript ROS 2 reference gateway and Python/rclpy sidecar.
- `FollowJointTrajectory`, `JointState`, deny-by-default SROS2 reference policy,
  Shadow Mode, Reference Run, revocation refresh, controller checks,
  cancellation, evidence, doctor, and inspect paths.
- Two focused test suites covering the ReleaseGate and ROS 2 process boundary.
- Current architecture, CLI, security, ROS 2 setup, and design-partner
  documentation.

The active tree contains no desktop or web application, commerce/catalog or
manual-import system, natural-language compiler, embedded-controller product,
experimental Lab, inactive compatibility shell, or duplicate public CLI.

## Commit sequence

```text
e0984c0 chore(cleanup): remove repository garbage and hidden files
89b9b75 refactor(product): remove desktop and legacy UI surfaces
6c96213 refactor(product): remove marketplace and import systems
19cc49d refactor(product): remove lab nlp and embedded experiments
1990272 refactor(cli): remove legacy scripts aliases and adapters
35bd21d docs: remove legacy documentation and define current product
127240f chore(deps): reduce runtime scripts and dependencies
76b7375 test: consolidate retained releasegate coverage
4db78f1 chore(cleanup): remove obsolete generated-file patterns
```

## Reduction

Metrics use tracked files for file, documentation, test, and source counts.
Source lines include TypeScript, JavaScript, CommonJS, ECMAScript module, and
Python files. Repository size excludes `.git` and includes the installed
dependency tree.

| Metric | Before | After |
| --- | ---: | ---: |
| Tracked files | 624 | 38 |
| Source lines | 46,193 | 3,154 |
| Package manifests | 1 | 1 |
| Production dependencies | 11 | 2 |
| Development dependencies | 13 | 3 |
| Root scripts | 115 | 8 |
| Documentation files | 75 | 7 |
| Test files | 44 | 2 |
| Repository size excluding `.git` | 3,560,375,569 bytes | 31,305,465 bytes |
| Legacy-brand matches (`RealityWarden` plus whole-word `rw`) | 680 | 20 |
| `.fuse_hidden*` files | 10 | 0 |

This removes 93.9% of tracked files and 93.2% of counted source lines. Runtime
dependencies fell by 81.8%, development dependencies by 76.9%, and root
scripts by 93.0%.

## Safety-invariant coverage

The retained suites verify:

- blocked decisions do not reach an adapter;
- Shadow Mode sends no controller goal;
- permits bind release, action, device, and controller;
- permits expire and are single-use;
- revocation is refreshed immediately before dispatch;
- release-content changes invalidate approval;
- evidence truthfully records whether a hardware signal was sent;
- evidence hash chains verify;
- ROS 2 message and action contracts;
- missing ROS 2 dependencies fail clearly;
- unavailable controllers fail closed;
- SROS2 enforcement is required;
- Reference Run requires exact release confirmation.

## Final validation

Validation is run on the final report commit. The required command set is:

```text
npm install
npm run build
npm run typecheck
npm test
npm run verify
npm ls
npm run test:releasegate
npm run ros2:test
python -m compileall -q experimental/ros2-reference-sidecar
```

Representative CLI checks cover help, the example ExecSpec, example evidence,
ROS 2 doctor, and ROS 2 inspect.

The current machine does not provide `rclpy`, live DDS, SROS2, a controller, or
a physical robot. Doctor and inspect therefore return nonzero and accurately
report the missing Python dependency. This is the expected fail-closed result,
not a claim of live ROS 2 validation.

The ROS 2 reference implementation is tested at the contract and
process-boundary level. Live DDS, SROS2, controller and physical-robot
validation require an appropriate ROS 2 environment and are not claimed unless
actually completed.

## Final grep audit

The remaining `RealityWarden` matches are all occurrences of the unavoidable
published schema identifier `realitywarden.io/v1alpha1`, including validation
code, fixtures, tests, and documentation.

The remaining `Marketplace` and `Electron` matches are negative test assertions
that prevent those retired product surfaces from returning. The remaining
whole-word `rw` match is a negative assertion that the retired alias is absent
from root scripts. There are no `Manual Import`, `ESP32`, or `Coming Soon`
matches. Matches introduced by this audit section are documentation of the
required search itself and are not active product branding or functionality.
