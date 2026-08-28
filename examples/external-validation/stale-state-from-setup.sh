#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

: "${RLSOK_EXTERNAL_PROPOSAL:?path to a fresh valid proposal is required}"
: "${RLSOK_EXTERNAL_CASE_DIR:?run through run-isolated-case.sh}"
runtime_bin="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
proposal_topic="$(jq -er '.proposalTopic' "$setup_path")"
joint_state_topic="$(jq -er '.jointStateTopic' "$setup_path")"
release_path="$(jq -er '.releasePath' "$setup_path")"
max_state_age_ms="$(jq -er '.runtimePolicy.maxStateAgeMs' "$release_path")"
if ! [[ "$max_state_age_ms" =~ ^[0-9]+$ ]] || (( max_state_age_ms < 1 || max_state_age_ms > 120000 )); then
  echo "release maxStateAgeMs is outside the validation bound" >&2
  exit 2
fi
inner_log="$RLSOK_EXTERNAL_CASE_DIR/runtime.log"

(ulimit -f 8192; exec "$runtime_bin" observe --setup "$setup_path" \
  --evidence "$RLSOK_EXTERNAL_CASE_DIR/unexpected-evidence.json") \
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

matched=false
for _attempt in $(seq 1 300); do
  if timeout 2 ros2 topic info "$joint_state_topic" --verbose 2>/dev/null \
    | grep -Eq 'Subscription count: [1-9]'; then
    matched=true
    break
  fi
  kill -0 "$observe_pid" 2>/dev/null || { echo "observe exited before state match" >&2; exit 2; }
  sleep 0.1
done
[[ "$matched" == true ]]
fresh_ready="$RLSOK_EXTERNAL_CASE_DIR/fresh-state.ready.json"
for _attempt in $(seq 1 300); do
  [[ -f "$fresh_ready" ]] && jq -e '
    .schema == "rlsok.io/fresh-joint-state-ready/v1"
    and .caseId == "stale_state" and .publicationCount >= 10
    and (.subscriberMatchedAt | type == "string")
    and (.lastPublishedAt | type == "string")
  ' "$fresh_ready" >/dev/null 2>&1 && break
  kill -0 "$observe_pid" 2>/dev/null || { echo "observe exited before fresh-state baseline" >&2; exit 2; }
  sleep 0.1
done
jq -e '.schema == "rlsok.io/fresh-joint-state-ready/v1"
  and .caseId == "stale_state" and .publicationCount >= 10' \
  "$fresh_ready" >/dev/null
: > "$RLSOK_EXTERNAL_CASE_DIR/pause-state"
python3 -c 'import sys,time; time.sleep((int(sys.argv[1]) + 250) / 1000)' "$max_state_age_ms"
message="$(jq -Rs '{data:.}' "$RLSOK_EXTERNAL_PROPOSAL")"
timeout 30 ros2 topic pub --once --wait-matching-subscriptions 1 \
  "$proposal_topic" std_msgs/msg/String "$message" >/dev/null
blocked=false
for _attempt in $(seq 1 300); do
  if grep -Eq 'joint_state_stale|state_stale_or_invalid' "$inner_log"; then
    blocked=true
    break
  fi
  kill -0 "$observe_pid" 2>/dev/null || break
  sleep 0.1
done
[[ "$blocked" == true ]]
if [[ "$(grep -Ec '^Reason: (joint_state_stale|state_stale_or_invalid)$' "$inner_log" || true)" -ne 1 ]]; then
  echo "stale-state runtime did not emit one exact supported reason" >&2
  exit 125
fi
if [[ -f "$RLSOK_EXTERNAL_CASE_DIR/unexpected-evidence.json" ]]; then
  echo "stale state unexpectedly produced complete execution Evidence" >&2
  exit 2
fi
cleanup
trap - EXIT
cat "$inner_log"
stale_reason="$(sed -nE 's/^Reason: (joint_state_stale|state_stale_or_invalid)$/\1/p' "$inner_log")"
negative_tmp="$RLSOK_EXTERNAL_CASE_DIR/negative-result.json.$$.tmp"
jq -n \
  --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --arg caseId "stale_state" \
  --arg reason "$stale_reason" \
  --arg subjectSha256 "$(sha256sum "$RLSOK_EXTERNAL_PROPOSAL" | cut -d' ' -f1)" \
  --arg runtimeLogSha256 "$(sha256sum "$inner_log" | cut -d' ' -f1)" \
  --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
  '{schema:"rlsok.io/external-negative-runtime-result/v1",sessionId:$sessionId,
    caseId:$caseId,reason:$reason,subjectSha256:$subjectSha256,
    runtimeLogSha256:$runtimeLogSha256,observedAt:$observedAt}' > "$negative_tmp"
chmod 600 "$negative_tmp"
mv -- "$negative_tmp" "$RLSOK_EXTERNAL_CASE_DIR/negative-result.json"
# A pre-Evidence stale-state rejection is the expected BLOCK outcome.
exit 2
