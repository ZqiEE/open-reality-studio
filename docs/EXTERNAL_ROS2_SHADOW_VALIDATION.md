# External ROS 2 Shadow validation

This is the complete external-user procedure for RLSOK Shadow validation. It
does not enable Run and must be performed in an isolated ROS domain with no
physical controller. The collector deliberately reports
`COLLECTED_SELF_ATTESTED / EXTERNAL_REVIEW_REQUIRED`; local JSON and SHA-256
files are not an authenticated external endorsement.

Do not use an unverified development checkout as release evidence. Run this
procedure against the exact GitHub-hosted artifact only after its CI is green,
or against a published installer after release. A source-checkout dry run is
development evidence only.

## Required zero-dispatch observer

For every setup, Shadow, restart, replay, stale-state, revocation, and drift
command, the independent observer must:

1. run outside the RLSOK process and have a new process UUID and nonce;
2. be armed before the command starts;
3. own or observe the exact controller action/command path and confirm DDS
   matching/QoS compatibility during the command;
4. remain alive until at least 100 ms and at most 30 seconds after the command;
5. observe no `FollowJointTrajectory` goal request on the
   exact configured path;
6. bind its session ID, case ID, and SHA-256 of the exact command file;
7. record baseline and final controller-side counts, not merely copy
   `hardwareSignalSent=false` from RLSOK.

The packaged isolated generic observer at
`examples/external-validation/generic_ros2_observer.py` owns a fake
`FollowJointTrajectory` action server and publishes `JointState`. It rejects
every received goal after counting it. Use it only in an isolated domain; it
must never share a domain with a physical controller. For an existing graph,
replace it with controller-side instrumentation that emits the exact schema in
`examples/external-validation/observer.template.json`.

This generic observer does not instrument unrelated stop, hold, zero, or
vendor-specific controller endpoints. If a deployment adapter can publish on
such paths, add independent instrumentation for every one of them; do not use
this generic result to claim those paths were silent.

## 1. Clean installation and session

On clean Ubuntu 24.04 x86-64 with ROS 2 Jazzy, Fast DDS, `jq`, Python `rclpy`,
`control_msgs`, `sensor_msgs`, `std_msgs`, and `trajectory_msgs`:

```bash
export RLSOK_VALIDATION_ROOT="$HOME/rlsok-validation-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$RLSOK_VALIDATION_ROOT"
curl -fsSL https://rlsok.com/install.sh -o "$RLSOK_VALIDATION_ROOT/install.sh"
chmod 600 "$RLSOK_VALIDATION_ROOT/install.sh"
sha256sum "$RLSOK_VALIDATION_ROOT/install.sh" > "$RLSOK_VALIDATION_ROOT/install.sh.sha256"
sudo sh "$RLSOK_VALIDATION_ROOT/install.sh"
source /opt/ros/jazzy/setup.bash
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
export ROS_DOMAIN_ID=142
export RLSOK_EXTERNAL_RUNTIME_BIN="$(command -v rlsok)"
export RLSOK_EXTERNAL_TOOLKIT_ROOT="$(dirname "$(readlink -f "$RLSOK_EXTERNAL_RUNTIME_BIN")")/../examples/external-validation"
test -x "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh"
export RLSOK_CONFIG_HOME="$RLSOK_VALIDATION_ROOT/config"
export XDG_CONFIG_HOME="$RLSOK_VALIDATION_ROOT/xdg-config"
export RLSOK_CLOUD_API_URL="https://api.rlsok.com"
mkdir -m 700 "$RLSOK_CONFIG_HOME"
mkdir -m 700 "$XDG_CONFIG_HOME"
rlsok validate-external-ros2 init \
  --output "$RLSOK_VALIDATION_ROOT/bundle" \
  --operator "$USER" \
  --target "isolated generic ROS 2 Jazzy FollowJointTrajectory graph"
export RLSOK_EXTERNAL_VALIDATION_SESSION_ID="$(jq -er .sessionId "$RLSOK_VALIDATION_ROOT/bundle/session.json")"
```

Record the installer/version check as an exact command file:

```bash
cat > "$RLSOK_VALIDATION_ROOT/clean_install.command.sh" <<'EOF'
set -euo pipefail
sha256sum "$RLSOK_VALIDATION_ROOT/install.sh"
sha256sum "$(readlink -f "$RLSOK_EXTERNAL_RUNTIME_BIN")"
rlsok --version
rlsok validate-external-ros2 --help
test "$(timedatectl show -p NTPSynchronized --value)" = yes
EOF
export RLSOK_EXTERNAL_CASE_ID=clean_install
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-recorded-command.sh" \
  "$RLSOK_VALIDATION_ROOT/clean-install-case" \
  "$RLSOK_VALIDATION_ROOT/clean_install.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" \
  --case clean_install --outcome PASS --reason clean_install_verified \
  --command "$RLSOK_VALIDATION_ROOT/clean_install.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/clean-install-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/clean-install-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/clean-install-case/execution.json"
```

