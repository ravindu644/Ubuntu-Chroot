#!/bin/bash
set -e

# Get version from GitHub tag or use "dev" as default
if [ -n "$GITHUB_REF" ] && [[ "$GITHUB_REF" == refs/tags/* ]]; then
    VERSION="${GITHUB_REF#refs/tags/}"
else
    VERSION="dev"
fi

# Get current date in YYYYMMDD format
DATE=$(date +%Y%m%d)

# Output filename
OUTPUT_FILE="Ubuntu-22.04-rootfs-${DATE}-${VERSION}.tar.gz"

# Install QEMU handlers for cross-platform builds
docker run --privileged --rm tonistiigi/binfmt --install all

# Create and use a new builder instance
docker buildx create --name ubuntu-builder --use --driver docker-container || true
docker buildx use ubuntu-builder
docker buildx inspect --bootstrap

# Build the rootfs
docker buildx build \
  --platform linux/arm64 \
  --target export \
  --output type=tar,dest=custom-arm64-rootfs.tar \
  -f Dockerfile.builder \
  .

# Compress with maximum compression
gzip -9 custom-arm64-rootfs.tar

# Rename to final output file
mv custom-arm64-rootfs.tar.gz "$OUTPUT_FILE"

echo "$OUTPUT_FILE"
