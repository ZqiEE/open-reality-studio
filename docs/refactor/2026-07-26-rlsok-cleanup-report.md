# RLSOK product cleanup report — 2026-07-26

## Product outcome

Public product name: **RLSOK ReleaseGate** (`RLSOK = Release OK`).

Positioning: **Release control for executable robot policies.**

Primary message: **Only RLSOK releases reach the robot.**

`README.md`, package metadata, Next metadata, Electron window/startup/about
surfaces, CLI help, daemon banner, GitHub templates, installer/executable names,
release artifacts, `SECURITY.md`, and `CONTRIBUTING.md` now use RLSOK.

The following remain intentionally compatible: the `rw` CLI alias,
`RealityWarden` values in published project/evidence/legal schemas,
`realitywarden.io` API versions, existing release/evidence IDs, repository/import
namespaces, app ID, and historical branding asset paths.

## Deletions

- Deleted unmounted legacy UI:
  - `components/MarketplaceManager.tsx`
  - `components/ManualImportWizard.tsx`
  - `components/AssetImportWizard.tsx`
  - `components/RealityAssetCatalog.tsx`
- Deleted obsolete public issue forms for device support and Reality Asset
  submission. The generic bug form now targets ReleaseGate boundaries.
- Removed `pdfjs-dist`; its only production consumer was the deleted PDF wizard.
  Lockfile and generated third-party notices were regenerated.
- Removed no Core, gate, evidence, hardware-safety, Marketplace compatibility,
  Manual Import compatibility, Lab, firmware, or test fixture files.
- Deleted no 3D asset: dynamic preload and asset-test references prevent a safe
  asset deletion in this pass.

## Archived documents

The following historical documents moved under `docs/archive/pre-rlsok/` and
carry the required archive banner:

- `MARKETPLACE_TRUST_MODEL.md`
- `REALITY_ASSET_SUBMISSION.md`
- `manual-import/MANUAL_IMPORT.md`

They are not linked from the RLSOK README.

## Retained compatibility and optional code

- `lib/marketplace/**` remains because Electron IPC/preload, project v3
  round-trips, governance, SDK publication, release packaging, and compatibility
  tests still depend on its signing/catalog types and state.
- `lib/manual-import/**` remains because device-onboarding diagnostics, stored
  records, project compatibility, and historical tests still depend on its
  validation/provenance code.
- `lib/virtual-lab/**` and Next/Electron remain as an optional development and
  visualization tool reached through `npm run lab`.
- The LLM compiler remains a compatibility/example proposer: untrusted, with no
  execution authority. Moving its import path requires a separate compatibility
  migration.
- The ESP32 path remains a reference execution adapter and continues to prove
  the hardware gate invariants.

Future deletion conditions are extraction of neutral trust/version/revocation
metadata from Marketplace, neutral provenance/schema validation from Manual
Import, migration of stable project files, and isolation of Lab packaging/tests.

## Dependency direction

```text
Core
  -> CLI
  -> Daemon
  -> ROS 2 Gateway
  -> Lab (optional consumer)
  -> Examples / reference adapters
```

The product-boundary test recursively checks Core, CLI, daemon and ROS 2 sources
for imports from React, Next.js, Electron, Marketplace, Manual Import, the LLM
compiler, or Virtual Lab. No such reverse dependency exists.

## Entry points

- `npm run build` -> headless Core TypeScript build check
- `npm start` / `npm run dev` -> RLSOK CLI help, not the legacy desktop
- `npm run rlsok -- ...` and `npm run rw -- ...` -> identical implementation
- `npm run daemon` -> truthful headless composition banner; no network or robot
  adapter is implied
- `npm run lab` / `npm run lab:build` -> explicit optional Lab

## Verification

- Root, Next, and Electron TypeScript checks: passed
- `npm run build`: passed
- `npm run lab:build`: passed
- `npm run test:releasegate`: 11 categories passed
- `npm run test:real-hardware`: 49 tests passed
- `npm run test:virtual-loopback`: 5 scenarios passed
- `npm run test:release`: passed
- `npm run test:launch-closure`: passed
- `npm run verify`: passed in approximately 421 seconds
- `git diff --check`: passed
- `rw --help` and `rlsok --help`: same RLSOK CLI implementation
- Generated notices: current, 91 npm packages / 53 unique license texts

The only final-check warnings were Git's existing LF-to-CRLF conversion notices;
they are not whitespace errors.

## Git and commit handling

Branch: `refactor/rlsok-product-cleanup`.

No commits were created. The worktree already contained first-phase ReleaseGate
files plus user-owned UI/Electron changes, and this phase necessarily touched
some overlapping product-copy and assertion files. Forcing commits would risk
mixing ownership.

Suggested manual commit groups:

1. Core/CLI/daemon aliases and product-boundary tests.
2. RLSOK public copy, README, security/contribution docs, and GitHub templates.
3. Marketplace/Manual Import UI deletion, archives, dependency and notices.
4. Optional Lab/default-script isolation and `Unsupported` UI wording.
5. RLSOK Electron/release artifact naming and related release tests.

Pre-existing `.fuse_hidden*` files were not modified or deleted.

## Remaining risks

- Live ROS 2, DDS, and SROS 2 integration is not implemented.
- Shadow Mode has contract and zero-signal tests but has not been validated
  against a live mechanical deployment.
- Marketplace and Manual Import compatibility code remains relatively large.
- The legacy Lab UI and older unarchived engineering/release documents still
  contain historical terminology; they are not in the RLSOK README path but need
  a later Lab extraction/archive pass.
- Electron/Next dependencies remain because the optional Lab is not yet a
  separate package.
- Stable RealityWarden data identifiers and npm/import namespaces have not been
  migrated; a future alias/versioned migration is required.
- The daemon is a composition root, not a shipped network service.
