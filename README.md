# RLSOK

[![CI](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/realitywarden/rlsok?display_name=tag)](https://github.com/realitywarden/rlsok/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

RLSOK ReleaseGate validates an executable robot-policy release, binds
independent approval to its exact content, issues a short-lived single-use
execution Permit, gates ROS 2 dispatch, and writes verifiable Evidence.

## Latest product release

RLSOK **v1.0.3** is the latest stable public product release:

- robot-side runtime component: @realitywarden/rlsok 1.1.0
- cloud/control-plane component: rlsok-cloud 1.0.3
- Windows installer: RLSOK-v1.0.3-windows-x64-installer.zip
- ROS 2 runtime asset: RLSOK-v1.0.3-runtime-1.1.0.tgz
- Windows cloud asset: RLSOK-v1.0.3-cloud-1.0.3-windows-x64.tar.gz

The product release and component package versions serve different scopes.
Their exact source commits and SHA-256 digests are recorded in the release
manifest.

[Download v1.0.3](https://github.com/realitywarden/rlsok/releases/tag/v1.0.3) ·
[Installation](https://rlsok.com/download) ·
[Documentation](https://rlsok.com/docs) ·
[API health](https://api.rlsok.com/healthz)

Verify all assets with SHA256SUMS. Production installation does not depend on a
source checkout.

## Supported environment

- robot side: Ubuntu 24.04 x64, ROS 2 Jazzy, rclpy, rmw_fastrtps_cpp
- control plane: Windows 11 x64 and PostgreSQL 16
- validated simulators: official UR5e URSim and Gazebo Harmonic with the
  official Universal Robots ROS 2 driver

Live DDS JointState, Shadow zero-dispatch, single-use Permit consumption,
FollowJointTrajectory terminal results, post-revocation denial, Evidence,
restart persistence, backup/restore, upgrade/rollback, and endurance passed.
No physical hardware was used.

## Install the runtime package

Requires Node.js 22.12 or later, npm 10.5 or later, Python 3, and the supported
ROS 2 environment.

    npm install ./RLSOK-v1.0.3-runtime-1.1.0.tgz
    npx rlsok ros2 doctor

Start with the [product quickstart](docs/PRODUCT_QUICKSTART.md), then review the
[ROS 2 setup](docs/ROS2_REFERENCE_SETUP.md), [architecture](docs/ARCHITECTURE.md),
and [cloud contract](docs/CLOUD_CONTRACT_V1.md).

Hosted RLSOK Cloud is the default control plane. After installing the runtime,
pair it from a browser without copying an API key or Organization ID:

    npx rlsok pair

Environment-based credentials remain supported for advanced self-hosted
control-plane deployments.

## Responsibility boundary

RLSOK is not functional-safety software, a motion planner, an E-stop, a safety
PLC, a certified controller, or a hard real-time system. Independent safety
systems and controller limits remain required. Shadow is the default mode.
## License

Apache-2.0. See [LICENSE](LICENSE).
