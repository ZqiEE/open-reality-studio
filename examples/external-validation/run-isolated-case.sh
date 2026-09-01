#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "usage: run-isolated-case.sh <new-case-directory> <command-file>" >&2
  exit 2
fi
: "${RLSOK_EXTERNAL_VALIDATION_SESSION_ID:?set from validation session.json}"
: "${RLSOK_EXTERNAL_CASE_ID:?set to the exact case ID}"

case_dir="$(realpath -m "$1")"
command_file="$(realpath "$2")"
if [[ -e "$case_dir" ]]; then
  echo "case directory must not already exist: $case_dir" >&2
  exit 2
fi
if [[ ! -f "$command_file" || -L "$command_file" ]]; then
  echo "command file must be a regular non-symlink: $command_file" >&2
  exit 2
fi
mkdir -m 700 -p "$case_dir"

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
observer_pid=""
cleanup() {
  if [[ -n "$observer_pid" ]]; then
    kill "$observer_pid" 2>/dev/null || true
    wait "$observer_pid" 2>/dev/null || true
    observer_pid=""
  fi
}
trap cleanup EXIT

"$script_root/capture-invocation.sh" "$case_dir/invocation.json" "$command_file"

pause_file="$case_dir/pause-state"
drift_file="$case_dir/drift-state"
command_sha256="$(sha256sum "$command_file" | cut -d' ' -f1)"
invocation_sha256="$(sha256sum "$case_dir/invocation.json" | cut -d' ' -f1)"
observer_instance_id="$(cat /proc/sys/kernel/random/uuid)"
observer_nonce="$(cat /proc/sys/kernel/random/uuid)"
(ulimit -f 8192; exec python3 "$script_root/generic_ros2_observer.py" \
  --output "$case_dir/observer.json" \
  --ready-file "$case_dir/observer.ready.json" \
  --start-file "$case_dir/command.started" \
  --finish-file "$case_dir/command.finished" \
  --fresh-state-ready-file "$case_dir/fresh-state.ready.json" \
  --pause-state-file "$pause_file" \
  --drift-state-file "$drift_file" \
  --session-id "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --case-id "$RLSOK_EXTERNAL_CASE_ID" \
  --command-sha256 "$command_sha256" \
  --invocation-sha256 "$invocation_sha256" \
  --observer-instance-id "$observer_instance_id" \
  --nonce "$observer_nonce" \
  --action "${RLSOK_EXTERNAL_CONTROLLER_ACTION:-/joint_trajectory_controller/follow_joint_trajectory}" \
  --joint-state "${RLSOK_EXTERNAL_JOINT_STATE_TOPIC:-/joint_states}" \
  --joints "${RLSOK_EXTERNAL_JOINTS:-joint_a,joint_b}" \
  --timeout-seconds "${RLSOK_EXTERNAL_OBSERVER_TIMEOUT_SECONDS:-3780}") \
  > "$case_dir/observer.log" 2>&1 &
observer_pid=$!

for _attempt in $(seq 1 300); do
  [[ -f "$case_dir/observer.ready.json" ]] && \
    jq -e '.schema == "rlsok.io/zero-dispatch-observer-ready/v1" and .exclusiveCommandServer == true' \
      "$case_dir/observer.ready.json" >/dev/null 2>&1 && break
  kill -0 "$observer_pid" 2>/dev/null || break
  sleep 0.1
done
if ! jq -e '.schema == "rlsok.io/zero-dispatch-observer-ready/v1" and .exclusiveCommandServer == true' \
  "$case_dir/observer.ready.json" >/dev/null 2>&1 || ! kill -0 "$observer_pid" 2>/dev/null; then
  echo "independent observer did not arm" >&2
  exit 2
fi

write_marker() {
  local target="$1" temporary="${1}.$$.tmp"
  date -u +%Y-%m-%dT%H:%M:%S.%3NZ > "$temporary"
  chmod 600 "$temporary"
  mv -- "$temporary" "$target"
}

write_marker "$case_dir/command.started"
set +e
python3 "$script_root/run_command_group.py" \
  --command "$command_file" \
  --log "$case_dir/command.log" \
  --timeout-seconds "${RLSOK_EXTERNAL_COMMAND_TIMEOUT_SECONDS:-3720}" \
  --max-log-bytes "${RLSOK_EXTERNAL_MAX_LOG_BYTES:-33554432}" \
  --case-directory "$case_dir"
command_status=$?
set -e
write_marker "$case_dir/command.finished"
test "$(sha256sum "$command_file" | cut -d' ' -f1)" = "$command_sha256"

observer_exited=false
for _attempt in $(seq 1 400); do
  if ! kill -0 "$observer_pid" 2>/dev/null; then observer_exited=true; break; fi
  sleep 0.1
done
if [[ "$observer_exited" != true ]]; then
  kill -TERM "$observer_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$observer_pid" 2>/dev/null || true
fi
set +e; wait "$observer_pid"; observer_status=$?; set -e
observer_pid=""
if [[ "$observer_status" -ne 0 ]]; then
  echo "independent observer failed with status $observer_status" >&2
  exit 2
fi
jq -e '
  .schema == "rlsok.io/zero-dispatch-observer/v1"
  and .armedBeforeCommand == true
  and .commandPathMatched == true
  and .qosCompatible == true
  and .observerCompleted == true
  and .terminationReason == "settle_complete"
  and .commandServerCountAtArm == 1
  and .maximumCommandServerCount == 1
  and .baselineDispatchCount == .finalDispatchCount
  and .rlsokDispatchesObserved == 0
  and .acceptedGoalCancelCallbacks == 0
' "$case_dir/observer.json" >/dev/null

execution_tmp="$case_dir/execution.json.$$.tmp"
jq -n \
  --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --arg caseId "$RLSOK_EXTERNAL_CASE_ID" \
  --arg invocationSha256 "$invocation_sha256" \
  --arg commandSha256 "$command_sha256" \
  --arg commandLogSha256 "$(sha256sum "$case_dir/command.log" | cut -d' ' -f1)" \
  --arg observerSha256 "$(sha256sum "$case_dir/observer.json" | cut -d' ' -f1)" \
  --argjson commandExitCode "$command_status" \
  --arg commandStartedAt "$(cat "$case_dir/command.started")" \
  --arg commandFinishedAt "$(cat "$case_dir/command.finished")" \
  '{schema:"rlsok.io/external-command-execution/v1",sessionId:$sessionId,
    caseId:$caseId,invocationSha256:$invocationSha256,commandSha256:$commandSha256,
    commandLogSha256:$commandLogSha256,observerSha256:$observerSha256,
    commandExitCode:$commandExitCode,commandStartedAt:$commandStartedAt,
    commandFinishedAt:$commandFinishedAt}' > "$execution_tmp"
chmod 600 "$execution_tmp"
mv -- "$execution_tmp" "$case_dir/execution.json"

jq -n \
  --arg caseDirectory "$case_dir" \
  --argjson commandExitCode "$command_status" \
  '{status:"OBSERVER_PASS",caseDirectory:$caseDirectory,commandExitCode:$commandExitCode}'
