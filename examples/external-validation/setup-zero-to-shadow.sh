#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

: "${RLSOK_EXTERNAL_CASE_DIR:?run through run-isolated-case.sh}"
: "${RLSOK_EXTERNAL_POLICY_ARTIFACT:?path to a non-empty test artifact is required}"
: "${RLSOK_EXTERNAL_VALIDATION_SESSION_ID:?copy from session.json}"
: "${RLSOK_EXTERNAL_RUNTIME_CREDENTIAL_ID:?non-secret Cloud audit/device credential ID required}"
: "${RLSOK_EXTERNAL_APPROVER_PRINCIPAL_ID:?different authenticated approver audit ID required}"
: "${RLSOK_CLOUD_API_URL:?set the exact Cloud endpoint captured by the validation session}"
runtime_bin="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
if [[ "$RLSOK_EXTERNAL_RUNTIME_CREDENTIAL_ID" == "$RLSOK_EXTERNAL_APPROVER_PRINCIPAL_ID" ]]; then
  echo "runtime and approver identities must differ" >&2
  exit 2
fi

joint_state_topic="${RLSOK_EXTERNAL_JOINT_STATE_TOPIC:-/joint_states}"
controller_action="${RLSOK_EXTERNAL_CONTROLLER_ACTION:-/joint_trajectory_controller/follow_joint_trajectory}"
release_name="${RLSOK_EXTERNAL_RELEASE_NAME:-external-shadow-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
"$runtime_bin" setup \
  --cloud "$RLSOK_CLOUD_API_URL" \
  --artifact "$RLSOK_EXTERNAL_POLICY_ARTIFACT" \
  --release-name "$release_name" \
  --device-name "isolated generic ROS 2 validation graph" \
  --joint-state-topic "$joint_state_topic" \
  --controller-action "$controller_action" \
  --approval-timeout-minutes "${RLSOK_EXTERNAL_APPROVAL_TIMEOUT_MINUTES:-60}" \
  --no-browser \
  --non-interactive

setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json}"
release_id="$(jq -er '.releaseId' "$setup_path")"
cp -- "$(jq -er '.proposalPath' "$setup_path")" "$RLSOK_EXTERNAL_CASE_DIR/proposal.json"
cp -- "$(jq -er '.evidencePath' "$setup_path")" "$RLSOK_EXTERNAL_CASE_DIR/evidence.json"
cloud_evidence_id="$(jq -er '.cloudEvidenceId' "$RLSOK_EXTERNAL_CASE_DIR/evidence.json")"
"$runtime_bin" cloud get-evidence "$cloud_evidence_id" \
  > "$RLSOK_EXTERNAL_CASE_DIR/cloud-evidence.json"
"$runtime_bin" cloud get-release "$release_id" \
  > "$RLSOK_EXTERNAL_CASE_DIR/cloud-release.json"
jq -e '.state == "approved" and .releaseId != "" and (.contentHash | test("^[a-f0-9]{64}$"))' \
  "$RLSOK_EXTERNAL_CASE_DIR/cloud-release.json" >/dev/null
jq -n \
  --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --arg releaseId "$release_id" \
  --arg executablePolicyHash "$(jq -er '.contentHash' "$RLSOK_EXTERNAL_CASE_DIR/cloud-release.json")" \
  --arg runtimeCredentialId "$RLSOK_EXTERNAL_RUNTIME_CREDENTIAL_ID" \
  --arg approverPrincipalId "$RLSOK_EXTERNAL_APPROVER_PRINCIPAL_ID" \
  --arg approvedAt "$(jq -er '.execSpec.evidence.approvedAt' "$RLSOK_EXTERNAL_CASE_DIR/cloud-release.json")" \
  --arg cloudReleaseReceiptSha256 "$(sha256sum "$RLSOK_EXTERNAL_CASE_DIR/cloud-release.json" | cut -d' ' -f1)" \
  '{
    schema:"rlsok.io/external-approval-proof/v1",
    sessionId:$sessionId,
    releaseId:$releaseId,
    executablePolicyHash:$executablePolicyHash,
    runtimeCredentialId:$runtimeCredentialId,
    approverPrincipalId:$approverPrincipalId,
    independentlyApproved:true,
    approvedAt:$approvedAt,
    cloudReleaseReceiptSha256:$cloudReleaseReceiptSha256
  }' > "$RLSOK_EXTERNAL_CASE_DIR/approval.json"
