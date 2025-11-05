#!/system/bin/sh
# Sparse Image Manager for Chroot Migration
# Copyright (c) 2025 ravindu644
# Usage: sparsemgr.sh [options] <command> [args]

# Default configuration - can be overridden
DEFAULT_CHROOT_DIR="/data/local/ubuntu-chroot"
CHROOT_DIR="${CHROOT_DIR:-$DEFAULT_CHROOT_DIR}"
SCRIPT_NAME="$(basename "$0")"

# --- Debug mode ---
LOGGING_ENABLED=${LOGGING_ENABLED:-0}

if [ "$LOGGING_ENABLED" -eq 1 ]; then
    LOG_DIR="${CHROOT_DIR%/*}/logs"
    mkdir -p "$LOG_DIR"
    LOG_FILE="$LOG_DIR/$SCRIPT_NAME.txt"
    LOG_FIFO="$LOG_DIR/$SCRIPT_NAME.fifo"
    rm -f "$LOG_FIFO" && mkfifo "$LOG_FIFO" 2>/dev/null
    echo "=== Logging started at $(date) ===" >> "$LOG_FILE"
    busybox tee -a "$LOG_FILE" < "$LOG_FIFO" &
    exec >> "$LOG_FIFO" 2>> "$LOG_FILE"
    set -x
fi

# Parse command line arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --chroot-dir|-d)
            CHROOT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options] <command> [args]"
            echo ""
            echo "Options:"
            echo "  --chroot-dir DIR, -d DIR    Set chroot directory (default: $DEFAULT_CHROOT_DIR)"
            echo ""
            echo "Commands:"
            echo "  migrate <size_gb>           Migrate to sparse image"
            echo ""
            echo "Environment Variables:"
            echo "  CHROOT_DIR                  Override default chroot directory"
            echo ""
            echo "Examples:"
            echo "  $0 migrate 8"
            echo "  $0 --chroot-dir /custom/path migrate 16"
            echo "  CHROOT_DIR=/custom/path $0 migrate 8"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Set derived paths
ROOTFS_DIR="$CHROOT_DIR/rootfs"
ROOTFS_IMG="$CHROOT_DIR/rootfs.img"
ROOTFS_SPARSE="$CHROOT_DIR/rootfs.sparse"

# Logging functions
log() { echo "[SPARSE] $1"; }
error() { echo "[ERROR] $1"; }
warn() { echo "[WARN] $1"; }

# Check if chroot is running
is_chroot_running() {
    # Use chroot.sh status command to check if running
    if "$CHROOT_DIR/chroot.sh" status 2>/dev/null | grep -q "RUNNING"; then
        return 0  # Running
    else
        return 1  # Not running
    fi
}

# Stop chroot if running
stop_chroot_if_running() {
    if is_chroot_running; then
        log "Chroot is currently running. Stopping it before migration..."
        if ! "$CHROOT_DIR/chroot.sh" stop 2>/dev/null; then
            warn "Failed to stop chroot automatically. Please stop it manually before migration."
            error "Cannot proceed with migration while chroot is running"
            exit 1
        fi
        log "Chroot stopped successfully"
        
        # Give a moment for processes to fully stop
        busybox sleep 2
    else
        log "Chroot is not running - proceeding with migration"
    fi
}

# Check for required tools
check_requirements() {
    log "Checking for required tools..."
    
    # Check for busybox
    if ! command -v busybox >/dev/null 2>&1; then
        error "busybox not found. This script requires busybox."
        exit 1
    fi
    
    # Check for mkfs.ext4 or mke2fs
    if ! command -v mkfs.ext4 >/dev/null 2>&1 && ! command -v mke2fs >/dev/null 2>&1; then
        error "mkfs.ext4 or mke2fs not found. Cannot format ext4 filesystem."
        exit 1
    fi
    
    log "All required tools found"
    return 0
}

# Cleanup function for error recovery
cleanup_on_error() {
    log "Error occurred, cleaning up..."
    
    # Unmount sparse directory if mounted
    if busybox mountpoint -q "$ROOTFS_SPARSE" 2>/dev/null; then
        busybox umount "$ROOTFS_SPARSE" 2>/dev/null || busybox umount -f "$ROOTFS_SPARSE" 2>/dev/null
    fi
    
    # Remove sparse directory and image
    busybox rm -rf "$ROOTFS_SPARSE" 2>/dev/null
    busybox rm -f "${ROOTFS_IMG}.tmp" 2>/dev/null
    
    log "Cleanup completed. Original rootfs preserved."
    exit 1
}

