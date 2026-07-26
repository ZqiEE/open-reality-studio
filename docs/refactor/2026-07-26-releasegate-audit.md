# ReleaseGate refactor audit

## Existing structure and retained core

The product is a Next.js/Electron desktop app with runtime, protocol, hardware,
adapter, marketplace, manual-import, and simulation subsystems. The retained
core is the ticketed `HardwareExecutionGate`, SafetyMonitor, sensor polling and
sequence interruption, RuntimeAuditLog/receipt hashing, Action Manifest
validation, adapter boundaries, and their safety tests.

## Migration classification

- Refactor/extract: hardware gate into generic release-aware execution gate;
  RuntimeAuditLog into ExecutionEvidence; Action Manifest into ActionContract.
- Optional lab: desktop/3D/virtual tooling (`apps/lab` target).
- Reference examples: ESP32 rig and natural-language proposer.
- Frozen: Marketplace and Manual/PDF Import.
- Archive later, after dependency removal and link checks: Marketplace product
  surface and legacy ecosystem positioning.
- Delete later only after equivalent coverage, passing verification, and a
  recoverable legacy tag: dead UI/product entry points and confirmed
  zero-reference legacy modules.

## Coverage and risks

Baseline before changes: typecheck passed; real-hardware safety 49/49;
virtual-loopback 5/5; receipt tests passed; Action Manifest 20/20. Major risks
are leaking the private ticket, adapter calls after block/shadow, dishonest
signal evidence, source-string conformance tests, UI/Core dependency reversal,
and pre-existing uncommitted desktop edits.

No production source was deleted or moved in this round. Tag
`legacy-desktop-v0.5` records the pre-refactor HEAD.
