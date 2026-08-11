# RLSOK

[![CI](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/realitywarden/rlsok?display_name=tag)](https://github.com/realitywarden/rlsok/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

RLSOK binds learned-policy execution to the exact release, robot, controller,
and approval intended to run. The robot-side gate rechecks Hosted Cloud before
ROS 2 dispatch and writes verifiable Evidence.

## Zero-to-Shadow

The official v1.2.0 robot integration is Universal Robots UR5e on Ubuntu 24.04
x86_64, ROS 2 Jazzy, Fast DDS, and the official Universal Robots ROS 2 driver.
It is validated in the driver's mock-hardware simulation; no physical-robot
validation is claimed. Other valid JointState/FollowJointTrajectory graphs are
identified explicitly as generic protocol support, not official robot support.

```bash
curl -fsSL https://rlsok.com/install.sh | sudo sh
source /opt/ros/jazzy/setup.bash
rlsok setup
```

The released runtime 1.3.0 bundle is self-contained. Normal users do not need
Node.js, npm, a source checkout, API keys, Workspace IDs, hand-calculated
hashes, or a blank ExecSpec.

`rlsok setup` detects the supported platform and live ROS graph, asks for the
policy artifact, automatically identifies a supported UR5e and its namespace,
joint order, active scaled controller, state source, and action, generates exact
bindings, pairs through the browser, creates a tested Draft, waits for
independent approval, runs a live zero-dispatch Shadow, writes Evidence, and
verifies the stored hash automatically.

Keep the gate running, then propose from policy code without ROS names:

```bash
rlsok observe
```

```python
from rlsok import propose
propose(next_joint_positions)
```

The Python surface can only submit a proposal. Release approval and controller
authority remain in the RLSOK gate.

## Local state

- credentials: `~/.config/rlsok/cloud-credentials.json`
- setup state: `~/.config/rlsok/setup.json`
- releases, protected artifacts, proposals, and Evidence:
  `~/.local/share/rlsok`

Re-run the installer to upgrade. Remove the runtime with
`sudo /opt/rlsok/uninstall.sh`; user configuration and Evidence are preserved.

## Development verification

Development requires Node.js 22.12+ and npm 10.5+. Production use does not.

```bash
npm ci
npm run verify
npm run package:smoke
npm run bundle:linux-x64
```

The Ubuntu Jazzy CI path uses both a real DDS reference graph and the official
UR ROS 2 driver with mock hardware. It proves automatic UR5e identification and
that Shadow receives proposals while attempting zero controller goals. It does
not claim physical-robot validation.

See [Product quickstart](docs/PRODUCT_QUICKSTART.md),
[ROS 2 setup](docs/ROS2_REFERENCE_SETUP.md),
[architecture](docs/ARCHITECTURE.md), and
[Cloud contract](docs/CLOUD_CONTRACT_V1.md).

## Responsibility boundary

RLSOK is not functional-safety software, a motion planner, E-stop, safety PLC,
certified controller, or hard real-time system. Independent safety systems,
controller limits, site procedures, and hazard analysis remain required.
Shadow is the default mode and never dispatches a controller goal.

## License

Apache-2.0. See [LICENSE](LICENSE).
