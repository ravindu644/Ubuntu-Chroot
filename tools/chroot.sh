#!/system/bin/sh

# Advanced Chroot Manager
# Copyright (c) 2025 ravindu644

# --- Configuration and Global Variables ---

# Use environment variable if set, otherwise use default path
CHROOT_PATH="${CHROOT_PATH:-/data/local/ubuntu-chroot/rootfs}"
ROOTFS_IMG="/data/local/ubuntu-chroot/rootfs.img"
SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(dirname "$0")"
C_HOSTNAME="ubuntu"
MOUNTED_FILE="/data/local/ubuntu-chroot/mount.points"
POST_EXEC_SCRIPT="/data/local/ubuntu-chroot/post_exec.sh"
HOLDER_PID_FILE="/data/local/ubuntu-chroot/holder.pid"
SILENT=0
SKIP_POST_EXEC=0


# --- Logging and Utility Functions ---

log() { 
    if [ "$SILENT" -eq 0 ]; then
        echo "[INFO] $1"
    fi
}
warn() { 
    if [ "$SILENT" -eq 0 ]; then
        echo "[WARN] $1"
    fi
}
error() { echo "[ERROR] $1"; }

usage() {
    echo "Usage: $SCRIPT_NAME [command] [options] [user]"
    echo ""
    echo "Commands:"
    echo "  start         Start the chroot environment and enter a shell."
    echo "  stop          Stop the chroot environment and kill all processes."
    echo "  restart       Restart the chroot environment."
    echo "  status        Show the current status of the chroot."
    echo "  umount        Unmount all chroot filesystems without stopping processes."
    echo "  run <command> Execute a command inside the chroot environment."
    echo "  backup <path> Create a compressed backup of the chroot environment."
    echo "  restore <path> Restore chroot from a backup archive."
    echo ""
    echo "Options:"
    echo "  [user]        Username to log in as (default: root)."
    echo "  --no-shell    Setup chroot without entering an interactive shell."
    echo "  --skip-post-exec  Skip running post-execution scripts."
    echo "  -s            Silent mode (suppress informational output)."
    exit 1
}