Expected outcome: `PASS`. A wrong version, missing command, or failed help
command is `BLOCK`; do not record it as a pass. Before calling this an external
install result, the reviewer must compare `install.sh.sha256` with an
independently obtained release checksum or signature. The version string alone
does not prove artifact provenance.

## 2. Pairing, independent approval, and Zero-to-Shadow

Create a non-empty test artifact. Supply a non-secret runtime credential/device
audit ID and the different authenticated Cloud principal ID that will approve
the Draft. Never put an API key or browser token in the bundle.

```bash
printf 'external-shadow-policy-fixture-v1\n' > "$RLSOK_VALIDATION_ROOT/policy.bin"
export RLSOK_EXTERNAL_POLICY_ARTIFACT="$RLSOK_VALIDATION_ROOT/policy.bin"
export RLSOK_EXTERNAL_RUNTIME_CREDENTIAL_ID='runtime-audit-id-from-cloud'
export RLSOK_EXTERNAL_APPROVER_PRINCIPAL_ID='different-admin-audit-id-from-cloud'
export RLSOK_EXTERNAL_CASE_ID=setup_zero_to_shadow
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/setup-zero-to-shadow.sh" \
  "$RLSOK_VALIDATION_ROOT/setup.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/setup.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/setup-case" \
  "$RLSOK_VALIDATION_ROOT/setup.command.sh"
```

The runtime prints the pairing/approval URL. A different authenticated person
must approve the exact Draft. The expected command exit is `0`; the local
Evidence reason is `shadow_permit_evaluated_no_controller_call`; the observer
must report zero goals. Record every exact artifact:

Permit consumption is tri-state. `consumed` is required for any recorded PASS;
`not_consumed` means the consume request was not initiated. `unknown` means the
request may have committed but its response was not observed: it is never PASS,
must never permit controller dispatch, and requires stopping the validation run
for external Cloud Permit/Evidence reconciliation before starting a fresh
session.

```bash
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" \
  --case setup_zero_to_shadow --outcome PASS \
  --reason shadow_permit_evaluated_no_controller_call \
  --command "$RLSOK_VALIDATION_ROOT/setup.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/setup-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/setup-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/setup-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/setup-case/proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/setup-case/observer.json" \
  --evidence "$RLSOK_VALIDATION_ROOT/setup-case/evidence.json" \
  --cloud-evidence "$RLSOK_VALIDATION_ROOT/setup-case/cloud-evidence.json" \
  --approval "$RLSOK_VALIDATION_ROOT/setup-case/approval.json" \
  --release-receipt "$RLSOK_VALIDATION_ROOT/setup-case/cloud-release.json"
```

Keep the protected setup state at `${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json`.
Create fresh proposals without changing release, device, proposer, action, or
units:

```bash
SETUP_PATH="${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json"
SETUP_PROPOSAL="$(jq -er .proposalPath "$SETUP_PATH")"
jq --arg id "restart-$(cat /proc/sys/kernel/random/uuid)" \
   --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
   '.proposalId=$id | .createdAt=$now' "$SETUP_PROPOSAL" \
   > "$RLSOK_VALIDATION_ROOT/restart-proposal.json"
jq --arg id "stale-$(cat /proc/sys/kernel/random/uuid)" \
   --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
   '.proposalId=$id | .createdAt=$now' "$SETUP_PROPOSAL" \
   > "$RLSOK_VALIDATION_ROOT/stale-proposal.json"
```

## 3. Required negative/restart matrix

Run in this order; revocation is last because it permanently invalidates the
exact release. For each observed case, set `RLSOK_EXTERNAL_CASE_ID`, create the
shown command file, and invoke `run-isolated-case.sh`. The runner emits an
immutable pre-command invocation snapshot plus a post-command execution record
containing the real exit code and bound command/log/observer hashes; the
collector does not accept a hand-entered exit code. It also refuses an
incomplete or non-zero-dispatch observer.

