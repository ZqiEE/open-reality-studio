#!/usr/bin/env bash
set -Eeu -o pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "usage: capture-invocation.sh <new-invocation-json> <command-file>" >&2
  exit 2
fi
: "${RLSOK_EXTERNAL_VALIDATION_SESSION_ID:?copy from validation session.json}"
: "${RLSOK_EXTERNAL_CASE_ID:?set to the exact validation case ID}"

output="$(realpath -m "$1")"
command_file="$(realpath "$2")"
[[ ! -e "$output" ]]
[[ -f "$command_file" && ! -L "$command_file" ]]
runtime_bin="${RLSOK_EXTERNAL_RUNTIME_BIN:-rlsok}"
runtime_path="$(readlink -f "$(command -v "$runtime_bin")")"
[[ -f "$runtime_path" && ! -L "$runtime_path" ]]

optional_path_and_hash() {
  local raw="$1"
  if [[ -z "$raw" ]]; then
    printf '\t\n'
    return
  fi
  local resolved
  resolved="$(realpath "$raw")"
  if [[ ! -f "$resolved" || -L "$resolved" ]]; then
    echo "bound invocation input must be a regular non-symlink: $resolved" >&2
    exit 2
  fi
  printf '%s\t%s\n' "$resolved" "$(sha256sum "$resolved" | cut -d' ' -f1)"
}

setup_path="${RLSOK_EXTERNAL_SETUP_PATH:-}"
if [[ -z "$setup_path" && -f "${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json" ]]; then
  setup_path="${RLSOK_CONFIG_HOME:-$HOME/.config/rlsok}/setup.json"
fi
IFS=$'\t' read -r setup_path setup_hash < <(optional_path_and_hash "$setup_path")
IFS=$'\t' read -r proposal_path proposal_hash < <(optional_path_and_hash "${RLSOK_EXTERNAL_PROPOSAL:-}")
IFS=$'\t' read -r policy_path policy_hash < <(optional_path_and_hash "${RLSOK_EXTERNAL_POLICY_ARTIFACT:-}")
cloud_api_url="${RLSOK_CLOUD_API_URL:-}"
if [[ -z "$cloud_api_url" ]]; then
  credentials_path="${XDG_CONFIG_HOME:-$HOME/.config}/rlsok/cloud-credentials.json"
  if [[ -f "$credentials_path" && ! -L "$credentials_path" ]]; then
    cloud_api_url="$(jq -er .apiUrl "$credentials_path")"
  fi
fi

temporary="${output}.$$.tmp"
trap 'rm -f -- "$temporary"' EXIT
jq -n \
  --arg sessionId "$RLSOK_EXTERNAL_VALIDATION_SESSION_ID" \
  --arg caseId "$RLSOK_EXTERNAL_CASE_ID" \
  --arg commandSha256 "$(sha256sum "$command_file" | cut -d' ' -f1)" \
  --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
  --arg runtimeBinary "$runtime_path" \
  --arg runtimeBinarySha256 "$(sha256sum "$runtime_path" | cut -d' ' -f1)" \
  --arg runtimeVersion "$($runtime_bin --version)" \
  --arg rosDistro "${ROS_DISTRO:-}" \
  --arg rmwImplementation "${RMW_IMPLEMENTATION:-}" \
  --arg rosDomainId "${ROS_DOMAIN_ID:-}" \
  --arg cloudBaseUrl "$cloud_api_url" \
  --arg controllerAction "${RLSOK_EXTERNAL_CONTROLLER_ACTION:-/joint_trajectory_controller/follow_joint_trajectory}" \
  --arg jointStateTopic "${RLSOK_EXTERNAL_JOINT_STATE_TOPIC:-/joint_states}" \
  --arg joints "${RLSOK_EXTERNAL_JOINTS:-joint_a,joint_b}" \
  --arg setupPath "$setup_path" --arg setupStateSha256 "$setup_hash" \
  --arg proposalPath "$proposal_path" --arg proposalSha256 "$proposal_hash" \
  --arg policyArtifactPath "$policy_path" --arg policyArtifactSha256 "$policy_hash" \
  --argjson pauseState "$([[ "${RLSOK_EXTERNAL_PAUSE_STATE:-0}" == 1 ]] && echo true || echo false)" \
  --argjson configurationDrift "$([[ "${RLSOK_EXTERNAL_DRIFT_STATE:-0}" == 1 ]] && echo true || echo false)" \
  '
  def null_if_empty: if . == "" then null else . end;
  {
    schema:"rlsok.io/external-command-invocation/v1",
    sessionId:$sessionId,
    caseId:$caseId,
    commandSha256:$commandSha256,
    capturedAt:$capturedAt,
    environment:{
      runtimeBinary:$runtimeBinary,
      runtimeBinarySha256:$runtimeBinarySha256,
      runtimeVersion:$runtimeVersion,
      rosDistro:($rosDistro|null_if_empty),
      rmwImplementation:($rmwImplementation|null_if_empty),
      rosDomainId:($rosDomainId|null_if_empty),
      cloudBaseUrl:($cloudBaseUrl|null_if_empty),
      controllerAction:($controllerAction|null_if_empty),
      jointStateTopic:($jointStateTopic|null_if_empty),
      joints:(if $joints == "" then null else ($joints|split(",")|map(select(length>0))) end),
      setupPath:($setupPath|null_if_empty),
      setupStateSha256:($setupStateSha256|null_if_empty),
      proposalPath:($proposalPath|null_if_empty),
      proposalSha256:($proposalSha256|null_if_empty),
      policyArtifactPath:($policyArtifactPath|null_if_empty),
      policyArtifactSha256:($policyArtifactSha256|null_if_empty),
      pauseState:$pauseState,
      configurationDrift:$configurationDrift
    }
  }' > "$temporary"
chmod 600 "$temporary"
mv -- "$temporary" "$output"
trap - EXIT
