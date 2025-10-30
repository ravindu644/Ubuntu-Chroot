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
        echo "Rootfs already exists. Skipping extraction..."
        return 0
    fi

    if unzip -l "$ZIPFILE" | grep -q "rootfs\.tar\.gz"; then
        echo "Extracting rootfs.tar.gz..."
        mkdir -p "$ROOTFS_DIR" "$TMPDIR"
        unzip -oj "$ZIPFILE" 'tools/post_exec.sh' -d /data/local/ubuntu-chroot >&2
        unzip -oq "$ZIPFILE" "rootfs.tar.gz" -d "$TMPDIR" || { echo "Failed to extract rootfs.tar.gz"; exit 1; }
        tar -xpf "$TMPDIR/rootfs.tar.gz" -C "$ROOTFS_DIR" || { echo "Failed to unpack rootfs.tar.gz"; exit 1; }
    else
        echo "rootfs.tar.gz not found, skipping extraction."
    fi
}
