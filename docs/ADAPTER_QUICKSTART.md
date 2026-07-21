# Adapter SDK — Developer Quickstart

Build a **governed device adapter** for RealityWarden and submit it to the
marketplace — self-serve, from zero to a governance-green submission in minutes,
with no human review round-trip to discover a safety problem.

The whole point: **you prove your adapter passes the exact governance the
platform enforces, on your own machine, before you submit.**

```
  sdk:catalog     →   sdk:scaffold        →   sdk:conformance      →   sdk:submit
  pick a standard     generate a skeleton     self-certify it          governance-locked draft
  (common cases)      (green on creation)     (9 governance checks)    (refuses if not green)
```

> For the internal adapter architecture (AdapterInterface, SimulatorAdapter, the
> ticketed real-hardware boundary), see [`ADAPTER_SDK.md`](./ADAPTER_SDK.md).

---

## Prerequisites

- Node.js `>= 22.12` and npm `>= 10.5` (see `package.json` `engines`).
- Clone the repo and `npm install`.

---

## 0. Discover a standard profile

Most devices fit a common case. List the standard profiles and start from the
closest one instead of authoring from scratch:

```bash
npm run sdk:catalog
```

Each listed standard is governance-green and maps to a real reference profile —
today: pick-and-place / generic / desktop / restricted-lab arms, RGB light,
on/off switch, dimmable light, and inspection camera.

## 1. Scaffold a new adapter

**From a standard** (recommended) — clone the closest catalog entry:

```bash
npm run sdk:scaffold -- --from light-switch --name my-switch --display "My Switch" --vendor "Acme"
```

**Or from a raw device type** — a minimal template for the family:

```bash
npm run sdk:scaffold -- --type smart_light --name my-lamp --display "My Lamp" --vendor "Acme"
```

- `--from` — a standard catalog id (see `sdk:catalog`); or `--type` — one of
  `robot_arm`, `smart_light`, `camera_sensor` (the runnable families).
- `--name` — a kebab-case slug; becomes the profile directory and `profile_id`.
- `--display`, `--vendor` — optional human labels.

Either way this writes `profiles/<name>/device.meta.json` + `geometry.json` and
immediately runs the governance self-check, so you see **GREEN on creation**. It
never overwrites an existing directory.

Then edit `profiles/my-lamp/device.meta.json` (capabilities, constraints,
display) and `geometry.json` to describe your real device.

---

## 2. Self-certify with sdk:conformance

At any time, prove your adapter passes governance:

```bash
npm run sdk:conformance -- profiles/my-lamp
```

It runs the **same authoritative validators the runtime uses** — there is no
softer private path. A green result means the platform's Safety Governor will
accept your adapter as a simulation-only proposal. The nine checks:

| Check | What it proves |
|---|---|
| `manifest_builds` | Your profile compiles into a device manifest. |
| `zero_real_execution_authority` | `realAdapterEnabled` is false (invariant 5). |
| `sdk_real_boundary_disabled` | The SDK exposes no real-device execution path. |
| `simulation_adapter_available` | A simulation adapter boundary exists. |
| `runtime_task_compiles` | A plain-language task compiles for your device. |
| `plan_dry_run_only` | The adapter plan stays dry-run-only, never real. |
| `plan_validates` | The adapter's own plan validation passes. |
| `dry_run_succeeds` | The plan dry-runs cleanly. |
| `platform_safety_gate` | **The authoritative gate authorizes it.** |

If anything fails, the output names the check and the reason, and points you to
the next step when green. Nothing is ever executed on hardware.

If your device's world model uses different objects/zones than the default, give
the check a representative task so `runtime_task_compiles` can resolve it:

```bash
npm run sdk:conformance -- profiles/my-arm --prompt "put the red cube in the right safe zone"
```

---

## 3. Submit

When green, produce a ready-to-submit marketplace draft:

```bash
npm run sdk:submit -- profiles/my-lamp
```

`sdk:submit` re-runs the conformance gate first and **refuses to produce a
submission unless your adapter is green.** The draft it writes
(`profiles/my-lamp/submission.draft.json`) carries governance guarantees that are
enforced by schema — they cannot be edited away without breaking the asset
digest:

```
  execution_authority_granted = false
  real_adapter_enabled        = false
  trust_tier_granted          = null      (granted only by platform review)
  signature_present           = false
  review_state                = local_draft_unsubmitted
```

Your submitted adapter is a **proposal with zero execution authority** until the
platform grants it a trust tier. That is the deal that lets any developer publish
safely: nothing you submit can bypass the safety gate — structurally, not by
policy.

### Pre-flight the draft (optional)

The platform verifies every incoming draft independently — trusting nothing you
claim, recomputing the asset digest, re-running asset governance, and checking
each forced literal. You can run that exact verification yourself before sending:

```bash
npm run sdk:review -- profiles/my-lamp/submission.draft.json
```

`ACCEPTED` means it will pass platform intake. Any tamper (an edited asset, a
self-granted execution authority or trust tier) is `REJECTED` at this gate.

---

## The governance contract (what the platform guarantees you)

- **You cannot ship something unsafe by accident.** Every path to real actuation
  is behind the Safety Governor; a submission carries no execution authority.
- **The check you run is the check the platform runs.** `sdk:conformance` and
  `sdk:submit` call the runtime's own validators, so green-here means green-there.
- **Trust is earned, not asserted.** `trust_tier_granted` starts null; the
  platform grants it through review. Your self-check gets you to a *submittable*
  state, not to execution authority.

---

## Verifying the tooling

The on-ramp is covered by tests (positive **and** negative — the checks have
teeth, they are not always-green), including an end-to-end test that runs
scaffold → conformance → submit as one flow:

```bash
npm run test:sdk-conformance   # governance self-check
npm run test:sdk-scaffold      # skeleton generation
npm run test:sdk-submit        # submission draft
npm run test:fast              # the whole local gate, including the above
```

`npm run test:fast` runs the full fast local gate (compile once, run every
suite). `npm run verify` remains the canonical pre-release gate.
