# Open Reality Studio v0.2 Alpha Release Notes

This document prepares the next public release candidate. It does not create a release tag and it does not claim that the product is production-ready.

Current product boundary remains:

- simulation-first
- no real device execution
- no production hardware control
- no certified industrial safety guarantee

## Scope of v0.2 Alpha vs v0.1.1 Public Alpha

Compared with `v0.1.1 Public Alpha`, the `v0.2 Alpha` codebase now includes:

1. **Open Reality Runtime Kernel**
   - runtime-first prompt compilation boundary
   - device capability reasoning
   - world-model-aware gating
   - explicit blocked / unsupported / ambiguous / not_runnable results

2. **Visible Autonomy Console**
   - runtime decision surfaced in the product UI
   - target device, goal, required capability, and safety result visible before simulation dispatch

3. **Open Reality Protocol v0.1 Contract**
   - explicit protocol contract for:
     - `DeviceManifest`
     - `CapabilityContract`
     - `WorldModel`
     - `Goal`
     - `Plan`
     - `SafetyEnvelope`
     - `TaskDSL`
     - `AdapterBoundary`

4. **Adapter SDK Boundary**
   - simulation adapter boundary defined
   - real adapters remain disabled
   - dry-run-only adapter plan boundary stays explicit

5. **Lab Report / Audit Trail**
   - compiled, blocked, unsupported, ambiguous, and not_runnable outcomes can produce lab report evidence
   - export JSON remains local / front-end driven

6. **Developer Onboarding Pack**
   - onboarding guide for new devices
   - fictional device manifest example
   - onboarding tests for simulation-only integration

7. **Commercial Validation Package**
   - product positioning
   - customer validation questions
   - paid pilot threshold guidance

## Runnable device paths in the current codebase

Current runnable or simulation-enabled paths remain intentionally narrow:

- `robot_arm`
- `smart_light`
- `camera_sensor`

Everything else remains Coming Soon / non-runnable in the main flow.

## What v0.2 Alpha still does not mean

The following are still false and must not be implied:

- real device execution is supported
- all device families are runnable
- the runtime is production-ready
- industrial certification exists
- the demo video proves hardware control

## Release posture

The release should still be described as:

**simulation-first Physical AI Runtime Desktop Prototype**

That is the correct current framing.
