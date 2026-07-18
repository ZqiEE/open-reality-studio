# Product Vision — RealityWarden

Status: APPROVED 2026-07-07 (six invariants and v0.3→v0.6 order confirmed by owner)
Scope: product direction v0.3 → v0.6
Relationship to other docs: `PRD.md` describes the current product; `ROADMAP.md`
tracks execution order; `COMMERCIAL_POSITIONING.md` states the market thesis;
this document states where the product is going and the rules that constrain
every step of the way there. On conflict about safety semantics,
`OPEN_REALITY_PROTOCOL.md` (see `PROTOCOL_INDEX.md`) remains authoritative.

## Vision statement

RealityWarden becomes **the safety runtime between language AI and real
hardware — for everyone, not just developers.**

Today the product is a simulation-first virtual lab. The destination is: a
maker with a $5 ESP32 and a hobby servo goes from unboxing to safely running
natural-language commands on real hardware in under 15 minutes — no Arduino
IDE, no firmware knowledge, no YAML — and at no point along that journey is a
single safety guarantee weaker than it is in today's simulation.

**Owner correction (2026-07-18):** "simulation-first" describes the safety
pipeline and historical lab capability, not the permanent primary desktop
navigation. The default product shell is REAL-device-first. Simulation remains
an explicit, visibly separate secondary mode for asset review, protocol work,
and no-signal testing; a generic virtual model must never occupy the primary
workspace or imply a mapping to connected hardware.

The thesis stays what it has always been: AI must never jump straight from
text into actuation. Every proposal — whether it comes from an LLM, a
marketplace asset, an imported manual, or the user's own custom action — is
untrusted input to the same pipeline: schema validation → capability check →
rule-based risk → safety gate → audit. Growth means widening what flows *into*
that pipeline, never adding a path *around* it.

## Baseline (v0.2)

Simulation-first virtual lab; real-hardware execution gate (`lib/hardware/`)
implemented and tested but not yet in the main UI; LLM task compiler core
implemented behind the approved draft (`LLM_COMPILER_DRAFT.md`); verify chain
green; four-scenario real-device acceptance pending. Everything below assumes
that acceptance passes first.

## The six invariants

These bind every pillar and every version. Numbering of 1–5 is being
formalized here for the first time; item 6 is already cited by number in
project records.

1. **Single gated path.** The safety gate is the only code path to hardware.
   A blocked decision means zero frames on the wire — structurally, not by
   convention.
2. **Default-block.** Missing, stale, or invalid information (sensors,
   manifests, profiles) blocks actuation. Absence of evidence is never
   permission.
3. **No silent fallback.** Every degradation (LLM offline, driver missing,
   device unreachable) is explicit, logged, and visible in the UI. The system
   never guesses and never pretends.
4. **Honest audit.** Every decision is recorded with truthful provenance:
   which compiler ran, whether a hardware signal was actually sent
   (`hardwareSignalSent`), which rules triggered. Reports never claim more
   than what happened.
5. **Untrusted proposers.** Models, imported manuals, marketplace assets, and
   user manifests are proposal generators with zero execution authority. Risk
   is always recomputed by our rules; a proposer's self-assessment gets zero
   weight. Out-of-range requests are refused, never clamped.
6. **Simulation and reality are visibly distinct.** Simulated runs are marked
   `[SIMULATION]`; real runs are marked `real_hardware`. A user can always
   tell which world they are acting in, at any window size.

## Four pillars

### 1. One-click firmware flashing（一键烧录芯片）

**What:** From inside the app: plug in a supported board → auto-detect chip
and port → flash a signed, prebuilt RealityWarden firmware bundle → verify
with a protocol handshake. No Arduino IDE, no library manager, no COM-port
archaeology.

**Why:** Flashing is currently the tallest step of the onboarding staircase
(today: install IDE, install two libraries, pick a board, open a serial
monitor, remember to close it). It is also a safety feature: firmware we built
refuses out-of-range commands *on-chip*, so one-click flashing means every
onboarded device carries the second, independent safety layer by default.

**Safety binding:** Only signed official bundles flash via the one-click path
(invariant 5). Flash-then-verify: a device is not "onboarded" until the
handshake proves the expected firmware version is responding (invariants 2,
4). Failed or interrupted flashes report exactly what happened (invariant 3).

**Not:** flashing arbitrary user firmware through the one-click path; that
remains a documented manual workflow outside the product's trust claims.

### 2. User-defined actions（用户自定义动作）

**What:** Users compose new named actions for their device from existing
capability primitives, through a declarative Action Manifest (JSON,
zod-validated) and a capability editor UI — e.g. "scan_left_to_right" =
sequenced `set_angle` steps with per-step sensor preconditions.

**Why:** A fixed capability list caps what the product can be. Makers'
devices are heterogeneous; the value is letting them express *their* device's
verbs without writing runtime code.

**Safety binding:** Manifests are data, never code — no user code executes in
the runtime (invariant 5). Every custom action must declare its safety
envelope (ranges, required sensors, risk-relevant metadata); undeclared or
schema-violating manifests are rejected (invariant 2). At run time a custom
action expands to primitives and each primitive passes the full existing
pipeline — a manifest cannot grant a device an ability its profile does not
have, and cannot relax any rule (invariant 1). Release gate: a
"cooperating-malicious manifest" test suite, same posture as the
cooperating-malicious-model gate.

**Not:** user-provided scripts/plugins in the execution path; manifest-driven
bypass of per-primitive checks ("trust the composite" is banned).

