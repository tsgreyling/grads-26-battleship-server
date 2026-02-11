#!/usr/bin/env bash
# Build and push a multi-platform image (linux/amd64 + linux/arm64) so the same
# image can be pulled on x86 and on Mac (Apple Silicon). Fixes:
#   "no matching manifest for linux/arm64/v8 in the manifest list entries"
#
# Usage:
#   ./scripts/build-multiarch.sh [IMAGE_TAG]
# Example:
#   ./scripts/build-multiarch.sh ghcr.io/myorg/battleship-server:latest
#   ./scripts/build-multiarch.sh myuser/battleship-server:v1.0

set -e
IMAGE="${1:-battleship-server:latest}"

echo "Building multi-platform image: $IMAGE (linux/amd64, linux/arm64)"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$IMAGE" \
  --push \
  .

echo "Done. Pull with: docker pull $IMAGE"
echo "On Mac (arm64) and Linux (amd64) the correct variant will be used automatically."
