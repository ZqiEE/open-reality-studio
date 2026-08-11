#!/bin/sh
set -eu

RLSOK_PRODUCT_VERSION="1.1.0"
RLSOK_RUNTIME_VERSION="1.2.0"
ARCHIVE="rlsok-runtime-${RLSOK_RUNTIME_VERSION}-linux-x64.tar.gz"
RELEASE_BASE="${RLSOK_RELEASE_BASE:-https://github.com/realitywarden/rlsok/releases/download/v${RLSOK_PRODUCT_VERSION}}"
INSTALL_ROOT="${RLSOK_INSTALL_ROOT:-/opt/rlsok}"
BIN_DIR="${RLSOK_BIN_DIR:-/usr/local/bin}"

fail() {
  echo "RLSOK install: $1" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "Ubuntu 24.04 x86_64 is required."
[ "$(uname -m)" = "x86_64" ] || fail "x86_64 is required; ARM64 is not supported by this release."
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] ||
    fail "Ubuntu 24.04 is required; found ${PRETTY_NAME:-an unsupported Linux release}."
fi
command -v curl >/dev/null 2>&1 || fail "curl is required. Install it with: sudo apt-get install curl"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required (package: coreutils)."
command -v tar >/dev/null 2>&1 || fail "tar is required."

if [ "$(id -u)" -ne 0 ] && [ "$INSTALL_ROOT" = "/opt/rlsok" ]; then
  fail "system installation needs root. Use: curl -fsSL https://rlsok.com/install.sh | sudo sh"
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
if [ -n "${RLSOK_RELEASE_DIR:-}" ]; then
  cp "$RLSOK_RELEASE_DIR/$ARCHIVE" "$TEMP_DIR/$ARCHIVE"
  cp "$RLSOK_RELEASE_DIR/$ARCHIVE.sha256" "$TEMP_DIR/$ARCHIVE.sha256"
else
  curl -fL --proto '=https' --tlsv1.2 "$RELEASE_BASE/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
  curl -fL --proto '=https' --tlsv1.2 "$RELEASE_BASE/$ARCHIVE.sha256" -o "$TEMP_DIR/$ARCHIVE.sha256"
fi
(cd "$TEMP_DIR" && sha256sum -c "$ARCHIVE.sha256") || fail "download checksum verification failed."
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"

VERSION_ROOT="$INSTALL_ROOT/$RLSOK_RUNTIME_VERSION"
mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
rm -rf "$VERSION_ROOT.new"
mv "$TEMP_DIR/rlsok-runtime-$RLSOK_RUNTIME_VERSION" "$VERSION_ROOT.new"
rm -rf "$VERSION_ROOT"
mv "$VERSION_ROOT.new" "$VERSION_ROOT"
ln -sfn "$VERSION_ROOT/bin/rlsok" "$BIN_DIR/rlsok"
ln -sfn "$VERSION_ROOT/uninstall.sh" "$INSTALL_ROOT/uninstall.sh"

"$BIN_DIR/rlsok" --version
echo "RLSOK runtime $RLSOK_RUNTIME_VERSION (product v$RLSOK_PRODUCT_VERSION) installed at $VERSION_ROOT"
echo "Next: source /opt/ros/jazzy/setup.bash && rlsok setup"