# Create sparse image
create_sparse_image() {
    local size_gb="$1"
    local img_path="$2"
    
    log "Creating sparse image: ${size_gb}GB"
    
    # Try Android's built-in truncate first, fallback to busybox
    log "Using truncate to create ${size_gb}GB sparse file..."
    if ! truncate -s "${size_gb}G" "$img_path" 2>/dev/null; then
        log "Built-in truncate failed, trying busybox truncate..."
        if ! busybox truncate -s "${size_gb}G" "$img_path" 2>/dev/null; then
            error "Failed to create sparse image with both truncate and busybox truncate"
            return 1
        fi
    fi
    
    # Force filesystem sync - CRITICAL for Android
    busybox sync
    busybox sleep 2
    
    # Verify file exists
    if [ ! -f "$img_path" ]; then
        error "Sparse image file was not created"
        return 1
    fi
    
    local actual_size=$(busybox stat -c%s "$img_path" 2>/dev/null || echo "0")
    log "File created with size: $actual_size bytes"
    
    if [ "$actual_size" = "0" ]; then
        error "File size is zero - creation failed"
        busybox rm -f "$img_path"
        return 1
    fi
    
    # Another sync before formatting
    busybox sync
    busybox sleep 1
    
    log "Formatting sparse image with ext4..."
    # Try mkfs.ext4 first, fallback to mke2fs
    if command -v mkfs.ext4 >/dev/null 2>&1; then
        if ! mkfs.ext4 -F -O ^has_journal,^resize_inode -m 0 -L "ubuntu-chroot" "$img_path" 2>&1; then
            error "Failed to format sparse image with mkfs.ext4"
            busybox rm -f "$img_path"
            return 1
        fi
    elif command -v mke2fs >/dev/null 2>&1; then
        if ! mke2fs -t ext4 -F -O ^has_journal,^resize_inode -m 0 -L "ubuntu-chroot" "$img_path" 2>&1; then
            error "Failed to format sparse image with mke2fs"
            busybox rm -f "$img_path"
            return 1
        fi
    else
        error "No ext4 formatting tool available"
        busybox rm -f "$img_path"
        return 1
    fi
    
    log "Sparse image created and formatted successfully"
    return 0
}

# Mount sparse image to temporary directory
mount_sparse_image() {
    local img_path="$1"
    local mount_path="$2"
    
    log "Mounting sparse image to $mount_path"
    busybox mkdir -p "$mount_path"
    
    # Use busybox mount
    if ! busybox mount -t ext4 -o loop,rw,noatime,nodiratime "$img_path" "$mount_path" 2>/dev/null; then
        # Fallback to system mount if busybox mount fails
        if ! mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 "$img_path" "$mount_path" 2>/dev/null; then
            error "Failed to mount sparse image"
            return 1
        fi
    fi
    
    log "Sparse image mounted successfully"
    return 0
}

# Migrate rootfs using tar pipe
migrate_rootfs() {
    local source_dir="$1"
    local dest_dir="$2"
    
    log "Starting rootfs migration using tar pipe..."
    log "Source: $source_dir"
    log "Destination: $dest_dir"
    
    # Create destination directory
    busybox mkdir -p "$dest_dir"
    
    # Use busybox tar to copy everything while preserving permissions and ownership
    if ! (cd "$source_dir" && busybox tar -cf - . | (cd "$dest_dir" && busybox tar -xf -)); then
        error "Failed to migrate rootfs data"
        return 1
    fi
    
    log "Rootfs migration completed successfully"
    return 0
}

