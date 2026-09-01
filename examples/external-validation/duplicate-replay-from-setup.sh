#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

: "${RLSOK_EXTERNAL_PROPOSAL:?path to the exact original proposal is required}"
: "${RLSOK_EXTERNAL_CASE_DIR:?run through run-isolated-case.sh}"
runtime_bin="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
proposal_topic="$(jq -er '.proposalTopic' "$setup_path")"
evidence_path="$RLSOK_EXTERNAL_CASE_DIR/evidence.json"
inner_log="$RLSOK_EXTERNAL_CASE_DIR/observe.log"

"$runtime_bin" observe --setup "$setup_path" --evidence "$evidence_path" \
  > "$inner_log" 2>&1 &
observe_pid=$!
cleanup() {
  kill -INT "$observe_pid" 2>/dev/null || true
  for _cleanup_attempt in $(seq 1 50); do
    kill -0 "$observe_pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -TERM "$observe_pid" 2>/dev/null || true
  sleep 0.2
  kill -KILL "$observe_pid" 2>/dev/null || true
  wait "$observe_pid" 2>/dev/null || true
}
trap cleanup EXIT

message="$(jq -Rs '{data:.}' "$RLSOK_EXTERNAL_PROPOSAL")"
timeout 30 ros2 topic pub --once --wait-matching-subscriptions 1 \
  "$proposal_topic" std_msgs/msg/String "$message" >/dev/null
for _attempt in $(seq 1 300); do
  [[ -f "$evidence_path" ]] && jq -e '
    .decision == "blocked" and .reason == "proposal_id_duplicate"
    and .evidenceVerified == true and (.cloudEvidenceId | type == "string")
    and (.cloudEvidenceId | length > 0)
  ' "$evidence_path" >/dev/null 2>&1 && break
  kill -0 "$observe_pid" 2>/dev/null || { echo "observe exited before replay result" >&2; exit 2; }
  sleep 0.1
done
jq -e '.decision == "blocked" and .reason == "proposal_id_duplicate"
  and .evidenceVerified == true and (.cloudEvidenceId | type == "string")
  and (.cloudEvidenceId | length > 0)' \
  "$evidence_path" >/dev/null
cloud_evidence_id="$(jq -er '.cloudEvidenceId' "$evidence_path")"
"$runtime_bin" cloud get-evidence "$cloud_evidence_id" \
  > "$RLSOK_EXTERNAL_CASE_DIR/cloud-evidence.json"
cleanup
trap - EXIT
# The first delivery after process restart must already be a verified BLOCK.
exit 2
