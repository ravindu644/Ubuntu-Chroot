#!/bin/bash
set -e

: "${VERSION:=dev}"

# Get current date in YYYYMMDD format
DATE=$(date +%Y%m%d)

# Output filename
OUTPUT_FILE="Ubuntu-24.04-rootfs-${DATE}-${VERSION}.tar.gz"

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

# Move to parent directory (repo root)
mv "$OUTPUT_FILE" ../

echo "$OUTPUT_FILE"
