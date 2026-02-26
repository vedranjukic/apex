#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CLI_DIR/../.." && pwd)"

VERSION="${VERSION:-$(cat "$ROOT_DIR/VERSION" 2>/dev/null || echo "dev")}"
BIN_DIR="$CLI_DIR/bin"

mkdir -p "$BIN_DIR"
cd "$CLI_DIR"

build() {
  local os=$1 arch=$2 suffix=$3
  local output="$BIN_DIR/apex-${suffix}"
  echo "Building apex-${suffix} (${os}/${arch})..."
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build \
    -ldflags "-s -w -X github.com/apex/cli/cmd.Version=${VERSION}" \
    -o "$output" .
  echo "  -> $output ($(du -h "$output" | cut -f1))"
}

case "${1:-all}" in
  darwin-arm64) build darwin arm64 darwin-arm64 ;;
  darwin-amd64) build darwin amd64 darwin-amd64 ;;
  linux-amd64)  build linux  amd64 linux-amd64  ;;
  linux-arm64)  build linux  arm64 linux-arm64  ;;
  all)
    build darwin arm64 darwin-arm64
    build darwin amd64 darwin-amd64
    build linux  amd64 linux-amd64
    build linux  arm64 linux-arm64
    ;;
  *)
    echo "Usage: $0 [darwin-arm64|darwin-amd64|linux-amd64|linux-arm64|all]"
    exit 1
    ;;
esac

echo "Done."