# Main migration function
migrate_to_sparse() {
    local size_input="$1"
    
    # Remove 'GB' suffix if present and extract numeric value
    local size_gb=$(echo "$size_input" | busybox sed 's/[^0-9]//g')
    
    if [ -z "$size_gb" ]; then
        error "Invalid size specified: $size_input"
        echo "Usage: $0 migrate <size_in_gb>"
        echo "Example: $0 migrate 8"
        exit 1
    fi
    
    if [ "$size_gb" -lt 4 ] || [ "$size_gb" -gt 64 ]; then
        error "Size must be between 4GB and 64GB"
        exit 1
    fi
    
    # Check if rootfs directory exists and is not empty
    if [ ! -d "$ROOTFS_DIR" ] || [ -z "$(busybox ls -A "$ROOTFS_DIR" 2>/dev/null)" ]; then
        error "Rootfs directory not found or is empty"
        exit 1
    fi
    
    # Check if sparse image already exists
    if [ -f "$ROOTFS_IMG" ]; then
        error "Sparse image already exists. Please remove it first."
        exit 1
    fi
    
    # Check if sparse directory already exists
    if [ -d "$ROOTFS_SPARSE" ]; then
        error "Migration directory already exists. Please clean up first."
        exit 1
    fi
    
    log "Starting migration to sparse image (${size_gb}GB)"
    log "Source: $ROOTFS_DIR"
    
    # Stop chroot if it's running (CRITICAL for data integrity)
    stop_chroot_if_running
    
    # Set up error trap for cleanup
    trap cleanup_on_error ERR
    
    # Create temporary sparse image
    local tmp_img="${ROOTFS_IMG}.tmp"
    if ! create_sparse_image "$size_gb" "$tmp_img"; then
        cleanup_on_error
    fi
    
    # Mount sparse image to temporary directory
    if ! mount_sparse_image "$tmp_img" "$ROOTFS_SPARSE"; then
        cleanup_on_error
    fi
    
    # Migrate data using tar pipe
    if ! migrate_rootfs "$ROOTFS_DIR" "$ROOTFS_SPARSE"; then
        cleanup_on_error
    fi
    
    # Unmount sparse image
    log "Unmounting sparse image..."
    if ! busybox umount "$ROOTFS_SPARSE" 2>/dev/null && ! umount "$ROOTFS_SPARSE" 2>/dev/null; then
        error "Failed to unmount sparse image"
        cleanup_on_error
    fi
    
    # Finalize migration
    log "Finalizing migration..."
    
    # Backup original rootfs directory name
    local backup_dir="${ROOTFS_DIR}.backup"
    
    # Rename original rootfs to backup
    if ! busybox mv "$ROOTFS_DIR" "$backup_dir"; then
        error "Failed to backup original rootfs directory"
        cleanup_on_error
    fi
    
    # Rename sparse directory to rootfs
    if ! busybox mv "$ROOTFS_SPARSE" "$ROOTFS_DIR"; then
        error "Failed to rename sparse directory"
        # Try to restore original rootfs
        busybox mv "$backup_dir" "$ROOTFS_DIR" 2>/dev/null || true
        cleanup_on_error
    fi
    
    # Move image to final location
    if ! busybox mv "$tmp_img" "$ROOTFS_IMG"; then
        error "Failed to move sparse image to final location"
        # Try to restore original rootfs
        busybox rm -rf "$ROOTFS_DIR" 2>/dev/null || true
        busybox mv "$backup_dir" "$ROOTFS_DIR" 2>/dev/null || true
        cleanup_on_error
    fi
    
    # Remove backup directory after successful migration
    busybox rm -rf "$backup_dir"
    
    # Clear error trap
    trap - ERR
    
    log "Migration completed successfully!"
    log "Sparse image: $ROOTFS_IMG (${size_gb}GB)"
    log "Rootfs directory: $ROOTFS_DIR"
    log ""
    log "IMPORTANT: Your chroot is now using a sparse image."
    log "To mount it, use: mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 $ROOTFS_IMG $ROOTFS_DIR"
    
    return 0
}

# Main script logic
case "$1" in
    migrate)
        check_requirements
        if [ -z "$2" ]; then
            error "Size parameter required"
            echo "Usage: $0 [options] migrate <size_in_gb>"
            echo "Example: $0 migrate 8"
            exit 1
        fi
        migrate_to_sparse "$2"
        ;;
    *)
        echo "Sparse Image Manager for Chroot Migration"
        echo "Usage: $0 [options] <command> [args]"
        echo ""
        echo "Options:"
        echo "  --chroot-dir DIR, -d DIR    Set chroot directory (default: $DEFAULT_CHROOT_DIR)"
        echo "  --help, -h                  Show this help message"
        echo ""
        echo "Commands:"
        echo "  migrate <size_gb>           Migrate to sparse image (size: 4-64 GB)"
        echo ""
        echo "Environment Variables:"
        echo "  CHROOT_DIR                  Override default chroot directory"
        echo ""
        echo "Examples:"
        echo "  $0 migrate 8"
        echo "  $0 --chroot-dir /custom/path migrate 16"
        echo "  CHROOT_DIR=/custom/path $0 migrate 8"
        echo ""
        echo "Description:"
        echo "  Migrates your existing Ubuntu chroot from a directory-based"
        echo "  rootfs to a sparse ext4 image for better performance and"
        echo "  space efficiency."
        echo ""
        echo "Requirements:"
        echo "  - busybox"
        echo "  - mkfs.ext4 or mke2fs"
        exit 1
        ;;
esac
