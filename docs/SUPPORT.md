# RealityWarden Desktop Support

This guide is installed with RealityWarden and works offline.

## Product boundary

RealityWarden 0.5.1 Public Alpha is a REAL-device-first safety-governance
desktop application for one documented ESP32 reference rig. The disconnected
REAL workspace intentionally shows no 3D stage or stale data.

REAL HARDWARE remains evidence-locked, requires operator confirmation, and
never treats a software acknowledgement as proof of physical motion. SIM LAB is
a separate zero-signal mode; Robot Arm, Smart Light, and Camera Sensor are its
runnable paths.

## Recover from a startup problem

1. Use **Retry startup** in the recovery window.
2. If retry fails, use **Copy details** and save a local diagnostic bundle from **File → Export Local Diagnostics…**.
3. Restart RealityWarden. Existing user projects and preferences are preserved by uninstall and reinstall by default.

An offline or unavailable local LLM does not prevent the workbench from opening. RealityWarden labels the fallback explicitly and uses the local rule compiler for supported commands.

## Recover a project

- Use **File → Open Project** to select a `.openreality.json` project.
- Use **File → Restore** to restore the last validated autosave.
- A corrupt autosave is quarantined and never silently replaces the current workspace. Discard it only through the explicit recovery action.
- Project validation rejects unsupported versions, unknown fields, unsafe real-device authority, missing imported assets, and oversized files instead of guessing or narrowing them silently.

## Export local diagnostics

Use **File → Export Local Diagnostics…** or the native **Help** menu. The JSON bundle is created only after you choose a local destination. RealityWarden does not upload it.

The bundle contains:

- RealityWarden and runtime versions;
- operating-system release, architecture, locale, and packaged/development state;
- a bounded, allowlisted, redacted excerpt of desktop startup messages.

The bundle excludes project contents, imported assets, AI prompts, generated commands, audit evidence, hardware results, serial-port inventory, environment variables, and credentials. Paths and secret-like values in the permitted startup messages are redacted.

Review the JSON before sharing it. Support staff should request this bundle instead of a complete project unless the operator separately chooses to share a project.

## Simulation and REAL HARDWARE

- Simulation Run/Stop controls appear only inside explicitly selected SIM LAB.
- REAL HARDWARE stays in its independent black/yellow boundary and is not enabled by simulation state.
- Missing, stale, invalid, or frozen sensor evidence blocks real execution.
- Physical-device acceptance is optional evidence and is not required to use or evaluate the software paths.

Additional packaged references: `WINDOWS_TRIAL_GUIDE.md`, `EVALUATION_GUIDE.md`, and `REAL_HARDWARE_ESP32.md`.

Use **Help → Third-Party Notices** for the lockfile-bound production dependency inventory, redistributed model attributions, and included license texts. The page is packaged with the app and opens offline.