| Case | Exact expected outcome | Exact reason |
|---|---:|---|
| `malformed_input` | `BLOCK`, exit 2 | `proposal_invalid` |
| `stale_state` | `BLOCK`, exit 2 | `joint_state_stale` or `state_stale_or_invalid` |
| `duplicate_replay` | `BLOCK`, exit 2 | `proposal_id_duplicate` |
| `restart_shadow` | `PASS`, exit 0 | `shadow_permit_evaluated_no_controller_call` |
| `configuration_drift` | `BLOCK`, exit 2 | `configuration_mismatch` |
| `revoked_release` | `BLOCK`, exit 2 | `cloud_release_not_eligible:revoked` |
| `evidence_tamper` | `BLOCK`, exit 2 | `evidence_verification_failed` |

Malformed input:

```bash
printf '{"proposalId":' > "$RLSOK_VALIDATION_ROOT/malformed.json"
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/malformed.json"
export RLSOK_EXTERNAL_CASE_ID=malformed_input
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/shadow-once-from-setup.sh" \
  "$RLSOK_VALIDATION_ROOT/malformed.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/malformed.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/malformed-case" "$RLSOK_VALIDATION_ROOT/malformed.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case malformed_input \
  --outcome BLOCK --reason proposal_invalid \
  --command "$RLSOK_VALIDATION_ROOT/malformed.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/malformed-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/malformed-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/malformed-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/malformed.json" \
  --observer "$RLSOK_VALIDATION_ROOT/malformed-case/observer.json" \
  --runtime-log "$RLSOK_VALIDATION_ROOT/malformed-case/runtime.log" \
  --negative-result "$RLSOK_VALIDATION_ROOT/malformed-case/negative-result.json"
```

Stale state uses a live continuous observer, waits for state matching, pauses
the independent publisher for longer than the approved freshness bound, and
then submits a fresh proposal:

```bash
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/stale-proposal.json"
export RLSOK_EXTERNAL_CASE_ID=stale_state
export RLSOK_EXTERNAL_PAUSE_STATE=1
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/stale-state-from-setup.sh" \
  "$RLSOK_VALIDATION_ROOT/stale.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/stale.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/stale-case" "$RLSOK_VALIDATION_ROOT/stale.command.sh"
unset RLSOK_EXTERNAL_PAUSE_STATE
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case stale_state \
  --outcome BLOCK --reason joint_state_stale \
  --command "$RLSOK_VALIDATION_ROOT/stale.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/stale-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/stale-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/stale-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/stale-proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/stale-case/observer.json" \
  --runtime-log "$RLSOK_VALIDATION_ROOT/stale-case/runtime.log" \
  --negative-result "$RLSOK_VALIDATION_ROOT/stale-case/negative-result.json"
```

Duplicate replay must reuse the exact setup proposal bytes. The first delivery
to a newly started gateway process must already BLOCK—not merely the second
delivery in that new process. A frozen candidate without persistent replay
state fails this gate and the procedure stops; do not record a later in-process
duplicate as a substitute:

```bash
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/setup-case/proposal.json"
export RLSOK_EXTERNAL_CASE_ID=duplicate_replay
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/duplicate-replay-from-setup.sh" \
  "$RLSOK_VALIDATION_ROOT/replay.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/replay.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/replay-case" "$RLSOK_VALIDATION_ROOT/replay.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case duplicate_replay \
  --outcome BLOCK --reason proposal_id_duplicate \
  --command "$RLSOK_VALIDATION_ROOT/replay.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/replay-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/replay-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/replay-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/setup-case/proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/replay-case/observer.json" \
  --evidence "$RLSOK_VALIDATION_ROOT/replay-case/evidence.json" \
  --cloud-evidence "$RLSOK_VALIDATION_ROOT/replay-case/cloud-evidence.json"
```

Restart Shadow with a fresh proposal and a new observer/runtime process:

```bash
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/restart-proposal.json"
export RLSOK_EXTERNAL_CASE_ID=restart_shadow
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/shadow-once-from-setup.sh" \
  "$RLSOK_VALIDATION_ROOT/restart.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/restart.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/restart-case" "$RLSOK_VALIDATION_ROOT/restart.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case restart_shadow \
  --outcome PASS --reason shadow_permit_evaluated_no_controller_call \
  --command "$RLSOK_VALIDATION_ROOT/restart.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/restart-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/restart-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/restart-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/restart-proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/restart-case/observer.json" \
  --evidence "$RLSOK_VALIDATION_ROOT/restart-case/evidence.json" \
  --cloud-evidence "$RLSOK_VALIDATION_ROOT/restart-case/cloud-evidence.json"
```

Configuration drift uses the same approved release but changes the observed
joint-set identity in the isolated graph:

