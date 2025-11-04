#!/system/bin/sh

# Ubuntu Chroot Installation Functions
# Clean, minimal implementation

TMPDIR=/dev/tmp
CHROOT_DIR="/data/local/ubuntu-chroot"
VERSION_FILE="$CHROOT_DIR/version"

# Detect root method
detect_root() {
    if command -v magisk >/dev/null 2>&1; then
        ROOT_METHOD="magisk"
        echo -e "- Magisk detected\n"
        echo "- WARNING: You may face various terminal bugs with Magisk."
        echo -e "- You can try downgrading your Magisk version to v28 or v29.\n"
    elif command -v ksud >/dev/null 2>&1; then
        ROOT_METHOD="kernelsu"
        echo -e "- KernelSU detected\n"
    elif command -v apd >/dev/null 2>&1; then
        ROOT_METHOD="apatch"
        echo -e "- Apatch detected\n"
    else
        ROOT_METHOD="unknown"
        echo -e "- Unknown root method detected. Proceed with caution.\n"
    fi

    # Check for SuSFS compatibility
    if zcat /proc/config.gz 2>/dev/null | grep -q "CONFIG_KSU_SUSFS=y" || [ -d /data/adb/modules/susfs4ksu ]; then
        echo -e "WARNING: SuSFS detected. You may encounter mounting issues with \"/proc\".\n"
        echo -e "Fix: Disable \"HIDE SUS MOUNTS FOR ALL PROCESSES\" in SuSFS4KSU settings.\n"
    fi
}

# Extract core chroot files
setup_chroot() {
    mkdir -p "$CHROOT_DIR"
    unzip -oj "$ZIPFILE" 'tools/chroot.sh' -d "$CHROOT_DIR" >&2
    unzip -oj "$ZIPFILE" 'tools/start-hotspot' -d "$CHROOT_DIR" >&2
    unzip -oj "$ZIPFILE" 'tools/sparsemgr.sh' -d "$CHROOT_DIR" >&2
    unzip -oj "$ZIPFILE" 'tools/post_exec.sh' -d "$CHROOT_DIR" >&2
    echo "- Core chroot files extracted"
}

# Setup OTA system
setup_ota() {
    mkdir -p "$CHROOT_DIR/ota"
    unzip -oj "$ZIPFILE" 'tools/updater.sh' -d "$CHROOT_DIR/ota" >&2
    unzip -oj "$ZIPFILE" 'tools/updates.sh' -d "$CHROOT_DIR/ota" >&2

    # Record version for OTA updates
    if [ ! -f "$VERSION_FILE" ]; then
        local version_code

        # Check if module was previously installed
        if [ -f "/data/adb/modules/ubuntu-chroot/module.prop" ]; then
            # Record OLD version from existing installation for proper OTA tracking
            version_code=$(grep "^versionCode=" "/data/adb/modules/ubuntu-chroot/module.prop" | cut -d'=' -f2)
            echo "- Recording previous version $version_code for OTA updates"
        else
            # Fresh install - record version from zip file
            unzip -oj "$ZIPFILE" 'module.prop' -d "$TMPDIR" >&2
            version_code=$(grep "^versionCode=" "$TMPDIR/module.prop" | cut -d'=' -f2)
            echo "- Fresh install - version $version_code recorded"
        fi

        echo "$version_code" > "$VERSION_FILE"
    fi
}

# Find rootfs file in ZIP
find_rootfs_file() {
    unzip -l "$ZIPFILE" 2>/dev/null | grep -E '\.tar\.gz$' | head -1 | while read -r line; do
        # Extract filename from the last field (handles spaces correctly)
        echo "$line" | rev | cut -d' ' -f1 | rev
    done
}

# Extract rootfs
extract_rootfs() {
    echo "- Setting up Ubuntu rootfs..."

    # Extract experimental config
    if unzip -oj "$ZIPFILE" 'experimental.conf' -d "$MODPATH" >&2 2>/dev/null; then
        true  # Config loaded silently
    fi

    # Determine extraction method
    local use_sparse=false
    if [ -f "$MODPATH/experimental.conf" ]; then
        . "$MODPATH/experimental.conf" 2>/dev/null
        if [ "$USE_SPARSE_IMAGE_METHOD" = "true" ]; then
            use_sparse=true
            echo "- Sparse image method enabled"
        fi
    fi

    # Find rootfs file
    local rootfs_file
    rootfs_file=$(find_rootfs_file)

    if [ -z "$rootfs_file" ]; then
        echo "- No rootfs file found in ZIP archive..Skipping extraction..."
        return 0
    fi

    echo "- Found rootfs file: $rootfs_file"

    if [ "$use_sparse" = true ]; then
        extract_sparse "$rootfs_file"
    else
        extract_traditional "$rootfs_file"
    fi
}

# Extract to traditional directory
extract_traditional() {
    local rootfs_file="$1"
    local rootfs_dir="$CHROOT_DIR/rootfs"

    # Check if already exists
    if [ -d "$rootfs_dir" ]; then
        echo "- Rootfs directory already exists. Skipping extraction..."
        return 0
    fi

    echo "- Extracting Ubuntu rootfs..."

    # Create directory and extract
    mkdir -p "$rootfs_dir" "$TMPDIR"
    if unzip -oq "$ZIPFILE" "$rootfs_file" -d "$TMPDIR" && tar -xpf "$TMPDIR/$rootfs_file" -C "$rootfs_dir"; then
        echo "- Ubuntu rootfs extracted successfully"
        return 0
    else
        echo "- Rootfs extraction failed"
        rm -rf "$rootfs_dir"
        return 1
    fi
}

# Extract to sparse image
extract_sparse() {
    local rootfs_file="$1"
    local img_file="$CHROOT_DIR/rootfs.img"
    local rootfs_dir="$CHROOT_DIR/rootfs"

    # Check if image already exists
    if [ -f "$img_file" ]; then
        echo "- Sparse image already exists. Skipping setup..."
        return 0
    fi

    # Get size from config
    SPARSE_IMAGE_SIZE=${SPARSE_IMAGE_SIZE:-8}
    echo "- Creating sparse image: ${SPARSE_IMAGE_SIZE}GB"

    # Create and format sparse image
    truncate -s "${SPARSE_IMAGE_SIZE}G" "$img_file" || return 1
    mkfs.ext4 -F -O ^has_journal,^resize_inode -m 0 -L "ubuntu-chroot" "$img_file" || {
        rm -f "$img_file"
        return 1
    }

    # Mount and extract
    mkdir -p "$rootfs_dir"
    mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 "$img_file" "$rootfs_dir" || {
        rm -f "$img_file"
        return 1
    }

    # Extract rootfs
    mkdir -p "$TMPDIR"
    if unzip -oq "$ZIPFILE" "$rootfs_file" -d "$TMPDIR" && tar -xpf "$TMPDIR/$rootfs_file" -C "$rootfs_dir"; then
        echo "- Ubuntu rootfs extracted to sparse image"
        umount "$rootfs_dir"
        echo "- Sparse image setup completed"
        return 0
    else
        echo "- Sparse image extraction failed"
        umount "$rootfs_dir" 2>/dev/null
        rm -f "$img_file"
        return 1
    fi
}

# Create command symlink
create_symlink() {
    mkdir -p "$MODPATH/system/bin"
    if ln -sf "$CHROOT_DIR/chroot.sh" "$MODPATH/system/bin/ubuntu-chroot"; then
        echo "- Created symlink for 'ubuntu-chroot' command"
    else
        echo "- Failed to create symlink for 'ubuntu-chroot' command"
        exit 1
    fi
}
