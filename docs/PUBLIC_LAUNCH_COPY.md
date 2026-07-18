# Public Launch Copy — v0.5.1 Public Alpha

Use these drafts for public posts. Keep the boundary explicit: the main
workbench is simulation-first; one ESP32 reference rig has a separate,
evidence-locked REAL HARDWARE path. This is not general hardware control or a
certified safety product.

## Short post

AI should not touch the physical world directly.

RealityWarden v0.5.1 Public Alpha is a local desktop runtime for Physical AI:

- natural-language and custom actions
- capability and safety governance
- 3D simulation, replay, and audit evidence
- strict Reality Asset/action-library validation
- review-gated, simulation-only device proposals from local PDF/manual imports
- one independently gated ESP32 reference-hardware path

The main workflow requires no hardware. The reference rig remains opt-in,
sensor-gated, operator-confirmed, and visibly marked REAL HARDWARE.

https://github.com/ZqiEE/open-reality-studio
## Technical post

RealityWarden v0.5.1 routes supported intent through a local Runtime Kernel,
World Model, Safety Governor, TaskDSL, AdapterPlan, and audit trail before
dispatch.

The simulation workbench supports `robot_arm`, `smart_light`, and
`camera_sensor`. Other built-in families remain Coming Soon/non-runnable.

For the documented ESP32 + SG90 + HC-SR04 bench rig, real actuation exists only
behind an evidence lock, per-run operator confirmation, sensor interlocks,
HardwareExecutionGate, and a private ticketed transport path. Delivery evidence
distinguishes not-sent, attempted/unconfirmed, and device-acknowledged. SG90
acknowledgement is open-loop and never presented as physical-position proof.

Public Alpha; no general hardware compatibility, production deployment claim,
or industrial safety certification.

https://github.com/ZqiEE/open-reality-studio

## Chinese short intro

RealityWarden v0.5.1 Public Alpha 是一个 simulation-first 的 Physical AI 桌面运行时。

它把自然语言/自定义动作送入设备能力检查、安全治理、TaskDSL、3D 仿真、回放和审计，而不是让 AI 直接控制设备。主工作流无需硬件；文档中的 ESP32 + SG90 + HC-SR04 参考台架拥有独立的 REAL HARDWARE 危险边界，必须经过证据锁、逐次人工确认、传感器互锁和私有 ticket 安全门。

当前不是通用硬件控制产品，不提供物理到位反馈证明，也没有工业安全认证。

https://github.com/ZqiEE/open-reality-studio
