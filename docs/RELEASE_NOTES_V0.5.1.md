# RealityWarden v0.5.1 Public Alpha Release Notes

RealityWarden v0.5.1 is a software-complete Public Alpha release candidate for
simulation-first Physical AI workflows and one explicitly gated ESP32 reference
rig. It does not claim general hardware compatibility, verified physical motion,
industrial safety certification, or production readiness.

## Highlights since v0.3.0

- Project/workspace version 2 preserves user-imported DeviceAssets, including
  embedded GLB/GLTF bytes, across Save/Open and durable IndexedDB autosave.
  Version 1 migrates explicitly; unknown fields, non-portable paths, dangling
  assets, oversized files, and simulator-boundary tampering are rejected.
- A product-grade desktop information architecture keeps the 3D Workspace as
  the visual center, AI Command as the only Run/Stop surface, evidence one step
  away, and REAL HARDWARE inside an independent danger boundary.
- The Action Composer supports capability-scoped custom actions, strict atomic
  action-library import/export, reference recipes, and editable 3D forbidden
  zones backed by the same runtime constraints.
- Fresh sensor polling now precedes every primitive on the reference hardware
  path. Missing, stale, invalid, frozen, regressed-clock, or failed sensor
  evidence default-blocks, and a failed/blocked/cancelled step emits no later
  actuation frames.
- Local PDF, Markdown, and text manual import can propose a DeviceProfile and
  actions. Source comparison, raw output, JSON, and semantic 3D preview remain
  reviewable. Two explicit approvals are required before a generated asset can
  enter Virtual Lab.
- Manual-derived records are permanently simulation-only:
  `real_device_enabled:false` and `supported_adapters:['simulator']`. Templates
  cannot expand capabilities, and tampered or orphaned records are rejected on
  restore rather than silently repaired.
- Enabled manual simulation assets can explicitly enter Action Composer for a
  third-gate installation review. The UI exposes source digest, primitive
  steps, envelopes, sensors, and ID conflicts; the selected batch is
  revalidated atomically and never overwrites actions or links a real adapter.
- The Windows NSIS installer includes the compiled shared safety runtime, Next
  production output, pinned PDF extraction runtime, checksummed firmware, and
  rebuilt Windows serialport native bindings. Packaging now verifies these
  contents and automatically runs the packaged production smoke path.

## Real-hardware boundary

The normal AI Command workflow and all manual-derived assets are simulation-only
and require no device. REAL HARDWARE is a separate, visibly distinct path only
for the documented ESP32 + SG90 + HC-SR04 bench rig. Actuation requires the
evidence lock (or explicit supervised bench override), per-run confirmation,
fresh plausible sensor evidence, SafetyMonitor approval, and the gate-private
HardwareExecutionGate ticket path.

Blocked decisions emit zero actuation frames. Evidence distinguishes
`not_sent`, `attempted_unconfirmed`, and `device_acknowledged`. SG90 success is
recorded as `command_acknowledged_open_loop` with
`physicalOutcomeVerified:false`; acknowledgement is not physical-position proof.

## Verification evidence

- all three TypeScript projects pass type checking;
- Next.js production build passes;
- real-hardware safety invariants: **48/48**;
- virtual serial loopback acceptance: **5/5**;
- malicious/manual-import, second-gate, and action-install coverage: **21/21**;
- Desktop and Conformance source-contract checks pass;
- full `npm run verify` passes;
- `npm run desktop:pack` verifies the package and automatically runs
  `RealityWarden.exe --prod --smoke-test`.

Expected Windows artifact:

```text
release/RealityWarden-0.5.1-Setup.exe
```

## Known limitations

- Public Alpha, not a production-certified control system.
- The reference hardware path supports only the documented bench rig.
- Manual import depends on a reachable configured local Ollama runtime and does
  not install actions into Action Composer automatically; installation is an
  explicit third-gate review for enabled simulation assets only.
- Physical reference-kit acceptance is optional field evidence, never a
  software completion or release-engineering gate.
- Code signing, tagging, publishing, and installer upload remain owner actions.
