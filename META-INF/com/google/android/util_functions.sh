#!/system/bin/sh
TMPDIR=/dev/tmp
VERSION_FILE="/data/local/ubuntu-chroot/version"

setup_chroot(){
  mkdir -p /data/local/ubuntu-chroot
  unzip -oj "$ZIPFILE" 'tools/chroot.sh' -d /data/local/ubuntu-chroot >&2
  unzip -oj "$ZIPFILE" 'tools/start-hotspot' -d /data/local/ubuntu-chroot >&2
  unzip -oj "$ZIPFILE" 'tools/sparsemgr.sh' -d /data/local/ubuntu-chroot >&2
}

setup_ota(){
    mkdir -p /data/local/ubuntu-chroot/ota
    unzip -oj "$ZIPFILE" 'tools/updater.sh' -d /data/local/ubuntu-chroot/ota >&2
    unzip -oj "$ZIPFILE" 'tools/updates.sh' -d /data/local/ubuntu-chroot/ota >&2

    # Only create version file if it doesn't exist
    if [ ! -f "$VERSION_FILE" ]; then
        set -x
        local version_code
        unzip -oj "$ZIPFILE" 'module.prop' -d $MODPATH >&2
        version_code=$(grep "^versionCode=" $MODPATH/module.prop | cut -d'=' -f2)
        echo "$version_code" | tee $VERSION_FILE
        set +x
    fi

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
    local ROOTFS_IMG="/data/local/ubuntu-chroot/rootfs.img"
    local EXPERIMENTAL_CONF="$MODPATH/experimental.conf"

    # Extract experimental.conf first to check configuration
    if unzip -oj "$ZIPFILE" 'experimental.conf' -d "$MODPATH" >&2 2>/dev/null; then
        echo "- Experimental configuration extracted"
    fi

    # Check if experimental sparse image method is enabled
    if [ -f "$EXPERIMENTAL_CONF" ]; then
        # Source the config file to get variables
        . "$EXPERIMENTAL_CONF" 2>/dev/null
        
        if [ "$USE_SPARSE_IMAGE_METHOD" = "true" ]; then
            echo "- Experimental sparse image method enabled"

            # Use size from config (default 8GB) with G suffix
            SPARSE_IMAGE_SIZE=${SPARSE_IMAGE_SIZE:-8}
            
            echo "- Creating sparse image: ${SPARSE_IMAGE_SIZE}GB"

            # Check if image already exists and is mounted
            if [ -f "$ROOTFS_IMG" ]; then
                echo "- Sparse image already exists. Checking mount status..."

                # Check if already mounted
                if mountpoint -q "$ROOTFS_DIR" 2>/dev/null; then
                    echo "- Rootfs already mounted. Skipping image creation..."
                    return 0
                else
                    echo "- Image exists but not mounted. Mounting..."
                    mkdir -p "$ROOTFS_DIR"
                    mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 "$ROOTFS_IMG" "$ROOTFS_DIR" || {
                        echo "Failed to mount existing sparse image"
                        exit 1
                    }
                    echo "- Sparse image mounted successfully"
                    return 0
                fi
            fi

            # Create sparse image
            echo "- Creating sparse image file..."
            truncate -s "${SPARSE_IMAGE_SIZE}G" "$ROOTFS_IMG" || {
                echo "Failed to create sparse image"
                exit 1
            }

            # Format as ext4 with performance optimizations
            echo "- Formatting sparse image with ext4..."
            mkfs.ext4 -F -O ^has_journal,^resize_inode -m 0 -L "ubuntu-chroot" "$ROOTFS_IMG" || {
                echo "Failed to format sparse image"
                rm -f "$ROOTFS_IMG"
                exit 1
            }

            # Mount the image
            echo "- Mounting sparse image..."
            mkdir -p "$ROOTFS_DIR"
            mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 "$ROOTFS_IMG" "$ROOTFS_DIR" || {
                echo "Failed to mount sparse image"
                rm -f "$ROOTFS_IMG"
                exit 1
            }

            echo "- Sparse image created and mounted successfully"

            # Extract rootfs to mounted directory
            extract_to_mount
            
            # Unmount the image after extraction
            echo "- Unmounting sparse image..."
            umount "$ROOTFS_DIR" || {
                echo "Warning: Failed to unmount sparse image after extraction"
            }
            
            echo "- Sparse image setup completed successfully"
        fi
    else
        # Use traditional directory extraction method
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
    fi
}

extract_to_mount(){
    local ROOTFS_DIR="/data/local/ubuntu-chroot/rootfs"

    # Auto-detect any .tar.gz file in the ZIP
    local ROOTFS_FILE=$(unzip -l "$ZIPFILE" | grep '\.tar\.gz$' | head -1 | awk '{print $4}')

    if [ -n "$ROOTFS_FILE" ]; then
        echo "- Found rootfs file: $ROOTFS_FILE"
        echo "- Extracting $ROOTFS_FILE to mounted sparse image..."
        mkdir -p "$TMPDIR"
        unzip -oq "$ZIPFILE" "$ROOTFS_FILE" -d "$TMPDIR" || { echo "Failed to extract $ROOTFS_FILE"; exit 1; }
        tar -xpf "$TMPDIR/$ROOTFS_FILE" -C "$ROOTFS_DIR" || { echo "Failed to unpack $ROOTFS_FILE"; exit 1; }
        unzip -oj "$ZIPFILE" 'tools/post_exec.sh' -d /data/local/ubuntu-chroot >&2
        unzip -oj "$ZIPFILE" 'tools/sparsemgr.sh' -d /data/local/ubuntu-chroot >&2
        chmod 755 /data/local/ubuntu-chroot/sparsemgr.sh
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
