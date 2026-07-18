# RealityWarden

## Making Physical AI open, safer, and not locked inside one brand.

**RealityWarden is the audited gate between AI and the physical world — a safety runtime between AI agents and real hardware.**

![RealityWarden demo: plain English moves a real servo through a safety gate; an unplugged sensor and a too-close hand both block execution](./docs/media/demo.gif)

> Plain English moves a real servo — through a rule parser, an operator confirmation, and a safety gate. Unplug the sensor or put a hand too close and it refuses, with an honest audit either way.

### Try it in 2 minutes (Windows)

1. Download the installer from the [latest release](https://github.com/realitywarden/realitywarden/releases/latest) and run it.
2. The app opens in the REAL workspace. With the documented ESP32 reference rig, select its port, diagnose it, connect, and issue a governed command. Every actuation request still requires visible operator confirmation.
3. Without hardware, explicitly enter **SIM LAB** to rehearse supported virtual workflows with zero hardware signal. Simulation is a secondary tool, not a silent fallback or a claim about physical safety.

To build from source instead, see [Quick Start](#quick-start) below.

Many robots, machines, sensors, smart devices, lab instruments, and factory systems already have chips, controllers, motors, sensors, or hardware interfaces.

But they are not automatically AI-controllable.

RealityWarden helps ordinary hardware become part of Physical AI through a **universal software runtime** instead of a closed brand stack.

The goal is to help AI enter the physical world in a way that is:

- more open
- safer
- more stable
- faster to adopt
- easier for more companies and developers to build on
- less dependent on one closed ecosystem

It is built around one rule:

**AI should not send commands straight to hardware.**

Before an AI-generated action can reach a device, RealityWarden routes it through:

- device capability checks
- world-state grounding
- Safety Governor review
- inspectable `TaskDSL` compilation
- `AdapterPlan` validation
- simulation / dry-run boundary
- structured runtime audit logging

Only after every layer passes can an action execute at all — and every run is visibly labeled as simulation or real hardware, never conflated.

The long-term goal is not to build robots or chips.

The goal is to define the **common software execution layer** that lets different brands, devices, adapters, and future hardware stacks expose physical actions through a shared RealityWarden boundary.

If Physical AI becomes locked inside a few closed stacks, fewer companies can participate.

RealityWarden is designed for the opposite direction: more devices, more adapters, more Reality Assets, more integration work, more deployment work, and a wider developer ecosystem around AI-controlled physical systems.

**Current status — v0.5.1 Public Alpha**

- Public Alpha
- the default desktop shell is REAL-device-first; disconnected state contains no
  virtual model or 3D simulation stage
- a first, tightly gated REAL hardware path exists for one reference rig
  (ESP32 + SG90 servo + HC-SR04 — see
  [docs/REAL_HARDWARE_ESP32.md](./docs/REAL_HARDWARE_ESP32.md)); it runs only
  through an evidence lock, per-run operator confirmation, and an audited
  safety gate; blocked commands can never reach the wire
- no production hardware control, no industrial safety certification
- SIM LAB remains a visibly separate, zero-signal secondary mode for asset
  review, protocol work, and repeatable safety testing
- local PDF/Markdown/text manual import produces reviewable, simulation-only
  device proposals; a second explicit review is required before a generated
  asset can enter Virtual Lab; proposed actions require a separate explicit
  conflict review before being copied into Action Composer, and generated
  assets can never enable a real adapter

Real-hardware safety invariants — **48/48 passing**, plus **5/5** virtual-loopback scenarios. The current suite includes fresh per-primitive sensor polling and proves that an interlock change or lost sensor stops a multi-step action with zero further actuation frames. Run `npm run verify` to reproduce the complete automated gate; physical reference-kit checks remain optional field evidence.

**Demo video:** see the 45-second demo (plain English → real servo, then blocked by an unplugged sensor and a too-close hand) on the [v0.5.0 release page](https://github.com/realitywarden/realitywarden/releases/tag/v0.5.0).

## Runtime Architecture

```mermaid
flowchart LR
  A["Human or AI intent"] --> V["Untrusted proposal validation"]
  V --> C["Capability + bounds"]
  C --> S["Safety policy + fresh sensor evidence"]
  S --> D{"Explicit mode"}
  D -->|"REAL reference rig"| G["HardwareExecutionGate ticket"]
  G --> H["ESP32 + servo"]
  D -->|"SIM LAB"| L["Simulation adapter"]
  L --> R["Replay / lab report"]
  G --> A1["Honest hardware audit"]
  S --> A1
```

The important point is the boundary in the middle. The current repository proves that AI-to-device workflows can be mediated by a local runtime before anything touches execution.

See [docs/LOCAL_RUNTIME.md](./docs/LOCAL_RUNTIME.md) for the exact runtime scope, audit path, and future Edge Runtime / Reality Chip direction.

## What is implemented now

- **REAL-first governed desktop shell**
  - connect -> diagnose -> explicit confirmation -> fresh sensor evidence ->
    ticketed `HardwareExecutionGate` -> honest audit
- **Safety Governor**
  - blocks unsafe, unsupported, ambiguous, and not-runnable requests before simulation dispatch
- **Reality Asset foundation**
  - device manifests, capability contracts, world-model assumptions, adapter boundary metadata
- **Structured runtime audit log**
  - execution path is captured in lab reports instead of disappearing inside UI-only state
- **Adapter boundary**
  - one reference ESP32 rig exists behind a ticketed
    `HardwareExecutionGate`, evidence lock, sensor interlocks, and per-run
    operator confirmation
  - simulation adapters exist only inside the explicitly selected SIM LAB
- **Runnable simulation paths**
  - `robot_arm`
  - `smart_light`
  - `camera_sensor`
- **Custom actions across all three runnable paths**
  - strict profile-specific Action Manifests with typed smart-light values
  - built-in reference recipes can be loaded in Action Composer and are
    revalidated before use
  - examples: [`examples/action-manifests`](./examples/action-manifests)

## REAL workspace and SIM LAB

The default workspace is for the documented REAL reference rig. Before a
connection it shows a flat onboarding state; after connection it may show only
the read-only REAL twin and current telemetry. The last command angle is
open-loop feedback, never claimed as measured position.

SIM LAB is entered explicitly for virtual assets, manual/profile review,
protocol development, replay, and reproducible no-signal tests. It is useful
without hardware, but it is not the product's default navigation and never
proves that a physical scene is safe. Entering SIM LAB disconnects any REAL
serial session, clears REAL telemetry, and removes the hardware controls from
the lab surface. Simulated runs are marked `[SIMULATION]`; real decisions are
marked `real_hardware`.

Simulation and hardware share capability/safety semantics but deliberately use separate execution interfaces; a generic simulation adapter cannot actuate hardware.

## Runnable devices

| Device Type | SIM LAB support | Boundary |
| --- | --- | --- |
| `robot_arm` | Yes | Simulation-only golden path |
| `smart_light` | Yes | Low-risk simulation-only path |
| `camera_sensor` | Yes | Low-risk / read-only simulation-only path |
| `mobile_robot` | No | Coming Soon / not runnable |
| `conveyor_belt` | No | Coming Soon / not runnable |
| `plc_cabinet` | No | Coming Soon / not runnable |
| `lab_instrument` | No | Coming Soon / not runnable |
| `warehouse_rack` | No | Coming Soon / not runnable |
| `sensor_box` | No | Coming Soon / not runnable |

Exact support matrix: [docs/DEVICE_SUPPORT.md](./docs/DEVICE_SUPPORT.md)

## What this Public Alpha does not do

- no arbitrary/customer real-device execution outside the documented reference rig
- no production hardware control
- no certified industrial safety guarantee
- no claim that all device families are runnable
- no silent fallback from unsupported devices into another device path

Do not describe this repository as:

- production-ready
- industrial-grade certified
- a general-purpose real-hardware control platform

It is a **REAL-first Public Alpha safety runtime** with one tightly scoped
reference-hardware path and a separate simulation lab.

## Why this matters

Most AI product demos still jump directly from language to action.

That is acceptable in software.
It is not acceptable for robotics, labs, factory systems, drones, smart devices, or physical infrastructure.

Physical AI should not depend on one robot brand, one closed stack, or one capital-controlled ecosystem.

A common runtime boundary can let more device makers, developers, integrators, researchers, and service teams participate without each company having to rebuild the whole AI-to-device stack from zero.

RealityWarden exists to prove a different execution model:

1. describe the device as a Reality Asset
2. understand the AI request
3. inspect the target device and its capability contract
4. inspect the world state
5. decide whether the request is allowed, corrected, unsupported, or blocked
6. compile a structured task
7. validate an adapter plan
8. log the decision path
9. only then enter the explicitly selected destination: SIM LAB or the ticketed reference-hardware gate

This is the ecosystem direction:

- hardware companies can expose devices through Reality Assets
- developers can build adapters and simulation packs
- integrators can build deployment and monitoring workflows
- safety teams can define rules and review audit trails
- more companies can enter Physical AI without being locked into one closed brand stack

## Quick Start

Clone and install:

```bash
git clone https://github.com/realitywarden/realitywarden.git
cd realitywarden
npm install
```

Run web mode:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run desktop mode:

```bash
npm run desktop:dev
```

Run the production desktop shell from source:

```bash
npm run desktop:prod
```

`desktop:start` is a local convenience script. For repeatable evaluation, use `desktop:dev` or `desktop:prod`.

Build and verify:

```bash
npm run typecheck
npm run build
npm run verify
```

## SIM LAB example prompts

Explicitly select **SIM LAB**, then use one of these:

```text
Move the red cube to the back safe zone
```

```text
Throw the red cube off the table
```

```text
Set the light to blue
```

```text
Take a photo
```

Expected behavior:

- safe `robot_arm` request executes in simulation
- unsafe `robot_arm` request is blocked before execution
- `smart_light` and `camera_sensor` run through limited low-risk simulation paths
- Coming Soon devices remain not runnable

## Local Runtime boundaries

The product keeps two visibly separate destinations behind shared proposal and
safety semantics:

```text
Intent -> validation -> capability/bounds -> safety decision
  -> REAL reference rig: fresh telemetry -> HardwareExecutionGate ticket -> transport -> hardware audit
  -> SIM LAB: TaskDSL -> AdapterPlan -> simulation adapter -> report/replay
```

This is the current product truth:

- **audited gate before any execution**
- **local runtime gated**
- **adapter boundary present**
- **real execution isolated behind the evidence-locked, ticketed reference path**
- **simulation is explicit and never a fallback from REAL**

More detail: [docs/LOCAL_RUNTIME.md](./docs/LOCAL_RUNTIME.md)

## Related docs

- [docs/LOCAL_RUNTIME.md](./docs/LOCAL_RUNTIME.md)
- [docs/DEVICE_SUPPORT.md](./docs/DEVICE_SUPPORT.md)
- [docs/OPEN_REALITY_PROTOCOL.md](./docs/OPEN_REALITY_PROTOCOL.md)
- [docs/REALITY_ASSET_DEVELOPER_KIT.md](./docs/REALITY_ASSET_DEVELOPER_KIT.md)
- [docs/REALITY_ASSET_SUBMISSION.md](./docs/REALITY_ASSET_SUBMISSION.md)
- [docs/EVALUATION_GUIDE.md](./docs/EVALUATION_GUIDE.md)
- [docs/WINDOWS_TRIAL_GUIDE.md](./docs/WINDOWS_TRIAL_GUIDE.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
- [docs/DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md)

## Real Device Adapter Boundary

Real-device work stays behind explicit adapter and safety boundaries.

The first real path (ESP32 bench rig) already follows this rule:

- the simulation workbench cannot dispatch to hardware; the SafetyMonitor
  rejects any manifest with a real adapter enabled
- the hardware route runs only through `HardwareExecutionGate`
  (`lib/hardware/`): blocked commands never reach the adapter, offline is
  never faked, missing/stale/implausible sensor data default-blocks actuation,
  and every decision is audited with `hardwareSignalSent`
- simulation and reality stay strictly separated; hardware support expands
  only device-by-device, each behind the same gate
- the default shell is REAL-first, but only the separately marked reference-rig
  boundary has real execution scope; manual/Marketplace assets remain
  simulation-only and cannot grant hardware authority

## Contributing

- test the runtime boundary
- report unclear execution states
- submit Reality Asset ideas
- propose simulation-ready device manifests

The repository is most useful when contributions preserve the current rule:

**AI should not touch reality directly.**