run_in_ns() {
    if [ -n "$HOLDER_PID" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then
        busybox nsenter --target "$HOLDER_PID" --mount -- "$@"
    else
        "$@"
    fi
}

run_in_chroot() {
    # Execute a command inside the chroot environment using namespace isolation
    local command="$*"

    # Common exports for chroot environment
    local common_exports="export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin';"

    # Ensure chroot is started if not running
    if ! is_chroot_running; then
        start_chroot
    fi

    # Load holder PID if available
    if [ -f "$HOLDER_PID_FILE" ]; then
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    fi

    # If namespace holder is running, execute command in namespace with chroot
    if [ -n "$HOLDER_PID" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then
        busybox nsenter --target "$HOLDER_PID" --mount -- \
            chroot "$CHROOT_PATH" /bin/bash -c "
                $common_exports
                $command
            "
    else
        # Fallback to direct chroot if namespace not available
        chroot "$CHROOT_PATH" /bin/bash -c "
            $common_exports
            $command
        "
    fi
}


# --- State Check Functions ---

is_mounted() {
    # Check if a given path is a mountpoint in the isolated namespace.
    # The output of mountpoint is "path is a mountpoint" on success.
    # We grep for 'is a' to confirm.
    run_in_ns mountpoint "$1" 2>/dev/null | grep -q 'is a'
}

is_chroot_running() {
    # Check if the namespace holder process is running
    [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null
}

check_sysv_ipc() {
    # Check if System V IPC is enabled in the kernel
    # This affects tools like fio, kdiskmark that require shared memory
    local cfg
    cfg=$(zcat /proc/config.gz 2>/dev/null || cat /proc/config 2>/dev/null)
    if echo "$cfg" | grep -q "^CONFIG_SYSVIPC=y"; then
        return 0  # IPC available
    else
        return 1  # IPC not available
    fi
}


# --- Setup Helper Functions ---

advanced_mount() {
    local src="$1" tgt="$2" type="$3" opts="$4"
    
    # Create target directory for non-bind mounts or if source doesn't exist for bind
    if [ "$type" = "tmpfs" ] || [ "$type" = "devpts" ] || [ ! -e "$src" ]; then
        run_in_ns mkdir -p "$tgt" 2>/dev/null
    else
        run_in_ns mkdir -p "$(dirname "$tgt")" 2>/dev/null
    fi

    if [ "$type" = "bind" ]; then
        [ -e "$src" ] || { warn "Source for bind mount does not exist: $src"; return 1; }
        run_in_ns mount --bind "$src" "$tgt"
    else
        run_in_ns mount -t "$type" $opts "$type" "$tgt"
    fi
    
    if [ $? -eq 0 ]; then
        log "Mounted $src -> $tgt ($type)"
        echo "$tgt" >> "$MOUNTED_FILE"
    else
        error "Failed to mount $src"
    fi
}

setup_storage() {
    # Mount storage at /storage/emulated/0 inside chroot for safe access.
    local storage_path="/storage/emulated/0"
    local chroot_storage="$CHROOT_PATH/storage/emulated/0"
    
    if [ -d "$storage_path" ] && [ -r "$storage_path" ]; then
        log "Setting up storage access: $storage_path"
        run_in_ns mkdir -p "$chroot_storage"
        if run_in_ns mount -o bind "$storage_path" "$chroot_storage" 2>/dev/null; then
            log "Storage mounted at /storage/emulated/0"
            echo "$chroot_storage" >> "$MOUNTED_FILE"
        else
            warn "Storage mount failed"
        fi
    else
        warn "Android storage not found at $storage_path"
    fi
}

apply_internet_fix() {
    log "Applying internet fix for chroot..."
    
    # Generate resolv.conf from Android properties with fallbacks.
    > "$CHROOT_PATH/etc/resolv.conf"
    for i in 1 2 3 4; do
        dns=$(getprop net.dns${i} 2>/dev/null)
        [ -z "$dns" ] && break
        echo "nameserver $dns" >> "$CHROOT_PATH/etc/resolv.conf"
    done
    echo "nameserver 8.8.8.8" >> "$CHROOT_PATH/etc/resolv.conf"
    echo "nameserver 8.8.4.4" >> "$CHROOT_PATH/etc/resolv.conf"
    chmod 644 "$CHROOT_PATH/etc/resolv.conf"
    
    # Add necessary network groups for apps like apt.
    grep -q "aid_inet" "$CHROOT_PATH/etc/group" || echo "aid_inet:x:3003:" >> "$CHROOT_PATH/etc/group"
    grep -q "aid_net_raw" "$CHROOT_PATH/etc/group" || echo "aid_net_raw:x:3004:" >> "$CHROOT_PATH/etc/group"
    if run_in_ns chroot "$CHROOT_PATH" id root >/dev/null 2>&1; then
        run_in_ns chroot "$CHROOT_PATH" /usr/sbin/usermod -aG aid_inet root 2>/dev/null
    fi
    if run_in_ns chroot "$CHROOT_PATH" id _apt >/dev/null 2>&1; then
        run_in_ns chroot "$CHROOT_PATH" /usr/sbin/usermod -aG aid_inet,aid_net_raw _apt 2>/dev/null
    fi
    
    # Set up hosts file and enable IP forwarding.
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
    echo "127.0.0.1    localhost $C_HOSTNAME" > "$CHROOT_PATH/etc/hosts"
    echo "::1          localhost ip6-localhost ip6-loopback" >> "$CHROOT_PATH/etc/hosts"
    run_in_ns sh -c "echo '$C_HOSTNAME' > '$CHROOT_PATH/proc/sys/kernel/hostname'" 2>/dev/null
    
    log "Internet fix successfully applied."
}


# --- Core Action Functions ---

kill_chroot_processes() {
    log "Killing all running chroot services and processes..."
    
    # Use lsof to find all PIDs with open files in chroot, then kill them.
    local pids
    pids=$(lsof 2>/dev/null | grep "$CHROOT_PATH" | awk '{print $2}' | uniq)
    
    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null
        log "Killed chroot processes."
    else
        log "No chroot processes found."
    fi
}

create_namespace() {
    local pid_file="$1"
    local flags="--fork"
    local cfg=$(zcat /proc/config.gz 2>/dev/null || cat /proc/config 2>/dev/null)

    for ns in mount:NAMESPACES uts:UTS_NS ipc:IPC_NS pid:PID_NS net:NET_NS user:USER_NS cgroup:CGROUPS; do
        flag="--${ns%%:*}"
        config="CONFIG_${ns#*:}"
        if echo "$cfg" | grep -q "^${config}=y" && unshare $flag true 2>/dev/null; then
            flags="$flags $flag"
        fi
    done

    log "using flags: $flags"

    # Try regular unshare first
    unshare $flags busybox sleep infinity &
    local pid=$!
    if kill -0 $pid 2>/dev/null; then
        echo $pid > "$pid_file"
        return 0
    fi

    # Fallback to busybox unshare, remove --cgroups if present
    local busybox_flags=$(echo "$flags" | sed 's/--cgroups//g')
    log "Regular unshare failed, trying busybox unshare with flags: $busybox_flags"

    busybox unshare $busybox_flags busybox sleep infinity &
    pid=$!
    if kill -0 $pid 2>/dev/null; then
        echo $pid > "$pid_file"
        return 0
    else
        error "Failed to create namespace with both unshare implementations"
        return 1
    fi
}

start_chroot() {
    log "Setting up advanced chroot environment..."
    
    # Check System V IPC support and warn if not available
    if ! check_sysv_ipc; then
        warn "System V IPC not enabled in kernel - some benchmarking tools (fio, kdiskmark) may fail"
    fi

    # Set up namespace isolation
    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        log "Namespace holder already running."
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    else
        log "Creating new isolated namespace..."
        create_namespace "$HOLDER_PID_FILE"
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
        sleep 0.5  # Give namespace time to initialize
        log "Running in isolated namespace (PID: $HOLDER_PID)"
    fi
    
    [ -d "$CHROOT_PATH" ] || { error "Chroot directory not found at $CHROOT_PATH"; exit 1; }

    # Check if sparse image exists - mount it
    if [ -f "$ROOTFS_IMG" ]; then
        log "Sparse image detected"
        
        # Check if already mounted (from unclean shutdown) and unmount first
        if mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
            log "Sparse image already mounted, unmounting first..."
            if umount -f "$CHROOT_PATH" 2>/dev/null || umount -l "$CHROOT_PATH" 2>/dev/null; then
                log "Previous mount cleaned up"
            else
                warn "Failed to unmount previous mount, continuing anyway"
            fi
        fi
        
        log "Mounting sparse image to rootfs..."
        if ! run_in_ns mount -t ext4 -o loop,rw,noatime,nodiratime,barrier=0 "$ROOTFS_IMG" "$CHROOT_PATH"; then
            error "Failed to mount sparse image"
            exit 1
        fi
        log "Sparse image mounted successfully"
    fi

    # Clean up previous mount tracking file if it exists.
    rm -f "$MOUNTED_FILE"

    # Store original SELinux status and set to permissive.
    local og_selinux_file="/data/local/ubuntu-chroot/og-selinux"
    if [ ! -f "$og_selinux_file" ]; then
        getenforce > "$og_selinux_file" 2>/dev/null && log "Stored original SELinux status" || warn "Failed to store SELinux status"
    fi
    (setenforce 0 && log "SELinux set to permissive mode") || warn "Failed to set SELinux to permissive mode"

    # Remount /data with suid to fix sudo issues for non-root users.
    run_in_ns mount -o remount,suid /data 2>/dev/null && log "Remounted /data with suid" || warn "Failed to remount /data with suid"

    log "Setting up system mounts..."
    advanced_mount "proc" "$CHROOT_PATH/proc" "proc" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "sysfs" "$CHROOT_PATH/sys" "sysfs" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "/dev" "$CHROOT_PATH/dev" "bind"
    advanced_mount "devpts" "$CHROOT_PATH/dev/pts" "devpts" "-o rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"
    advanced_mount "tmpfs" "$CHROOT_PATH/tmp" "tmpfs" "-o rw,nosuid,nodev,relatime,size=100M"
    advanced_mount "tmpfs" "$CHROOT_PATH/run" "tmpfs" "-o rw,nosuid,nodev,relatime,size=50M"
    advanced_mount "tmpfs" "$CHROOT_PATH/dev/shm" "tmpfs" "-o mode=1777"

    # Mount /config if possible
    [ -d "/config" ] && run_in_ns mount -t bind "/config" "$CHROOT_PATH/config" 2>/dev/null && log "Mounted $CHROOT_PATH/config" && echo "$CHROOT_PATH/config" >> "$MOUNTED_FILE"

    # Optional mounts for better compatibility.
    [ -d "/dev/binderfs" ] && advanced_mount "/dev/binderfs" "$CHROOT_PATH/dev/binderfs" "bind"
    [ -d "/dev/bus/usb" ] && advanced_mount "/dev/bus/usb" "$CHROOT_PATH/dev/bus/usb" "bind"

    # Minimal cgroup setup for Docker support.
    log "Setting up minimal cgroups for Docker..."
    run_in_ns mkdir -p "$CHROOT_PATH/sys/fs/cgroup"
    if run_in_ns mount -t tmpfs -o mode=755 tmpfs "$CHROOT_PATH/sys/fs/cgroup" 2>/dev/null; then
        echo "$CHROOT_PATH/sys/fs/cgroup" >> "$MOUNTED_FILE"
        run_in_ns mkdir -p "$CHROOT_PATH/sys/fs/cgroup/devices"
        if grep -q devices /proc/cgroups 2>/dev/null; then
            if run_in_ns mount -t cgroup -o devices cgroup "$CHROOT_PATH/sys/fs/cgroup/devices" 2>/dev/null; then
                log "Cgroup devices mounted successfully."
                echo "$CHROOT_PATH/sys/fs/cgroup/devices" >> "$MOUNTED_FILE"
            else
                warn "Failed to mount cgroup devices."
            fi
        else
            warn "Devices cgroup controller not available."
        fi
    else
        warn "Failed to mount cgroup tmpfs."
    fi

    setup_storage
    apply_internet_fix

    # Increase shared memory for services like PostgreSQL.
    sysctl -w kernel.shmmax=268435456 >/dev/null 2>&1

    # Run post-execution script if it exists and we're not skipping it.
    if [ "$SKIP_POST_EXEC" -eq 0 ] && [ -f "$POST_EXEC_SCRIPT" ] && [ -x "$POST_EXEC_SCRIPT" ]; then
        log "Running post-execution script..."
        # Convert script to base64 and execute it directly in chroot without copying
        SCRIPT_B64=$(busybox base64 -w 0 "$POST_EXEC_SCRIPT")
        run_in_chroot "echo '$SCRIPT_B64' | base64 -d | bash"
    fi

    # Disable Android Doze to prevent background process slowdowns when screen is off
    su -c 'dumpsys deviceidle disable' >/dev/null 2>&1 && log "Disabled Android Doze to prevent background slowdowns"

    log "Chroot environment setup completed successfully!"
}

stop_chroot() {
    log "Stopping chroot environment..."
    
    kill_chroot_processes
    
    # Unmount all filesystems (including sparse image if present)
    umount_chroot
    
    # Restore original SELinux status.
    local og_selinux_file="/data/local/ubuntu-chroot/og-selinux"
    if [ -f "$og_selinux_file" ]; then
        local original_status
        original_status="$(cat "$og_selinux_file")"
        case "$original_status" in
            Enforcing) setenforce 1 && log "Restored SELinux to enforcing mode." || warn "Failed to restore SELinux." ;;
            Permissive) setenforce 0 && log "Restored SELinux to permissive mode." || warn "Failed to restore SELinux." ;;
        esac
        rm -f "$og_selinux_file"
    fi
    
    # Kill namespace holder process
    if [ -f "$HOLDER_PID_FILE" ]; then
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
        if kill -0 "$HOLDER_PID" 2>/dev/null; then
            kill "$HOLDER_PID" 2>/dev/null && log "Killed namespace holder process." || warn "Failed to kill holder process."
        fi
        rm -f "$HOLDER_PID_FILE"
    fi
    
    # Re-enable Android Doze
    su -c 'dumpsys deviceidle enable' >/dev/null 2>&1 && log "Re-enabled Android Doze"

    log "Chroot stopped successfully."
}

umount_chroot() {
    # Unmount sparse image if it's mounted and image file exists
    if [ -f "$ROOTFS_IMG" ] && mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
        log "Force unmounting sparse image..."
        if umount -f "$CHROOT_PATH" 2>/dev/null; then
            log "Sparse image force unmounted successfully."
        elif umount -l "$CHROOT_PATH" 2>/dev/null; then
            log "Sparse image lazy unmounted successfully."
        else
            warn "Failed to unmount sparse image."
        fi
    fi
    
    # Special handling for storage - normal unmount only to avoid breaking Android storage
    local chroot_storage="$CHROOT_PATH/storage/emulated/0"
    if is_mounted "$chroot_storage"; then
        log "Unmounting storage safely..."
        for i in 1 2 3; do
            if run_in_ns umount "$chroot_storage" 2>/dev/null; then
                log "Storage unmounted successfully."
                break
            fi
            [ $i -lt 3 ] && sleep 1
        done
    fi
    
    # Unmount tracked mount points in reverse order for safety.
    if [ -f "$MOUNTED_FILE" ]; then
        log "Unmounting filesystems..."
        sort -r "$MOUNTED_FILE" | while read -r mount_point; do
            # Use lazy unmount for /sys as it can be busy.
            case "$mount_point" in
                "$CHROOT_PATH"/sys*) run_in_ns umount -l "$mount_point" 2>/dev/null ;;
                *) run_in_ns umount "$mount_point" 2>/dev/null ;;
            esac
        done
        rm -f "$MOUNTED_FILE"
        log "All chroot mounts unmounted."
    fi
}

