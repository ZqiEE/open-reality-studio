# RLSOK product cleanup audit — 2026-07-26

This audit precedes source and dependency deletion. It distinguishes the current
RLSOK ReleaseGate path from historical compatibility code and optional tools.
`RealityWarden`, `rw`, and `realitywarden.io` remain valid compatibility
identifiers; their presence alone is not evidence of a current product surface.

## Method

The audit covered static imports, dynamic imports, filesystem path construction,
tests, package scripts, TypeScript/build inputs, Electron preload/IPC wiring,
release packaging, documentation links, and the shipped page composition.
Deletion is allowed only where every relevant reference is removed or is a
negative assertion proving that the surface is not mounted.

| Path / item | Current use | Production refs | Test refs | Build / script refs | Default product? | Classification | Decision, risk, replacement | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/exec-spec`, `release-policy`, `execution-gate`, `evidence`, `action-contract`, `robot-profile`, `adapter-sdk`, `ros2-gateway` | Headless release model, policy, gate, evidence and integration contracts | CLI, daemon and package-to-package imports | ReleaseGate suites | TypeScript build and ReleaseGate runner | Yes | `KEEP_CORE` | Current product core. No replacement. | `npm run typecheck`; `npm run test:releasegate` |
| `apps/cli/rw.ts` and `scripts/run-rw.cjs` | ReleaseGate CLI | Direct command entry | CLI cases in ReleaseGate suite | `rw` package script | Yes | `KEEP_CORE` | Keep `rw`; add `rlsok` as an alias to this same implementation. | `npm run rw -- --help`; `npm run rlsok -- --help` |
| `apps/daemon/index.ts` | Headless gate composition root | Core consumers may instantiate it | ReleaseGate boundary tests | TypeScript build | Yes | `KEEP_CORE` | Keep UI-free. A daemon entry must not imply a ROS 2 network implementation. | `npm run typecheck`; dependency-boundary test |
| `lib/marketplace/**`, `marketplace/distribution.example.json`, Marketplace IPC/preload bridge | Historical catalog/signing/project compatibility | `app/page.tsx`, Electron main/preload, governance and SDK publication flows | Marketplace, desktop, conformance, project-file, release and SDK tests | Marketplace release scripts; packaging resource | No | `KEEP_COMPAT` | Unsafe to delete: it would break stable project data, Electron smoke checks and SDK/release tooling. It is not linked or mounted as an RLSOK feature. Future replacement is neutral trust/version/revocation metadata packages. | `npm run test:marketplace`; `npm run test:desktop`; `npm run test:project-files`; `npm run test:release` |
| `components/MarketplaceManager.tsx` | Unmounted legacy Marketplace UI | None; no component import or JSX mount | Negative source assertions only | Included only by broad TS input | No | `DELETE_SOURCE` | Delete after recording references. No replacement UI. Compatibility library remains. Low risk; conformance assertion continues to prove absence from the page. | `rg MarketplaceManager`; `npm run typecheck`; `npm run test:conformance` |
| `lib/manual-import/**` | Historical profile/provenance import compatibility | Device-onboarding diagnostics and legacy application logic | Manual-import, device-onboarding and accessibility contracts | TypeScript build and explicit test script | No | `KEEP_COMPAT` | Unsafe to delete until provenance/schema code is extracted and historical tests are isolated. It must not be imported by ReleaseGate core. | `npm run test:manual-import`; `npm run test:device-onboarding`; dependency-boundary test |
| `components/ManualImportWizard.tsx` | Unmounted PDF/manual onboarding UI | None; no component import or JSX mount | Negative source assertions only | Broad TS input; pulls `pdfjs-dist` into dependency graph | No | `DELETE_SOURCE` | Delete. No replacement UI; accepted executable inputs use CLI/Core validation. Low risk once `pdfjs-dist` references are rechecked. | `rg ManualImportWizard`; `npm run typecheck`; `npm run test:conformance` |
| `components/AssetImportWizard.tsx` | Unmounted simulation asset import UI | None | Negative source assertions only | Broad TS input | No | `DELETE_SOURCE` | Delete. No current-product replacement. | `rg AssetImportWizard`; `npm run typecheck`; `npm run test:conformance` |
| `components/RealityAssetCatalog.tsx` | Unmounted legacy asset catalog UI | None | Negative source assertions only | Broad TS input | No | `DELETE_SOURCE` | Delete. No current-product replacement. | `rg RealityAssetCatalog`; `npm run typecheck`; `npm run test:conformance` |
| `pdfjs-dist` | PDF parser used by `ManualImportWizard` | Only the deletion candidate above | Release/legal checks mention its packaged notice | Dependency, lockfile and notices | No | `DELETE_DEPENDENCY` | Delete only after the wizard is removed and release/notices assertions are updated or regenerated. Medium release-test risk. | `rg pdfjs-dist`; `npm install`; `npm run notices:generate`; `npm run test:release` |
| `lib/virtual-lab/**` and the existing desktop/Next application | Optional visualization and retained legacy desktop | Profiles and legacy desktop runtime | Virtual-lab, desktop, UI and hardware suites | Next/Electron build | No | `KEEP_LAB` | Retain as “Optional development and visualization tool.” Core/CLI/daemon must not import it. Use an explicit `lab` entry; desktop removal requires a later extraction. | `npm run test:virtual-lab`; `npm run test:desktop`; dependency-boundary test |
| `components/LabConfigurator.tsx`, `VirtualDeviceStage.tsx`, semantic 3D components and device models | Unmounted or legacy Lab presentation | Internal component relationships and optional Lab code | Conformance/UI tests and asset checks | Next/TypeScript build | No | `KEEP_LAB` | Do not delete piecemeal: shared types, 3D assets and tests remain coupled. Keep out of default product navigation. | `npm run test:virtual-lab`; `npm run test:assets`; `npm run build` |
| `lib/llm-compiler/**` and related manual-import/runtime adapters | Historical natural-language proposal compiler | Legacy runtime and import compatibility | Compiler/runtime/manual-import tests | TypeScript build and explicit scripts | No | `KEEP_EXAMPLE` | Treat only as an untrusted proposal source with no execution authority. Moving it now would break compatibility imports; ReleaseGate core must not depend on it. | `npm run test:llm-compiler`; dependency-boundary test |
| `lib/hardware/**`, firmware and ESP32 tests | Hardware gate and ESP32 reference rig | Real-hardware path | Hardware and 49 safety-invariant cases | Flash/diagnostic/demo scripts | No | `KEEP_EXAMPLE` | Retain as a reference execution adapter. Never claim certified or production safety. | `npm run test:real-hardware`; `npm run test:virtual-loopback` |
| Old Marketplace, manual-import, vision and positioning documents | Historical pre-RLSOK narrative | Documentation only | Some release/link assertions may name exact paths | Packaged support allow-list for selected docs | No | `ARCHIVE_DOCS` | Move documents only after exact link and packaging references are updated. Add the archive banner. | `rg` link audit; `npm run test:support`; `npm run test:release` |
| Unsupported device type definitions (`mobile_robot`, conveyor, PLC, drone, warehouse/lab types) | Legacy schemas, simulation fixtures and runtime switches | Internal runtime/type compatibility | Broad hardware, lab and schema coverage | TypeScript/Next build | No | `KEEP_COMPAT` | Keep definitions, but do not expose cards or “Coming Soon” entries in default UI. Deleting types would corrupt historical data. | `npm run typecheck`; `npm run test:conformance`; `npm run test:virtual-lab` |
| Legacy 3D assets and screenshots | Optional Lab rendering and regression evidence | 3D preload paths | Asset tests and visual acceptance | Next public assets | No | `UNKNOWN` | No asset deletion in this pass: several paths are dynamically loaded or asserted by filesystem tests. Re-audit after Lab extraction. | `npm run test:assets`; `npm run build` |

## Dependency boundaries required after cleanup

- ReleaseGate Core, CLI, and daemon must not import React, Next.js, Electron,
  Marketplace, Manual Import, the LLM compiler, or Virtual Lab.
- The optional Lab and compatibility modules may import Core.
- Public navigation and first-screen copy must not advertise Marketplace, Manual
  Import, natural-language hardware control, or unsupported device cards.
- The LLM compiler has proposal authority only. Every proposal still passes
  normal ActionContract, release resolution, and Execution Gate checks.

## Planned deletion set

The only source files approved for immediate deletion are:

- `components/MarketplaceManager.tsx`
- `components/ManualImportWizard.tsx`
- `components/AssetImportWizard.tsx`
- `components/RealityAssetCatalog.tsx`

`pdfjs-dist` is approved for deletion only after a post-source-deletion reference
scan proves it is unused outside dependency metadata and generated notices.
