# RLSOK integration support

RLSOK ReleaseGate is device-neutral release-control Core. Device support is
provided by adapters and does not follow from schema validation or a Release OK
decision.

## Implemented boundaries

| Integration | Status | Scope |
| --- | --- | --- |
| Adapter SDK contract | Implemented | Interface and contract tests |
| ROS 2 gateway contract | Implemented | Interfaces and in-memory reference adapters |
| Live ROS 2 / DDS / SROS 2 network | Not implemented | No live graph or deployment |
| ESP32 servo rig | Reference only | Execution-adapter and fail-closed invariant tests |
| Optional Lab adapters | Development only | Visualization and test harnesses |

RLSOK does not claim general-purpose device support, industrial control
guarantees, functional-safety certification, or production certification.
Robot- and controller-specific integration must supply its own bounded
ActionContract, profiles, fresh state, adapter implementation, test evidence,
physical safeguards, and deployment review.

Historical device type definitions remain loadable for project compatibility.
They are not advertised as supported RLSOK device integrations.
