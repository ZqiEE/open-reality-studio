# Contributing to RLSOK

RLSOK is release control for executable robot policies. Contributions should
strengthen the answer to three questions: what action was proposed, was its
release admitted, and what evidence proves the result?

## Contribution priorities

- strict, versioned ExecSpec, ActionContract and RobotProfile schemas;
- release approval, expiry, revocation and target binding;
- fail-closed Execution Gate behavior and no-bypass adapter contracts;
- truthful, tamper-evident evidence;
- ROS 2 interface boundaries and reference adapters;
- clear security-boundary and compatibility documentation.

The optional Lab, ESP32 reference rig, historical Marketplace/Manual Import
compatibility, and natural-language proposer are not the default product path.
Changes there must not introduce a reverse dependency into Core, CLI, or daemon.

## Safety rules

- Treat models, agents, imported data and network messages as untrusted.
- Reject out-of-contract values; do not silently clamp them into execution.
- Missing, invalid, stale, frozen or mismatched state must fail closed.
- A blocked or shadow decision must never send an actuation signal.
- Evidence must truthfully record `hardwareSignalSent`.
- Do not describe RLSOK as safety-rated, certified, hard real-time, or a
  replacement for an E-Stop, safety PLC, or certified controller.
- Never add credentials, tokens, private endpoints, or secrets.

Historical identifiers such as `rw`, `RealityWarden`, and
`realitywarden.io/*` may be required for compatibility. Do not rename stable
formats without an explicit, lossless migration.

## Validation

Run before opening a pull request:

```bash
npm run typecheck
npm run build
npm run test:releasegate
npm run test:real-hardware
npm run test:virtual-loopback
npm run verify
```

Describe the boundary affected, new failure behavior, compatibility impact, and
the exact commands run.
