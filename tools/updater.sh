#!/system/bin/sh

# Ubuntu Chroot Updater - Rewritten
# Copyright (c) 2025 ravindu644

# --- Configuration ---
CHROOT_PATH="${CHROOT_PATH:-/data/local/ubuntu-chroot/rootfs}"
CHROOT_DIR="$(dirname "$CHROOT_PATH")"
VERSION_FILE="$CHROOT_DIR/version"
OTA_DIR="$CHROOT_DIR/ota"
UPDATES_SCRIPT="$OTA_DIR/updates.sh"
LOG_DIR="$CHROOT_DIR/logs"
SILENT=0
DEBUG=0

# --- Logging ---
log() {
    [ "$SILENT" -eq 0 ] && echo "[UPDATE] $1"
}

debug() {
    [ "$DEBUG" -eq 1 ] && echo "[DEBUG] $1"
}

error() {
    echo "[ERROR] $1" >&2
}

# --- Version Management ---
get_current_version() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

set_current_version() {
    echo "$1" > "$VERSION_FILE"
    log "Version updated to $1"
}

get_target_version() {
    local module_prop="/data/adb/modules/ubuntu-chroot/module.prop"
    if [ -f "$module_prop" ]; then
        grep "^versionCode=" "$module_prop" | cut -d'=' -f2 || echo "0"
    else
        echo "0"
    fi
}

# --- Update Execution ---
execute_update() {
    local version="$1"
    local func_name="update_v${version}"
    local log_file="$LOG_DIR/update_v${version}_$(date +%Y%m%d_%H%M%S).log"

    debug "Checking if $func_name exists..."
    if ! type "$func_name" >/dev/null 2>&1; then
        debug "$func_name not found, skipping"
        return 2  # No more updates
    fi

    log "Applying update v$version..."

    # Ensure tmp directory exists in chroot
    mkdir -p "$CHROOT_PATH/tmp"

    # Base64 encode the updates script for streaming
    updates_b64=$(base64 -w0 "$UPDATES_SCRIPT")

    # Execute update directly in chroot
    mkdir -p "$LOG_DIR"
    debug "Running: $CHROOT_DIR/chroot.sh run \"echo '$updates_b64' | base64 -d > /updates.sh && . /updates.sh && if $func_name; then echo '[UPDATER] Update completed successfully'; else echo '[UPDATER] Update failed'; exit 1; fi\""
    if "$CHROOT_DIR/chroot.sh" run "echo '$updates_b64' | base64 -d > /updates.sh && . /updates.sh && if $func_name; then echo '[UPDATER] Update completed successfully'; else echo '[UPDATER] Update failed'; exit 1; fi" | tee "$log_file" | grep "^\\[UPDATER\\]"; then
        log "✓ Update v$version completed successfully"
        return 0
    else
        error "✗ Update v$version failed (see $log_file)"
        # Show last few lines of log
        if [ -f "$log_file" ]; then
            error "Last 10 lines of log:"
            tail -10 "$log_file" >&2
        fi
        return 1
    fi
}

# --- Core Update Logic ---
perform_updates() {
    local current_version=$(get_current_version)
    local target_version=$(get_target_version)

    log "Current version: $current_version"
    log "Target version: $target_version"

    # Check if updates script exists
    if [ ! -f "$UPDATES_SCRIPT" ]; then
        error "Updates script not found: $UPDATES_SCRIPT"
        return 1
    fi

    debug "Sourcing updates script: $UPDATES_SCRIPT"
    if ! . "$UPDATES_SCRIPT"; then
        error "Failed to source updates script"
        return 1
    fi

    # Nothing to do if already up to date
    if [ "$current_version" -ge "$target_version" ]; then
        log "Already up to date (v$current_version)"
        return 0
    fi

    # Find all available update functions
    log "Scanning for available updates..."
    local available_updates=""
    local version=$((current_version + 1))
    while [ "$version" -le "$target_version" ]; do
        if type "update_v${version}" >/dev/null 2>&1; then
            available_updates="$available_updates $version"
            debug "Found update_v${version}"
        else
            debug "update_v${version} not found"
        fi
        version=$((version + 1))
    done

    if [ -z "$available_updates" ]; then
        log "No updates found between v$current_version and v$target_version"
        set_current_version "$target_version"
        return 0
    fi

    log "Found updates:$available_updates"

    # Apply each available update
    for version in $available_updates; do
        execute_update "$version"
        local result=$?

        if [ $result -eq 1 ]; then
            error "Update failed at v$version, stopping"
            return 1
        elif [ $result -eq 2 ]; then
            debug "No update function for v$version"
        else
            # Update succeeded, save progress
            set_current_version "$version"
        fi
    done

    # Set to target version
    set_current_version "$target_version"
    log "All updates applied successfully!"
    return 0
}

# --- Main ---
main() {
    # Root check
    if [ "$(id -u)" -ne 0 ]; then
        error "Must be run as root"
        exit 1
    fi

    # Parse arguments
    while [ $# -gt 0 ]; do
        case "$1" in
            -s|--silent) SILENT=1 ;;
            -d|--debug) DEBUG=1 ;;
            -f|--force) rm -f "$VERSION_FILE" ;;
            -h|--help)
                echo "Usage: $0 [options]"
                echo "  -s, --silent    Silent mode"
                echo "  -d, --debug     Debug mode"
                echo "  -f, --force     Force re-apply all updates"
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

    # Check if chroot.sh exists
    if [ ! -x "$CHROOT_DIR/chroot.sh" ]; then
        error "chroot.sh not found or not executable: $CHROOT_DIR/chroot.sh"
        exit 1
    fi

    # Ensure chroot is running
    if ! "$CHROOT_DIR/chroot.sh" status >/dev/null 2>&1; then
        log "Starting chroot..."
        if ! "$CHROOT_DIR/chroot.sh" start --no-shell --skip-post-exec -s; then
            error "Failed to start chroot"
            exit 1
        fi
        sleep 2  # Give more time
    fi

    # Run updates
    if perform_updates; then
        log "Update completed successfully"
        exit 0
    else
        error "Update failed"
        exit 1
    fi
}

main "$@"
