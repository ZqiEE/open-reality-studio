# Phase 1–2 working-tree attribution — 2026-07-26

This report classifies the dirty worktree before phase 3. Attribution is based
on the phase 1 and phase 2 task reports, the recorded pre-task status, file
content and dependency role, not file modification timestamps.

Recovery material is stored locally at:

```text
.recovery/rlsok-phase-1-2/
```

It is excluded through `.git/info/exclude`, not the repository `.gitignore`.
The directory contains tracked patches, a verified complete repository bundle,
status/name/stat snapshots, an untracked-file checksum inventory and a verified
ZIP containing all 51 untracked files. `untracked-files.tar` is incomplete due
to a Windows tar list parsing error and must not be used for recovery.

## Classification rules

| Classification | Meaning | Staging rule |
| --- | --- | --- |
| `USER_EXISTING` | Explicitly recorded as present before the ReleaseGate work | Never stage without a hunk-level human review |
| `PHASE1_RELEASEGATE` | New ReleaseGate Core, schemas, CLI, daemon, fixtures or docs | Safe to stage by explicit path |
| `PHASE2_RLSOK` | RLSOK positioning, cleanup, archives or release-name migration | Safe to stage when the whole file has no earlier user overlap |
| `SHARED_OR_AMBIGUOUS` | Contains both user work and refactor work, or spans both phases | Do not stage as a whole; retain or split hunks manually |
| `GENERATED` | Deterministically regenerated dependency/notices output | Stage with its source dependency change |
| `UNTRACKED_UNKNOWN` | Origin cannot be proven | Do not stage or delete |

## Path attribution

