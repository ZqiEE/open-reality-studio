#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo "first-user install acceptance requires Linux x86_64" >&2
  exit 2
fi

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release_dir=${RLSOK_RELEASE_DIR:-"$repository_root/artifacts"}
candidate_installer=${RLSOK_CANDIDATE_INSTALLER:-"$repository_root/packaging/install.sh"}
archive="$release_dir/rlsok-runtime-1.4.0-linux-x64.tar.gz"
archive_checksum="$archive.sha256"
for required in "$candidate_installer" "$archive" "$archive_checksum"; do
  [[ -f $required ]] || { echo "missing candidate input: $required" >&2; exit 2; }
done

acceptance_root=$(mktemp -d)
trap 'rm -rf "$acceptance_root"' EXIT
export HOME="$acceptance_root/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export RLSOK_INSTALL_ROOT="$acceptance_root/opt/rlsok"
export RLSOK_BIN_DIR="$acceptance_root/bin"
export RLSOK_PYTHON_SITE="$acceptance_root/python-site"
mkdir -p "$RLSOK_BIN_DIR" "$XDG_CONFIG_HOME/rlsok" "$XDG_DATA_HOME/rlsok/evidence"

printf 'credential-sentinel\n' > "$XDG_CONFIG_HOME/rlsok/cloud-credentials.json"
printf 'setup-sentinel\n' > "$XDG_CONFIG_HOME/rlsok/setup.json"
printf 'evidence-sentinel\n' > "$XDG_DATA_HOME/rlsok/evidence/acceptance.json"

public_installer="$acceptance_root/public-install.sh"
curl -fsSL https://rlsok.com/install.sh -o "$public_installer"
public_installer_sha256=$(sha256sum "$public_installer" | cut -d' ' -f1)
RLSOK_RELEASE_DIR= sh "$public_installer"
public_version=$("$RLSOK_BIN_DIR/rlsok" --version)
if python3 -S -c 'import os, site; site.addsitedir(os.environ["RLSOK_PYTHON_SITE"]); from rlsok import propose; assert callable(propose)' >/dev/null 2>&1; then
  public_python_sdk=true
else
  public_python_sdk=false
fi

