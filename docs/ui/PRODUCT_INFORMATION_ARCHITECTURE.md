# RealityWarden product information architecture

RealityWarden is a governed runtime between human or AI intent and physical hardware. It is not a device dashboard and it is not a generic 3D editor. The primary desktop shell is REAL-first. Every primary surface must help a non-developer answer one of three questions in order:

1. Is my reviewed physical device connected and what can it do?
2. Why did the runtime allow or block the proposed action?
3. Am I explicitly ready to ask that device to act?

## The three product planes

### 1. REAL device workspace: default central workspace

The default central workspace contains no generic virtual device. Before connection it directs the operator to the independent REAL HARDWARE boundary. After connection it shows only the read-only REAL twin and current, non-stale telemetry.

The default shell therefore follows the product's actual destination: onboarding and governing real hardware. It must never imply that a robot-arm demo model controls the connected reference servo.

### 2. Simulation Lab: explicit secondary mode

Simulation remains available for protocol development, asset/manual review, unsupported-device exploration, and reproducible no-signal safety tests. It is entered explicitly from the workspace-mode control and may then expose the simulation setup rail, model library, command dock, timeline, and console.

Simulation is not the default onboarding path and is not presented as a prerequisite that proves physical safety. Its model library is not a list of discovered physical devices.

### 3. Status and safety contract: right upper rail

In REAL mode, the upper rail reports honest connection/telemetry status and the non-bypassable safety contract. In Simulation Lab mode it explains the most recent simulated runtime decision and its evidence. It must not show simulation-model details as the default REAL-device context.

### 4. REAL HARDWARE: separate black/yellow boundary

The REAL HARDWARE area is an optional physical reference rig. It remains outside the simulation evidence tabs and uses independent connection, evidence lock, operator confirmation, tickets, and `HardwareExecutionGate` execution.

The Stage 1 REAL servo twin is a read-only mirror of the connected reference rig. It displays the last acknowledged command angle as open-loop, not measured, plus current distance telemetry. It is not the selected generic simulator and it never creates a simulation-to-real mapping by visual proximity.

After connection, the boundary presents one operator task at a time:

- **Command** prepares and executes a single governed reference-servo request.
- **Teach** records acknowledged jog commands and replays a saved manifest through the existing gated sequence runner.
- **Firmware** is an isolated maintenance task; it does not share the actuation controls.

Connection identity and the explicit session confirmation remain visible wherever actuation can be requested. Switching tasks changes presentation only; it never creates a new IPC or execution route.

In REAL mode this boundary is the primary right-rail task area and remains open; device status and the safety-contract explanation move below it as auxiliary evidence. At compact 1180×720, the hardware boundary must retain at least half of the right rail. In Simulation Lab mode the hierarchy reverses: simulation decision evidence is primary and the independent hardware boundary may remain compact.

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