enter_chroot() {
    local user="$1"

    # Check if we are running in an interactive terminal.
    if ! [ -t 1 ]; then
        log "Chroot is running. To enter manually, use: sh $SCRIPT_NAME start $user"
        return
    fi

    log "Entering chroot as user: $user"
    local common_exports="
        export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin';
        export TERM='xterm';
    "

    # Load holder PID
    if [ -f "$HOLDER_PID_FILE" ]; then
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    fi

    if [ "$user" = "root" ]; then
        # For root, directly execute a login shell inside the namespace
        exec busybox nsenter --target "$HOLDER_PID" --mount -- \
            chroot "$CHROOT_PATH" /bin/bash -c "
                $common_exports
                export HOME='/root';
                cd /root;
                exec /bin/bash --login;
            "
    else
        # For non-root users, bypass PAM by using chroot with su's --session-command
        # This avoids PAM session errors in isolated namespaces
        exec busybox nsenter --target "$HOLDER_PID" --mount -- \
            chroot "$CHROOT_PATH" /bin/bash -c "
                $common_exports
                # Create user runtime directory if it doesn't exist
                user_uid=\$(id -u '$user' 2>/dev/null)
                if [ -n \"\$user_uid\" ]; then
                    mkdir -p /run/user/\$user_uid 2>/dev/null
                    chown '$user':'$user' /run/user/\$user_uid 2>/dev/null
                    chmod 700 /run/user/\$user_uid 2>/dev/null
                fi
                export HOME=\"/home/$user\";
                cd \"/home/$user\" 2>/dev/null || export HOME='/root';
                # Use su without login to avoid PAM session issues
                exec /bin/su '$user' -s /bin/bash;
            "
    fi
}

show_status() {
    # Status output for webui detection
    if is_chroot_running; then
        echo "Status: RUNNING"
    else
        echo "Status: STOPPED"
    fi
}

list_users() {
    # Get users from the chroot filesystem (regular users with UID >= 1000)
    # run_in_chroot will start chroot if needed and execute with proper namespace isolation
    run_in_chroot "grep -E ':x:1[0-9][0-9][0-9]:' /etc/passwd 2>/dev/null | cut -d: -f1 | head -20 | tr '\n' ',' | sed 's/,$//'"
}

run_command() {
    local command="$*"
    log "Running command in chroot: $command"
    # run_in_chroot will start chroot if needed and execute with proper namespace isolation
    run_in_chroot "$command"
}

backup_chroot() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        error "Backup path not specified"
        exit 1
    fi
    
    # Ensure backup path directory exists
    local backup_dir="$(dirname "$backup_path")"
    if ! run_in_ns mkdir -p "$backup_dir"; then
        error "Failed to create backup directory: $backup_dir"
        exit 1
    fi
    
    log "Creating backup archive: $backup_path"

    # Unified backup logic for both sparse and regular rootfs
    # 1. Ensure chroot is restarted
    stop_chroot >/dev/null 2>&1
    start_chroot >/dev/null 2>&1

    # 2. Umount filesystems for clean backup
    umount_chroot >/dev/null 2>&1
    sleep 1  # Brief pause to ensure clean unmount
    
    # 3. Create compressed tar archive
    if run_in_ns busybox tar -czf "$backup_path" -C "$CHROOT_PATH" . 2>/dev/null; then
        local size
        size=$(run_in_ns du -h "$backup_path" 2>/dev/null | cut -f1)
        log "Backup created successfully: $backup_path (${size:-unknown size})"
    else
        error "Failed to create backup archive"
        exit 1
    fi
    
    # 4. Always stop chroot after backup (whether successful or failed)
    stop_chroot >/dev/null 2>&1
}

