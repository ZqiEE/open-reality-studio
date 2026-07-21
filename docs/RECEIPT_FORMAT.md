# Audit Receipt Format — `realitywarden.receipt/v1`

Status: **frozen, additive-only** (2026-07-21). This document is the public
specification of the RealityWarden audit receipt, written for the people who
*consume* receipts — customers, insurers, auditors, and integrators — not
just for the people who produce them. A receipt consumer needs nothing from
this repository except this document (and optionally the standalone
verifier) to check a receipt.

The receipt is the productized form of the positioning
(`POSITIONING.md`): *every action gated, refusable, and receipted — with
evidence you can hand to a regulator, an insurer, or a customer.*

## What a receipt is

A receipt is a single JSON document that notarizes a sequence of runtime
audit entries — every proposal, decision, refusal, degradation, and
hardware-delivery outcome the runtime recorded in a session or time range —
together with a deterministic content hash that makes any later modification
detectable.

Two files are exported from the same evidence:

- `<name>.receipt.json` — the machine-readable receipt (this spec)
- `<name>.receipt.md` — a human-readable rendering of the same content
  (informative only; the JSON is authoritative)

## Honesty boundaries (read before relying on a receipt)

1. The content hash is **tamper-evident, not a cryptographic signature**. It
   proves the document is unmodified since export; it does not by itself
   prove who produced it. (Key-based signing is a planned, additive
   extension.)
2. `hardwareSignalSent: false` **proves** no signal left the host for that
   decision. `true` is the conservative cover — read `hardwareSignalState`
   for precision (`attempted_unconfirmed` vs `device_acknowledged`).
3. Open-loop acknowledgement (`command_acknowledged_open_loop` in entry
   data) is a device acknowledging a command — it is **not** proof of
   physical position or motion.
4. A `real_outcome_evidence_missing` entry means the runtime could not
   obtain consistent delivery evidence for that action and recorded the gap
   conservatively (as attempted/unconfirmed) rather than claiming a clean
   "not sent". The gap itself is part of the evidence.
5. `meta.operator` and `meta.note` are self-declared free text, not
   verified identity.

## Top-level structure

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | `"realitywarden.receipt/v1"` | Format identifier. Consumers must reject other values. |
| `product` | `"RealityWarden"` | Producing product. |
| `generatedAt` | ISO 8601 string | Export time (producer clock). |
| `meta` | object | `appVersion` (string), `deviceProfileId` (string\|null), `operator` (string\|null, self-declared), `note` (string\|null). |
| `timeRange` | object | `from`/`to`: ISO timestamps of earliest/latest entry, or both `null` for an empty receipt. |
| `summary` | object | Counts derived from `entries` (see below). Redundant by design — a consumer can recompute and cross-check. |
| `entries` | array | The evidence itself, in original recording order, unmodified. |
| `governanceInvariantIds` | string[] | The structural invariants the producing runtime enforces (see `GOVERNANCE.md`). |
| `integrity` | object | `algorithm: "sha256"`, `contentHash` (hex), `statement` (honest scope of the hash). |

### Entry structure (`entries[i]`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Unique entry id. |
| `timestamp` | ISO 8601 string | Recording time. |
| `stage` | string | One of `input`, `compiler`, `runtime_kernel`, `autonomy`, `adapter_plan`, `dry_run`, `execution_gate`, `hardware`. |
| `level` | `info` \| `warn` \| `error` | Severity. A blocked action is typically `warn`/`error` — refusals are first-class records, not omissions. |
| `code` | string | Machine-readable decision code (e.g. `real_executed`, `real_blocked`, `real_outcome_evidence_missing`). |
| `message` | string | Human-readable decision statement. |
| `hardwareSignalSent` | boolean | Compatibility flag; must equal `hardwareSignalState !== "not_sent"`. |
| `hardwareSignalState` | `not_sent` \| `attempted_unconfirmed` \| `device_acknowledged` | Precise delivery evidence. |
| `data` | object (optional) | Structured context (intent, sensor values, step counts, …). |

### Summary structure

`totalEntries` (number), `byLevel` (`info`/`warn`/`error` counts), `byStage`
(counts per stage present), `byHardwareSignalState` (counts per state),
`entriesWithHardwareSignal` (entries whose state ≠ `not_sent`).

## Canonicalization and hashing

The `integrity.contentHash` is the SHA-256 (lowercase hex) of the
**canonical serialization** of the receipt body — the receipt object with
the `integrity` field removed. Canonical serialization rules:

1. Object keys sorted lexicographically at **every** depth; members whose
   value is `undefined` are omitted.
2. Arrays keep their original order (order is meaningful evidence).
3. Strings and numbers serialize as by JSON (`JSON.stringify`); non-finite
   numbers are invalid and must fail loudly.
4. No whitespace between tokens.
5. UTF-8 encoding for hashing.

## How to verify a receipt

Any one of these, in increasing order of independence:

1. **In-app**: the producing runtime's `verifyAuditReceipt()`
   (`lib/receipt/AuditReceipt.ts`).
2. **Standalone, from this repo, no build needed**:
   `npm run receipt:verify -- path/to/file.receipt.json`
   (runs `scripts/verify-receipt.cjs`, dependency-free Node).
3. **Fully independent**: implement the four steps yourself in any language
   — (a) check `schema`; (b) check every entry satisfies
   `hardwareSignalSent === (hardwareSignalState !== "not_sent")`;
   (c) canonicalize the receipt without `integrity` per the rules above;
   (d) SHA-256 it and compare with `integrity.contentHash`.

A receipt that fails any step must be treated as modified or malformed —
not as partially trustworthy.

## Stability guarantee

`realitywarden.receipt/v1` is **additive-only**: existing fields will not be
renamed, retyped, or removed, and canonicalization will not change. New
optional fields may appear; verifiers must ignore unknown fields when
validating structure but must still include them in canonicalization (the
hash covers the whole body). A breaking change would ship as
`realitywarden.receipt/v2` alongside, never in place.

## Relation to other documents

- `POSITIONING.md` — why the receipt is the product
- `COMPLIANCE_MAPPING.md` — how receipt contents map to EU AI Act
  Art. 12/13/14 and machine-safety practice
- `GOVERNANCE.md` — the structural invariants referenced by
  `governanceInvariantIds`, each with its enforcing code and proving test
