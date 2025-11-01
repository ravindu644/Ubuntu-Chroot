#!/system/bin/sh

# Advanced Chroot Manager
# Copyright (c) 2025 ravindu644

# --- Configuration and Global Variables ---

# Use environment variable if set, otherwise use default path
CHROOT_PATH="${CHROOT_PATH:-/data/local/ubuntu-chroot/rootfs}"
SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(dirname "$0")"
C_HOSTNAME="ubuntu"
MOUNTED_FILE="/data/local/ubuntu-chroot/mount.points"
POST_EXEC_SCRIPT="/data/local/ubuntu-chroot/post_exec.sh"
HOLDER_PID_FILE="/data/local/ubuntu-chroot/holder.pid"
SILENT=0


# --- Logging and Utility Functions ---

log() { [ "$SILENT" -eq 0 ] && echo "[INFO] $1"; }
warn() { [ "$SILENT" -eq 0 ] && echo "[WARN] $1"; }
error() { echo "[ERROR] $1"; }

usage() {
    echo "Usage: $SCRIPT_NAME [command] [options] [user]"
    echo ""
    echo "Commands:"
    echo "  start         Start the chroot environment and enter a shell."
    echo "  stop          Stop the chroot environment and kill all processes."
    echo "  restart       Restart the chroot environment."
    echo "  status        Show the current status of the chroot."
    echo ""
    echo "Options:"
    echo "  [user]        Username to log in as (default: root)."
    echo "  --no-shell    Setup chroot without entering an interactive shell."
    echo "  -s            Silent mode (suppress informational output)."
    exit 1
}

run_in_ns() {
    if [ -n "$HOLDER_PID" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then
        nsenter --target "$HOLDER_PID" --mount -- "$@"
    else
        "$@"
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

start_chroot() {
    log "Setting up advanced chroot environment..."
    
    # Set up namespace isolation
    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        log "Namespace holder already running."
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    else
        log "Creating new mount namespace..."
        unshare --fork --mount busybox sleep infinity &
        HOLDER_PID=$!
        echo $HOLDER_PID > "$HOLDER_PID_FILE"
        sleep 0.5  # Give namespace time to initialize
        log "Running in isolated mount namespace (PID: $HOLDER_PID)"
    fi
    
    [ -d "$CHROOT_PATH" ] || { error "Chroot directory not found at $CHROOT_PATH"; exit 1; }

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
    advanced_mount "/proc" "$CHROOT_PATH/proc" "proc" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "/sys" "$CHROOT_PATH/sys" "bind"
    advanced_mount "/dev" "$CHROOT_PATH/dev" "bind"
    advanced_mount "devpts" "$CHROOT_PATH/dev/pts" "devpts" "-o rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"
    advanced_mount "tmpfs" "$CHROOT_PATH/tmp" "tmpfs" "-o rw,nosuid,nodev,relatime,size=100M"
    advanced_mount "tmpfs" "$CHROOT_PATH/run" "tmpfs" "-o rw,nosuid,nodev,relatime,size=50M"

    # Mount /config if possible
    [ -d "/config" ] && run_in_ns mount -t bind "/config" "$CHROOT_PATH/config" 2>/dev/null && log "Mounted $CHROOT_PATH/config" && echo "$CHROOT_PATH/config" >> "$MOUNTED_FILE"

    # Optional mounts for better compatibility.
    [ -d "/sys/kernel/debug" ] && advanced_mount "/sys/kernel/debug" "$CHROOT_PATH/sys/kernel/debug" "bind"
    [ -d "/sys/kernel/config" ] && advanced_mount "/sys/kernel/config" "$CHROOT_PATH/sys/kernel/config" "bind"
    [ -d "/dev/binderfs" ] && advanced_mount "/dev/binderfs" "$CHROOT_PATH/dev/binderfs" "bind"
    [ -d "/proc/bus/usb" ] && advanced_mount "/proc/bus/usb" "$CHROOT_PATH/proc/bus/usb" "bind"
    [ -d "/dev/bus/usb" ] && advanced_mount "/dev/bus/usb" "$CHROOT_PATH/dev/bus/usb" "bind"

    # Minimal cgroup setup for Docker support.
    log "Setting up minimal cgroups for Docker..."
    run_in_ns mkdir -p "$CHROOT_PATH/sys/fs/cgroup"
    if run_in_ns mount -t tmpfs -o mode=755 tmpfs "$CHROOT_PATH/sys/fs/cgroup" 2>/dev/null; then
        echo "$CHROOT_PATH/sys/fs/cgroup" >> "$MOUNTED_FILE"
        run_in_ns mkdir -p "$CHROOT_PATH/sys/fs/cgroup/devices"
        if run_in_ns mount -t cgroup -o devices cgroup "$CHROOT_PATH/sys/fs/cgroup/devices" 2>/dev/null; then
            log "Cgroup devices mounted successfully."
            echo "$CHROOT_PATH/sys/fs/cgroup/devices" >> "$MOUNTED_FILE"
        else
            warn "Failed to mount cgroup devices."
        fi
    else
        warn "Failed to mount cgroup tmpfs."
    fi

    setup_storage
    apply_internet_fix

    # Increase shared memory for services like PostgreSQL.
    sysctl -w kernel.shmmax=268435456 >/dev/null

    # Run post-execution script if it exists.
    if [ -f "$POST_EXEC_SCRIPT" ] && [ -x "$POST_EXEC_SCRIPT" ]; then
        log "Running post-execution script..."
        cp "$POST_EXEC_SCRIPT" "$CHROOT_PATH/root/post_exec.sh"
        chmod +x "$CHROOT_PATH/root/post_exec.sh"
        run_in_ns chroot "$CHROOT_PATH" /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin && /root/post_exec.sh"
        rm -f "$CHROOT_PATH/root/post_exec.sh"
    fi

    # Disable Android Doze to prevent background process slowdowns when screen is off
    su -c 'dumpsys deviceidle disable' >/dev/null 2>&1 && log "Disabled Android Doze to prevent background slowdowns"

    log "Chroot environment setup completed successfully!"
}

stop_chroot() {
    log "Stopping chroot environment..."
    
    kill_chroot_processes
    
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
        exec nsenter --target "$HOLDER_PID" --mount -- \
            chroot "$CHROOT_PATH" /bin/bash -c "
                $common_exports
                export HOME='/root';
                cd /root;
                exec /bin/bash --login;
            "
    else
        # For non-root users, bypass PAM by using chroot with su's --session-command
        # This avoids PAM session errors in isolated namespaces
        exec nsenter --target "$HOLDER_PID" --mount -- \
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
NO_SHELL_FLAG=0

for arg in "$@"; do
    case "$arg" in
        start|stop|restart|status)
            COMMAND="$arg"
            ;;
        --no-shell)
            NO_SHELL_FLAG=1
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
            USER_ARG="$arg"
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
    *)
        error "Invalid command: $COMMAND"
        usage
        ;;
esac
