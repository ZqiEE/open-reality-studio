# External compatibility runbook

This runbook gathers the minimum non-proprietary facts needed to assess a ROS 2
integration. It does not grant approval or add an officially supported robot.
Use `rlsok compatibility inspect` for read-only discovery where the runtime is
available.

## Information to provide

Provide only:

1. ROS distribution.
2. RMW implementation.
3. Controller name and action interface, including the
   `FollowJointTrajectory` action path when applicable.
4. JointState or other state source, including its topic and message type.
5. Stable joint order.
6. Whether the system uses `ros2_control` or a custom bridge.
7. Whether a simulation or mock-controller environment is available.

Do not provide proprietary source code, policy weights, safety PLC
configuration, credentials, tokens, certificates, or private keys. RLSOK does
not need those materials for this compatibility assessment.

## Read-only inspection

Source the ROS environment and run:

```bash
rlsok compatibility inspect
rlsok compatibility inspect --json
rlsok compatibility inspect --write compatibility-report.json
```

Inspection reads bounded ROS/DDS discovery information. It must not publish,
send an action goal, change a controller, approve a release, or create a permit.
The report can include an `executionConfigurationCandidate`; that candidate is
unapproved input for review, never an approved configuration.

Record the reported status exactly:

- `officially_supported`: matches an existing, explicitly documented support profile;
- `compatible_unverified`: the discovered protocol boundary is plausible but unvalidated;
- `insufficient_information`: required discovery facts are absent;
- `incompatible`: discovered facts conflict with the required interface.

`compatible_unverified` is not an official-support claim and is not permission
to use Reference Run.

## Validation handoff

Review the report against the supplied seven facts. Resolve missing or
conflicting controller, state-source, device, or joint-order information in the
external environment, then inspect again. Any configuration candidate must go
through the normal RLSOK evidence and independent approval process before it can
become an approved configuration.

Start with Shadow and confirm `hardwareSignalSent=false`. Reference Run remains
fail closed unless the approved configuration and current observed configuration
match and all existing release-authority checks pass. Independent functional
safety and site validation remain required.
