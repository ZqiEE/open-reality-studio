# Evaluation Guide

This guide is for the current `v0.5.1 Public Alpha`.

Use it when you want a clean first evaluation of the product without guessing which prompts or device paths are actually supported.

## What This Alpha Is

RealityWarden Desktop is a **REAL-device-first** Physical AI safety runtime. It
opens on the documented ESP32 reference-rig path, which remains evidence-locked,
sensor-gated, operator-confirmed, ticketed, and visibly distinct. Disconnected
REAL mode renders no simulation canvas or stale telemetry.

SIM LAB is a separate explicit zero-signal mode. It can be evaluated without
hardware and currently supports:

- `robot_arm`
- `smart_light`
- `camera_sensor`
- manually imported PDF/Markdown/text device proposals after two explicit
  simulation-only reviews

Manual-derived actions remain uninstalled after those two reviews. Copying one
into Action Composer is optional and requires a third explicit conflict review
for the exact enabled simulation profile.

Everything else in the workspace should be treated as:

- visible asset scaffolding
- protocol surface
- Coming Soon runtime coverage

The product is **not** general-purpose or production-certified real-device
control; the ESP32-S3 + SG90 + HC-SR04 rig is the only current hardware scope.

## Best First-Run Path

1. Confirm REAL is selected on launch.
2. Confirm the disconnected center is flat and has no 3D grid or virtual model.
3. If you have the documented rig, evaluate port selection, diagnose, connect,
   explicit confirmation, one allowed angle, and one interlock-blocked angle.
4. For the no-hardware path, explicitly select **SIM LAB**.

Recommended SIM LAB order:

1. `robot_arm`
2. `smart_light`
3. `camera_sensor`

Do not start with `mobile_robot`, `plc_cabinet`, `conveyor_belt`,
`lab_instrument`, `warehouse_rack`, or `sensor_box`. Those are not runnable in
SIM LAB yet and have no real-device authority.

## Language Note

If the desktop UI is set to Chinese, use the Chinese prompt examples below.

If the desktop UI is set to English, use the English prompt examples below.

For the current Public Alpha, staying close to the documented prompt wording will give the most reliable evaluation result.

## 1. SIM LAB Robot Arm

Expected result:

- safe task executes
- unsafe task is blocked before execution
- playback, logs, and lab report update

### Recommended prompts

Chinese:

- `把红方块放到后侧安全区`
- `把红方块放到左侧安全区`
- `把红方块扔出桌面`

English:

- `Move the red cube to the back safe zone`
- `Move the red cube to the left safe zone`
- `Throw the red cube off the table`

### What you should see

Safe task:

- AI command compiles into a robot-arm task
- Safety gate passes
- Robot arm performs pick-and-place
- Playback and logs show execution progress

Blocked task:

- Safety gate blocks before motion
- No motion frames execute
- Robot arm and object remain still

## 2. SIM LAB Smart Light

Expected result:

- low-risk lighting commands execute
- brightness and color changes are visible
- unsupported prompts fail clearly

### Recommended prompts

Chinese:

- `打开智能灯`
- `关闭智能灯`
- `把灯调亮`
- `把灯调暗`
- `把灯改成蓝色`
- `把灯改成红色`

English:

- `turn on the light`
- `turn off the light`
- `make the light brighter`
- `dim the light`
- `set the light to blue`
- `set the light to red`

### Known unsupported example

- `make the light purple`

Expected unsupported behavior:

- clear unsupported message
- no silent fallback
- no robot-arm commands

## 3. SIM LAB Camera Sensor

Expected result:

- low-risk capture/read feedback executes
- unsupported prompts fail clearly
- no robot-arm motion is triggered

### Recommended prompts

Chinese:

- `拍一张照片`
- `扫描当前区域`
- `读取摄像头状态`

English:

- `take a photo`
- `scan current area`
- `read camera status`

### Known unsupported example

- `inspect the camera feed carefully`

Expected unsupported behavior:

- clear unsupported message
- no silent fallback to capture
- no action frames beyond the supported camera path

## What Not To Expect

Do not expect the following from this Public Alpha:

- general-purpose real-device execution (the separately marked ESP32 reference
  rig is the only gated hardware path)
- production hardware control
- certified industrial safety
- all device families runnable from AI Command
- universal natural-language understanding

## If A Run Fails

Check these first:

1. You selected a runnable device path:
   - `robot_arm`
   - `smart_light`
   - `camera_sensor`
2. The prompt matches the currently supported examples closely.
3. The current run target shown in the UI matches the device you intended to run.

If the run target is a non-runnable device family, the correct behavior is:

- `Coming Soon`
- `Not runnable in this Public Alpha`
- no motion or action execution

## Honest Summary

Use this Public Alpha to evaluate:

- governed reference-rig onboarding and allow/block behavior
- truthful hardware delivery audit semantics
- explicit zero-signal simulation workflows
- narrow, honestly bounded runnable paths

Do not use this Public Alpha as evidence of:

- general real-world hardware compatibility or certified physical outcomes
- full multi-device runtime coverage
- production readiness
