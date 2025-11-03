#!/system/bin/sh

# Ubuntu Chroot Updater
# Incremental rootfs updater with version tracking
# Copyright (c) 2025 ravindu644

# --- Configuration ---
CHROOT_PATH="${CHROOT_PATH:-/data/local/ubuntu-chroot/rootfs}"
SCRIPT_DIR="$(dirname "$0")"
HOLDER_PID_FILE="/data/local/ubuntu-chroot/holder.pid"
VERSION_FILE="/data/local/ubuntu-chroot/version"
OTA_DIR="/data/local/ubuntu-chroot/ota"
UPDATES_SCRIPT="${OTA_DIR}/updates.sh"
LOG_FILE=""
SILENT=0

# --- Logging Functions ---
log() { 
    if [ "$SILENT" -eq 0 ]; then
        echo "[UPDATER] $1"
    fi
}
warn() { 
    if [ "$SILENT" -eq 0 ]; then
        echo "[UPDATER WARN] $1"
    fi
}
error() { echo "[UPDATER ERROR] $1"; }

# --- Namespace Functions (copied from chroot.sh) ---
run_in_ns() {
    if [ -n "$HOLDER_PID" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then
        busybox nsenter --target "$HOLDER_PID" --mount -- "$@"
    else
        "$@"
    fi
}

run_in_chroot() {
    # Execute command and append all output to the global log file
    run_in_ns chroot "$CHROOT_PATH" /bin/bash -c "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; exec 2>&1; $*" >> "$LOG_FILE" 2>&1
}

# --- Version Management ---
get_current_version() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" 2>/dev/null || echo "1"
    else
        echo "1"
    fi
}

set_current_version() {
    echo "$1" > "$VERSION_FILE"
}

get_target_version() {
    # Extract version from module.prop in Magisk modules directory
    local module_prop="/data/adb/modules/ubuntu-chroot/module.prop"
    if [ -f "$module_prop" ]; then
        grep "^versionCode=" "$module_prop" | cut -d'=' -f2 || echo "1500"
    else
        echo "1500"
    fi
}

# --- Update Framework ---
load_updates() {
    if [ -f "$UPDATES_SCRIPT" ]; then
        . "$UPDATES_SCRIPT"
        return 0
    else
        error "Updates script not found: $UPDATES_SCRIPT"
        return 1
    fi
}

apply_update() {
    local version="$1"
    local func_name="update_v${version}"

    if command -v "$func_name" >/dev/null 2>&1; then
        # Add clear separator for this update in the log file
        {
            echo ""
            echo "=== Applying Update v$version ==="
            echo "Started: $(date)"
            echo ""
        } >> "$LOG_FILE"

        log "Applying update v$version..."
        if "$func_name"; then
            # Mark update as completed in log
            echo "✓ Update v$version completed successfully" >> "$LOG_FILE"
            log "Update v$version completed successfully"
            return 0
        else
            # Mark update as failed in log
            echo "✗ Update v$version failed" >> "$LOG_FILE"
            error "Update v$version failed"
            return 1
        fi
    else
        # Silently skip versions without update functions
        return 0
    fi
}

# --- Core Update Logic ---
perform_update() {
    local current_version target_version

    # Set up logging for this update session
    local log_dir="/data/local/ubuntu-chroot/logs"
    local timestamp=$(date +%Y%m%d_%H%M)
    LOG_FILE="${log_dir}/update_${timestamp}.log"

    # Create logs directory if it doesn't exist
    mkdir -p "$log_dir" 2>/dev/null

    # Initialize log file with session info
    {
        echo "=== Ubuntu Chroot Update Session ==="
        echo "Started: $(date)"
        echo "Log file: $LOG_FILE"
        echo ""
    } > "$LOG_FILE"

    current_version=$(get_current_version)
    target_version=$(get_target_version)

    log "Current version: $current_version"
    log "Target version: $target_version"

    if [ "$current_version" -ge "$target_version" ]; then
        log "Already up to date"
        return 0
    fi

    log "Starting update process from $current_version to $target_version"

    # Load update definitions
    if ! load_updates; then
        return 1
    fi

    # Apply updates incrementally
    local version
    for version in $(seq $((current_version + 1)) "$target_version"); do
        if ! apply_update "$version"; then
            error "Update failed at version $version"
            return 1
        fi

        # Update version file after successful update
        set_current_version "$version"
    done

    # Add final summary to log file
    {
        echo ""
        echo "=== Update Session Complete ==="
        echo "Final version: $(get_current_version)"
        echo "Completed: $(date)"
        echo ""
    } >> "$LOG_FILE"

    log "All updates applied successfully"
    return 0
}

# --- Main Logic ---
main() {
    # Must be run as root
    if [ "$(id -u)" -ne 0 ]; then
        error "This script must be run as root"
        exit 1
    fi

    # Parse arguments
    while [ $# -gt 0 ]; do
        case "$1" in
            -s|--silent)
                SILENT=1
                ;;
            -f|--force)
                # Force update regardless of version
                rm -f "$VERSION_FILE"
                ;;
            -h|--help)
                echo "Usage: $0 [options]"
                echo "  -s, --silent    Silent mode"
                echo "  -f, --force     Force update"
                echo "  -h, --help      Show this help"
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
        shift
    done

    # Load holder PID for namespace isolation
    if [ -f "$HOLDER_PID_FILE" ]; then
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    fi

    # Check if chroot is running, start if needed
    if [ ! -f "$HOLDER_PID_FILE" ] || ! kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        log "Chroot not running, starting it..."
        if ! "$(dirname "$OTA_DIR")/chroot.sh" start --no-shell --skip-post-exec -s; then
            error "Failed to start chroot"
            exit 1
        fi

        # Reload holder PID after starting chroot
        if [ -f "$HOLDER_PID_FILE" ]; then
            HOLDER_PID=$(cat "$HOLDER_PID_FILE")
            log "Chroot started successfully, PID: $HOLDER_PID"
        else
            error "HOLDER_PID_FILE not found after starting chroot"
            exit 1
        fi
    fi

    # Perform the update
    if perform_update; then
        log "Update completed successfully"
        exit 0
    else
        error "Update failed"
        exit 1
    fi
}

main "$@"
