# Roadmap

This roadmap is intentionally narrow. The priority is not feature count. The
priority is keeping the public surface honest, stable, usable, and clearly
positioned as the **evidence-grade safety gateway between AI intent and real
actuators** (see `POSITIONING.md` — locked 2026-07-21).

RealityWarden is not trying to build robots or chips. One question drives
every milestone below: **"What did the AI intend, was it allowed, and where
is the proof?"** Features that sharpen the gate or the receipt come first;
everything else (ecosystem, marketplace, new device families) is chapter two.

Product direction and the historical v0.3–v0.6 plan live in
`PRODUCT_VISION.md`; this file only tracks execution order. The six
invariants bind every item below.

## Completed: Real-Device Software Boundary (v0.2 close-out)

- pass the automated real-hardware and virtual-loopback suites, including the
  four safety scenarios and explicit `hardwareSignalSent` evidence
- `npm run verify` green on the Windows host (build included)
- close visual-review leftovers (neutral-gray inline hex consolidation)
- removed the three superseded generic real-adapter files after confirming zero
  production references; the ticketed `lib/hardware/` boundary is authoritative

Physical reference-kit validation remains an optional field check documented in
`REAL_HARDWARE_ESP32.md`; it is not a product-completion or development gate.

## Completed: v0.3 — Real Hardware in the Product

- wire `lib/hardware/` into the main UI: explicit `REAL HARDWARE` device
  identity + connection wizard
- LLM compiler UI wiring per the approved `LLM_COMPILER_DRAFT.md` (status
  chip, `[COMPILER]` log lines, explicit fallback badge)
- one-click firmware flashing MVP for the reference kit
- keep simulation the default path; real hardware is always opt-in and
  visibly distinct

## Completed: v0.4 — Your Device, Your Actions

- versioned Action Manifest composer and primitive expansion through the
  unchanged safety pipeline
- strict atomic action-library JSON import/export
- 3D forbidden-zone visualization and editing backed by profile constraints
- sensor polling/subscription with a fresh evidence generation per primitive;
  failed reads and latched clock/frozen faults interrupt a sequence with zero
  further actuation frames
- Robot Arm, Smart Light, and Camera Sensor reference recipes; exact
  device-profile matching; typed/ranged smart-light values; one-click recipe
  loading through the same validator; semantic execution coverage

## Completed: v0.5 — Manual Import (simulation-only)

- datasheet/PDF/Markdown to draft DeviceProfile via local LLM, human-reviewed,
  simulation-first enablement; generated assets can never enable a real
  adapter

## NOW: v0.6 — The Receipt (hero milestone)

The productized form of the positioning. Everything in this milestone serves
one user moment: *hand a third party the proof.*

1. **One-click signed audit report export**: select a time range, export a
   human-readable PDF + machine-readable JSON containing every proposal,
   decision, rule trigger, refusal, operator confirmation, and
   `hardwareSignalSent` outcome; content-hashed (and signed) so tampering is
   evident. This is the artifact a team hands to a customer, insurer, or
   auditor.
2. **First-screen narrative**: the default surface tells the story
   `intent -> gate -> outcome + receipt`. A refusal is a first-class,
   calmly-presented positive state ("blocked, here's why, here's the
   record") — not an error wall.
3. **Receipt vocabulary stability**: freeze and document the audit-record
   schema (`schemas/`) so external consumers can build on it; additive
   changes only from here.
4. **Usability, speed, transparency pass**: fewer clicks from launch to a
   governed command; every state visible and explained in plain language;
   no dead ends — every blocked/degraded state says what happened and what
   to do next. (Continues `docs/ui/2026-07-11-ui-audit.md` C/E series.)
5. **Compliance mapping kept current**: `COMPLIANCE_MAPPING.md` tracks the
   receipt feature; the exported report references the mapping.

Exit criteria: a first-time user can go from install to a governed command
in under 5 minutes, trigger a refusal, and export a signed report proving
both events — without reading any documentation.

## NEXT: v0.7 — Design partners

- onboard 2–3 external embodied-AI / robotics teams as design partners using
  the receipt export in a real evaluation or PoC
- per-partner rule/policy profiles, reusable across deployments (the rule
  library is a compounding asset — see `POSITIONING.md`)
- collect the receipt-consumer feedback loop: what do their customers,
  insurers, or auditors actually accept?

## DEFERRED (chapter two — after the evidence layer has users)

- Reality Asset Catalog presentation and ecosystem surface
- Adapter SDK expansion and third-party adapter verification
- Marketplace alpha (declarative assets only, signed, trust-tiered,
  disabled-by-default on install)
- new runnable device families beyond the reference rig

These remain real and remain on the map, but they widen a moat that must
first exist. They do not compete with v0.6/v0.7 for effort.

## Standing rules (unchanged)

- show the core story clearly: intent -> gate -> outcome + receipt
- unsupported prompts never silently execute
- non-ready devices stay behind `Coming Soon`
- build / verify / smoke tests stay green
- the six invariants only tighten, never loosen

## Owner-reviewed additions (2026-07-16, post physical acceptance)

- Real-device digital twin in the 3D workspace (owner vision, staged):
  Stage 1 - a clearly REAL-marked mirror that ECHOES real state (current
  angle command, live distance). Stage 2 - drag-to-propose: dragging the
  REAL-marked twin is an INTENT INPUT on par with natural language; it
  generates a proposal that runs the same pipeline (validate -> simulate ->
  safety gate -> explicit confirm) before the real device follows. Dragging
  never drives hardware directly - the mouse is an untrusted proposer like
  any other. Forbidden zones and interlocks apply live during the drag (the
  twin refuses visibly). Invariant 6 is satisfied by distinct REAL marking
  and the confirmation ritual, not by banishing real devices from 3D.
- Built-in governed flasher (owner decision: users never touch the Arduino
  IDE): embed esptool-js in the desktop app and flash ONLY reviewed prebuilt
  images paired through firmware write orders (sha256 three-way match).
  Firmware variants (pulse_width / serial_ttl) ship as prebuilt images
  selected by the configuration draft - zero config, zero compile, zero IDE
  for users. New firmware capability enters via the ecosystem review
  pipeline, never via wrapping an arbitrary-code IDE.
- Teach mode, two tiers (both REAL, differing only in input method):
  Tier 1 jog-teach (works on the open-loop SG90 today): UI jog buttons move
  the real servo in small GATED steps; the operator records waypoints of
  commands (commands ARE positions on open-loop hardware) into an Action
  Manifest; replay runs every step through the safety gate.
  Tier 2 hand-guide teach (feedback hardware, e.g. bus servos): record =
  read-only encoder sampling while physically moving the device, replay =
  every step through the gate.
- DONE 2026-07-16: auto-reconnect of the read-only panel after real
  execution releases the port.

## Not In Scope Through v0.7

- vendor-certified industrial safety claims
- cloud dependency for any safety decision
- marketplace distribution of executable code
- protocol changes that are not additive
- paid marketplace transactions
- claiming that purely mechanical objects without chips, controllers,
  sensors, actuators, motors, or interfaces can be changed by software alone