restore_chroot() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        error "Backup path not specified"
        exit 1
    fi
    
    if [ ! -f "$backup_path" ]; then
        error "Backup file does not exist: $backup_path"
        exit 1
    fi
    
    # Check if backup file has .tar.gz extension
    case "$backup_path" in
        *.tar.gz) ;;
        *) error "Backup file must have .tar.gz extension"; exit 1 ;;
    esac
    
    log "Extracting backup archive from: $backup_path"
    
    # Stop and clean up current chroot if running (only in manual mode)
    if [ "$WEBUI_MODE" -eq 0 ]; then
        if is_chroot_running; then
            log "Stopping running chroot..."
            stop_chroot
        fi

        # Check for sparse image and force unmount if mounted
        if [ -f "$ROOTFS_IMG" ] && mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
            log "Force unmounting sparse image..."
            umount -f "$CHROOT_PATH" 2>/dev/null || umount -l "$CHROOT_PATH" 2>/dev/null || {
                error "Failed to unmount sparse image"
                exit 1
            }
        fi

        # Remove sparse image file if it exists
        if [ -f "$ROOTFS_IMG" ]; then
            log "Removing sparse image file..."
            rm -f "$ROOTFS_IMG" || {
                error "Failed to remove sparse image file"
                exit 1
            }
        fi

        # Remove existing chroot directory
        if [ -d "$CHROOT_PATH" ]; then
            log "Removing existing chroot directory..."
            if ! run_in_ns rm -rf "$CHROOT_PATH"; then
                error "Failed to remove existing chroot directory"
                exit 1
            fi
        fi
    fi
    
    # Create rootfs directory
    if ! run_in_ns mkdir -p "$CHROOT_PATH"; then
        error "Failed to create rootfs directory: $CHROOT_PATH"
        exit 1
    fi

    # Extract the tar.gz archive
    if run_in_ns busybox tar -xzf "$backup_path" -C "$CHROOT_PATH" 2>/dev/null; then
        log "Chroot restored successfully from: $backup_path"
    else
        error "Failed to extract backup archive"
        exit 1
    fi
}

