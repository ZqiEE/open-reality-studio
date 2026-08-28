#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

: "${RLSOK_EXTERNAL_PROPOSAL:?path to the exact proposal input is required}"
: "${RLSOK_EXTERNAL_CASE_DIR:?run through run-isolated-case.sh}"
runtime_bin="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
if [[ ! -f "$setup_path" || -L "$setup_path" ]]; then
  echo "setup state must be a regular non-symlink: $setup_path" >&2
  exit 2
fi
if [[ ! -f "$RLSOK_EXTERNAL_PROPOSAL" || -L "$RLSOK_EXTERNAL_PROPOSAL" ]]; then
  echo "proposal must be a regular non-symlink" >&2
  exit 2
fi

release_path="$(jq -er '.releasePath' "$setup_path")"
device_id="$(jq -er '.deviceId' "$setup_path")"
proposer_identity="$(jq -er '.proposerIdentity' "$setup_path")"
joint_state_topic="$(jq -er '.jointStateTopic' "$setup_path")"
controller_action="$(jq -er '.controllerAction' "$setup_path")"
proposal_topic="$(jq -er '.proposalTopic' "$setup_path")"
evidence_path="$RLSOK_EXTERNAL_CASE_DIR/evidence.json"
runtime_log="$RLSOK_EXTERNAL_CASE_DIR/runtime.log"
if [[ "${RLSOK_EXTERNAL_DRIFT_STATE:-0}" == "1" ]]; then
  : > "$RLSOK_EXTERNAL_CASE_DIR/drift-state"
fi

set +e
(ulimit -f 8192; exec env RLSOK_EXECUTION_MODE=cloud-connected "$runtime_bin" ros2 shadow \
  --release "$release_path" \
  --device "$device_id" \
  --proposer "$proposer_identity" \
  --joint-state-topic "$joint_state_topic" \
  --controller-action "$controller_action" \
  --proposal-topic "$proposal_topic" \
  --proposal-file "$RLSOK_EXTERNAL_PROPOSAL" \
  --once true \
  --proposal-timeout-ms 30000 \
  --evidence "$evidence_path" \
  ) > "$runtime_log" 2>&1
command_status=$?
set -e
cat "$runtime_log"

if [[ "${RLSOK_EXTERNAL_CASE_ID:-}" == "malformed_input" ]]; then
  if [[ "$command_status" -ne 2 ]] ||
     [[ "$(grep -Fxc 'Reason: proposal_invalid' "$runtime_log" || true)" -ne 1 ]] ||
     [[ -f "$evidence_path" ]]; then
    echo "malformed input did not produce the exact pre-Evidence proposal_invalid BLOCK" >&2
    exit 125
  fi
  negative_tmp="$RLSOK_EXTERNAL_CASE_DIR/negative-result.json.$$.tmp"
  jq -n \
    --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
    --arg caseId "malformed_input" \
    --arg reason "proposal_invalid" \
    --arg subjectSha256 "$(sha256sum "$RLSOK_EXTERNAL_PROPOSAL" | cut -d' ' -f1)" \
    --arg runtimeLogSha256 "$(sha256sum "$runtime_log" | cut -d' ' -f1)" \
    --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
    '{schema:"rlsok.io/external-negative-runtime-result/v1",sessionId:$sessionId,
      caseId:$caseId,reason:$reason,subjectSha256:$subjectSha256,
      runtimeLogSha256:$runtimeLogSha256,observedAt:$observedAt}' > "$negative_tmp"
  chmod 600 "$negative_tmp"
  mv -- "$negative_tmp" "$RLSOK_EXTERNAL_CASE_DIR/negative-result.json"
fi

if [[ -f "$evidence_path" ]]; then
  cloud_evidence_id="$(jq -er '.cloudEvidenceId' "$evidence_path")"
  "$runtime_bin" cloud get-evidence "$cloud_evidence_id" \
    > "$RLSOK_EXTERNAL_CASE_DIR/cloud-evidence.json"
fi
exit "$command_status"
