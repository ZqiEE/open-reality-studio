> Archived historical document. This does not describe the current RLSOK product.

# Reality Asset Submission Guide

RealityWarden accepts Reality Asset submissions that help describe devices for simulation-first Physical AI workflows.

This guide is for contributors who want to propose or submit a Reality Asset Package.

Reality Assets are the beginning of the RealityWarden ecosystem: more devices, more adapters, more simulation packs, more safety rules, and more integration work around AI-controlled physical systems.

This guide does not enable live device execution.

## What Can Be Submitted

Accepted submission types:

- Simulation-only device asset.
- Read-only sensor asset.
- Coming Soon device proposal.
- Low-risk actuator proposal with `realAdapterEnabled: false`.

Good submissions explain what the device is, what it can do, which capabilities are supported, which natural-language prompts are safe, and which prompts must be unsupported or blocked.

Potential future asset categories include robots, robot arms, sensors, smart devices, lab equipment, factory systems, electronic toys, drones in simulation-only form, and other physical systems that can be described through a safe runtime boundary.

## What Cannot Be Submitted

Do not submit assets that require or imply:

- `realAdapterEnabled: true`.
- High-risk hardware execution.
- Weapons or weaponized behavior.
- Drones with real flight enabled.
- PLC write control enabled.
- Heating, cutting, destructive, or hazardous equipment execution.
- Assets that bypass `SafetyGovernor`.
- Assets that silently fall back to another device.
- Unauthorized vendor logos, trademarks, CAD files, or proprietary models.

## Required Files

A minimal Reality Asset Package should include:

- `asset.manifest.json`
- device manifest fields
- capability contract fields
- world model assumptions
- adapter boundary fields
- example prompts
- validation metadata

Use the template in:

```text
examples/reality-assets/templates/basic-device.asset.json
```

Validate locally:

```bash
npm run validate:reality-asset -- examples/reality-assets/templates/basic-device.asset.json
```

## Required Fields

Every submitted asset must clearly state:

- `assetId`
- `displayName`
- `deviceType`
- support level
- capability contract
- adapter mode
- `realAdapterEnabled: false`
- example safe prompts
- example unsupported prompts
- example unsafe prompts where applicable
- license/source notes

If the asset cannot be validated locally, it is not ready for review.

## Safety Checklist

Before opening a PR or issue, confirm:

- The asset is simulation-only, read-only, or Coming Soon.
- No real device command is enabled.
- No hidden fallback maps the asset to another runnable device.
- Unsupported prompts fail clearly.
- Unsafe prompts are blocked or rejected.
- The adapter boundary is explicit.
- The asset does not claim production readiness.
- The asset does not include unauthorized brand material.

## Review Rubric

Maintainers will review:

- Manifest completeness.
- Capability contract clarity.
- Adapter boundary safety.
- Example prompt quality.
- Unsupported and unsafe prompt coverage.
- No real execution.
- No silent fallback.
- License/source clarity.

## Rejection Reasons

A submission may be rejected if it:

- Enables or requests real hardware execution.
- Marks a high-risk device as runnable.
- Omits capability or adapter boundaries.
- Uses unsafe fallback behavior.
- Includes unauthorized vendor material.
- Claims certified safety or production readiness.
- Cannot pass local validation.

## Example PR Description

```md
## Reality Asset

Device type:
Support level:
Adapter mode:
realAdapterEnabled: false

## Why this asset matters

- What kind of hardware or simulation does it represent?
- What Physical AI workflow could it help describe?
- Which companies, developers, or integrators could build on it later?

## What works in simulation

- ...

## What is unsupported

- ...

## Unsafe prompts covered

- ...

## Validation

- [ ] npm run validate:reality-asset -- path/to/asset.json
- [ ] I understand RealityWarden is simulation-first.
- [ ] I am not granting this asset real-device execution authority.
```

## Real Device Boundary

RealityWarden's public asset contribution path is simulation-only. Reality
Asset submissions cannot enable live hardware control. The existing ESP32
reference rig is separately implemented behind an evidence lock,
HardwareExecutionGate, sensor interlocks, and per-run human confirmation; asset
metadata cannot select or expand that path. Any future real-device integration
requires an equally explicit, separately reviewed safety boundary.

## Marketplace signing boundary (v0.6 work)

An accepted asset may be wrapped in the strict Marketplace package envelope
and signed by a reviewed Ed25519 publisher key. Signing is not safety approval:
the consumer still rejects executable metadata, re-runs the Reality Asset
validator, derives the visible trust tier from its own local trust store, and
installs the package disabled. See `../MARKETPLACE_TRUST_MODEL.md`.

Maintainers sign only an already reviewed draft and never commit or package a
private key:

```bash
npm run marketplace:sign -- --draft reviewed-package-draft.json \
  --private-key publisher-ed25519-private.pem \
  --out signed-marketplace-package.json
```
