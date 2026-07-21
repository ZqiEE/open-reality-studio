# RealityWarden

## The black box and gatekeeper for AI-driven machines.

**RealityWarden is a neutral, evidence-grade safety gateway between AI intent and real actuators. Every action is gated, refusable, and receipted — with evidence you can hand to a regulator, an insurer, or a customer.**

![RealityWarden demo: plain English moves a real servo through a safety gate; an unplugged sensor and a too-close hand both block execution](./docs/media/demo.gif)

> Plain English moves a real servo — through a rule parser, an operator confirmation, and a safety gate. Unplug the sensor or put a hand too close and it **refuses, and shows you the evidence**. The refusal is the product.

## The problem

AI models are being wired to real machines faster than anyone can prove they are safe. When a customer, an insurer, or a regulator asks:

> *"What did the AI intend at that moment? Who approved it? Where is the record that unsafe requests were refused?"*

— today, nobody in the stack can answer with evidence. Control-layer safety (collision avoidance) can't answer it. Network security can't answer it. Ship-time certification can't answer it. It requires an independent runtime layer sitting between the AI's intent and the actuator, keeping honest records.

That layer is RealityWarden. It is built around one rule:

**AI should not send commands straight to hardware — and when it tries, there must be a record.**

Before an AI-generated action can reach a device, RealityWarden routes it through:

- device capability checks
- world-state grounding
- Safety Governor review
- inspectable `TaskDSL` compilation
- `AdapterPlan` validation
- simulation / dry-run boundary
- structured runtime audit logging

Only after every layer passes can an action execute at all. Every decision is recorded with an honest `hardwareSignalSent` flag — did a signal actually reach the wire, which rule fired, what was refused and why. Blocked commands **structurally cannot** reach the actuator: when a request is blocked, no code path to the transport exists.

## Why neutrality matters

Chip vendors bolt safety onto their own silicon. Model vendors referee their own models. Neither can be the trusted judge — the proposer must have zero execution authority. RealityWarden owns no robot, no chip, and no model. It is designed to be the independent layer that any brand's hardware and any vendor's model can be governed through — which is also why its audit trail is worth something to a third party.

See [docs/POSITIONING.md](./docs/POSITIONING.md) for the locked product positioning and competitive map, and [docs/COMPLIANCE_MAPPING.md](./docs/COMPLIANCE_MAPPING.md) for how the runtime's invariants line up with EU AI Act logging and human-oversight obligations.

### Try it in 2 minutes (Windows)

1. Download the installer from the [latest release](https://github.com/realitywarden/realitywarden/releases/latest) and run it.
2. The app opens in the REAL workspace. With the documented ESP32 reference rig, select its port, diagnose it, connect, and issue a governed command. Every actuation request still requires visible operator confirmation.
3. Without hardware, explicitly enter **SIM LAB** to rehearse supported virtual workflows with zero hardware signal. Simulation is a secondary tool, not a silent fallback or a claim about physical safety.

The ESP32 + SG90 + HC-SR04 reference rig is not the product. It is the cheapest possible **living proof** that the governance architecture reaches real hardware — the fastest way to watch an AI request get refused, on a real machine, with a receipt.

To build from source instead, see [Quick Start](#quick-start) below.

**Current status — v0.5.1 Public Alpha**

- Public Alpha
- the default desktop shell is REAL-device-first; disconnected state contains no
  virtual model or 3D simulation stage
- a first, tightly gated REAL hardware path exists for one reference rig
  (ESP32 + SG90 + HC-SR04 — see
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

The important point is the boundary in the middle — and the audit trail coming out of it. The current repository proves that AI-to-device workflows can be mediated by a local runtime before anything touches execution, and that every decision leaves an honest record.

See [docs/LOCAL_RUNTIME.md](./docs/LOCAL_RUNTIME.md) for the exact runtime scope, audit path, and future Edge Runtime / Reality Chip direction.

## What is implemented now

- **REAL-first governed desktop shell**
  - connect -> diagnose -> explicit confirmation -> fresh sensor evidence ->
    ticketed `HardwareExecutionGate` -> honest audit
- **Safety Governor**
  - blocks unsafe, unsupported, ambiguous, and not-runnable requests before simulation dispatch
- **Structured runtime audit log**
  - every decision captured with `hardwareSignalSent`, the rule that fired,
    and the refusal reason — in lab reports instead of disappearing inside
    UI-only state
- **Audit receipt export** (`realitywarden.receipt/v1`)
  - one click exports a tamper-evident receipt (JSON + Markdown) of a
    session's proposals, decisions, refusals, and honest delivery evidence
  - any third party can verify it independently — see
    [docs/RECEIPT_FORMAT.md](./docs/RECEIPT_FORMAT.md) and
    `npm run receipt:verify -- <file.receipt.json>`
- **Reality Asset foundation**
  - device manifests, capability contracts, world-model assumptions, adapter boundary metadata
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
reference-hardware path and a separate simulation lab. Honesty about limits is
itself part of the product: an evidence layer that overclaims is worthless.

## Why this matters

Most AI product demos still jump directly from language to action. That is acceptable in software. It is not acceptable for robotics, labs, factory systems, drones, smart devices, or physical infrastructure.

And the pressure is no longer hypothetical: logging and human oversight for high-risk AI systems are becoming legal obligations, insurers are beginning to underwrite AI-driven machines and need per-action records, and every serious robotics customer now asks for safety proof before deployment. The teams that can produce a receipt will deploy; the teams that cannot will stay in the demo room.

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

The long-term direction is a common, neutral execution layer — not owned by any robot brand, chip vendor, or model vendor — that lets more devices, adapters, and developers participate in Physical AI without each company rebuilding the AI-to-device stack from zero. That ecosystem (open protocol, Adapter SDK, Reality Asset marketplace) is chapter two; the evidence layer comes first.

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

- [docs/POSITIONING.md](./docs/POSITIONING.md) — locked product positioning
- [docs/RECEIPT_FORMAT.md](./docs/RECEIPT_FORMAT.md) — audit receipt spec (`realitywarden.receipt/v1`)
- [docs/COMPLIANCE_MAPPING.md](./docs/COMPLIANCE_MAPPING.md) — invariants → EU AI Act mapping
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

**AI should not touch reality directly — and when it tries, there must be a record.**
