#!/usr/bin/env bash
set -Eeo pipefail
umask 077

PINNED_COMMIT="7c7bfa449011905be63442b6c0ca98b35131cabc"
PINNED_CONTROLLER_SHA="207508c19de20bcfec44aefc6f09ed833cc6a33b63c78aade427817928302aba"
: "${HUSARION_WS:?HUSARION_WS must point to the built official workspace}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof_root="${RLSOK_HUSARION_PROOF_ROOT:-$repo_root/artifacts/husarion-gazebo}"
proof_root="$(realpath -m "$proof_root")"
run_id="${RLSOK_HUSARION_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
if [[ ! "$run_id" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  echo "RLSOK_HUSARION_RUN_ID contains unsupported characters" >&2
  exit 2
fi
proof_dir="$(realpath -m "${RLSOK_HUSARION_PROOF_DIR:-$proof_root/$run_id}")"
if [[ -e "$proof_dir" ]]; then
  echo "Husarion proof directory must not already exist: $proof_dir" >&2
  exit 2
fi
mkdir -m 700 -p "$proof_dir"
controller="$HUSARION_WS/src/rosbot_ros/rosbot_controller/config/rosbot/controllers.yaml"
namespace="${RLSOK_HUSARION_NAMESPACE:-}"
namespace="${namespace#/}"
namespace="${namespace%/}"
if [[ -n "$namespace" && ! "$namespace" =~ ^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$ ]]; then
  echo "RLSOK_HUSARION_NAMESPACE is invalid" >&2
  exit 2
fi
topic_prefix="${namespace:+/$namespace}"
command_topic="$topic_prefix/cmd_vel"
odometry_topic="$topic_prefix/odometry/filtered"
mux_source_topic="$topic_prefix/twist_mux_controller/source"
controller_manager="$topic_prefix/controller_manager"
mux_node="$topic_prefix/twist_mux_controller"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
source_commit="$(git -c safe.directory="$repo_root" -C "$repo_root" rev-parse HEAD)"
gazebo_pid=""
monitor_pid=""
monitor_name=""

command -v setsid >/dev/null

source /opt/ros/jazzy/setup.bash
source "$HUSARION_WS/install/setup.bash"
set -u
cd "$repo_root"

process_group_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

wait_for_process_group() {
  local process_group=$1 attempts=$2
  for _attempt in $(seq 1 "$attempts"); do
    if ! process_group_alive "$process_group"; then return 0; fi
    sleep 0.1
  done
  return 1
}

terminate_background_group() {
  local process_group=$1 label=$2
  [[ -n "$process_group" ]] || return 0
  kill -INT -- "-$process_group" 2>/dev/null || true
  if ! wait_for_process_group "$process_group" 100; then
    kill -TERM -- "-$process_group" 2>/dev/null || true
  fi
  if ! wait_for_process_group "$process_group" 20; then
    kill -KILL -- "-$process_group" 2>/dev/null || true
  fi
  if ! wait_for_process_group "$process_group" 20; then
    echo "background_process_group_cleanup_failed:$label:$process_group" >&2
    return 1
  fi
  wait "$process_group" 2>/dev/null || true
}

cleanup_background() {
  if [[ -n "$monitor_pid" ]]; then
    terminate_background_group "$monitor_pid" "monitor:$monitor_name" || true
    monitor_pid=""
  fi
  if [[ -n "$gazebo_pid" ]]; then
    terminate_background_group "$gazebo_pid" "gazebo" || true
    gazebo_pid=""
  fi
}

diagnostics() {
  local status=$1
  cleanup_background
  echo "=== Husarion acceptance diagnostics (status $status) ==="
  timeout 10 ros2 topic list -t || true
  timeout 10 ros2 node list || true
  timeout 10 ros2 control list_controllers --controller-manager "$controller_manager" || true
  timeout 10 ros2 control list_hardware_interfaces --controller-manager "$controller_manager" || true
  for file in "$proof_dir"/*.log "$proof_dir"/*.json; do
    [[ -f "$file" ]] && { echo "=== $file ==="; tail -n 400 "$file"; }
  done
  [[ -f "$proof_dir/gazebo.log" ]] && tail -n 1000 "$proof_dir/gazebo.log"
  exit "$status"
}
trap 'diagnostics $?' ERR
trap cleanup_background EXIT

actual_commit="$(
  git -c safe.directory="$HUSARION_WS/src/rosbot_ros" \
    -C "$HUSARION_WS/src/rosbot_ros" rev-parse HEAD
)"
[[ "$actual_commit" == "$PINNED_COMMIT" ]]
echo "$actual_commit" > "$proof_dir/upstream-commit.txt"
echo "$PINNED_CONTROLLER_SHA  $controller" | sha256sum --check

export ROS_DOMAIN_ID=91
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
jq -n \
  --arg schema "rlsok.io/husarion-gazebo-environment/v1" \
  --arg runId "$run_id" \
  --arg startedAt "$started_at" \
  --arg sourceCommit "$source_commit" \
  --arg upstreamCommit "$actual_commit" \
  --arg namespace "$namespace" \
  --arg commandTopic "$command_topic" \
  --arg odometryTopic "$odometry_topic" \
  --arg muxSourceTopic "$mux_source_topic" \
  --arg rosDistro "${ROS_DISTRO:-unknown}" \
  --arg rmwImplementation "$RMW_IMPLEMENTATION" \
  --arg rosDomainId "$ROS_DOMAIN_ID" \
  --arg kernel "$(uname -srmo)" \
  --arg node "$(node --version)" \
  --arg python "$(python3 --version 2>&1)" \
  '{
    schema:$schema, runId:$runId, startedAt:$startedAt,
    sourceCommit:$sourceCommit, upstreamCommit:$upstreamCommit,
    namespace:$namespace,
    resolvedTopics:{command:$commandTopic,odometry:$odometryTopic,muxSource:$muxSourceTopic},
    rosDistro:$rosDistro, rmwImplementation:$rmwImplementation,
    rosDomainId:$rosDomainId, kernel:$kernel, node:$node, python:$python
  }' > "$proof_dir/environment.json"
ros2 daemon stop >/dev/null 2>&1 || true
launch_args=(robot_model:=rosbot rviz:=False gz_headless_mode:=True)
if [[ -n "$namespace" ]]; then launch_args+=("namespace:=$namespace"); fi
setsid ros2 launch rosbot_gazebo simulation.yaml "${launch_args[@]}" \
  > "$proof_dir/gazebo.log" 2>&1 &
gazebo_pid=$!

ready=false
readiness_deadline=$((SECONDS + 180))
while (( SECONDS < readiness_deadline )); do
  cmd_type="$(timeout 2 ros2 topic type "$command_topic" 2>/dev/null || true)"
  odom_type="$(timeout 2 ros2 topic type "$odometry_topic" 2>/dev/null || true)"
  if [[ "$cmd_type" == "geometry_msgs/msg/TwistStamped" \
    && "$odom_type" == "nav_msgs/msg/Odometry" ]]; then
    controllers="$(timeout 3 ros2 control list_controllers --controller-manager "$controller_manager" 2>/dev/null || true)"
    if [[ "$controllers" == *"twist_mux_controller"*"active"* \
      && "$controllers" == *"differential_drive_controller"*"active"* ]]; then
      ready=true
      break
    fi
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "official_gazebo_graph_not_ready" >&2
  false
fi

ros2 topic list -t > "$proof_dir/topics.txt"
ros2 topic info "$command_topic" -v > "$proof_dir/cmd-vel-info.txt"
ros2 topic info "$odometry_topic" -v > "$proof_dir/odometry-info.txt"
ros2 control list_controllers --controller-manager "$controller_manager" \
  > "$proof_dir/controllers.txt"
ros2 control list_hardware_interfaces --controller-manager "$controller_manager" \
  > "$proof_dir/hardware-interfaces.txt"
ros2 param get "$mux_node" drive_controller \
  > "$proof_dir/mux-drive-controller.txt"
ros2 param get "$mux_node" cmd_vel_inputs.unknown.topic \
  > "$proof_dir/mux-unknown-topic.txt"
ros2 param get "$mux_node" cmd_vel_inputs.unknown.priority \
  > "$proof_dir/mux-unknown-priority.txt"
grep -q "differential_drive_controller" "$proof_dir/mux-drive-controller.txt"
grep -q "cmd_vel" "$proof_dir/mux-unknown-topic.txt"
grep -Eq '(^|[^0-9])1([^0-9]|$)' "$proof_dir/mux-unknown-priority.txt"
grep -Eq 'differential_drive_controller/(linear|angular)/velocity.*claimed' \
  "$proof_dir/hardware-interfaces.txt"

run_monitor() {
  local name=$1
  if [[ -n "$monitor_pid" ]]; then
    echo "observer_already_running:$monitor_name" >&2
    return 1
  fi
  monitor_name="$name"
  setsid python3 scripts/husarion-gazebo-monitor.py \
    --duration 180 \
    --output "$proof_dir/$name-monitor.json" \
    --ready-file "$proof_dir/$name.ready" \
    --stop-file "$proof_dir/$name.stop" \
    --namespace "$namespace" \
    > "$proof_dir/$name-monitor.log" 2>&1 &
  monitor_pid=$!
  for attempt in $(seq 1 50); do
    [[ -f "$proof_dir/$name.ready" ]] && break
    kill -0 "$monitor_pid" 2>/dev/null || break
    sleep 0.1
  done
  [[ -f "$proof_dir/$name.ready" ]]
  kill -0 "$monitor_pid" 2>/dev/null
  sleep 2
}

stop_monitor() {
  local name=$1
  if [[ -z "$monitor_pid" || "$monitor_name" != "$name" ]]; then
    echo "observer_not_running:$name" >&2
    return 1
  fi
  if ! kill -0 "$monitor_pid" 2>/dev/null; then
    wait "$monitor_pid" 2>/dev/null || true
    monitor_pid=""
    echo "observer_ended_before_command:$name" >&2
    return 1
  fi
  # Keep observing through a post-command DDS settle interval. The observer
  # must still be alive at the end or zero-dispatch evidence is invalid.
  sleep 1
  if ! kill -0 "$monitor_pid" 2>/dev/null; then
    wait "$monitor_pid" 2>/dev/null || true
    monitor_pid=""
    echo "observer_ended_before_settle:$name" >&2
    return 1
  fi
  : > "$proof_dir/$name.stop"
  if ! wait_for_process_group "$monitor_pid" 150; then
    terminate_background_group "$monitor_pid" "monitor:$name" || true
    monitor_pid=""
    monitor_name=""
    echo "observer_did_not_stop_after_request:$name" >&2
    return 1
  fi
  wait "$monitor_pid"
  monitor_pid=""
  monitor_name=""
  jq -e \
    --arg namespace "$namespace" \
    --arg command "$command_topic" \
    --arg odometry "$odometry_topic" \
    --arg muxSource "$mux_source_topic" \
    '.observerCompleted == true
      and .terminationReason == "stop_requested"
      and .namespace == $namespace
      and .resolvedTopics == {command:$command,odometry:$odometry,muxSource:$muxSource}' \
    "$proof_dir/$name-monitor.json" >/dev/null
}

common_args=(
  --controller-config "$controller"
  --device-identity rosbot-gazebo-01
  --robot-identity husarion-rosbot-gazebo
  --proposer-identity learned-policy@example.test
  --namespace "$namespace"
  --use-sim-time true
  --required-observer-node rlsok_husarion_acceptance_monitor
)

run_monitor shadow
node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode shadow \
  --release examples/husarion-rosbot-gazebo/release.shadow.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.json \
  --evidence "$proof_dir/evidence.shadow.json" \
  "${common_args[@]}" | tee "$proof_dir/shadow.log"
stop_monitor shadow
jq -e '.decision == "allowed" and .hardwareSignalSent == false and .publicationCount == 0' \
  "$proof_dir/shadow.log" >/dev/null
jq -e '.commandCount == 0 and (.commands | length) == 0 and (.rlsokPublisherNodes | length) >= 1' \
  "$proof_dir/shadow-monitor.json" >/dev/null
node scripts/run-rlsok.cjs --test apps/cli/rlsok.ts verify-evidence \
  "$proof_dir/evidence.shadow.json" --release \
  examples/husarion-rosbot-gazebo/release.shadow.json \
  | tee "$proof_dir/shadow-evidence.log"

# Cover the 2 s pre-start arm, the transport's bounded 15 s DDS readiness
# window, dispatch, and independent odometry/source observation. The monitor
# publishes nothing and does not extend the runtime's readiness deadline.
run_monitor run
node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode run \
  --release examples/husarion-rosbot-gazebo/release.run.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.run.json \
  --evidence "$proof_dir/evidence.run.json" \
  "${common_args[@]}" | tee "$proof_dir/run.log"
stop_monitor run
jq -e '.decision == "allowed" and .hardwareSignalSent == true and .publicationCount == 1' \
  "$proof_dir/run.log" >/dev/null
jq -e '
  .commandCount == 1
  and (.commands | length) == 1
  and .commands[0].frameId == "base_link"
  and (.commands[0].linearX - 0.1 | fabs) < 0.000001
  and (.commands[0].angularZ - 0.2 | fabs) < 0.000001
  and (.muxSources | index("unknown")) != null
  and (.rlsokPublisherNodes | length) >= 1
  and .maxDisplacementMeters > 0.001
  and .maxLinearSpeed > 0.01
' "$proof_dir/run-monitor.json" >/dev/null
node scripts/run-rlsok.cjs --test apps/cli/rlsok.ts verify-evidence \
  "$proof_dir/evidence.run.json" --release \
  examples/husarion-rosbot-gazebo/release.run.json \
  | tee "$proof_dir/run-evidence.log"

changed_controller="$proof_dir/controllers.changed.yaml"
cp "$controller" "$changed_controller"
printf '\n# acceptance binding mismatch\n' >> "$changed_controller"
run_monitor mismatch
if node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode run \
  --release examples/husarion-rosbot-gazebo/release.run.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.run.json \
  --evidence "$proof_dir/evidence.mismatch.json" \
  --controller-config "$changed_controller" \
  --device-identity rosbot-gazebo-01 \
  --robot-identity husarion-rosbot-gazebo \
  --proposer-identity learned-policy@example.test \
  --namespace "$namespace" \
  --use-sim-time true | tee "$proof_dir/mismatch.log"; then
  mismatch_status=0
else
  mismatch_status=$?
fi
stop_monitor mismatch
if [[ "$mismatch_status" -ne 2 ]]; then
  echo "configuration mismatch returned $mismatch_status; expected 2" >&2
  false
fi
jq -e '.decision == "blocked" and .reason == "configuration_mismatch" and .hardwareSignalSent == false and .publicationCount == 0' \
  "$proof_dir/mismatch.log" >/dev/null
jq -e '.commandCount == 0 and (.commands | length) == 0 and (.rlsokPublisherNodes | length) >= 1' \
  "$proof_dir/mismatch-monitor.json" >/dev/null
node scripts/run-rlsok.cjs --test apps/cli/rlsok.ts verify-evidence \
  "$proof_dir/evidence.mismatch.json" --release \
  examples/husarion-rosbot-gazebo/release.run.json \
  | tee "$proof_dir/mismatch-evidence.log"

# Stop the simulator before hashing the proof so gazebo.log cannot change after
# the manifest is finalized.
terminate_background_group "$gazebo_pid" "gazebo"
gazebo_pid=""
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg schema "rlsok.io/husarion-gazebo-acceptance/v1" \
  --arg runId "$run_id" \
  --arg sourceCommit "$source_commit" \
  --arg upstreamCommit "$actual_commit" \
  --arg startedAt "$started_at" \
  --arg finishedAt "$finished_at" \
  --arg namespace "$namespace" \
  --arg commandTopic "$command_topic" \
  --arg odometryTopic "$odometry_topic" \
  --arg muxSourceTopic "$mux_source_topic" \
  --slurpfile shadow "$proof_dir/shadow-monitor.json" \
  --slurpfile run "$proof_dir/run-monitor.json" \
  --slurpfile mismatch "$proof_dir/mismatch-monitor.json" \
  '{
    schema:$schema, status:"PASS", runId:$runId,
    sourceCommit:$sourceCommit, upstreamCommit:$upstreamCommit,
    startedAt:$startedAt, finishedAt:$finishedAt,
    namespace:$namespace,
    resolvedTopics:{command:$commandTopic,odometry:$odometryTopic,muxSource:$muxSourceTopic},
    checks:{
      shadow:"PASS", shadowZeroDispatchObserver:"PASS",
      runExactlyOnePublication:"PASS", configurationMismatchBlocked:"PASS",
      evidenceVerification:"PASS"
    },
    shadow:$shadow[0], run:$run[0], mismatch:$mismatch[0],
    physicalRobotValidation:"not_performed"
  }' \
  > "$proof_dir/acceptance-summary.json"

files_json='[]'
while IFS= read -r -d '' artifact; do
  relative_path="${artifact#"$proof_dir/"}"
  artifact_sha="$(sha256sum "$artifact" | cut -d' ' -f1)"
  artifact_bytes="$(stat -c %s "$artifact")"
  files_json="$(jq -c \
    --arg path "$relative_path" \
    --arg sha256 "$artifact_sha" \
    --argjson bytes "$artifact_bytes" \
    '. + [{path:$path,sha256:$sha256,bytes:$bytes}]' <<<"$files_json")"
done < <(find "$proof_dir" -type f \
  ! -name manifest.json ! -name SHA256SUMS -print0 | sort -z)
jq -n \
  --arg schema "rlsok.io/husarion-gazebo-artifact-manifest/v1" \
  --arg runId "$run_id" \
  --arg status "PASS" \
  --arg sourceCommit "$source_commit" \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson files "$files_json" \
  '{schema:$schema,runId:$runId,status:$status,sourceCommit:$sourceCommit,generatedAt:$generatedAt,files:$files}' \
  > "$proof_dir/manifest.json"
(
  cd "$proof_dir"
  find . -type f ! -name SHA256SUMS -printf '%P\0' \
    | sort -z \
    | xargs -0 sha256sum
) > "$proof_dir/SHA256SUMS"
(cd "$proof_dir" && sha256sum -c SHA256SUMS >/dev/null)
cat "$proof_dir/acceptance-summary.json"
printf 'Husarion acceptance proof: %s\n' "$proof_dir"