| Path | Change | Attribution | Evidence / overlap | Safe staging | Suggested commit | Manual handling |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/action-contract/index.ts` | add | `PHASE1_RELEASEGATE` | New strict action schema named in phase 1 report | Yes, explicit path | `feat: add executable policy specification` | No |
| `packages/robot-profile/index.ts` | add | `PHASE1_RELEASEGATE` | New strict robot/controller profile schema | Yes | `feat: add executable policy specification` | No |
| `packages/exec-spec/index.ts` | add | `PHASE1_RELEASEGATE` | New ExecSpec implementation and hashing boundary | Yes | `feat: add executable policy specification` | No |
| `packages/release-policy/index.ts` | add | `PHASE1_RELEASEGATE` | New release lifecycle, approval and revocation | Yes | `feat: add release lifecycle and revocation` | No |
| `packages/execution-gate/index.ts` | add | `PHASE1_RELEASEGATE` | New permit registry, gate and Shadow Mode | Yes | `refactor: extract execution gate and permit boundary` | No |
| `packages/evidence/index.ts` | add | `PHASE1_RELEASEGATE` | Canonical JSON, SHA-256 and evidence chain | Yes | `feat: add tamper-evident execution evidence` | No |
| `packages/adapter-sdk/index.ts` | add | `PHASE1_RELEASEGATE` | New neutral adapter contract export | Yes | `refactor: extract execution gate and permit boundary` | No |
| `packages/ros2-gateway/index.ts` | add | `PHASE1_RELEASEGATE` | Phase 1 transport-neutral interfaces/in-memory references only | Yes | `feat: add releasegate cli and daemon` | No |
| `apps/cli/rw.ts`, `apps/daemon/index.ts` | add | `PHASE1_RELEASEGATE` | New CLI and UI-free daemon composition root | Yes | `feat: add releasegate cli and daemon` | No |
| `scripts/run-releasegate-tests.cjs`, `scripts/run-rw.cjs` | add | `PHASE1_RELEASEGATE` | New runners for phase 1 | Yes | relevant feature/test commit | No |
| `tests/fixtures/releasegate/**` | add | `PHASE1_RELEASEGATE` | New minimal release fixtures | Yes | `test: enforce releasegate boundaries` | No |
| `tests/releasegate/**` | add | `SHARED_OR_AMBIGUOUS` | Phase 1 gate tests plus phase 2 product-boundary tests in one file | Hunk/path split required | phase 1 tests, then phase 2 boundary test | Yes |
| `docs/EXEC_SPEC.md`, `EVIDENCE_FORMAT.md`, `RELEASE_LIFECYCLE.md`, `MIGRATION_FROM_LEGACY.md`, `THREAT_MODEL.md` | add | `PHASE1_RELEASEGATE` | New phase 1 architecture/security documents | Yes | `docs: define releasegate product boundary` | No |
| `docs/ROS2_GATEWAY.md` | add | `PHASE1_RELEASEGATE` | Phase 1 interface-contract status; phase 3 will update after baseline commit | Yes | `docs: define releasegate product boundary` | No |
| `docs/refactor/2026-07-26-releasegate-audit.md` | add | `PHASE1_RELEASEGATE` | Phase 1 audit record | Yes | `docs: define releasegate product boundary` | No |
| `examples/ros2-arm-demo/README.md` | add | `PHASE1_RELEASEGATE` | Phase 1 interface-only placeholder | Yes | `docs: define releasegate product boundary` | No |
| `types/js-yaml.d.ts` | add | `PHASE1_RELEASEGATE` | Required by the phase 1 CLI YAML reader | Yes | `feat: add releasegate cli and daemon` | No |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | modify | `PHASE2_RLSOK` | Whole-file RLSOK rewrites performed in phase 2; no pre-task user overlap recorded | Yes | `docs: rebrand product as RLSOK ReleaseGate` | Review before commit |
| `docs/PRODUCT_POSITIONING.md`, `SECURITY_BOUNDARY.md` | add | `PHASE2_RLSOK` | New RLSOK positioning and boundary docs | Yes | `docs: rebrand product as RLSOK ReleaseGate` | No |
| `docs/refactor/2026-07-26-rlsok-cleanup-audit.md`, `2026-07-26-rlsok-cleanup-report.md` | add | `PHASE2_RLSOK` | Phase 2 audit/delivery records | Yes | `docs: rebrand product as RLSOK ReleaseGate` | No |
| `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md` | modify/delete | `PHASE2_RLSOK` | Explicit phase 2 product-surface cleanup | Yes | `docs: rebrand product as RLSOK ReleaseGate` | No |
| `components/AssetImportWizard.tsx`, `ManualImportWizard.tsx`, `MarketplaceManager.tsx`, `RealityAssetCatalog.tsx` | delete | `PHASE2_RLSOK` | Phase 2 audit proved no imports/mounts before deletion | Yes | `chore: remove obsolete product surfaces` | No |
| `docs/MANUAL_IMPORT.md`, `MARKETPLACE_TRUST_MODEL.md`, `REALITY_ASSET_SUBMISSION.md` plus `docs/archive/pre-rlsok/**` | move/archive | `PHASE2_RLSOK` | Exact source-to-archive moves with archive banners | Yes, stage deletion and destination together | `chore: remove obsolete product surfaces` | No |
| `archive/marketplace-alpha/README.md`, `experimental/manual-import/README.md`, `experimental/simulation-workbench/README.md`, `apps/lab/README.md` | add | `PHASE2_RLSOK` | Explicit compatibility/Lab isolation markers | Yes | `refactor: isolate optional lab and legacy integrations` | No |
| `examples/natural-language-proposer/README.md`, `examples/reference-esp32-rig/README.md` | add | `PHASE2_RLSOK` | Explicit proposer/reference-adapter positioning | Yes | `refactor: isolate optional lab and legacy integrations` | No |
| `app/layout.tsx`, `components/AppHeader.tsx`, `components/startup/**`, `electron/menus/appMenu.ts`, `electron/startupShell.ts`, `electron/support/supportActions.ts` | modify | `PHASE2_RLSOK` | Small public product-name changes; no earlier user overlap recorded for these files | Yes after diff review | `docs: rebrand product as RLSOK ReleaseGate` | No |
| `docs/DEVICE_SUPPORT.md`, `RELEASE_NOTES_V0.5.1.md`, `WINDOWS_TRIAL_GUIDE.md` | modify | `PHASE2_RLSOK` | RLSOK support/artifact wording | Yes | RLSOK docs/release naming commits | No |
| `scripts/after-pack.cjs`, `pack-electron.cjs`, `prepare-public-release.cjs`, `run-product-design-acceptance.cjs`, `run-startup-design-acceptance.cjs`, `verify-electron-package.cjs`, `verify-windows-install-lifecycle.cjs`, `windows-authenticode.cjs`, `write-release-evidence.cjs`, `write-supply-chain-evidence.cjs` | modify | `PHASE2_RLSOK` | Mechanical current-artifact rename; stable schema values retained | Yes | `docs: rebrand product as RLSOK ReleaseGate` or release-artifact subcommit | No |
| `lib/release/runLaunchClosureTests.js`, `runPublicReleaseTests.js`, `runReleaseTests.js` | modify | `PHASE2_RLSOK` | Assertions/fixtures updated with product and artifact names | Yes | release-artifact subcommit | No |
| `package-lock.json`, `docs/THIRD_PARTY_NOTICES.md`, `docs/THIRD_PARTY_NOTICES.html` | modify | `GENERATED` | `pdfjs-dist` removal followed by `npm install` and notices generation | Yes with package change | `chore: remove obsolete product surfaces` | No |
| `package.json` | modify | `SHARED_OR_AMBIGUOUS` | Phase 1 scripts, phase 2 aliases/default-path/dependency/release metadata in one file; no user ownership but spans commits | Hunk split recommended | CLI/core, cleanup, then artifact-name commits | Yes |
| `scripts/run-rlsok-daemon.cjs` | add | `PHASE2_RLSOK` | Phase 2 truthful daemon banner | Yes | `feat: add releasegate cli and daemon` | No |
| `app/page.tsx` | modify | `SHARED_OR_AMBIGUOUS` | Explicitly dirty before phase 1; later targeted RLSOK copy edits overlap | No whole-file staging | Leave uncommitted or stage only proven RLSOK hunks | Yes |
| `components/AuditPanel.tsx`, `AutonomyDecisionPanel.tsx`, `EvidenceSidebar.tsx`, `OperatorNotice.tsx`, `RealDeviceWorkspace.tsx`, `RealHardwarePanel.tsx` | modify | `USER_EXISTING` | Recorded as user UI work before refactor; later tests depend on current state | No | None without user review | Yes |
| `electron/main.ts`, `electron/preload.ts` | modify | `SHARED_OR_AMBIGUOUS` | Recorded user Electron work plus phase 2 title/smoke changes | No whole-file staging | Hunk-level RLSOK changes only | Yes |
| `lib/conformance/runConformance.js`, `lib/desktop/runDesktopTests.js`, `lib/ui/runAccessibilityTests.js` | modify | `SHARED_OR_AMBIGUOUS` | Pre-existing UI assertions plus phase 1/2 boundary assertion changes | No whole-file staging | Hunk-level test commits | Yes |
| `docs/ROADMAP.md` | modify | `SHARED_OR_AMBIGUOUS` | Earlier product planning plus appended migration content | No whole-file staging | Leave for manual review | Yes |
| `lib/i18n.ts` | modify | `SHARED_OR_AMBIGUOUS` | Existing UI localization plus phase 2 RLSOK/Unsupported wording | Hunk split only | RLSOK product-surface commit | Yes |
| `COMMIT_MSG_step2.txt` | delete | `UNTRACKED_UNKNOWN` | Deletion predates phase 3 and is not required by either phase report | No | None | Yes |
| `app/.fuse_hidden*`, `components/.fuse_hidden*` | add | `UNTRACKED_UNKNOWN` | Explicitly pre-existing opaque filesystem artifacts | Never | None | Yes; do not delete |

## Safe commit boundary

The untracked Phase 1 packages, interfaces, CLI/daemon, fixtures and documents
can be committed by explicit path without touching user files. Phase 2
whole-file docs, audited deletions/archives, deterministic generated outputs and
release artifact scripts are also attributable.

The following must remain unstaged unless split interactively:

```text
app/page.tsx
components/AuditPanel.tsx
components/AutonomyDecisionPanel.tsx
components/EvidenceSidebar.tsx
components/OperatorNotice.tsx
components/RealDeviceWorkspace.tsx
components/RealHardwarePanel.tsx
electron/main.ts
electron/preload.ts
lib/conformance/runConformance.js
lib/desktop/runDesktopTests.js
lib/ui/runAccessibilityTests.js
lib/i18n.ts
docs/ROADMAP.md
package.json
tests/releasegate/releaseGate.test.ts
COMMIT_MSG_step2.txt
```

No phase 3 feature work should begin until the safe groups are committed and
the remaining overlap is explicitly recorded.
