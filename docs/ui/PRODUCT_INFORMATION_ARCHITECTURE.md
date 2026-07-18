# RealityWarden product information architecture

RealityWarden is a governed runtime between human or AI intent and physical hardware. It is not a device dashboard and it is not a generic 3D editor. Every primary surface must help a non-developer answer one of three questions in order:

1. What do I want to test without touching hardware?
2. Why did the runtime allow or block it?
3. Am I explicitly ready to ask a connected reference device to act?

## The three product planes

### 1. Safe rehearsal: left setup plus central workspace

The left rail selects a **simulation target**, a simulator profile, and a test case. The central workspace shows the proposed or simulated outcome. This plane is air-gapped from actuation and must always say that it sends no hardware signal.

Its value is to let a user learn the intended motion, expose unsupported capabilities, and see predictable policy failures before entering the real-hardware boundary. A successful rehearsal does **not** prove that the physical environment is safe. Generic virtual devices do not automatically map to a connected device.

The model library exists to add a simulator to a rehearsal. It is not a list of discovered physical devices.

### 2. Run decision: right upper rail

The default right-side view explains the most recent runtime decision and its evidence. Model details are secondary and open when the user explicitly changes the selected simulation model. The right rail must not lead with configuration duplication or stale completed state before a run.

### 3. REAL HARDWARE: separate black/yellow boundary

The REAL HARDWARE area is an optional physical reference rig. It remains outside the simulation evidence tabs and uses independent connection, evidence lock, operator confirmation, tickets, and `HardwareExecutionGate` execution.

The Stage 1 REAL servo twin is a read-only mirror of the connected reference rig. It displays the last acknowledged command angle as open-loop, not measured, plus current distance telemetry. It is not the selected generic simulator and it never creates a simulation-to-real mapping by visual proximity.

## Naming rules

- Use **simulation model**, not virtual device, when referring to a rehearsal target.
- Use **test case**, not scenario, in first-user UI.
- Use **run decision** for allow/block reasoning and evidence.
- Reserve **REAL HARDWARE** and the warning token for the independent physical boundary.
- A hardware-local dry run may be called **reference-servo preflight**. It must not be presented as the generic simulation workspace.

## Product acceptance questions

At 1180×720, a first-time user should be able to answer these without documentation:

- Which area is guaranteed not to send a hardware signal?
- Where do I enter and run a rehearsal command?
- Where will I learn why it was allowed or blocked?
- Which area can affect physical hardware?
- Is the connected REAL mirror actually mapped to the selected simulation model?

If any answer is ambiguous, the layout is not release-ready even when its tests pass.
