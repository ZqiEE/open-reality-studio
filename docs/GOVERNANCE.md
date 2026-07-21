# Governance Invariants — the auditable moat

RealityWarden's promise is that safety is enforced **structurally, not by policy**.
Each invariant below names where it is enforced and which test proves it. Do not
trust the claim — run the tests.

> This file is generated from `lib/governance/invariants.ts` and kept honest by
> `tests/governance-invariants/governanceMap.test.ts` (every enforcement file must
> exist; every proof test must be a real npm script). Run all proofs with
> `npm run test:fast`, or the canonical `npm run verify`.

## 1. Single gated path

The safety gate is the only code path to hardware. A blocked decision means zero frames on the wire — structurally, not by convention.

- Enforced in: `lib/hardware/HardwareExecutionGate.ts`, `lib/hardware/internal/actuation.ts`
- Proven by: `npm run test:real-hardware`, `npm run test:conformance`

## 2. Default-block

Missing, stale, or invalid information (sensors, manifests, profiles) blocks actuation. Absence of evidence is never permission.

- Enforced in: `lib/runtime/SafetyMonitor.ts`, `lib/hardware/SensorConditioning.ts`
- Proven by: `npm run test:real-hardware`

## 3. No silent fallback

Every degradation (LLM offline, driver missing, device unreachable) is explicit, logged, and visible. The system never guesses and never pretends.

- Enforced in: `lib/hardware/Esp32DeviceAdapter.ts`, `lib/runtime/SafetyMonitor.ts`
- Proven by: `npm run test:real-hardware`, `npm run test:conformance`

## 4. Honest audit

Every decision is recorded with truthful provenance: which compiler ran, whether a hardware signal was actually sent (hardwareSignalSent), which rules triggered.

- Enforced in: `lib/runtime/RuntimeAuditLog.ts`, `lib/hardware/HardwareExecutionGate.ts`
- Proven by: `npm run test:real-hardware`, `npm run test:conformance`

## 5. Untrusted proposers

Models, imported manuals, marketplace assets, and user/submission manifests are proposal generators with zero execution authority. Risk is always recomputed by our rules; a proposer's self-assessment gets zero weight.

- Enforced in: `lib/runtime/SafetyMonitor.ts`, `lib/marketplace/MarketplaceSubmission.ts`, `scripts/sdkReview.ts`
- Proven by: `npm run test:marketplace`, `npm run test:sdk-review`, `npm run test:autonomy`

## 6. Simulation and reality are visibly distinct

Simulated runs are marked [SIMULATION]; real runs are marked real_hardware. A user can always tell which world they are acting in.

- Enforced in: `lib/hardware/HardwareExecutionGate.ts`
- Proven by: `npm run test:conformance`, `npm run test:desktop`

## 7. Trust is not execution authority (ecosystem)

Across submit, review, publish, and catalog, a trust tier governs distribution and visibility only. A published, verified package keeps realAdapterEnabled=false at every tier; the marketplace can never open real actuation.

- Enforced in: `lib/marketplace/MarketplacePackage.ts`, `lib/marketplace/MarketplaceCatalog.ts`, `scripts/sdkPublish.ts`, `scripts/sdkCatalogBuild.ts`
- Proven by: `npm run test:sdk-publish`, `npm run test:sdk-catalog-build`, `npm run test:ecosystem-chain`