# --- Main Script Logic ---

# Must be run as root.
if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root."
    exit 1
fi

# Check if busybox is available
if ! command -v busybox >/dev/null 2>&1; then
    error "busybox command not found. Please install busybox."
    exit 1
fi

# Set default command if none is provided.
if [ $# -eq 0 ]; then
    set -- start
fi

# Centralized argument parsing.
COMMAND=""
USER_ARG="root"
BACKUP_PATH=""
RUN_COMMAND=""
NO_SHELL_FLAG=0
WEBUI_MODE=0

for arg in "$@"; do
    case "$arg" in
        start|stop|restart|status|umount|backup|restore|list-users|run)
            COMMAND="$arg"
            ;;
        --no-shell)
            NO_SHELL_FLAG=1
            ;;
        --webui)
            WEBUI_MODE=1
            ;;
        --skip-post-exec)
            SKIP_POST_EXEC=1
            ;;
        -s)
            SILENT=1
            ;;
        -h|--help)
            usage
            ;;
        -*)
            echo "Unknown option: $arg"
            usage
            ;;
        *)
            # For run command, collect all remaining arguments as the command
            if [ "$COMMAND" = "run" ]; then
                if [ -z "$RUN_COMMAND" ]; then
                    RUN_COMMAND="$arg"
                else
                    RUN_COMMAND="$RUN_COMMAND $arg"
                fi
            # For backup/restore commands, the next argument is the path
            elif [ "$COMMAND" = "backup" ] || [ "$COMMAND" = "restore" ]; then
                BACKUP_PATH="$arg"
            else
                USER_ARG="$arg"
            fi
            ;;
    esac
