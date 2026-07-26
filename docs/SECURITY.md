# Security boundary

## Invariants

1. A blocked decision cannot call a dispatcher.
2. Shadow has no dispatcher and cannot send a controller goal.
3. Permits are private, short-lived, single-use, and bound to the action hash,
   release, device, and controller.
4. Release eligibility is refreshed immediately before dispatch.
5. Missing, stale, future, malformed, mismatched, expired, changed, or revoked
   input fails closed.
6. Out-of-contract values are rejected, never clamped.
7. Evidence truthfully records not-sent and attempted/unconfirmed states.
8. The Python ROS sidecar is transport-only and cannot authorize execution.
9. Reference Run requires SROS2 `Enforce` and exact release confirmation.

## Threats and controls

| Threat | Control |
| --- | --- |
| Malformed or oversized proposal | strict bounded schema |
| Wrong proposer, release, or robot | exact resolver and deployment binding |
| Changed release after approval | full ExecSpec identity mismatch blocks |
| Forged/replayed permit | private registry, TTL, consume-on-use |
| Permit moved to another target | release/device/controller/action binding |
| Revocation races with dispatch | release-record refresh at dispatch |
| Shadow accidentally actuates | no dispatcher, zero-goal tests |
| Compromised sidecar | transport-only process; Core retains authority |
| Evidence edit or reorder | canonical SHA-256 chain verification |

## Residual risk

Host compromise, malicious authorized controller firmware, incorrect approved
profiles, clock failure, incomplete sensing, DDS behavior, and physical hazards
remain outside this software guarantee. Cancellation requested is not
cancellation physically proven. RLSOK does not replace independent functional
safety.

## SROS2 reference policy

Use separate gateway, proposer, state-publisher, and controller enclaves.
Start with no grants and add only:

- gateway subscribe `/rlsok/action_proposals`;
- gateway subscribe `/joint_states`;
- gateway action client
  `/joint_trajectory_controller/follow_joint_trajectory`;
- proposer publish `/rlsok/action_proposals`.

```bash
export ROS_SECURITY_KEYSTORE=/secure/path/rlsok_keystore
export ROS_SECURITY_ENABLE=true
export ROS_SECURITY_STRATEGY=Enforce
```

The illustrative unsigned source policy is
`examples/ros2-reference/sros2/policy.xml`. Generate and sign deployment
artifacts outside Git.