```bash
jq --arg id "drift-$(cat /proc/sys/kernel/random/uuid)" \
   --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
   '.proposalId=$id | .createdAt=$now' "$SETUP_PROPOSAL" \
   > "$RLSOK_VALIDATION_ROOT/drift-proposal.json"
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/drift-proposal.json"
export RLSOK_EXTERNAL_CASE_ID=configuration_drift
export RLSOK_EXTERNAL_DRIFT_STATE=1
cp -- "$RLSOK_EXTERNAL_TOOLKIT_ROOT/shadow-once-from-setup.sh" \
  "$RLSOK_VALIDATION_ROOT/drift.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/drift.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/drift-case" "$RLSOK_VALIDATION_ROOT/drift.command.sh"
unset RLSOK_EXTERNAL_DRIFT_STATE
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case configuration_drift \
  --outcome BLOCK --reason configuration_mismatch \
  --command "$RLSOK_VALIDATION_ROOT/drift.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/drift-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/drift-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/drift-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/drift-proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/drift-case/observer.json" \
  --evidence "$RLSOK_VALIDATION_ROOT/drift-case/evidence.json" \
  --cloud-evidence "$RLSOK_VALIDATION_ROOT/drift-case/cloud-evidence.json"
```

Revoke the exact release, then submit another fresh proposal under a new
observer. Put both operations in the recorded command file:

```bash
jq --arg id "revoked-$(cat /proc/sys/kernel/random/uuid)" \
   --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
   '.proposalId=$id | .createdAt=$now' "$SETUP_PROPOSAL" \
   > "$RLSOK_VALIDATION_ROOT/revoked-proposal.json"
export RLSOK_EXTERNAL_PROPOSAL="$RLSOK_VALIDATION_ROOT/revoked-proposal.json"
export RLSOK_EXTERNAL_CASE_ID=revoked_release
cat > "$RLSOK_VALIDATION_ROOT/revoked.command.sh" <<'EOF'
set -euo pipefail
setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
"${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}" cloud revoke \
  "$(jq -er .releaseId "$setup_path")" "external validation revocation test"
EOF
tail -n +2 "$RLSOK_EXTERNAL_TOOLKIT_ROOT/shadow-once-from-setup.sh" \
  >> "$RLSOK_VALIDATION_ROOT/revoked.command.sh"
chmod 700 "$RLSOK_VALIDATION_ROOT/revoked.command.sh"
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-isolated-case.sh" \
  "$RLSOK_VALIDATION_ROOT/revoked-case" "$RLSOK_VALIDATION_ROOT/revoked.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case revoked_release \
  --outcome BLOCK --reason cloud_release_not_eligible:revoked \
  --command "$RLSOK_VALIDATION_ROOT/revoked.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/revoked-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/revoked-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/revoked-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/revoked-proposal.json" \
  --observer "$RLSOK_VALIDATION_ROOT/revoked-case/observer.json" \
  --evidence "$RLSOK_VALIDATION_ROOT/revoked-case/evidence.json" \
  --cloud-evidence "$RLSOK_VALIDATION_ROOT/revoked-case/cloud-evidence.json"
```

Export the Cloud chain, alter one hash, and prove verification blocks. This is
a data-verification case and intentionally has no ROS observer:

```bash
cat > "$RLSOK_VALIDATION_ROOT/evidence-tamper.command.sh" <<'EOF'
set -euo pipefail
runtime="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
release_id="$(jq -er .releaseId "$setup_path")"
"$runtime" cloud evidence export --release "$release_id" \
  --output "$RLSOK_EXTERNAL_CASE_DIR/original-chain.json"
jq '.records[0].evidenceHash = ("0" * 64)' \
  "$RLSOK_EXTERNAL_CASE_DIR/original-chain.json" \
  > "$RLSOK_EXTERNAL_CASE_DIR/tampered-chain.json"
if "$runtime" cloud verify-evidence-chain "$RLSOK_EXTERNAL_CASE_DIR/tampered-chain.json"; then
  echo 'tampered Evidence unexpectedly verified' >&2
  exit 1
fi
exit 2
EOF
export RLSOK_EXTERNAL_CASE_ID=evidence_tamper
unset RLSOK_EXTERNAL_PROPOSAL
bash "$RLSOK_EXTERNAL_TOOLKIT_ROOT/run-recorded-command.sh" \
  "$RLSOK_VALIDATION_ROOT/tamper-case" \
  "$RLSOK_VALIDATION_ROOT/evidence-tamper.command.sh"
rlsok validate-external-ros2 record \
  --output "$RLSOK_VALIDATION_ROOT/bundle" --case evidence_tamper \
  --outcome BLOCK --reason evidence_verification_failed \
  --command "$RLSOK_VALIDATION_ROOT/evidence-tamper.command.sh" \
  --log "$RLSOK_VALIDATION_ROOT/tamper-case/command.log" \
  --invocation "$RLSOK_VALIDATION_ROOT/tamper-case/invocation.json" \
  --execution "$RLSOK_VALIDATION_ROOT/tamper-case/execution.json" \
  --subject "$RLSOK_VALIDATION_ROOT/tamper-case/tampered-chain.json" \
  --original-evidence-chain "$RLSOK_VALIDATION_ROOT/tamper-case/original-chain.json"
```

