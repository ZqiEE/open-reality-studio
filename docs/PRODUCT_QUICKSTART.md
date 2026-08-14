# Product quickstart

## Supported Zero-to-Shadow path

- Ubuntu 24.04 x86_64
- ROS 2 Jazzy
- `rmw_fastrtps_cpp` / Fast DDS
- `sensor_msgs/msg/JointState`
- `control_msgs/action/FollowJointTrajectory`
- Hosted RLSOK Cloud
- Official integration: Universal Robots UR5e with the official ROS 2 driver

Install and begin:

```bash
curl -fsSL https://rlsok.com/install.sh | sudo sh
source /opt/ros/jazzy/setup.bash
rlsok setup
```

The setup flow validates the platform and loaded RMW, identifies the UR5e model,
namespace, stable six-joint order, official controller family, active scaled
trajectory controller, state source, and action without asking for ROS names;
it then reads a current JointState sample, hashes and protects the selected policy
artifact, generates exact robot/controller/release bindings, and opens Hosted
Cloud pairing.

After pairing, the paired runtime submits a tested Shadow Draft. It cannot
approve that Draft. The authenticated browser user approves the final exact
ExecSpec; the waiting terminal receives the finalized approval-bound spec and
runs a hold-position proposal through the live Shadow boundary.

Success explicitly reports:

```text
✓ Live JointState observed
✓ Exact approved release evaluated
✓ Controller goals attempted: 0
✓ Hardware signal sent: false
✓ Evidence verified by hash
```

The local result and protected configuration paths are printed at completion.
Cloud receives artifact metadata and the exact digest, not the policy bytes.

Start continuous Shadow evaluation and connect the learned policy:

```bash
rlsok observe
```

```python
from rlsok import propose
propose(next_joint_positions)
```

`propose` reads the exact joint order and proposal channel written by setup. It
does not own release eligibility or controller authority. A recognized but
incomplete or unsupported Universal Robots graph fails closed; an unrelated
valid ROS graph is labeled generic protocol support rather than official robot
support.

## Common recovery

- ROS unavailable: `source /opt/ros/jazzy/setup.bash` in the same terminal.
- Wrong RMW: `export RMW_IMPLEMENTATION=rmw_fastrtps_cpp`.
- No state: verify `ros2 topic list -t` and
  `ros2 topic echo --once <joint-state-topic>`.
- No controller: verify `ros2 control list_controllers` and
  `ros2 action list -t`.
- Recognized UR but unsupported boundary: activate the official scaled trajectory
  controller and keep the robot description, controller manager, JointState, and
  action in one namespace; RLSOK will not silently downgrade it to generic.
- Pairing expired: run `rlsok pair` again and approve within ten minutes.
- Artifact changed: create a new setup Draft; previous approval is never reused.

Run `rlsok ros2 doctor` for technical diagnostics.

## Advanced/manual workflows

The previous raw runtime package, environment-based Cloud credentials,
standalone Shadow, explicit release YAML, and `rlsok ros2 shadow/run` commands
remain available for advanced integration and compatibility. They are not the
normal first-run experience. See [ROS 2 reference setup](ROS2_REFERENCE_SETUP.md)
and [Cloud contract](CLOUD_CONTRACT_V1.md).

## Responsibility boundary

RLSOK determines whether a specific release remains eligible for the configured
controller path. It does not determine whether physical motion is safe. It is
not functional-safety software or a hard real-time controller. Independent
E-stops, safety PLCs, certified controllers, motion limits, mechanical
safeguards, site procedures, and hazard analysis remain required.

The official UR5e claim is validated with the official driver's mock-hardware
simulation on Ubuntu 24.04 / Jazzy / Fast DDS. Physical UR5e motion is not
claimed by this release.

The complete physical-hardware procedure and reproducible evidence format are
defined in [Physical UR5e validation runbook](PHYSICAL_UR5E_VALIDATION.md).