### 3. Manual import（说明书导入）

**What:** Import a device datasheet or manual (PDF) → a local LLM extracts a
*draft* DeviceProfile + Action Manifest → the user reviews a human-readable
diff ("this manual claims: 0–180°, 5V, PWM on pin…") → user confirms →
profile enters the normal validation suite → device must pass simulation
dry-runs before real execution is even offered.

**Why:** Hand-writing device profiles is the second-tallest onboarding step
and the least fun. Manuals already contain the facts; extraction is exactly
the kind of work an untrusted LLM is good for.

**Safety binding:** Identical trust posture to the LLM task compiler: the
extraction is an untrusted proposal, strictly upstream of all checks
(invariant 5). Nothing auto-enables — human confirmation is mandatory and the
audit log records `profile_source: manual_import` with the raw extraction
retained (invariant 4). A fabricated or hallucinated capability can never
become executable without explicit human confirmation *and* passing
validation (invariant 2). Extraction failures are reported as failures, never
papered over with guessed defaults (invariant 3).

**Not:** fully automatic onboarding ("import and run"); cloud OCR/LLM
dependency — extraction runs on the same local Ollama stack as the compiler.

### 4. Ecosystem marketplace（生态市场）

**What:** A community exchange for declarative assets: device profiles,
action packs, scenario/lab setups, visual assets — building on the existing
`REALITY_ASSET_SUBMISSION.md` pipeline. Browse, install, and share from
inside the app.

**Why:** Pillars 1–3 make individual onboarding cheap; the marketplace makes
it *cumulative*. The hundredth user of a sensor should benefit from the
first user's reviewed profile. This is also the commercial surface: trust and
curation are the product.

**Safety binding:** Marketplace distributes **data only — never executable
code** (invariant 5). Every asset carries mandatory safety metadata and a
signature; trust tiers (official / verified / community) are displayed, never
inferred. Installation is a proposal: assets arrive disabled, must run in
simulation first, and require an explicit user step to touch real hardware
(invariants 2, 6). Install/enable/uninstall are all audited (invariant 4).
Release gate: a red-team asset pack (malicious manifests, over-range
envelopes, spoofed metadata) must be 100% rejected or contained.

**Not:** adapter *code* distribution through the marketplace in v0.x; paid
listings before the trust mechanics have shipped and survived contact with
strangers.

## Roadmap v0.3 → v0.6

Each version has a theme, its pillar, and a hard acceptance gate. Order is
deliberate: 1 (flash) before 2 (actions) before 3 (import) before 4 (market),
because each pillar's trust mechanics are the foundation of the next.

### v0.3 — Real hardware in the product

Prerequisite: automated real-hardware invariants, virtual-loopback scenarios,
package verification, and smoke tests pass. Physical reference-kit acceptance
is optional field evidence, never a development or release gate.

- Wire `lib/hardware/` into the main UI: device panel with explicit
  `REAL HARDWARE` identity, connection wizard, port selection (invariant 6).
- LLM compiler UI wiring per the approved draft: status chip, `[COMPILER]`
  log lines, explicit fallback badge.
- One-click flashing MVP for the reference kit (ESP32 + SG90 + HC-SR04):
  bundled flasher + signed firmware, auto-detect, flash, handshake-verify.
- Delete the three `@deprecated` legacy adapter files.

Gate: on a clean Windows machine with no Arduino IDE, a new user flashes the
reference kit and reproduces all four acceptance scenarios entirely from the
UI. Verify chain green throughout.

### v0.4 — Your device, your actions

- Action Manifest format (zod schema, versioned) + capability editor UI.
- Custom actions expand to primitives; per-primitive safety evaluation
  unchanged and unavoidable.
- Sensor polling/subscription model (replaces pull-once-before-execute), so
  interlocks hold *during* multi-step custom actions.
- Second and third reference device recipes to prove the manifest generalizes.

Gate: cooperating-malicious-manifest suite green; a custom action interrupted
mid-sequence by an interlock stops with zero further frames; all existing
suites green.

### v0.5 — Manual import

- PDF/manual → local-LLM extraction → draft profile + manifest → review-diff
  UI → validation suite → simulation-first enablement.
- Profile validation suite hardened into a reusable gate (also used by v0.6).

Gate: three real reference manuals import to working profiles with human
review; a deliberately falsified manual (fabricated capability, wrong voltage
range) never yields an executable capability without explicit human
confirmation, and the audit trail shows the full provenance.

### v0.6 — Marketplace alpha

- Submission → review → signing pipeline (extends the existing asset
  submission flow); trust tiers; in-app browse/install.
- Installed assets: disabled by default → simulation-first → explicit
  real-hardware enablement.
- Uninstall is clean (no residual capabilities, profiles, or manifests).

Gate: red-team asset pack 100% rejected or contained; end-to-end story works
— install a community profile for a device you own, flash (v0.3), add a
custom action (v0.4) or import its manual (v0.5), run safely on real
hardware, publish your improved profile back.

## What we will never do

Add a code path to hardware that bypasses the safety gate. Clamp instead of
refuse. Fall back silently. Give any model, manifest, or marketplace asset
execution authority. Require the cloud for a safety decision. Ship an audit
log that flatters. Blur the line between simulation and reality.

## Out of scope through v0.6

Industrial/vendor-certified safety claims, multi-site fleet management, cloud
sync and accounts, mobile clients, paid marketplace transactions, fine-tuned
models, and any protocol change that is not additive.
