#!/system/bin/sh
TMPDIR=/dev/tmp

setup_chroot(){
  mkdir -p /data/local/ubuntu-chroot
  unzip -oj "$ZIPFILE" 'tools/chroot.sh' -d /data/local/ubuntu-chroot >&2
}

check_for_susfs(){
    local susfs_detected=false

    if zcat /proc/config.gz 2>/dev/null | grep -q "CONFIG_KSU_SUSFS=y"; then
        susfs_detected=true
    elif [ -d /data/adb/modules/susfs4ksu ]; then
        susfs_detected=true
    fi

    if [ "$susfs_detected" = true ]; then
        echo "WARNING: SuSFS detected — not supported. Using this module with SuSFS is extremely not recommended as it may cause stability issues. Do not report these issues to the module developer."
    fi
}

detect_root(){
    # Detect root method
    if command -v magisk >/dev/null 2>&1; then
        ROOT_METHOD="magisk"
    elif command -v ksud >/dev/null 2>&1; then
        ROOT_METHOD="kernelsu"
    elif command -v apd >/dev/null 2>&1; then
        ROOT_METHOD="apatch"
    else
        ROOT_METHOD="unknown"
    fi

    # Print detection result
    case "$ROOT_METHOD" in
        magisk)
            echo "- Magisk detected"
            echo "- WARNING: You may face various TTY bugs. Please report them to the Magisk developer as they are not relatable to this module."
            ;;
        kernelsu) echo "- Kernelsu detected" ;;
        apatch)   echo "- Apatch detected" ;;
        *)        echo "- Unknown root method detected. Proceed with caution." ;;
    esac

    check_for_susfs

    # Enable global mount if needed
    case "$ROOT_METHOD" in
        kernelsu) echo 1 > /data/adb/ksu/.global_mnt ;;
        apatch)   echo 1 > /data/adb/.global_namespace_enable ;;
    esac
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
