# Windows Trial Guide

Use this guide when you want to try the current `v0.5.1 Public Alpha` on Windows.

This is a **simulation-first desktop application**. The normal evaluation path requires no hardware.

The separately marked REAL HARDWARE panel supports only the documented ESP32 reference rig behind an evidence lock and safety gate. This is not general-purpose or production-certified device control.

## What You Can Actually Run

Runnable device paths in the current Public Alpha:

- `robot_arm`
- `smart_light`
- `camera_sensor`

Other built-in device families are visible in the workspace, but they are still:

- `Coming Soon`
- not runnable in the main Run flow
- not valid evidence of finished runtime support

## Option A: Try a Built Installer

If you already have a packaged installer, the expected Windows installer file looks like:

```text
RealityWarden-0.5.1-Setup.exe
```

Install flow:

1. Launch the installer.
2. Choose an install directory if needed.
3. Finish the installer.
4. Start `RealityWarden`.

Expected first-run outcome:

- the desktop window opens
- the virtual workspace shows the default robot arm
- the AI Command input is visible
- the product does not require real hardware

Offline help and recovery are included in the installation. Open the visible
**File** menu (or press Alt for the native **Help** menu) to open the packaged
support guide, view the local version/boundary dialog, or export a redacted local
diagnostic JSON. Diagnostic export does not upload data and excludes projects,
prompts, audit/hardware results, serial ports, environment variables, and
credentials.

## Option B: Build the Installer From Source

From the repository root:

```bash
npm install
npm run desktop:pack
```

Expected output:

```text
release/RealityWarden-0.5.0-Setup.exe
release/RealityWarden-0.5.0-Startup-Acceptance.json
release/RealityWarden-0.5.0-Startup-Acceptance.json.sha256
release/RealityWarden-0.5.0-Design-Acceptance.json
release/RealityWarden-0.5.0-Design-Acceptance.json.sha256
release/RealityWarden-0.5.0-Install-Lifecycle.json
release/RealityWarden-0.5.0-Install-Lifecycle.json.sha256
release/RealityWarden-0.5.0-Release-Evidence.json
release/RealityWarden-0.5.0-Release-Evidence.json.sha256
```

The release evidence JSON is written only after package inspection, packaged
first-run renderer smoke, the neutral no-flash startup/recovery matrix
(including Windows scaling, reduced motion, and forced colors), the 1440×900 /
1180×720 bilingual product-design matrix (including keyboard focus and dialogs),
and an isolated clean-install/safe+blocked audit journey/reinstall/offline/
uninstall lifecycle pass. Use it
to verify the installer SHA256, packaged BUILD_ID, startup/design evidence
digests, and lifecycle evidence digest; it does not claim code signing,
migration from a different historical version, or physical-device acceptance.
Uninstall removes the application but preserves user projects and preferences
by default.

If you only want to run the desktop shell from source in a production-like mode without generating an installer:

```bash
npm run desktop:prod
```

If you are actively developing the UI, use:

```bash
npm run desktop:dev
```

## First Evaluation Path

Do not start by clicking random device families.

Use this order:

1. `robot_arm`
2. `smart_light`
3. `camera_sensor`

Then use [docs/EVALUATION_GUIDE.md](./EVALUATION_GUIDE.md).

## Recommended First Commands

### Robot Arm

Safe example:

- `Move the red cube to the back safe zone`
- `把红方块放到后侧安全区`

Blocked example:

- `Throw the red cube off the table`
- `把红方块扔出桌面`

### Smart Light

- `Turn on the light`
- `Set the light to blue`
- `打开智能灯`
- `把灯改成蓝色`

### Camera Sensor

- `Take a photo`
- `拍一张照片`

## What Correct Behavior Looks Like

`robot_arm`:

- safe task executes
- blocked unsafe task does not move the arm
- playback and logs update

`smart_light`:

- on/off works
- brightness changes are visible
- color changes are visible

`camera_sensor`:

- capture and read feedback appears
- unsupported prompts fail clearly

## What Is Not A Bug In This Alpha

These are current product boundaries:

- non-runnable device families show `Coming Soon`
- unsupported prompts fail instead of silently guessing
- real hardware is never reached from the normal simulation workflow; the
  separately marked reference-rig panel remains evidence-locked and opt-in

## When To Stop And Re-check

If you see any of these, stop and verify the run target first:

- you selected a non-runnable device family
- the current run target does not match the device you expected
- you expected real hardware execution from the desktop alpha