done

# Execute command.
case "$COMMAND" in
    start)
        if is_chroot_running; then
            log "Chroot is already running."
        else
            start_chroot
        fi

        if [ "$NO_SHELL_FLAG" -eq 0 ]; then
            enter_chroot "$USER_ARG"
        else
            log "Chroot setup complete (no-shell mode). Use 'sh $0 start' to enter."
        fi
        ;;
    stop)
        stop_chroot
        ;;
    restart)
        log "Restarting chroot environment..."
        stop_chroot
        start_chroot
        
        if [ "$NO_SHELL_FLAG" -eq 0 ]; then
            enter_chroot "$USER_ARG"
        else
            log "Chroot setup complete (no-shell mode). Use 'sh $0 start' to enter."
        fi
        ;;
    status)
        show_status
        ;;
    umount)
        log "Umounting chroot filesystems..."
        umount_chroot
        log "Chroot filesystems unmounted successfully."
        ;;
    list-users)
        list_users
        ;;
    run)
        if [ -z "$RUN_COMMAND" ]; then
            error "No command specified for run"
            usage
        fi
        run_command "$RUN_COMMAND"
        ;;
    backup)
        backup_chroot "$BACKUP_PATH"
        ;;
    restore)
        restore_chroot "$BACKUP_PATH"
        ;;
    *)
        error "Invalid command: $COMMAND"
        usage
        ;;
esac
