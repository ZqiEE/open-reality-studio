# Device Onboarding Guide

This guide explains the minimum contract for adding a new device to Open Reality Studio without enabling real hardware control.

Current boundary:

- simulation-first
- real device execution disabled
- no direct hardware control in Public Alpha

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

Open Reality Studio remains a simulation-first runtime prototype.
