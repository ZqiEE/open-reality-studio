# Open Reality Positioning

## One-line Position

RealityWarden is a REAL-first AI-to-Action safety runtime that governs the
boundary between intent and physical hardware.

## What Open Reality Is

Open Reality is not a robot brand.

Open Reality is not a chip platform.

Open Reality is not a closed device stack.

Open Reality is a common runtime layer between AI models and physical devices.

An AI model or human gives an intent. RealityWarden treats it as an untrusted
proposal, validates capability and bounds, checks current evidence, applies
safety policy, requires explicit authorization, and audits whether any hardware
signal was actually sent.

## Why This Exists

Physical AI should be open, safer, and not locked inside one brand.

If every robotics or hardware company builds its own closed AI stack, the physical world becomes fragmented. Fewer companies can participate. More value gets captured by a small number of closed ecosystems.

Open Reality is designed for the opposite direction:

- more devices
- more Reality Assets
- more adapters
- more simulation packs
- more integration work
- more deployment work
- more monitoring work
- more safety and audit workflows
- more companies entering Physical AI

## Device Scope

Many modern physical systems already have some combination of chips, controllers, sensors, motors, actuators, or hardware interfaces.

That does not make them automatically AI-controllable.

Open Reality is designed to describe and route AI workflows for many categories of future devices, including:

- robots
- robot arms
- sensors
- smart devices
- electronic toys
- lab equipment
- factory systems
- cameras
- smart home hardware
- mobile robots
- drones as future simulation-only assets until a reviewed real boundary exists
- future Physical AI systems

A device should become visible through a Reality Asset, not through a hardcoded brand-specific path.

## Core Runtime Path

```text
Natural-language goal from an AI model
-> Open Reality Runtime
-> Reality Asset
-> capability contract
-> world-state grounding
-> action plan
-> simulation or dry run
-> safety decision
-> adapter plan
-> audit log
-> physical-device boundary
```

## Freedom and Limits

AI can be flexible at the goal level.

Physical execution must remain bounded by real-world limits.

Open Reality separates those two layers:

- AI can describe what should happen.
- Reality Assets describe what a device can do.
- Capability contracts describe what is allowed.
- World state describes the current environment.
- Simulation and dry run help evaluate the action path.
- Safety decisions allow, correct, ask for human approval, reject, or block.
- Audit logs preserve the decision path.

This lets AI become more useful in the physical world without treating natural language as direct permission to act.

## Ecosystem Direction

The long-term ecosystem is built around shared boundaries:

- hardware companies expose devices as Reality Assets
- developers build adapters
- simulator builders create simulation packs
- safety teams define rules
- integrators build deployment workflows
- service teams build monitoring and maintenance workflows
- auditors and operators review decision logs

The goal is not one brand owning the whole Physical AI stack.

The goal is a common software layer that helps more hardware companies and developers participate.

## Current Boundary

RealityWarden Public Alpha is REAL-first for one documented ESP32 reference
rig. SIM LAB is a visibly separate zero-signal mode for virtual assets and
reproducible tests.

It does not claim production hardware readiness or certified industrial safety.

No public asset, imported manual, model, or generic adapter can grant itself
real-device authority.

## Guiding Rule

AI should not touch reality directly.
