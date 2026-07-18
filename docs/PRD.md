# Product Requirements

RealityWarden is the governed desktop runtime between human or AI intent and
physical hardware. The primary product task is to get a reviewed device online,
decide whether a proposed action is allowed, and—only after explicit operator
confirmation—route an allowed primitive through the single hardware gate with
an honest audit trail.

The Public Alpha supports one real reference rig: ESP32-S3 + SG90 servo +
HC-SR04. It is not a general hardware platform and makes no certified
industrial-safety claim.

## Primary REAL Product Path

1. Auto-detect, or refresh and explicitly select, a currently enumerated serial port.
2. If RealityWarden firmware responds, diagnose and connect it. If a blank or
   unresponsive listed ESP32-S3 does not respond, prepare a governed first
   flash without claiming a successful handshake.
3. Review the exact target port, reviewed image version, and SHA-256; explicitly
   confirm a five-minute, one-use authorization. Re-enumerate and reject any
   target, request, or image change before esptool identifies the ESP32-S3 and writes.
4. Reconnect and require `diagnose` to verify the expected firmware version.
5. Verify the installed build's version-bound REAL release approval. The
   approval is bound to this app version, the reviewed reference profile, and
   the exact four owner-reviewed scenario digests; arbitrary JSON files and
   packaged environment variables cannot unlock execution.
6. Propose a single command, jog-teach sequence, or saved Action Manifest.
7. Recompute validation and risk; require fresh sensor evidence and visible
   operator confirmation.
8. Execute only through a private `HardwareExecutionGate` ticket.
9. Report `hardwareSignalSent` truthfully and stop a sequence at the first
   blocked/failed/cancelled primitive with zero subsequent frames.

The disconnected REAL workspace contains no virtual model or 3D simulation
stage. A connected read-only twin may show current distance plus the last
acknowledged command angle, explicitly labeled open-loop and not measured.

## Secondary SIM LAB Path

SIM LAB is an explicit zero-signal mode for protocol development, manual and
Marketplace asset review, unsupported-device exploration, deterministic safety
tests, replay, and report export. It provides the multi-device virtual
workspace, Device Profile simulator, prompt-to-TaskDSL path, state inspector,
timeline, and adapter-package tooling.

Simulation never grants real-device authority, never silently replaces a REAL
failure, and never claims that a physical outcome was verified. The modes are
operationally exclusive: entering SIM LAB disconnects any REAL serial session,
clears REAL telemetry, and removes all hardware controls from the lab surface.

## Non-negotiable Product Boundaries

- The safety gate is the only actuation path.
- Missing, stale, invalid, frozen, or undeclared evidence blocks by default.
- Degradation is visible and audited; there is no silent fallback.
- Proposers are untrusted; out-of-range values are rejected, never clamped.
- Simulation and reality remain visibly distinct at every supported viewport.
- Real execution is limited to the documented reference rig until a new device
  earns an equally strict profile, transport, evidence, and acceptance chain.
