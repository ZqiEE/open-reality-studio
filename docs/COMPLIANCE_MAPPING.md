# Compliance Mapping — Six Invariants → Regulatory Obligations

Status: working draft (2026-07-21). This document maps RealityWarden's six
enforced safety invariants to the obligations that AI-driven machines are
increasingly required to meet. It is a technical alignment aid for
evaluation, sales, and diligence conversations.

**Honest scope statement (read first):** RealityWarden is a Public Alpha
runtime. This mapping shows *architectural alignment*, not certification.
RealityWarden is not a certified safety component, this document is not
legal advice, and no claim is made that using RealityWarden makes a system
compliant. Compliance is a property of the whole deployed system and its
operator.

## The six invariants (as enforced in code and tests)

| # | Invariant | Enforcement |
| --- | --- | --- |
| 1 | Single controlled path: actuation frames exist only via a ticketed `HardwareExecutionGate`; blocked commands structurally cannot reach the transport | private module + ESLint import ban + transport-level refusal; real-hardware test suite |
| 2 | Default-block: missing / stale / invalid / frozen sensor evidence, or missing device clock, blocks execution | fresh per-primitive evidence generation; latched fault states |
| 3 | No silent fallback: every degradation is explicit, visible, and audited | audit log entries for every downgrade |
| 4 | Honest audit: every decision records `hardwareSignalSent` (not-sent / attempted-unconfirmed / device-acknowledged), the rule that fired, and open-loop caveats | structured runtime audit log |
| 5 | Untrusted proposers: model output, manifests, manual imports, and user input have zero execution authority; out-of-range values are rejected, never clamped | proposal validation layer; cooperating-malicious test suite |
| 6 | Simulation and reality are visibly distinct: real decisions marked `real_hardware`, simulated runs marked `[SIMULATION]`, never conflated | mode-exclusive UI + conformance assertions |

Verified by 48/48 real-hardware invariant tests plus 5/5 virtual-loopback
scenarios (`npm run verify`).

## Mapping to EU AI Act (Regulation (EU) 2024/1689), high-risk obligations

High-risk obligations are scheduled to apply from August 2026 (subject to
the ongoing simplification timeline). AI systems that are safety components
of machinery are within the high-risk scope. Relevant articles:

### Art. 12 — Record-keeping (automatic logging)

> High-risk AI systems shall technically allow for the automatic recording
> of events (logs) over the lifetime of the system.

Alignment: invariants 3 + 4. Every proposal, decision, rule trigger,
refusal, degradation, and hardware-delivery outcome is automatically
recorded in a structured audit log — including the honest distinction
between "signal never sent", "attempted, unconfirmed", and
"device-acknowledged". Logging is not optional or bypassable: the audit
write sits on the only execution path (invariant 1).

### Art. 14 — Human oversight

> High-risk AI systems shall be designed such that they can be effectively
> overseen by natural persons... including the ability to intervene or
> interrupt the system.

Alignment: invariants 1 + 5 + per-run operator confirmation. No AI-generated
action reaches an actuator without passing the gate; every real actuation
requires visible operator confirmation; the operator's refusal is terminal
(no clamping, no retry-into-compliance); a multi-step action halts at the
first blocked primitive with zero further actuation frames.

### Art. 13 — Transparency and provision of information

Alignment: invariants 4 + 6. The operator always sees which mode (REAL vs
SIMULATION) they are in, what evidence the decision used, which rule fired,
and what the system does *not* know (open-loop feedback is labeled as such,
never presented as measured position).

### Art. 9 — Risk management system

Alignment: invariant 2 embodies a "default to safe state on missing
information" policy; capability contracts and forbidden zones make the
accepted risk envelope explicit and machine-checkable per device profile.

## Machine-safety practice (orientation, not certification)

- **ISO 10218 / ISO/TS 15066 (robot safety / collaborative robots)**: these
  standards assume a protective stop and monitored state. RealityWarden's
  contribution is upstream and complementary: it governs whether an
  *intent* may become a command at all, and records the decision. It does
  not replace functional-safety hardware (e-stops, safety PLCs, monitored
  stop circuits) and must never be described as doing so.
- **Insurance underwriting**: per-action decision records with honest
  delivery evidence are precisely the data class underwriters ask for when
  pricing AI-driven machine risk. The planned one-click export of a signed
  audit report (see `ROADMAP.md`) is designed for this consumer.

## What this mapping is for

1. **Design partners / customers**: a one-page answer to "how does this help
   us with the EU AI Act?" — with honest limits stated.
2. **Diligence**: shows that the runtime's invariants were designed against
   the same failure classes regulators care about, before regulation forced
   it.
3. **Roadmap anchor**: the receipt-export feature is the productized form of
   this document.

## What this mapping is not

- not a conformity assessment, certificate, or legal opinion
- not a claim that RealityWarden is itself a certified safety component
- not a substitute for functional-safety hardware or a machinery CE process
