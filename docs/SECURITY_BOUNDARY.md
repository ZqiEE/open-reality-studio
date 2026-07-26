# Security and safety boundary

The trusted ReleaseGate core is the strict schemas, release state machine,
release resolver contract, execution gate, opaque single-use permit registry,
and evidence verifier.

Untrusted inputs include models, VLA/agent proposals, Action Manifests,
natural-language output, imported manuals, Marketplace content, user-supplied
profiles, network messages, and stale or missing robot state.

Structural invariants:

1. A blocked decision cannot call the adapter.
2. Adapters cannot mint permits; no permit value/constructor is exported.
3. Permits are single-use, short-lived, and bound to the action hash.
4. Missing, stale, future, invalid, or mismatched state fails closed.
5. Out-of-bounds data is rejected, never clamped into execution.
6. Draft, tested, shadow, expired, mismatched, and revoked releases cannot
   dispatch.
7. Allow, block, approval-required, dispatch, and failure outcomes produce
   evidence with truthful signal state.

RLSOK is not functional-safety certified, safety-rated, hard real-time,
an E-Stop, a safety PLC, or a replacement for a certified robot controller.
