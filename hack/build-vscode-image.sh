#!/bin/bash
# Build the code-server Docker image from claude-1 → claude-2
#
# Run this on a machine with Docker installed:
#   chmod +x hack/build-vscode-image.sh
#   ./hack/build-vscode-image.sh
#
# Then push:
#   docker push vedranjukic/daytona-sandbox:claude-2

set -euo pipefail

BASE_IMAGE="vedranjukic/daytona-sandbox:claude-1"
NEW_IMAGE="vedranjukic/daytona-sandbox:claude-2"
CONTAINER_NAME="claude-vscode-build"

echo "=== Pulling base image ==="
docker pull "$BASE_IMAGE"

echo "=== Creating container ==="
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker create --name "$CONTAINER_NAME" "$BASE_IMAGE" sleep infinity
docker start "$CONTAINER_NAME"

echo "=== Installing code-server ==="
docker exec "$CONTAINER_NAME" bash -c '
  # Install code-server
  curl -fsSL https://code-server.dev/install.sh | sh

  # Verify installation
  code-server --version

  echo "✅ code-server installed successfully"
'

echo "=== Stopping container ==="
docker stop "$CONTAINER_NAME"

echo "=== Committing image ==="
docker commit "$CONTAINER_NAME" "$NEW_IMAGE"

echo "=== Cleaning up ==="
docker rm "$CONTAINER_NAME"

echo ""
echo "✅ Image built: $NEW_IMAGE"
echo ""
echo "To push to Docker Hub:"
echo "  docker push $NEW_IMAGE"
