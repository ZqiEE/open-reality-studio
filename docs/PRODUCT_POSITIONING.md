# RLSOK ReleaseGate product positioning

Status: current public product positioning.

RLSOK means Release OK. RLSOK ReleaseGate is executable robot policy release control for ROS 2
and learned robot policies. It binds model identity, action semantics, robot
and controller configuration, runtime policy, and test evidence into one
versioned `ExecutablePolicySpec` (`ExecSpec`). Only an approved, unexpired,
unrevoked release bound to the target device may approach an adapter.

Only RLSOK releases reach the robot.

The product is responsible for release identity, approval state, device
binding, fail-closed runtime admission, and tamper-evident evidence. It is not
responsible for model training, motion planning, perception, collision
avoidance, certified control, or emergency stopping.

RLSOK is the next product phase of RealityWarden ReleaseGate. Historical
RealityWarden names remain where stable compatibility requires them.

The desktop application is an optional lab/reference surface. The ESP32 rig is
a reference adapter, not the product. Natural-language compilation is an
untrusted proposal example. Marketplace and Manual Import are frozen.
