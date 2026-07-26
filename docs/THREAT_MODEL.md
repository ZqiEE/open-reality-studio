# Threat model

Protected assets are execution authority, release identity, device binding,
fresh robot state, approval history, and truthful dispatch evidence.

| Threat | Control |
| --- | --- |
| Proposer supplies unsafe or malformed action | strict schema/policy validation; no clamping |
| Caller omits or reuses state | missing/stale/future state blocks |
| Action changes after authorization | permit binds the action hash |
| Permit is forged, expired, replayed, or moved to another target | private registry; short expiry; action/release/device/controller binding; consume-on-use |
| Release content changes after approval | full ExecSpec identity mismatch blocks |
| Revoked release continues operating | terminal revoke state checked at admission |
| Shadow accidentally actuates | Shadow gate has no dispatcher and records `not_sent` |
| Evidence entry is edited or reordered | canonical JSON, SHA-256, ordered hash chain |
| Adapter bypasses the gate | adapter contract requires an opaque permit; reference hardware retains its private ticket |
| ROS proposal impersonates another deployment | exact device/proposer/release resolution and SROS2 enclave policy |
| Revocation races with an already issued permit | release eligibility is rechecked at dispatch; permit fails |
| Active goal survives release revocation | cancellation is requested and evidenced; independent controller/safety observation is still required |
| Sidecar is compromised | sidecar has transport only; Core owns schema, policy, permit, release, and evidence |

Residual risks include host compromise, malicious controller firmware,
incorrect profile data that was nevertheless approved, clock integrity,
incomplete sensing, transport ambiguity after write, and physical hazards
outside the software boundary. A content hash detects edits; it does not prove
producer identity. Signing is an optional future interface, not a current PKI.
