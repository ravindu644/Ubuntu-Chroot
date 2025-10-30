#!/system/bin/sh
TMPDIR=/dev/tmp

setup_chroot(){
  mkdir -p /data/local/ubuntu-chroot
  unzip -oj "$ZIPFILE" 'tools/chroot.sh' -d /data/local/ubuntu-chroot >&2
}

check_for_susfs(){
    if zcat /proc/config.gz 2>/dev/null | grep -q "CONFIG_KSU_SUSFS=y"; then
        echo "ERROR: CONFIG_KSU_SUSFS detected — not supported"
        exit 1
    elif [ -d /data/adb/modules/susfs4ksu ]; then
        echo "ERROR: Using this module with SuSFS is not supported"
        exit 1
    fi
}

extract_rootfs(){
    local ROOTFS_DIR="/data/local/ubuntu-chroot/rootfs"

    if [ -d "$ROOTFS_DIR" ]; then
        echo "- Rootfs already exists. Skipping extraction..."
        return 0
    fi

    # Auto-detect any .tar.gz file in the ZIP
    local ROOTFS_FILE=$(unzip -l "$ZIPFILE" | grep '\.tar\.gz$' | head -1 | awk '{print $4}')

    if [ -n "$ROOTFS_FILE" ]; then
        echo "- Found rootfs file: $ROOTFS_FILE"
        echo "- Extracting $ROOTFS_FILE..."
        mkdir -p "$ROOTFS_DIR" "$TMPDIR"
        unzip -oq "$ZIPFILE" "$ROOTFS_FILE" -d "$TMPDIR" || { echo "Failed to extract $ROOTFS_FILE"; exit 1; }
        tar -xpf "$TMPDIR/$ROOTFS_FILE" -C "$ROOTFS_DIR" || { echo "Failed to unpack $ROOTFS_FILE"; exit 1; }
        unzip -oj "$ZIPFILE" 'tools/post_exec.sh' -d /data/local/ubuntu-chroot >&2
    else
        echo "- No .tar.gz file found in ZIP, skipping rootfs extraction."
    fi
}
