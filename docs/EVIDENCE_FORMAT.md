# Execution evidence format

`packages/evidence` defines `ExecutionEvidence`, `ChainedEvidence`, and
`EvidenceBundle`.

Each decision records release and component hashes, device/proposal identity,
the proposed action, decision and matched rules, observed/decision/dispatch
times, and truthful hardware signal state. `hardwareSignalSent` must agree with
`hardwareSignalState`; inconsistency fails verification.

Entries use deterministic canonical JSON, SHA-256, and an ordered hash chain.
Editing, deleting, inserting, or reordering entries is detectable. This is
tamper-evident, not absolutely tamper-proof and not a cryptographic signature.
No complex PKI is built into v1alpha1.

`rw verify-evidence <directory>` reads `evidence.json`; a direct file path is
also accepted. It checks chain integrity, per-entry release/ExecSpec identity,
and signal-state consistency. Callers may additionally supply revocation,
expiry, expected Release ID, ExecSpec hash, policy, and test-report checks via
the package API.