RLSOK_RELEASE_DIR="$release_dir" sh "$candidate_installer"
candidate_version=$(env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" --version)
env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" --help >/dev/null
env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" setup --help >/dev/null
env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" pair --help >/dev/null
env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" observe --help >/dev/null
set +e
doctor_output=$(env -u NODE_PATH PATH=/usr/bin:/bin "$RLSOK_BIN_DIR/rlsok" ros2 doctor)
doctor_status=$?
set -e
[[ $doctor_status == 0 || $doctor_status == 2 ]]
grep -q '"rosAvailable"' <<<"$doctor_output"
python3 -S -c 'import os, site; site.addsitedir(os.environ["RLSOK_PYTHON_SITE"]); from rlsok import propose; assert callable(propose)'
test -f "$RLSOK_INSTALL_ROOT/1.4.0/lib/rlsok/experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py"
test -f "$RLSOK_INSTALL_ROOT/1.4.0/lib/rlsok/sdk/python/rlsok/__init__.py"

for sentinel in \
  "$XDG_CONFIG_HOME/rlsok/cloud-credentials.json" \
  "$XDG_CONFIG_HOME/rlsok/setup.json" \
  "$XDG_DATA_HOME/rlsok/evidence/acceptance.json"; do
  test -s "$sentinel"
done

selected_hash=$(sha256sum "$RLSOK_INSTALL_ROOT/1.4.0/bin/rlsok" | cut -d' ' -f1)
assert_selected_unchanged() {
  test "$(sha256sum "$RLSOK_INSTALL_ROOT/1.4.0/bin/rlsok" | cut -d' ' -f1)" = "$selected_hash"
  test "$("$RLSOK_BIN_DIR/rlsok" --version)" = "$candidate_version"
}

missing="$acceptance_root/missing"
mkdir -p "$missing"
if RLSOK_RELEASE_DIR="$missing" sh "$candidate_installer" >"$missing.out" 2>&1; then
  echo "missing archive unexpectedly installed" >&2
  exit 1
fi
assert_selected_unchanged

corrupt="$acceptance_root/corrupt"
mkdir -p "$corrupt"
cp "$archive" "$archive_checksum" "$corrupt/"
printf 'corrupt\n' >> "$corrupt/$(basename "$archive")"
if RLSOK_RELEASE_DIR="$corrupt" sh "$candidate_installer" >"$corrupt.out" 2>&1; then
  echo "corrupt checksum unexpectedly installed" >&2
  exit 1
fi
assert_selected_unchanged

invalid="$acceptance_root/invalid"
mkdir -p "$invalid"
printf 'not an archive\n' > "$invalid/$(basename "$archive")"
(cd "$invalid" && sha256sum "$(basename "$archive")" > "$(basename "$archive_checksum")")
if RLSOK_RELEASE_DIR="$invalid" sh "$candidate_installer" >"$invalid.out" 2>&1; then
  echo "invalid archive unexpectedly installed" >&2
  exit 1
fi
assert_selected_unchanged

failure_bin="$acceptance_root/failure-bin"
mkdir -p "$failure_bin"
cat > "$failure_bin/mv" <<'EOF'
#!/bin/sh
if [ "${1##*/}" = "1.4.0.new" ] && [ "${2##*/}" = "1.4.0" ]; then
  exit 73
fi
exec /usr/bin/mv "$@"
EOF
chmod +x "$failure_bin/mv"
if PATH="$failure_bin:$PATH" RLSOK_RELEASE_DIR="$release_dir" sh "$candidate_installer" >"$acceptance_root/activation.out" 2>&1; then
  echo "injected activation failure unexpectedly installed" >&2
  exit 1
fi
assert_selected_unchanged
test ! -e "$RLSOK_INSTALL_ROOT/1.4.0.new"
test ! -e "$RLSOK_INSTALL_ROOT/1.4.0.rollback"

uninstall_copy="$acceptance_root/uninstall.sh"
cp "$RLSOK_INSTALL_ROOT/uninstall.sh" "$uninstall_copy"
"$uninstall_copy"
"$uninstall_copy"
test ! -e "$RLSOK_BIN_DIR/rlsok"
test ! -e "$RLSOK_INSTALL_ROOT"
test ! -e "$RLSOK_PYTHON_SITE/rlsok.pth"
for sentinel in \
  "$XDG_CONFIG_HOME/rlsok/cloud-credentials.json" \
  "$XDG_CONFIG_HOME/rlsok/setup.json" \
  "$XDG_DATA_HOME/rlsok/evidence/acceptance.json"; do
  test -s "$sentinel"
done

fake_uname="$acceptance_root/fake-uname"
mkdir -p "$fake_uname"
cat > "$fake_uname/uname" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-s" ]; then printf 'Darwin\n'; else exec /usr/bin/uname "$@"; fi
EOF
chmod +x "$fake_uname/uname"
if PATH="$fake_uname:$PATH" RLSOK_RELEASE_DIR="$release_dir" sh "$candidate_installer" >"$acceptance_root/os.out" 2>&1; then
  echo "unsupported OS unexpectedly installed" >&2
  exit 1
fi

cat > "$fake_uname/uname" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-m" ]; then printf 'aarch64\n'; else exec /usr/bin/uname "$@"; fi
EOF
chmod +x "$fake_uname/uname"
if PATH="$fake_uname:$PATH" RLSOK_RELEASE_DIR="$release_dir" sh "$candidate_installer" >"$acceptance_root/arch.out" 2>&1; then
  echo "unsupported architecture unexpectedly installed" >&2
  exit 1
fi

archive_sha256=$(sha256sum "$archive" | cut -d' ' -f1)
source_commit=${RLSOK_SOURCE_COMMIT:-${GITHUB_SHA:-unknown}}
proof=${RLSOK_INSTALL_ACCEPTANCE_PROOF:-"$repository_root/artifacts/first-user-install-acceptance.json"}
mkdir -p "$(dirname "$proof")"
cat > "$proof" <<EOF
{
  "sourceCommit": "$source_commit",
  "productVersion": "1.3.0",
  "runtimeVersion": "1.4.0",
  "publicInstallerSha256": "$public_installer_sha256",
  "candidateArchiveSha256": "$archive_sha256",
  "publicInstalledVersion": "$public_version",
  "publicPythonSdkImportable": $public_python_sdk,
  "candidateInstalledVersion": "$candidate_version",
  "cliPassedWithNodeAndNpmAbsentFromPath": true,
  "checksumBeforeActivation": true,
  "upgradePreservedUserState": true,
  "missingArchiveFailedClosed": true,
  "corruptChecksumFailedClosed": true,
  "invalidArchiveFailedClosed": true,
  "activationFailureRestoredPreviousRuntime": true,
  "uninstallPreservedUserState": true,
  "uninstallIdempotent": true,
  "unsupportedOperatingSystemRejected": true,
  "unsupportedArchitectureRejected": true,
  "physicalRobotTested": false
}
EOF
cat "$proof"
