# Fleet/OTA and execution-authorization boundary

RLSOK authorizes execution; it does not deploy software. The system boundary is:

```text
CI/build
  -> fleet or OTA deployment
  -> software present on robot
  -> RLSOK execution authorization
  -> ROS 2 controller
  -> independent functional-safety system
  -> actuators
```

Each stage has a separate responsibility.

| Stage | Responsibility | Outside its responsibility |
| --- | --- | --- |
| CI/build | Produce and identify the software artifact. | Robot deployment and execution permission. |
| Fleet/OTA deployment | Transfer and install software on the intended robot. | RLSOK approval, permits, or controller dispatch. |
| RLSOK | Check the approved release, device, execution configuration, current authority, state freshness, action identity, and revocation before the ROS 2 dispatch boundary; record Evidence. | Software distribution and functional safety. |
| ROS 2 controller | Process an accepted controller request subject to its own interface and limits. | RLSOK release approval. |
| Independent functional-safety system | Enforce the site's safety functions independently of RLSOK. | Learned-policy release management. |

## Deployment is not permission

**Deployment != permission to execute.** An artifact may remain installed and
running while RLSOK blocks every proposed action. Approval binds a specific
release and security-critical execution configuration. Configuration drift,
expiry, stale authority, or revocation must block execution without requiring
the deployment system to uninstall the software.

Fleet and OTA systems may report that installation succeeded. They must not
translate that state into an RLSOK approval or permit. RLSOK likewise does not
claim that a blocked or allowed decision changes the installed artifact.

## Safety boundary

**RLSOK != functional safety.** RLSOK does not replace or weaken:

- E-stops;
- safety PLCs;
- certified motion-safety functions or certified robot controllers;
- collision avoidance;
- controller limits, guarding, interlocks, risk assessment, or site procedures.

Those controls must remain independent and able to stop motion regardless of
RLSOK state. An RLSOK `ALLOW` means only that the proposal passed the configured
release-authorization path. It is not a statement that motion is safe.

## Integration invariant

The deployment system may supply artifact identity and installation status as
inputs, but only the existing RLSOK Release, Approval, Permit, Evidence, and ROS
2 Gateway mechanisms decide execution authorization. Shadow remains the default
and never sends a hardware signal.
