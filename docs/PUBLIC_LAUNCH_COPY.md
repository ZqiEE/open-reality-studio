# Public Launch Copy — v0.5.1 Public Alpha

Aligned with `POSITIONING.md` (locked 2026-07-21). Keep the boundary
explicit: the desktop is REAL-device-first for one ESP32 reference rig
inside an evidence-locked REAL HARDWARE boundary. SIM LAB is a separately
selected zero-signal tool. This is not general hardware control or a
certified safety product.

## Short post

AI is being wired to real machines faster than anyone can prove it's safe.

RealityWarden is the black box and gatekeeper for AI-driven machines: every
action gated, refusable, and receipted.

v0.5.1 Public Alpha, local desktop runtime:

- governed ESP32 reference-rig commands and jog-teach
- natural-language and custom actions through capability + safety governance
- live distance interlocks; honest hardware-delivery audit
  (`hardwareSignalSent` — never faked)
- unsafe request? It refuses — and shows you the evidence
- separate zero-signal SIM LAB for review, replay, and testing
- approved prebuilt firmware flashing with digest verification

The best part of the demo isn't the servo moving. It's the servo *not*
moving — sensor unplugged, hand too close — with an audit record either way.

https://github.com/ZqiEE/open-reality-studio

## Technical post

RealityWarden v0.5.1 routes intent through a local Runtime Kernel, World
Model, Safety Governor, TaskDSL, AdapterPlan, and a structured audit trail
before anything can dispatch. The proposer (LLM, manifest, manual import,
or human) has zero execution authority; out-of-range values are rejected,
never clamped.

For the documented ESP32 + SG90 + HC-SR04 bench rig, real actuation exists
only behind an evidence lock, per-run operator confirmation, sensor
interlocks, HardwareExecutionGate, and a private ticketed transport path.
Blocked commands structurally cannot reach the wire. Delivery evidence
distinguishes not-sent, attempted/unconfirmed, and device-acknowledged;
SG90 acknowledgement is open-loop and never presented as position proof.

Why this matters in 2026: logging and human oversight for high-risk AI
systems are becoming legal obligations (EU AI Act), and insurers are
starting to ask for per-action decision records for AI-driven machines.
This runtime is built to produce exactly that evidence. 48/48 safety
invariant tests + 5/5 loopback scenarios: `npm run verify`.

SIM LAB supports `robot_arm`, `smart_light`, `camera_sensor`; other
families remain Coming Soon/non-runnable. Public Alpha; no general hardware
compatibility, production deployment claim, or industrial safety
certification.

https://github.com/ZqiEE/open-reality-studio

## Chinese short intro

AI 正在被接上真实机器，但没有人能证明"它当时是安全的"。

RealityWarden 是 AI 驱动机器的"黑匣子 + 门卫"：AI 与真实执行器之间的中立
举证型安全网关——每个动作都过门、可拒绝、有回执。

v0.5.1 Public Alpha 是本地桌面运行时：自然语言/示教动作必须经过能力检查、
实时传感器证据、安全治理、人工确认和私有 ticket 安全门；被拦截的命令在代码
结构上就到不了硬件；审计诚实记录信号是否真的发出（`hardwareSignalSent`）。
演示里最有价值的不是舵机动了，而是拔掉传感器后它**拒绝动**——并给你留下
证据。

没有硬件时，可显式进入独立的 SIM LAB；仿真不会静默替代真机失败，也不证明
物理结果。当前不是通用硬件控制产品，不提供物理到位反馈证明，也没有工业安全
认证——一个会夸大的举证层毫无价值，诚实本身就是产品的一部分。

https://github.com/ZqiEE/open-reality-studio
