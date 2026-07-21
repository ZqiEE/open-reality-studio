# RealityWarden Positioning — FINAL (locked 2026-07-21)

> This document is the single source of truth for product positioning.
> Every public surface (README, launch copy, UI copy, pitch material) must
> agree with it. Changes require an explicit owner decision recorded here.

## One-line Position

**RealityWarden is the black box and gatekeeper for AI-driven machines: a
neutral, evidence-grade safety gateway between AI intent and real actuators.
Every action is gated, refusable, and receipted — with evidence you can hand
to a regulator, an insurer, or a customer.**

一句话（中文）：**AI 与真实执行器之间的中立举证型安全网关——每个动作都过门、
可拒绝、有回执，回执可交给监管、保险公司和客户。**

## The Pain We Solve (the only one)

Embodied-AI and robotics teams can make the demo work, but get stuck at the
deployment door, because customers, insurers, and regulators do not ask
"what can it do?" — they ask:

> **"What did the AI intend at that moment? Who approved it? Where is the
> record that unsafe requests were refused?"**

Today, nobody in the stack can answer that question with evidence.
RealityWarden exists to answer exactly that question, and nothing else.

Why the pain is real now (2026):

- EU AI Act high-risk obligations (automatic logging, human oversight,
  traceability) take effect from August 2026.
- Insurers (Axis, Relm, Marsh) have started underwriting AI-driven machines
  and need per-action decision records to price risk.
- VLA/LLM-driven robots are being deployed faster than anyone can prove
  they are safe; academic work (SafeVLA, VLSA) confirms an independent
  safety layer between model and actuator is an open, unsolved need.

## Who Buys

The buyer is **the person responsible for proving why a physical command was
allowed, blocked, or never sent**:

1. embodied-AI / robotics startups facing customer PoCs, investor diligence,
   or EU deployment
2. systems integrators who carry liability for AI-driven equipment at
   customer sites
3. later: insurers and auditors who consume the receipts

Makers and educators are an on-ramp and a living proof, not the market.

## Competitive Map (why this position is open)

| Layer | Players | They answer | They cannot answer |
| --- | --- | --- | --- |
| Control-signal safety | 3Laws (CBF runtime) | "Will it collide?" | What the AI intended; whether it should run |
| Network/IT security | Claroty, Alias Robotics | "Was it hacked?" | Whether a legitimate request is dangerous |
| Agent governance (IT) | Noma Security | "What are our AI agents doing?" | Physical gating + hardware-level receipts |
| Certification | NVIDIA Halos + TÜV/UL | "Was it compliant at ship time?" | Runtime, per-action evidence |
| **Intent-level gate + evidence layer** | **open — RealityWarden** | **"What did the AI want, was it allowed, and where is the proof?"** | — |

Structural reasons giants cannot take this seat:

- **NVIDIA Halos is welded to NVIDIA hardware (IGX).** It is a moat around
  their chips, not a neutral layer, and it will never serve the long tail of
  existing machines with no NVIDIA silicon.
- **Google's robot-constitution work is welded to Gemini.** A model vendor
  cannot credibly referee its own model — the proposer must have zero
  execution authority (our invariant 5).
- **Cloud vendors ship plumbing (MCP + MQTT), not accountability.**

The judge cannot be the athlete. Neutrality — no robot brand, no chip, no
model of our own — is the position, and it is only credible for an
independent layer.

## Moat (what compounds)

1. **Receipt format first-mover**: whoever defines the de-facto standard for
   "AI physical-action audit receipts" becomes the default counterparty for
   insurers and auditors.
2. **Rule library compounding**: every deployment's safety rules and block
   policies are reusable; the 10th customer costs a fraction of the 1st.
3. **Compliance mapping asset**: six invariants mapped to EU AI Act
   Art. 12/14 and machine-safety practice (see `COMPLIANCE_MAPPING.md`).
4. **Invariants proven in code**: blocked commands structurally cannot reach
   the wire; honest `hardwareSignalSent`; refusal receipts. A weekend clone
   can copy the demo, not the proof surface.

## What RealityWarden Is Not (unchanged, non-negotiable)

- not a robot brand, chip platform, or model vendor
- not production-certified industrial safety (no such claim, ever, until
  earned)
- not a general hardware-control platform in the current Public Alpha
- simulation never substitutes for physical proof

## Narrative Order (what leads, what follows)

1. **Lead**: the gate + the receipt ("it refuses, and shows you the
   evidence")
2. **Proof**: the ESP32 reference rig — the cheapest way to watch a refusal
   happen on real hardware in 2 minutes
3. **Deferred**: open protocol, Adapter SDK, Marketplace — real, but chapter
   two. They widen the moat only after the evidence layer has customers.

## Guiding Rule

AI should not touch reality directly — and when it tries, there must be a
record.
