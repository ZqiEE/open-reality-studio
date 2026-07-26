# SROS2 deny-by-default reference policy

SROS2 reduces unauthorized graph access; it does not make this gateway
safety-rated. Generate and sign artifacts with the tools from the deployed ROS
2 distribution and protect the keystore outside the repository.

Use separate enclaves:

- `/rlsok/reference_gateway`: subscribe only to the proposal and joint-state
  topics; call only the selected trajectory action.
- `/rlsok/design_partner_proposer`: publish only proposals.
- controller and state-publisher enclaves: expose only the required action and
  state topic.

Set enforcement, never permissive fallback:

```bash
export ROS_SECURITY_KEYSTORE=/secure/path/rlsok_keystore
export ROS_SECURITY_ENABLE=true
export ROS_SECURITY_STRATEGY=Enforce
export ROS_DOMAIN_ID=42
```

Start from no grants, then add exact fully qualified names. The illustrative
policy in `examples/ros2-releasegate-demo/sros2/policy.xml` grants the gateway
only:

- subscribe `/rlsok/action_proposals`;
- subscribe `/joint_states`;
- action client access to
  `/joint_trajectory_controller/follow_joint_trajectory`.

Do not grant wildcard publish, parameter, service, action, or namespace
permissions. Deny discovery or launch if identities, signatures, domain,
enclave path, or policy are missing. Re-generate signed permissions after any
name change and rerun Shadow evidence collection.

SROS2 cannot prevent a compromised authorized node from sending malicious
content. Strict schemas, exact release binding, Core policy, permit checks,
controller limits, and independent functional safety remain required.
