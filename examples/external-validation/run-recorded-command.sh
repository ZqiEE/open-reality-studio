#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "usage: run-recorded-command.sh <new-case-directory> <command-file>" >&2
  exit 2
fi
: "${RLSOK_EXTERNAL_VALIDATION_SESSION_ID:?copy from validation session.json}"
: "${RLSOK_EXTERNAL_CASE_ID:?set to the exact validation case ID}"

case_dir="$(realpath -m "$1")"
command_file="$(realpath "$2")"
[[ ! -e "$case_dir" ]]
[[ -f "$command_file" && ! -L "$command_file" ]]
mkdir -m 700 -p "$case_dir"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_root/capture-invocation.sh" "$case_dir/invocation.json" "$command_file"

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
test "$(sha256sum "$command_file" | cut -d' ' -f1)" = \
  "$(jq -er .commandSha256 "$case_dir/invocation.json")"

execution_tmp="$case_dir/execution.json.$$.tmp"
jq -n \
  --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --arg caseId "$RLSOK_EXTERNAL_CASE_ID" \
  --arg invocationSha256 "$(sha256sum "$case_dir/invocation.json" | cut -d' ' -f1)" \
  --arg commandSha256 "$(sha256sum "$command_file" | cut -d' ' -f1)" \
  --arg commandLogSha256 "$(sha256sum "$case_dir/command.log" | cut -d' ' -f1)" \
  --argjson commandExitCode "$command_status" \
  --arg commandStartedAt "$(cat "$case_dir/command.started")" \
  --arg commandFinishedAt "$(cat "$case_dir/command.finished")" \
  '{schema:"rlsok.io/external-command-execution/v1",sessionId:$sessionId,
    caseId:$caseId,invocationSha256:$invocationSha256,commandSha256:$commandSha256,
    commandLogSha256:$commandLogSha256,observerSha256:null,
    commandExitCode:$commandExitCode,commandStartedAt:$commandStartedAt,
    commandFinishedAt:$commandFinishedAt}' > "$execution_tmp"
chmod 600 "$execution_tmp"
mv -- "$execution_tmp" "$case_dir/execution.json"
jq -n --arg caseDirectory "$case_dir" --argjson commandExitCode "$command_status" \
  '{status:"EXECUTION_RECORDED",caseDirectory:$caseDirectory,commandExitCode:$commandExitCode}'
