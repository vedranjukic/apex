#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CLI_DIR/../.." && pwd)"

VERSION="${VERSION:-$(cat "$ROOT_DIR/VERSION" 2>/dev/null || echo "dev")}"
OUTPUT="${OUTPUT:-$CLI_DIR/bin/apex-darwin-arm64}"

echo "Building Apex CLI v${VERSION} for macOS Apple Silicon (darwin/arm64)..."

cd "$CLI_DIR"

CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build \
  -ldflags "-s -w -X github.com/apex/cli/cmd.Version=${VERSION}" \
  -o "$OUTPUT" \
  .

echo "Built: $OUTPUT"
ls -lh "$OUTPUT"
