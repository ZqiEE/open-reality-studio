# RLSOK security policy

RLSOK ReleaseGate admits a specifically identified executable robot-policy
release to a specifically bound target. “Release OK” is not a functional-safety
certification and does not certify the resulting robot motion.

## Trusted boundary

The trusted boundary comprises strict schemas, the release state machine,
release resolution, Execution Gate, opaque single-use permits, and evidence
verification. Models, policies, VLA/agent proposals, natural-language output,
imported files, Marketplace compatibility data, user profiles, network input,
and robot state are untrusted inputs.

Security invariants include:

1. blocked, approval-required and shadow decisions cannot call an adapter;
2. adapters cannot mint permits;
3. permits are short-lived, single-use and bound to an action hash;
4. missing, stale, future, invalid, frozen or mismatched state fails closed;
5. out-of-contract actions are rejected, never clamped into execution;
6. draft, tested, expired, mismatched and revoked releases cannot dispatch;
7. evidence truthfully records whether a hardware signal was sent.

RLSOK is not an E-Stop, a safety PLC, a certified robot controller, a
hard-real-time system, or a substitute for deployment-specific hazard analysis,
physical safeguards and certified safety functions.

## Reporting vulnerabilities

Do not open public issues for security-sensitive reports or secrets. Use GitHub
private security advisories when available. Otherwise contact the repository
owner through the public GitHub profile contact path. Do not include secrets in
public issues, pull requests, screenshots, logs, fixtures, or evidence bundles.
