# Physical UR5e validation runbook

Status in the RLSOK repository: **PENDING physical hardware execution**.

This is the authoritative procedure for an external robotics engineer to
validate RLSOK against a physical Universal Robots UR5e. A completed artifact
from this procedure is evidence for that individual run; the public product
claim must remain pending until the artifact has been reviewed and accepted.

## Responsibility boundary

RLSOK provides execution authorization. It is not functional safety, an E-stop,
a safety PLC, collision avoidance, trajectory safety, or motion planning. It
does not replace Universal Robots safety mechanisms, the robot risk assessment,
site procedures, guarding, supervision, or operator responsibility.

The procedure runs RLSOK in Shadow. RLSOK must make zero calls to the trajectory
controller during the successful Shadow and denial cases. The official driver
still connects to a physical robot, so the responsible operator must establish
the normal UR workcell and safety conditions before starting the driver.

## Required stack and people

- Physical UR5e with its normal Universal Robots safety configuration.
- Ubuntu 24.04 x86_64.
- ROS 2 Jazzy.
- `rmw_fastrtps_cpp` / Fast DDS.
- Official Universal Robots ROS 2 Driver for Jazzy.
- Active `scaled_joint_trajectory_controller`.
- Hosted RLSOK Cloud.
- A runtime operator and a different authenticated person who performs release
  approval. The runtime credential cannot approve its own release.
- A policy artifact file whose exact bytes can be retained for the run.

Do not manually enter a JointState topic, controller action, joint order, or ROS
namespace. The purpose of this validation is to prove automatic discovery. The
only supported disambiguation is `--robot-namespace` when more than one complete
UR5e driver graph is intentionally present.

## 1. Install and start the official driver

Install the official UR ROS 2 Driver using its Jazzy instructions. Configure the
physical robot and External Control program according to Universal Robots'
documentation and the site's safety process. Start the driver with the physical
robot IP and the scaled trajectory controller active. Do not use
`use_mock_hardware:=true` for this run.

In the RLSOK terminal:

```bash
source /opt/ros/jazzy/setup.bash
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
export ROS_DOMAIN_ID=<the driver domain>
ros2 control list_controllers
```

The output must show `scaled_joint_trajectory_controller` as `active`.

## 2. Install the released RLSOK runtime

```bash
curl -fsSL https://rlsok.com/install.sh | sudo sh
source /opt/ros/jazzy/setup.bash
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
export ROS_DOMAIN_ID=<the driver domain>
rlsok --version
```

Choose an empty local evidence directory and retain it unchanged:

```bash
export RLSOK_UR5E_PROOF="$PWD/rlsok-ur5e-proof-$(date -u +%Y%m%dT%H%M%SZ)"
```

## 3. Automatic discovery and preflight

```bash
rlsok validate-ur5e preflight \
  --output "$RLSOK_UR5E_PROOF" \
  --operator '<operator name>' \
  --robot-serial '<physical UR5e serial>'
```

This fails closed unless it observes Ubuntu 24.04 x86_64, Jazzy, Fast DDS, a
same-namespace UR5e robot description, the official UR controller family, the
active scaled trajectory controller, its FollowJointTrajectory action, and one
complete six-joint state source. It records hashes and exact discovered
bindings, not the full robot description. At this point the artifact status is
`PENDING`.

## 4. Cloud pairing, exact binding, and independent approval

```bash
rlsok setup --artifact /absolute/path/to/policy-artifact
```

Setup performs environment discovery again, protects a digest-addressed local
copy of the artifact, generates exact release/robot/controller bindings, and
pairs the runtime with Hosted Cloud. It opens the exact Draft approval page.

A different authenticated person must inspect and approve that Draft. The
terminal then evaluates a hold-position proposal in Shadow and must print:

```text
Live JointState observed
Exact approved release evaluated
Controller goals attempted: 0
Hardware signal sent: false
Evidence verified by hash
```

No controller goal is sent in this step.

## 5. Record Shadow and negative authority checks

```bash
rlsok validate-ur5e record \
  --output "$RLSOK_UR5E_PROOF" \
  --operator '<operator name>' \
  --robot-serial '<physical UR5e serial>'
```

This command rediscovers the live driver, proves it still matches the approved
setup, verifies the protected artifact and Cloud Evidence hashes, and records
zero controller calls. It also runs the production local checks for exact
binding, release mismatch, robot mismatch, controller mismatch, expired release
authority, and stale state. The output remains
`PENDING_REVOCATION_CHECK`.

## 6. Revoke the exact release

In Hosted Cloud, open the release ID printed by `record` and revoke that exact
release. Record the reason as `physical UR5e validation revocation test`.

Do not create or approve a replacement release until finalization is complete.

## 7. Verify revocation and finalize

```bash
rlsok validate-ur5e finalize \
  --output "$RLSOK_UR5E_PROOF" \
  --operator '<operator name>' \
  --robot-serial '<physical UR5e serial>'
```

Finalization requires Cloud to report the exact release as revoked. It submits
the same bound proposal through the live Shadow path and requires verified
Cloud Evidence with decision `blocked`, reason
`cloud_release_not_eligible:revoked`, `controllerGoalsAttempted: 0`, and
`hardwareSignalSent: false`.

It writes `result.json`, `manifest.json`, and `SHA256SUMS`, and changes the local
artifact status to `PASSED` only when every required check succeeds.

## 8. Verify and transfer the artifact

```bash
cd "$RLSOK_UR5E_PROOF"
sha256sum -c SHA256SUMS
```

Transfer the complete directory without editing it. Reviewers must verify the
checksums, confirm `result.json` says `PASSED`, confirm the physical robot serial
and operator, and compare the exact release ID with Hosted Cloud audit records.

## Failure handling

- Discovery failure: run `rlsok ros2 doctor`, confirm the sourced Jazzy
  environment, `ROS_DOMAIN_ID`, Fast DDS, and official driver state. Do not
  supply graph names to bypass discovery.
- Multiple robots: rerun preflight with `--robot-namespace <discovered
  namespace>` and let setup select the same discovered robot.
- Approval timeout or artifact change: start a new setup Draft; never reuse the
  old approval.
- Any nonzero controller dispatch count in Shadow or denial evidence: stop the
  validation, retain the artifact, and report it. Do not mark the run passed.
- Release not revoked: revoke the exact release in Hosted Cloud and rerun only
  `finalize`.
- A failed or partial run remains `PENDING`; it is not physical validation.
