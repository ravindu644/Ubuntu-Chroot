#!/system/bin/sh

# Update Module Status Script
# Copyright (c) 2025 ravindu644

# Updates module.prop description with chroot status

CHROOT_SH="/data/local/ubuntu-chroot/chroot.sh"
CHROOT_PATH="/data/local/ubuntu-chroot/rootfs"
ROOTFS_IMG="/data/local/ubuntu-chroot/rootfs.img"
MODULE_PROP="/data/adb/modules/ubuntu-chroot/module.prop"
DEFAULT_DESC="A module for installing Ubuntu 24.04 rootfs on Android and managing it with a modern WebUI, featuring full hardware access and proper namespace isolation"

# Check if chroot is running
check_status() {
    if [ ! -f "$CHROOT_SH" ]; then
        return 2  # Script not found
    fi

    # Check if chroot exists (either directory or sparse image)
    if [ ! -d "$CHROOT_PATH" ] && [ ! -f "$ROOTFS_IMG" ]; then
        return 3  # Chroot not found
    fi

    # Use chroot.sh to check status
    if sh "$CHROOT_SH" status 2>/dev/null | grep -q "Status: RUNNING"; then
        return 0  # Running
    else
        return 1  # Stopped
    fi
}

# Update module.prop description
update_description() {
    local status="$1"
    local new_desc

    if [ "$status" = "running" ]; then
        new_desc="Status: 🟢 Running"
    elif [ "$status" = "stopped" ]; then
        new_desc="Status: 🔴 Stopped"
    elif [ "$status" = "not_found" ]; then
        new_desc="Status: ⚪ Not Found"
    else
        new_desc="$DEFAULT_DESC"
    fi

    # Check if module.prop exists
    if [ ! -f "$MODULE_PROP" ]; then
        return 1
    fi

    # Update description line (line 4)
    if grep -q "^description=" "$MODULE_PROP"; then
        # Replace existing description
        sed -i "s|^description=.*|description=$new_desc|" "$MODULE_PROP" 2>/dev/null || {
            # Fallback if sed fails
            local tmp_file="${MODULE_PROP}.tmp"
            awk -v new_desc="$new_desc" '
                /^description=/ { print "description=" new_desc; next }
                { print }
            ' "$MODULE_PROP" > "$tmp_file" && mv "$tmp_file" "$MODULE_PROP"
        }
    else
        # Add description if it doesn't exist (shouldn't happen, but handle it)
        echo "description=$new_desc" >> "$MODULE_PROP"
    fi
}

# Main execution
main() {
    check_status
    local status_code=$?

    case $status_code in
        0)
            update_description "running"
            ;;
        1)
            update_description "stopped"
            ;;
        3)
            update_description "not_found"
            ;;
        *)
            update_description "default"
            ;;
    esac
}

# Run main function
main
