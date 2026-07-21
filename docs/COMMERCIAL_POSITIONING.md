# Commercial Positioning

> Positioning is locked — see `POSITIONING.md` (2026-07-21). This file
> covers the commercial layer only: buyer, pain, wedge, monetization.

RealityWarden is the **black box and gatekeeper for AI-driven machines**: a
neutral, evidence-grade safety gateway between AI intent and real actuators.
Its commercial value is a single, sharp capability — **proving why a physical
command was allowed, blocked, or never sent**, in a form a third party
(customer, insurer, regulator, auditor) will accept.

It is not a generic website, a cloud dashboard, a robot-arm animation, or a
promise that arbitrary equipment is AI-ready. No model, imported manual,
Marketplace package, or operator input can grant itself execution authority.

Current Public Alpha boundary:

- REAL-device-first desktop shell
- one governed ESP32-S3 + SG90 + HC-SR04 reference path
- explicit SIM LAB for zero-signal review and testing
- no arbitrary/customer hardware execution
- no production deployment or certified industrial-safety claim

## The buyer

The initial buyer is not a broad consumer. It is **the person responsible
for proving why a physical command was allowed, blocked, or never sent** —
usually at:

1. embodied-AI / robotics startups facing customer PoCs, investor diligence,
   or EU-market deployment (first target: they have fresh funding, fast
   decisions, and an acute proof burden)
2. systems integrators who carry liability for AI-driven equipment at
   customer sites
3. applied labs that need reproducible allow/block evidence
4. later: insurers and auditors as receipt consumers, not first customers

## The pain (one, not six)

> "Our demo works, but we cannot deploy: the customer / insurer / regulator
> is asking for proof of safety, and nobody on our team can produce it."

Everything else the product does (fragmented integrations, hidden partial
failures, sim-vs-real confusion) is real but subordinate: they are reasons
the proof is impossible today, and the receipt is the deliverable that
resolves them. Market timing: EU AI Act high-risk logging/oversight
obligations (from Aug 2026), insurers beginning to underwrite AI-driven
machines, and record robotics funding all converge on this exact proof
burden. See `COMPLIANCE_MAPPING.md`.

## Product wedge

The wedge is the **receipt**: a one-click, signed, human- and
machine-readable audit report of every AI proposal, decision, refusal,
operator confirmation, and honest hardware-delivery outcome
(`hardwareSignalSent`). The reference-rig workflow (diagnose → flash
approved firmware → governed commands → visible refusals → honest audit)
is the two-minute living proof that the receipt describes reality.

SIM LAB supports the business by reviewing declarative assets, reproducing
policy outcomes, and developing protocols without hardware. It is valuable,
but it is not the headline and never substitutes for physical acceptance.

## Why this is not just a servo demo

The reference servo is the smallest affordable proof that the governance
architecture reaches reality. The durable commercial assets are: the audit
vocabulary and receipt format (standard-setting position), the compounding
rule/policy library, the strict device profile + Action Manifest + ticketed
gate + sensor-generation model + transport contract, and the
malicious-input test surface. New devices must reuse and tighten those
boundaries; they may not add a bypass.

Competitive note: control-layer safety (3Laws), network security (Claroty),
IT-side agent governance (Noma), and ship-time certification (NVIDIA
Halos + TÜV/UL) each answer a different question and are welded to their
vendor's stack or scope. The intent-level gate with third-party-grade
receipts, neutral across brands/chips/models, is the open seat. The judge
cannot be the athlete.

## Monetization path (receipt-led)

1. design-partner pilots: governed workflow + receipt export in a real
   PoC/evaluation (paid pilot or LOI-first)
2. per-deployment licensing: policy profiles, evidence retention, receipt
   export (per seat / per device / per policy)
3. customer-specific declarative device/profile/action onboarding
4. adapter SDK and verification support for integrators (chapter two)
5. curated declarative asset distribution after trust operations mature
   (chapter two)

The defensible wedge is not "chat with your robot." It is reducing the cost
and risk of proving that intent became — or did not become — a physical
signal through one inspectable, neutral control boundary.

## Honest current positioning

Use this statement:

> RealityWarden is a REAL-first Physical AI safety runtime in Public Alpha.
> It governs one documented reference rig today, records every decision with
> honest delivery evidence, and includes a visibly separate zero-signal
> Simulation Lab for asset review and reproducible testing.

Do not claim production readiness, certified safety, arbitrary hardware
support, or a universal multi-device operating system. An evidence layer
that overclaims is worthless — honesty about limits is part of the product.
