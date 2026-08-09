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

The exact v1.0.3 runtime commit
`a0ccb421b0687656bdb142052299442017564d20` passed package smoke,
typecheck/build/tests, clean-directory installation, and the ROS 2 Jazzy real
DDS reference `FollowJointTrajectory` test-server path, including Shadow
zero-dispatch, Permit consumption, terminal result recording, post-revocation
denial, and Evidence verification.

Official UR5e URSim, Gazebo Harmonic, and the official Universal Robots ROS 2
driver were validated historically for v1.0.2. That simulator matrix was not
rerun from the exact v1.0.3 commit and is not presented as v1.0.3 exact-commit
evidence. No physical hardware was used in either validation set.

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
