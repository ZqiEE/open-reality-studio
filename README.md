# Open Reality Studio Desktop

Open Reality Studio Desktop is an early desktop prototype for simulation-first AI device development.

It is a local virtual lab for building, simulating, testing, debugging, and validating AI-controlled device workflows before touching real hardware.

No hardware required.

## Public Alpha Status

This repository is currently a **simulation-only Public Alpha**.

Current public alpha support is intentionally narrow:

- `robot_arm`
- `smart_light`
- `camera_sensor`

These three device paths are the only ones treated as runnable in the main desktop Run flow.

Everything else is still scaffolded or **Coming Soon**.

Same protocol for simulation and future real devices.

If you are evaluating the product for the first time, start with [docs/EVALUATION_GUIDE.md](./docs/EVALUATION_GUIDE.md).

If you want the Windows install-and-try path, use [docs/WINDOWS_TRIAL_GUIDE.md](./docs/WINDOWS_TRIAL_GUIDE.md).

First-run workflow for Public Alpha:

1. Stay on `robot_arm`, `smart_light`, or `camera_sensor`.
2. Add or select the workspace device you want to run.
3. Enter the task in **AI Command** below the workspace.
4. Watch the workspace for motion or blocked state, then confirm details in the inspector and bottom console.
5. Remember: this Public Alpha is **simulation-only**. Real device execution is not enabled.

## Open Reality Protocol v0.1

The stable `v0.2` contract layer now lives under `lib/open-reality-protocol`.

It reuses the Runtime Kernel contracts and makes the public protocol boundary explicit:

- `DeviceManifest`
- `CapabilityContract`
- `WorldModel`
- `Goal`
- `Plan`
- `SafetyEnvelope`
- `TaskDSL`
- `AdapterBoundary`

See [docs/OPEN_REALITY_PROTOCOL.md](./docs/OPEN_REALITY_PROTOCOL.md).

Robot Arm demo video: https://github.com/ZqiEE/open-reality-studio/releases/download/v0.1-public-alpha/open-reality-robotarm-demo-release-cut-web.mp4

## What This Alpha Does

- Runs a desktop virtual lab UI
- Compiles prompts into safe simulated execution flows
- Shows command-driven virtual-device playback
- Runs Safety Runtime before simulated execution
- Produces adapter commands, execution timeline, and Lab Report
- Supports project/workspace state inside the desktop workbench
- Can be packaged into a Windows desktop installer from the repository source tree

## What This Alpha Does Not Do

- No real device execution
- No production hardware control
- No certified industrial safety guarantee
- No cloud runtime
- No marketplace
- No LocalRuntime / EdgeRuntime for real hardware yet

## Supported Public Alpha Device Paths

| Device Type | Main Run | Notes |
| --- | --- | --- |
| `robot_arm` | Yes | Golden-path autonomy + playback demo |
| `smart_light` | Yes | Limited low-risk natural-language simulation run |
| `camera_sensor` | Yes | Limited low-risk natural-language simulation run |
| `mobile_robot` | No | Coming Soon |
| `conveyor_belt` | No | Coming Soon |
| `plc_cabinet` | No | Coming Soon |
| `lab_instrument` | No | Coming Soon |
| `warehouse_rack` | No | Coming Soon |
| `sensor_box` | No | Coming Soon |

See [docs/DEVICE_SUPPORT.md](./docs/DEVICE_SUPPORT.md) for the exact support matrix.

## Quick Start

Install dependencies:

```bash
npm install
```

Run web development mode:

```bash
npm run dev
```

Run the desktop shell in development mode:

```bash
npm run desktop:dev
```

Run the production shell from source after a production build:

```bash
npm run desktop:prod
```

Run a non-interactive desktop production smoke check:

```bash
npm run desktop:smoke
```

Create a Windows desktop installer:

```bash
npm run desktop:pack
```

The installer is written to:

```text
release/Open-Reality-Studio-<version>-Setup.exe
```

For the current Public Alpha build, the packaged installer path is:

```text
release/Open-Reality-Studio-0.1.1-Setup.exe
```

`npm run desktop:start` is a convenience script for local development. For repeatable evaluation, use `desktop:dev` or `desktop:prod` explicitly.

Build the app:

```bash
npm run build
```

Run TypeScript checks:

```bash
npm run typecheck
```

Run verification:

```bash
npm run verify
```

Run protocol validation:

```bash
npm run test:protocol
```

## Execution Model

Simulation path:

```text
Prompt
-> Device Profile
-> Task DSL
-> Safety Runtime
-> Adapter Commands
-> Virtual Device Runtime
-> Lab Report
```

For `robot_arm`, the main path also includes the current `AutonomyCore` / `RiskJudge` chain before simulated execution.

## Natural Language Boundary

Natural-language support is not universal.

- `robot_arm` supports the current golden-path AI command flow.
- `smart_light` supports a limited set of low-risk Chinese/English prompts.
- `camera_sensor` supports a limited set of low-risk Chinese/English prompts.
- Unsupported prompts must fail clearly and must not silently fall back into execution.

## Asset Boundary

Built-in assets are **generic industrial-style assets**.

They do **not** use unauthorized vendor logos, trademarks, or vendor CAD files.

## Future Real Device Adapter Boundary

The repository keeps future-facing adapter abstractions, but **real device execution is not part of this Public Alpha**.

Future real-device work must remain behind:

- certified adapters
- verified transport
- local safety enforcement
- human supervision

## Docs

- [docs/EVALUATION_GUIDE.md](./docs/EVALUATION_GUIDE.md)
- [docs/WINDOWS_TRIAL_GUIDE.md](./docs/WINDOWS_TRIAL_GUIDE.md)
- [docs/DEVICE_SUPPORT.md](./docs/DEVICE_SUPPORT.md)
- [docs/DEVICE_ONBOARDING.md](./docs/DEVICE_ONBOARDING.md)
- [docs/OPEN_REALITY_PROTOCOL.md](./docs/OPEN_REALITY_PROTOCOL.md)
- [docs/PROTOCOL.md](./docs/PROTOCOL.md)
- [docs/COMMERCIAL_POSITIONING.md](./docs/COMMERCIAL_POSITIONING.md)
- [docs/CUSTOMER_VALIDATION.md](./docs/CUSTOMER_VALIDATION.md)
- [docs/RELEASE_NOTES_V0.2_ALPHA.md](./docs/RELEASE_NOTES_V0.2_ALPHA.md)
- [docs/RELEASE_READINESS_V0.2_ALPHA.md](./docs/RELEASE_READINESS_V0.2_ALPHA.md)
- [docs/FIRST_LOW_RISK_REAL_DEVICE_PLAN.md](./docs/FIRST_LOW_RISK_REAL_DEVICE_PLAN.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
- [docs/DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md)
- [docs/VIRTUAL_LAB.md](./docs/VIRTUAL_LAB.md)
- [docs/DEVICE_ACTION_RUNTIME.md](./docs/DEVICE_ACTION_RUNTIME.md)
- [docs/ADAPTER_SDK.md](./docs/ADAPTER_SDK.md)
