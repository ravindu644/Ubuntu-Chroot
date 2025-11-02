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
        echo -e "\nWARNING: SuSFS detected. You may encounter mounting issues with \"/proc\" when using this module alongside SuSFS.\n"
        echo -e "This is fixable by disabling \"HIDE SUS MOUNTS FOR ALL PROCESSES\" from the SuSFS4KSU settings.\n"
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
            echo -e "\n- WARNING: You may face various terminal bugs with Magisk. Please report them to the Magisk developer as they are not relatable to this module."
            echo -e "- You can try downgrading your Magisk version to v28 or v29, as they used to have stable terminal management.\n"
            ;;
        kernelsu) echo "- KernelSU detected" ;;
        apatch)   echo "- Apatch detected" ;;
        *)        echo "- Unknown root method detected. Proceed with caution." ;;
    esac

    check_for_susfs
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

create_symlink(){

    mkdir -p $MODPATH/system/bin

    ln -s /data/local/ubuntu-chroot/chroot.sh \
    $MODPATH/system/bin/ubuntu-chroot > /dev/null 2>&1 && \
    chmod 0755 $MODPATH/system/bin/ubuntu-chroot > /dev/null 2>&1 && \
    echo "- Created symlink for chrootmgr" || \
    echo "- Failed to create symlink for chrootmgr"

}