## 4. Finalize, verify, and hand off

```bash
rlsok validate-external-ros2 finalize --output "$RLSOK_VALIDATION_ROOT/bundle"
rlsok validate-external-ros2 verify --output "$RLSOK_VALIDATION_ROOT/bundle"
(cd "$RLSOK_VALIDATION_ROOT/bundle" && sha256sum -c SHA256SUMS)
(cd "$RLSOK_VALIDATION_ROOT/bundle" && sha256sum manifest.json) \
  > "$RLSOK_VALIDATION_ROOT/manifest.anchor.sha256"
```

Expected machine status is always:

```json
{
  "status": "COLLECTED_SELF_ATTESTED",
  "reviewStatus": "EXTERNAL_REVIEW_REQUIRED"
}
```

The local `manifest.anchor.sha256` is not an external anchor while it remains
beside the writable bundle. Immediately transfer that small file over a
separately authenticated channel or write it to reviewer-controlled read-only
media. The reviewer verifies from inside the received bundle with
`sha256sum -c /path/to/manifest.anchor.sha256`.

An independent reviewer must obtain the manifest anchor separately, confirm
the observer/controller instrumentation and Cloud audit identities, and rerun
both verification commands. Only that reviewer may describe the external run
as PASS. The collector itself never does.

The raw setup log can contain a one-time pairing or approval URL. Treat the
entire bundle as sensitive until that URL has expired or been consumed; never
publish it as a public CI artifact.

Run the Evidence export only in a dedicated validation organization. The Cloud
v1 export preserves the organization-wide chain and can include payload
metadata for releases outside the filter; transferring it from a shared
organization can disclose unrelated device/release facts. A bounded,
server-authenticated checkpoint/inclusion proof remains an external Cloud gate.

`recover` repairs collector manifests, staging files, and a dead collector
lock. It cannot prove or reap arbitrary processes that escaped the command
process group after a host crash. After such a crash, stop the run, verify the
isolated ROS graph has no old action server/client or publisher, and start a new
session; do not reuse the old bundle.

## UR5e reference path

For an official-driver or physical UR5e, use the stricter phased tool in
`PHYSICAL_UR5E_VALIDATION.md`:

```bash
rlsok validate-ur5e preflight --output "$OUT" --operator "$USER" --robot-serial "$SERIAL"
rlsok setup --artifact /absolute/path/to/policy-artifact
rlsok validate-ur5e record --output "$OUT" --operator "$USER" --robot-serial "$SERIAL"
# Different authenticated Cloud user revokes the exact recorded release here.
rlsok validate-ur5e finalize --output "$OUT" --operator "$USER" --robot-serial "$SERIAL"
(cd "$OUT" && sha256sum -c SHA256SUMS)
```

The phase chain binds session, operator, serial, setup state, exact release and
artifact, environment, Cloud Evidence, revocation, and zero dispatch. It does
not claim physical safety or authorize production motion.

## Husarion ROSbot Gazebo reference path

Use only the pinned official Gazebo workspace and never a physical ROSbot:

```bash
export HUSARION_WS="$HOME/rosbot_ws"
export RLSOK_HUSARION_NAMESPACE=''  # or one validated namespace such as robot1
bash scripts/husarion-gazebo-acceptance.sh
```

The script creates a unique `0700` run directory, keeps its command observer
alive through each command and settle interval, records resolved namespaced
topics/environment/source/upstream commits, cleans up every background process,
and emits `acceptance-summary.json`, `manifest.json`, and `SHA256SUMS`.

The TypeScript Gazebo Reference Run permit/replay registry is live-process
only. It is not crash-safe and must not be used to claim restart-safe or
durable exactly-once physical dispatch. Use Shadow for the external matrix;
the experimental Rust Run boundary remains disabled until its separate CI and
external gates pass.
