# Device Onboarding Guide

This guide explains the minimum contract for adding a simulation device to
RealityWarden without granting it real-hardware authority.

This guide covers the **new-device asset pipeline**, not the product's default
navigation. The desktop product is REAL-first for the existing documented
reference rig; every newly proposed device still starts simulation-only.

Onboarding boundary:

- simulation-first for untrusted new device proposals
- new device manifests default to simulation-only
- no manifest or public adapter can opt into direct hardware control
- the existing ESP32 reference rig remains a separate, private-ticketed path

## Controlled firmware-configuration drafts

The first hardware-onboarding contract is implemented in
`lib/device-onboarding/FirmwareConfiguration.ts`. It accepts only an explicitly
reviewed, source-hashed proposal for the current conservative matrix:

- ESP32-S3 + SG90 + HC-SR04 for `robot_arm`
- ESP32-S3 + a safe-default digital output for `smart_light`
- ESP32-S3 + HC-SR04 read-only configuration for `sensor_box`

The contract rejects reserved/unreviewed GPIO, duplicate pins, component/device
mismatches, unknown fields, and stored-record tampering. Its output is always a
`draft` with `simulation_only:true`, `write_authorized:false`, and
`real_adapter_enabled:false`. It does not compile firmware, flash a board, open
a serial port, or grant execution authority. Those later stages require their
own explicit review and independently verified gates.

## The complete controlled onboarding loop

For the current conservative hardware matrix the loop is closed end to end,
with a separate human decision at every stage and zero execution authority
granted anywhere along it:

1. **Manual import** (`lib/manual-import/ManualProfileImport.ts`): a local
   model turns a manual into an untrusted DeviceProfile + Action Manifest
   proposal; first human review saves a `simulation_only` record.
2. **Simulation enablement**: the existing Virtual Lab second gate creates the
   user-owned simulation asset (`real_device_enabled:false`); actions need the
   third gate. This is where the device becomes usable in 3D simulation.
3. **Firmware configuration draft**
   (`lib/device-onboarding/FirmwareConfiguration.ts`): reviewed, source-hashed
   pin/component contract; always write-disabled.
4. **Write order** (`lib/device-onboarding/FirmwareWriteOrder.ts`): a second
   explicit authorization pairs the draft with exactly one reviewed prebuilt
   image (sha256-pinned). Templates without a reviewed image are refused —
   nothing is compiled ad hoc or substituted. `npm run hardware:flash --
   --port COMx --order <order.json>` flashes only when the on-disk image, its
   `.sha256` companion, and the order digest all agree.
5. **Read-only diagnostics** (`npm run hardware:diagnose -- --port COMx
   --json <report.json>`): produces a machine-readable report whose schema
   structurally cannot name an actuation command.
   `lib/device-onboarding/DiagnosticsEvidence.ts` accepts it only for
   RealityWarden firmware with a device-side clock and, when the draft uses
   the distance interlock, at least three plausible sensor samples.
6. **Closure** (`completeOnboardingClosure`): links manual source digest,
   reviewed profile, write order, and diagnostics evidence into an
   `onboarded_simulation_only` record. It requires stage 2 to have happened
   and grants nothing: `supported_adapters` stays `['simulator']`,
   `real_adapter_enabled` stays `false`, and the runtime evidence lock for
   real execution is untouched.

Physical-device steps (4–5 on a real board) remain optional operator evidence;
they are never a development or release gate.

Use this guide when you want to add a new device shape to the runtime, not when you want to bypass the safety boundary.

## Minimum onboarding checklist

Every new device should define:

1. `DeviceManifest`
2. `CapabilityContract` mapping
3. `WorldModel` assumptions
4. simulation adapter boundary
5. safety profile
6. tests

## 1. DeviceManifest

The manifest is the runtime-facing contract for the device.

It should answer:

- what the device is called
- what category it belongs to
- whether it is `simulation_only`, `read_only`, `coming_soon`, or `unsupported`
- which capabilities it exposes
- whether real adapter execution is enabled

For Public Alpha and early v0.2 work:

- prefer `simulation_only`
- or keep the example `coming_soon`
- always keep `realAdapterEnabled: false`

## 2. CapabilityContract

Do not invent commands first.

Start from capabilities such as:

- `read_sensor`
- `capture_image`
- `turn_on`
- `set_brightness`
- `move_to_pose`

Then let planning and safety decide whether a prompt can compile into TaskDSL.

If a goal requires a capability the manifest does not expose, the runtime must return `unsupported` instead of silently falling back.

## 3. WorldModel assumptions

Every device example should state what the runtime assumes about the world.

Examples:

- zones the device is allowed to reference
- objects it can observe or manipulate
- whether the device is fixed, mobile, read-only, or simulation-only

Keep the world model minimal and explicit. If the runtime cannot ground the task against the world model, the result should be `ambiguous` or `not_runnable`, not guessed execution.

## 4. Simulation Adapter

New devices must enter through a simulation adapter boundary first.

That means:

- compile prompt -> Goal
- Goal -> Plan
- Plan -> TaskDSL
- TaskDSL -> simulation adapter plan

Public Alpha boundary:

- simulation adapter: allowed
- dry run: allowed
- real adapter: disabled

Do not add a real adapter path in onboarding examples.

## 5. SafetyProfile

Each device needs an explicit safety posture, even when it is only simulated.

At minimum, define:

- support level
- blocked goals
- allowed zones
- forbidden zones
- speed / force expectations
- whether human approval is required

If the device is not truly ready, keep it:

- `coming_soon`, or
- `simulation_only` with narrow capability scope

## 6. Tests

Before claiming a device can be onboarded, add tests that prove:

1. the example manifest loads
2. `realAdapterEnabled` is `false`
3. a supported low-risk prompt compiles
4. an unsupported prompt does not execute

## Fictional example: `simple_sensor`

The repository includes:

- [examples/device-manifest-template.ts](../examples/device-manifest-template.ts)

This fictional device shows the minimum shape for a safe onboarding example:

- device id: `simple_sensor_01`
- support level: `simulation_only`
- capabilities: `read_sensor`, `inspect`, `record`
- real adapter: disabled

It is intentionally narrow. The point is to teach the contract, not to pretend the device is production-ready.

## Recommended onboarding flow

1. start from a fictional or internal device
2. keep it `simulation_only`
3. declare only the smallest truthful capability set
4. verify unsupported tasks return `unsupported`
5. verify `realAdapterEnabled` stays `false`
6. only then consider a richer simulation path

## What not to do

Do not:

- mark a new device runnable just because it has UI
- open real adapter execution in onboarding examples
- silently map unsupported prompts to existing device actions
- claim industrial certification or production readiness

RealityWarden remains REAL-first only for the documented reference rig. A new
device stays simulation-only until it earns a separately reviewed profile,
transport, hardware gate integration, evidence chain, and acceptance suite.
