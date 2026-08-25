#!/usr/bin/env bash
set -Eeo pipefail

PINNED_COMMIT="7c7bfa449011905be63442b6c0ca98b35131cabc"
PINNED_CONTROLLER_SHA="207508c19de20bcfec44aefc6f09ed833cc6a33b63c78aade427817928302aba"
: "${HUSARION_WS:?HUSARION_WS must point to the built official workspace}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof_dir="$repo_root/artifacts/husarion-gazebo"
controller="$HUSARION_WS/src/rosbot_ros/rosbot_controller/config/rosbot/controllers.yaml"
mkdir -p "$proof_dir"

source /opt/ros/jazzy/setup.bash
source "$HUSARION_WS/install/setup.bash"
set -u
cd "$repo_root"

diagnostics() {
  status=$?
  if [[ $status -eq 0 ]]; then return; fi
  echo "=== Husarion acceptance diagnostics (status $status) ==="
  timeout 10 ros2 topic list -t || true
  timeout 10 ros2 node list || true
  timeout 10 ros2 control list_controllers --controller-manager /controller_manager || true
  timeout 10 ros2 control list_hardware_interfaces --controller-manager /controller_manager || true
  for file in "$proof_dir"/*.log "$proof_dir"/*.json; do
    [[ -f "$file" ]] && { echo "=== $file ==="; tail -n 400 "$file"; }
  done
  [[ -f "$proof_dir/gazebo.log" ]] && tail -n 1000 "$proof_dir/gazebo.log"
  exit "$status"
}
trap diagnostics ERR

actual_commit="$(git -C "$HUSARION_WS/src/rosbot_ros" rev-parse HEAD)"
[[ "$actual_commit" == "$PINNED_COMMIT" ]]
echo "$actual_commit" > "$proof_dir/upstream-commit.txt"
echo "$PINNED_CONTROLLER_SHA  $controller" | sha256sum --check

export ROS_DOMAIN_ID=91
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
ros2 daemon stop >/dev/null 2>&1 || true
ros2 launch rosbot_gazebo simulation.yaml \
  robot_model:=rosbot rviz:=False gz_headless_mode:=True \
  > "$proof_dir/gazebo.log" 2>&1 &
gazebo_pid=$!
cleanup() {
  kill "$gazebo_pid" 2>/dev/null || true
  wait "$gazebo_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=false
readiness_deadline=$((SECONDS + 180))
while (( SECONDS < readiness_deadline )); do
  cmd_type="$(timeout 2 ros2 topic type /cmd_vel 2>/dev/null || true)"
  odom_type="$(timeout 2 ros2 topic type /odometry/filtered 2>/dev/null || true)"
  if [[ "$cmd_type" == "geometry_msgs/msg/TwistStamped" \
    && "$odom_type" == "nav_msgs/msg/Odometry" ]]; then
    controllers="$(timeout 3 ros2 control list_controllers --controller-manager /controller_manager 2>/dev/null || true)"
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
ros2 topic info /cmd_vel -v > "$proof_dir/cmd-vel-info.txt"
ros2 topic info /odometry/filtered -v > "$proof_dir/odometry-info.txt"
ros2 control list_controllers --controller-manager /controller_manager \
  > "$proof_dir/controllers.txt"
ros2 control list_hardware_interfaces --controller-manager /controller_manager \
  > "$proof_dir/hardware-interfaces.txt"
ros2 param get /twist_mux_controller drive_controller \
  > "$proof_dir/mux-drive-controller.txt"
ros2 param get /twist_mux_controller cmd_vel_inputs.unknown.topic \
  > "$proof_dir/mux-unknown-topic.txt"
ros2 param get /twist_mux_controller cmd_vel_inputs.unknown.priority \
  > "$proof_dir/mux-unknown-priority.txt"
grep -q "differential_drive_controller" "$proof_dir/mux-drive-controller.txt"
grep -q "cmd_vel" "$proof_dir/mux-unknown-topic.txt"
grep -Eq '(^|[^0-9])1([^0-9]|$)' "$proof_dir/mux-unknown-priority.txt"
grep -Eq 'differential_drive_controller/(linear|angular)/velocity.*claimed' \
  "$proof_dir/hardware-interfaces.txt"

run_monitor() {
  local name=$1 duration=$2
  rm -f "$proof_dir/$name.ready" "$proof_dir/$name-monitor.json"
  python3 scripts/husarion-gazebo-monitor.py \
    --duration "$duration" \
    --output "$proof_dir/$name-monitor.json" \
    --ready-file "$proof_dir/$name.ready" \
    > "$proof_dir/$name-monitor.log" 2>&1 &
  monitor_pid=$!
  for attempt in $(seq 1 50); do
    [[ -f "$proof_dir/$name.ready" ]] && break
    sleep 0.1
  done
  [[ -f "$proof_dir/$name.ready" ]]
  sleep 2
}

common_args=(
  --controller-config "$controller"
  --device-identity rosbot-gazebo-01
  --robot-identity husarion-rosbot-gazebo
  --proposer-identity learned-policy@example.test
  --namespace ''
  --use-sim-time true
  --required-observer-node rlsok_husarion_acceptance_monitor
)

run_monitor shadow 8
node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode shadow \
  --release examples/husarion-rosbot-gazebo/release.shadow.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.json \
  --evidence "$proof_dir/evidence.shadow.json" \
  "${common_args[@]}" | tee "$proof_dir/shadow.log"
wait "$monitor_pid"
jq -e '.decision == "allowed" and .hardwareSignalSent == false and .publicationCount == 0' \
  "$proof_dir/shadow.log" >/dev/null
jq -e '.commandCount == 0 and (.commands | length) == 0' \
  "$proof_dir/shadow-monitor.json" >/dev/null
node scripts/run-rlsok.cjs --test apps/cli/rlsok.ts verify-evidence \
  "$proof_dir/evidence.shadow.json" \
  | tee "$proof_dir/shadow-evidence.log"

run_monitor run 10
node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode run \
  --release examples/husarion-rosbot-gazebo/release.run.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.run.json \
  --evidence "$proof_dir/evidence.run.json" \
  "${common_args[@]}" | tee "$proof_dir/run.log"
wait "$monitor_pid"
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
  "$proof_dir/evidence.run.json" \
  | tee "$proof_dir/run-evidence.log"

changed_controller="$proof_dir/controllers.changed.yaml"
cp "$controller" "$changed_controller"
printf '\n# acceptance binding mismatch\n' >> "$changed_controller"
run_monitor mismatch 8
if node scripts/run-rlsok.cjs --test apps/demo/husarion-rosbot-gazebo.ts \
  --mode run \
  --release examples/husarion-rosbot-gazebo/release.run.json \
  --proposal examples/husarion-rosbot-gazebo/proposal.run.json \
  --evidence "$proof_dir/evidence.mismatch.json" \
  --controller-config "$changed_controller" \
  --device-identity rosbot-gazebo-01 \
  --robot-identity husarion-rosbot-gazebo \
  --proposer-identity learned-policy@example.test \
  --namespace '' \
  --use-sim-time true | tee "$proof_dir/mismatch.log"; then
  mismatch_status=0
else
  mismatch_status=$?
fi
wait "$monitor_pid"
if [[ "$mismatch_status" -ne 2 ]]; then
  echo "configuration mismatch returned $mismatch_status; expected 2" >&2
  false
fi
jq -e '.decision == "blocked" and .reason == "configuration_mismatch" and .hardwareSignalSent == false and .publicationCount == 0' \
  "$proof_dir/mismatch.log" >/dev/null
jq -e '.commandCount == 0 and (.commands | length) == 0' \
  "$proof_dir/mismatch-monitor.json" >/dev/null
node scripts/run-rlsok.cjs --test apps/cli/rlsok.ts verify-evidence \
  "$proof_dir/evidence.mismatch.json" \
  | tee "$proof_dir/mismatch-evidence.log"

jq -n \
  --arg upstreamCommit "$actual_commit" \
  --slurpfile shadow "$proof_dir/shadow-monitor.json" \
  --slurpfile run "$proof_dir/run-monitor.json" \
  --slurpfile mismatch "$proof_dir/mismatch-monitor.json" \
  '{status:"passed", upstreamCommit:$upstreamCommit, shadow:$shadow[0], run:$run[0], mismatch:$mismatch[0], physicalRobotValidation:"not_performed"}' \
  > "$proof_dir/acceptance-summary.json"
cat "$proof_dir/acceptance-summary.json"
