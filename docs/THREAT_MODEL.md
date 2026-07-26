# Threat model

Protected assets are execution authority, release identity, device binding,
fresh robot state, approval history, and truthful dispatch evidence.

| Threat | Control |
| --- | --- |
| Proposer supplies unsafe or malformed action | strict schema/policy validation; no clamping |
| Caller omits or reuses state | missing/stale/future state blocks |
| Action changes after authorization | permit binds the action hash |
| Permit is forged, expired, or replayed | private registry; short expiry; consume-on-use |
| Release content changes after approval | full ExecSpec identity mismatch blocks |
| Revoked release continues operating | terminal revoke state checked at admission |
| Shadow accidentally actuates | Shadow gate has no dispatcher and records `not_sent` |
| Evidence entry is edited or reordered | canonical JSON, SHA-256, ordered hash chain |
| Adapter bypasses the gate | adapter contract requires an opaque permit; reference hardware retains its private ticket |

Residual risks include host compromise, malicious controller firmware,
incorrect profile data that was nevertheless approved, clock integrity,
incomplete sensing, transport ambiguity after write, and physical hazards
outside the software boundary. A content hash detects edits; it does not prove
producer identity. Signing is an optional future interface, not a current PKI.
