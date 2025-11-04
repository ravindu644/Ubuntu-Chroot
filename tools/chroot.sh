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
CHROOT_SETUP_IN_PROGRESS=0


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
    echo "  resize <size> Resize sparse image to specified size in GB (4-64GB)."
    echo ""
    echo "Options:"
    echo "  [user]        Username to log in as (default: root)."
    echo "  --no-shell    Setup chroot without entering an interactive shell."
    echo "  --skip-post-exec  Skip running post-execution scripts."
    echo "  -s            Silent mode (suppress informational output)."
    exit 1
}

# --- REWRITTEN NAMESPACE HANDLING ---
_get_ns_flags() {
    # Central place to read and prepare namespace flags for nsenter.
    # This function now correctly translates long flags (--mount) to the
    # short flags (-m) that busybox nsenter requires.
    local flags_file="$HOLDER_PID_FILE.flags"
    if [ ! -f "$flags_file" ]; then
        warn "Namespace flags file not found, using fallback"
        echo "-m"; return # Fallback to mount only
    fi
    
    local long_flags short_flags
    long_flags=$(cat "$flags_file")
    
    if [ -z "$long_flags" ]; then
        warn "Empty namespace flags file, using fallback"
        echo "-m"; return
    fi

    for flag in $long_flags; do
        case "$flag" in
            --mount) short_flags="$short_flags -m" ;;
            --uts)   short_flags="$short_flags -u" ;;
            --ipc)   short_flags="$short_flags -i" ;;
            --pid)   short_flags="$short_flags -p" ;;
            # Ignore flags that nsenter doesn't need or support
            --cgroup|--fork) ;;
        esac
    done

    if [ -z "$short_flags" ]; then
        warn "No valid namespace flags found, using fallback"
        echo "-m"; return
    fi

    echo "$short_flags"
}

_execute_in_ns() {
    # Central execution function. Runs any given command inside the holder's namespaces.
    local holder_pid
    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        holder_pid=$(cat "$HOLDER_PID_FILE")
        local ns_flags
        ns_flags=$(_get_ns_flags)
        
        busybox nsenter --target "$holder_pid" $ns_flags -- "$@"
    else
        # If no namespace holder is running, execute command directly.
        "$@"
    fi
}

run_in_ns() {
    # Wrapper to execute a command in the namespace but not yet in the chroot.
    # Primarily used for mounting filesystems.
    _execute_in_ns "$@"
}

run_in_chroot() {
    # Execute a command inside the chroot environment using full namespace isolation.
    local command="$*"

    # Ensure chroot is started if not running - but prevent recursion during setup
    if [ "$CHROOT_SETUP_IN_PROGRESS" -eq 0 ]; then
        if ! is_chroot_running; then
            log "Starting chroot for command execution..."
            start_chroot > /dev/null 2>&1 || {
                error "Failed to start chroot for command execution"
                return 1
            }
        fi
    fi

    local common_exports="export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin'; export TMPDIR='/tmp';"
    
    # If namespace holder is running, execute in isolated namespaces
    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        # Use the centralized namespace execution
        _execute_in_ns chroot "$CHROOT_PATH" /bin/bash -c "
            $common_exports
            $command
        "
    else
        # Fallback to direct chroot if namespace not available (maintains compatibility)
        chroot "$CHROOT_PATH" /bin/bash -c "
            $common_exports
            $command
        "
    fi
}


# --- State Check Functions ---

is_mounted() {
    # Check if a given path is a mountpoint in the isolated namespace.
    run_in_ns mountpoint "$1" 2>/dev/null | grep -q 'is a'
}

is_chroot_running() {
    # Check if the namespace holder process is running
    [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null
}

check_sysv_ipc() {
    # Check if System V IPC is enabled in the kernel
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

run_fstrim() {
    log "Running fstrim to reclaim storage space from sparse image..."

    # Try different fstrim approaches for Android compatibility
    if run_in_chroot "fstrim -v /" 2>/dev/null; then
        log "fstrim completed successfully - space should be reclaimed from sparse image"
        log "Note: You may need to wait a few minutes for Android to fully reclaim the space"
        return 0
    elif run_in_chroot "fstrim -v /proc/self/root/" 2>/dev/null; then
        log "fstrim on /proc/self/root/ completed successfully"
        log "Note: You may need to wait a few minutes for Android to fully reclaim the space"
        return 0
    else
        warn "fstrim failed or not supported on this system"
        warn "This is expected on some Android kernels that don't support discard on loop devices"
        warn "Space reclamation depends on the discard mount option for automatic operation"
        return 1
    fi
}

apply_internet_fix() {
    log "Applying internet fix for chroot..."

    # Get DNS servers from Android system
    local dns1=$(getprop net.dns1 2>/dev/null || echo '8.8.8.8')
    local dns2=$(getprop net.dns2 2>/dev/null || echo '8.8.4.4')

    # Run filesystem operations within namespace context where chroot is accessible
    run_in_ns sh -c "
        # Create resolv.conf with DNS servers
        cat > '$CHROOT_PATH/etc/resolv.conf' << EOF
nameserver $dns1
nameserver $dns2
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF
        chmod 644 '$CHROOT_PATH/etc/resolv.conf'

        # Add required groups to /etc/group
        if ! grep -q '^aid_inet:' '$CHROOT_PATH/etc/group' 2>/dev/null; then
            echo 'aid_inet:x:3003:' >> '$CHROOT_PATH/etc/group'
        fi
        if ! grep -q '^aid_net_raw:' '$CHROOT_PATH/etc/group' 2>/dev/null; then
            echo 'aid_net_raw:x:3004:' >> '$CHROOT_PATH/etc/group'
        fi

        # Create hosts file
        cat > '$CHROOT_PATH/etc/hosts' << EOF
127.0.0.1    localhost $C_HOSTNAME
::1          localhost ip6-localhost ip6-loopback
EOF

        # Set hostname
        echo '$C_HOSTNAME' > '$CHROOT_PATH/proc/sys/kernel/hostname' 2>/dev/null
    "

    # These commands must run *inside* the chroot to find the users.
    # Set flag to prevent recursion
    CHROOT_SETUP_IN_PROGRESS=1
    run_in_chroot "/usr/sbin/usermod -aG aid_inet root 2>/dev/null"
    run_in_chroot "/usr/sbin/usermod -aG aid_inet,aid_net_raw _apt 2>/dev/null"
    CHROOT_SETUP_IN_PROGRESS=0

    # This must run on the host system
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1

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

# --- REWRITTEN create_namespace ---
create_namespace() {
    local pid_file="$1"
    local unshare_flags="" # Flags for the unshare command
    local nsenter_flags="" # Flags to save for nsenter

    # Test each namespace individually and build flags dynamically
    for ns_flag in --pid --mount --uts --ipc; do
        if unshare "$ns_flag" true 2>/dev/null; then
            unshare_flags+=" $ns_flag"
        fi
    done

    # nsenter_flags should be identical to unshare_flags
    nsenter_flags="$unshare_flags"

    # Ensure we have at least mount namespace
    if ! echo "$unshare_flags" | grep -q -- "--mount"; then
        error "Mount namespace not supported - cannot create chroot"
        return 1
    fi

    log "using flags: $unshare_flags"
    
    # Save the long-form flags. _get_ns_flags will translate them later.
    echo "$nsenter_flags" > "${pid_file}.flags"

    # This is the crucial fix: Run a subshell within the new namespaces.
    # This subshell backgrounds "sleep" and then echoes the correct PID of the
    # "sleep" process, guaranteeing we target the process inside the namespaces.
    unshare $unshare_flags sh -c 'busybox sleep infinity & echo $! > "$1"' -- "$pid_file"

    # Wait a moment for the PID file to be written
    local attempts=0
    while [ $attempts -lt 10 ]; do
        if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
            return 0
        fi
        sleep 0.1
        attempts=$((attempts + 1))
    done

    error "Failed to create and capture namespace holder PID."
    rm -f "$pid_file" "${pid_file}.flags"
    return 1
}

start_chroot() {
    log "Setting up advanced chroot environment..."
    
    # Set flag to prevent recursion
    CHROOT_SETUP_IN_PROGRESS=1

    if ! check_sysv_ipc; then
        warn "System V IPC not enabled in kernel - some benchmarking tools (fio, kdiskmark) may fail"
    fi

    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        log "Namespace holder already running."
    else
        log "Creating new isolated namespace..."
        create_namespace "$HOLDER_PID_FILE" || {
            CHROOT_SETUP_IN_PROGRESS=0
            return 1
        }
        sleep 0.5
        log "Running in isolated namespace (PID: $(cat "$HOLDER_PID_FILE"))"
    fi
    
    [ -d "$CHROOT_PATH" ] || { error "Chroot directory not found at $CHROOT_PATH"; CHROOT_SETUP_IN_PROGRESS=0; exit 1; }

    if [ -f "$ROOTFS_IMG" ]; then
        log "Sparse image detected"
        if mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
            log "Sparse image already mounted, unmounting first..."
            if umount -f "$CHROOT_PATH" 2>/dev/null || umount -l "$CHROOT_PATH" 2>/dev/null; then
                log "Previous mount cleaned up"
            else
                warn "Failed to unmount previous mount, continuing anyway"
            fi
        fi
        log "Mounting sparse image to rootfs..."
        if ! run_in_ns mount -t ext4 -o loop,discard,rw,noatime,nodiratime,barrier=0 "$ROOTFS_IMG" "$CHROOT_PATH"; then
            error "Failed to mount sparse image"
            CHROOT_SETUP_IN_PROGRESS=0
            exit 1
        fi
        log "Sparse image mounted successfully"
    fi

    rm -f "$MOUNTED_FILE"

    local og_selinux_file="/data/local/ubuntu-chroot/og-selinux"
    if [ ! -f "$og_selinux_file" ]; then
        getenforce > "$og_selinux_file" 2>/dev/null && log "Stored original SELinux status" || warn "Failed to store SELinux status"
    fi
    (setenforce 0 && log "SELinux set to permissive mode") || warn "Failed to set SELinux to permissive mode"

    run_in_ns mount -o remount,suid /data 2>/dev/null && log "Remounted /data with suid" || warn "Failed to remount /data with suid"

    log "Setting up system mounts..."
    advanced_mount "proc" "$CHROOT_PATH/proc" "proc" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "sysfs" "$CHROOT_PATH/sys" "sysfs" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "/dev" "$CHROOT_PATH/dev" "bind"
    advanced_mount "devpts" "$CHROOT_PATH/dev/pts" "devpts" "-o rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"
    advanced_mount "tmpfs" "$CHROOT_PATH/tmp" "tmpfs" "-o rw,nosuid,nodev,relatime,size=100M"
    advanced_mount "tmpfs" "$CHROOT_PATH/run" "tmpfs" "-o rw,nosuid,nodev,relatime,size=50M"
    advanced_mount "tmpfs" "$CHROOT_PATH/dev/shm" "tmpfs" "-o mode=1777"

    [ -d "/config" ] && run_in_ns mount -t bind "/config" "$CHROOT_PATH/config" 2>/dev/null && log "Mounted $CHROOT_PATH/config" && echo "$CHROOT_PATH/config" >> "$MOUNTED_FILE"
    [ -d "/dev/binderfs" ] && advanced_mount "/dev/binderfs" "$CHROOT_PATH/dev/binderfs" "bind"
    [ -d "/dev/bus/usb" ] && advanced_mount "/dev/bus/usb" "$CHROOT_PATH/dev/bus/usb" "bind"

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

    sysctl -w kernel.shmmax=268435456 >/dev/null 2>&1

    if [ "$SKIP_POST_EXEC" -eq 0 ] && [ -f "$POST_EXEC_SCRIPT" ] && [ -x "$POST_EXEC_SCRIPT" ]; then
        log "Running post-execution script..."
        SCRIPT_B64=$(busybox base64 -w 0 "$POST_EXEC_SCRIPT")
        run_in_chroot "echo '$SCRIPT_B64' | base64 -d | bash"
    fi

    su -c 'dumpsys deviceidle disable' >/dev/null 2>&1 && log "Disabled Android Doze to prevent background slowdowns"

    # Clear flag after setup is complete
    CHROOT_SETUP_IN_PROGRESS=0

    log "Chroot environment setup completed successfully!"
}

stop_chroot() {
    log "Stopping chroot environment..."
    
    kill_chroot_processes
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
        local holder_pid
        holder_pid=$(cat "$HOLDER_PID_FILE")
        if kill -0 "$holder_pid" 2>/dev/null; then
            kill "$holder_pid" 2>/dev/null && log "Killed namespace holder process." || warn "Failed to kill holder process."
        fi
        rm -f "$HOLDER_PID_FILE" "$HOLDER_PID_FILE.flags"
    fi
    
    su -c 'dumpsys deviceidle enable' >/dev/null 2>&1 && log "Re-enabled Android Doze"

    log "Chroot stopped successfully."
}

umount_chroot() {
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
    
    if [ -f "$MOUNTED_FILE" ]; then
        log "Unmounting filesystems..."
        sort -r "$MOUNTED_FILE" | while read -r mount_point; do
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
        export TMPDIR='/tmp';
        export TERM='xterm';
    "

    # Load holder PID
    if [ -f "$HOLDER_PID_FILE" ]; then
        HOLDER_PID=$(cat "$HOLDER_PID_FILE")
    fi
    
    local shell_command
    if [ "$user" = "root" ]; then
        shell_command="
            $common_exports
            export HOME='/root';
            cd /root;
            exec /bin/bash --login;
        "
    else
        shell_command="
            $common_exports
            user_uid=\$(id -u '$user' 2>/dev/null)
            if [ -n \"\$user_uid\" ]; then
                mkdir -p /run/user/\$user_uid 2>/dev/null
                chown '$user':'$user' /run/user/\$user_uid 2>/dev/null
                chmod 700 /run/user/\$user_uid 2>/dev/null
            fi
            export HOME=\"/home/$user\";
            cd \"/home/$user\" 2>/dev/null || export HOME='/root';
            exec /bin/su '$user' -s /bin/bash;
        "
    fi

    # Use exec to replace the script's process with the shell inside the chroot.
    # Check if namespace holder is available, otherwise fallback to direct chroot.
    if [ -f "$HOLDER_PID_FILE" ] && kill -0 "$(cat "$HOLDER_PID_FILE")" 2>/dev/null; then
        exec _execute_in_ns chroot "$CHROOT_PATH" /bin/bash -c "$shell_command"
    else
        exec chroot "$CHROOT_PATH" /bin/bash -c "$shell_command"
    fi
}

show_status() {
    if is_chroot_running; then
        echo "Status: RUNNING"
        if [ -f "$HOLDER_PID_FILE" ]; then
            echo "Namespace Holder PID: $(cat "$HOLDER_PID_FILE")"
        fi
        if [ -f "$HOLDER_PID_FILE.flags" ]; then
            echo "Namespace Flags: $(cat "$HOLDER_PID_FILE.flags")"
        fi
    else
        echo "Status: STOPPED"
    fi
}

list_users() {
    run_in_chroot "grep -E ':x:1[0-9][0-9][0-9]:' /etc/passwd 2>/dev/null | cut -d: -f1 | head -20 | tr '\n' ',' | sed 's/,$//'"
}

run_command() {
    local command="$*"
    log "Running command in chroot: $command"
    run_in_chroot "$command"
}

backup_chroot() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        error "Backup path not specified"
        exit 1
    fi
    
    local backup_dir
    backup_dir="$(dirname "$backup_path")"
    if ! run_in_ns mkdir -p "$backup_dir"; then
        error "Failed to create backup directory: $backup_dir"
        exit 1
    fi
    
    log "Creating backup archive: $backup_path"
    stop_chroot >/dev/null 2>&1
    start_chroot >/dev/null 2>&1
    umount_chroot >/dev/null 2>&1
    sleep 1
    
    if run_in_ns busybox tar -czf "$backup_path" -C "$CHROOT_PATH" . 2>/dev/null; then
        local size
        size=$(run_in_ns du -h "$backup_path" 2>/dev/null | cut -f1)
        log "Backup created successfully: $backup_path (${size:-unknown size})"
    else
        error "Failed to create backup archive"
        exit 1
    fi
    
    stop_chroot >/dev/null 2>&1
}

resize_sparse() {
    local new_size_gb="$1"
    
    # Validate input
    if [ -z "$new_size_gb" ]; then
        error "New size not specified. Usage: $SCRIPT_NAME resize <size_in_gb>"
        echo "Example: $SCRIPT_NAME resize 16"
        exit 1
    fi
    
    if ! [ "$new_size_gb" -eq "$new_size_gb" ] 2>/dev/null || [ "$new_size_gb" -le 0 ]; then
        error "Invalid size: $new_size_gb. Must be a positive integer."
        exit 1
    fi
    
    if [ "$new_size_gb" -lt 4 ] || [ "$new_size_gb" -gt 64 ]; then
        error "Size must be between 4GB and 64GB"
        exit 1
    fi
    
    if [ ! -f "$ROOTFS_IMG" ]; then
        error "Sparse image not found at $ROOTFS_IMG"
        exit 1
    fi
    
    # Get current sizes
    local actual_size=$(du -h "$ROOTFS_IMG" 2>/dev/null | cut -f1)
    local sparse_size=$(ls -lh "$ROOTFS_IMG" 2>/dev/null | tr -s ' ' | cut -d' ' -f5)
    
    if [ -z "$actual_size" ]; then
        error "Failed to determine current size"
        exit 1
    fi
    
    # Calculate minimum safe size (actual content + 15% overhead)
    local actual_value=$(echo "$actual_size" | sed 's/[^0-9.]//g')
    local min_safe_gb
    
    if command -v awk >/dev/null 2>&1; then
        min_safe_gb=$(awk "BEGIN { printf \"%.0f\", ($actual_value * 1.15) + 0.5 }")
    else
        # Fallback: multiply by 115 and divide by 100, round up
        local int_part="${actual_value%.*}"
        min_safe_gb=$(( (int_part * 115 + 99) / 100 ))
    fi
    
    # Ensure minimum is at least current + 1GB
    local actual_int=$(echo "$actual_value" | cut -d. -f1)
    [ "$min_safe_gb" -le "$actual_int" ] && min_safe_gb=$((actual_int + 1))
    
    # Display current info
    log "Current sparse image info:"
    echo -e "  - Sparse size (Android shows): ${sparse_size}"
    echo -e "  - Actual content size: ${actual_size}"
    echo -e "  - Safe minimum size (+15%): ${min_safe_gb}G"
    echo -e "  - Requested new size: ${new_size_gb}G"
    
    # Validate minimum size
    if [ "$new_size_gb" -lt "$min_safe_gb" ]; then
        error "Cannot resize below minimum safe size of ${min_safe_gb}G"
        error "Current content: ${actual_size} + 15% overhead = ${min_safe_gb}G minimum"
        exit 1
    fi
    
    # Determine operation
    local sparse_int=$(echo "$sparse_size" | sed 's/[^0-9].*//g')
    local operation="GROWING"
    [ "$new_size_gb" -lt "$sparse_int" ] && operation="SHRINKING"
    
    # Show warnings (skip in webui mode)
    if [ "${WEBUI_MODE:-0}" -eq 0 ]; then
        warn "EXTREME WARNING: RESIZING SPARSE IMAGE"
        warn "This operation is VERY RISKY and can CORRUPT your filesystem!"
        warn "- Make a FULL BACKUP before proceeding"
        warn "- DO NOT interrupt the process"
        warn ""
        warn "Operation: $operation (${actual_size} → ${new_size_gb}G)"
        
        echo -n "Type 'YES' to confirm: "
        read -r confirm
        [ "$confirm" != "YES" ] && { log "Resize cancelled"; exit 0; }
    fi
    
    log "Starting resize operation..."
    
    # Stop and unmount
    is_chroot_running && { warn "Stopping chroot..."; stop_chroot; sleep 2; }
    
    if mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
        log "Unmounting filesystem..."
        umount -f "$CHROOT_PATH" 2>/dev/null || umount -l "$CHROOT_PATH" 2>/dev/null || {
            error "Failed to unmount filesystem"
            exit 1
        }
        sleep 1
    fi
    
    # Filesystem check
    log "Checking filesystem integrity..."
    local fsck_output=$(e2fsck -f -y "$ROOTFS_IMG" 2>&1)
    local fsck_exit=$?
    
    # Exit codes: 0=no errors, 1=corrected, 2=corrected/reboot, 4+=failed
    if [ $fsck_exit -ge 4 ]; then
        error "Filesystem check failed (exit: $fsck_exit)"
        error "Output: $fsck_output"
        exit 1
    fi
    [ $fsck_exit -ne 0 ] && log "Filesystem check corrected issues (exit: $fsck_exit)"
    
    # Resize filesystem
    log "Resizing filesystem to ${new_size_gb}G..."
    local resize_output=$(resize2fs "$ROOTFS_IMG" "${new_size_gb}G" 2>&1)
    local resize_exit=$?
    
    if [ $resize_exit -ne 0 ] && ! echo "$resize_output" | grep -q "is now.*blocks long"; then
        error "Filesystem resize failed (exit: $resize_exit)"
        error "Output: $resize_output"
        error "Restore from backup immediately"
        exit 1
    fi
    [ $resize_exit -ne 0 ] && log "Resize completed with warnings"
    
    # Truncate for shrinking
    if [ "$operation" = "SHRINKING" ]; then
        log "Truncating sparse file to ${new_size_gb}G..."
        truncate -s "${new_size_gb}G" "$ROOTFS_IMG" 2>/dev/null || {
            error "Failed to truncate file"
            exit 1
        }
    fi
    
    # Verify by test mounting
    log "Verifying filesystem integrity..."
    if mount -t ext4 -o loop,ro "$ROOTFS_IMG" "$CHROOT_PATH" 2>/dev/null; then
        umount "$CHROOT_PATH" 2>/dev/null
        log "Filesystem verification successful"
    else
        error "Failed to mount resized filesystem - possible corruption"
        error "Restore from backup immediately"
        exit 1
    fi
    
    sleep 1
    local new_sparse=$(ls -lh "$ROOTFS_IMG" 2>/dev/null | tr -s ' ' | cut -d' ' -f5)
    
    log "   ${sparse_size} → ${new_sparse} ($operation)"    
    log "✅ Resize operation completed!"
}

restore_chroot() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        error "Backup path not specified"; exit 1;
    fi
    if [ ! -f "$backup_path" ]; then
        error "Backup file does not exist: $backup_path"; exit 1;
    fi
    case "$backup_path" in
        *.tar.gz) ;;
        *) error "Backup file must have .tar.gz extension"; exit 1 ;;
    esac
    
    log "Extracting backup archive from: $backup_path"
    
    if [ "$WEBUI_MODE" -eq 0 ]; then
        if is_chroot_running; then
            log "Stopping running chroot..."; stop_chroot;
        fi
        if [ -f "$ROOTFS_IMG" ] && mountpoint -q "$CHROOT_PATH" 2>/dev/null; then
            log "Force unmounting sparse image..."
            umount -f "$CHROOT_PATH" 2>/dev/null || umount -l "$CHROOT_PATH" 2>/dev/null || {
                error "Failed to unmount sparse image"; exit 1;
            }
        fi
        if [ -f "$ROOTFS_IMG" ]; then
            log "Removing sparse image file..."; rm -f "$ROOTFS_IMG" || { error "Failed to remove sparse image file"; exit 1; };
        fi
        if [ -d "$CHROOT_PATH" ]; then
            log "Removing existing chroot directory...";
            if ! run_in_ns rm -rf "$CHROOT_PATH"; then error "Failed to remove existing chroot directory"; exit 1; fi
        fi
    fi
    
    if ! run_in_ns mkdir -p "$CHROOT_PATH"; then
        error "Failed to create rootfs directory: $CHROOT_PATH"; exit 1;
    fi
    if run_in_ns busybox tar -xzf "$backup_path" -C "$CHROOT_PATH" 2>/dev/null; then
        log "Chroot restored successfully from: $backup_path"
    else
        error "Failed to extract backup archive"; exit 1;
    fi
}

# --- Main Script Logic ---

if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root."; exit 1;
fi
if ! command -v busybox >/dev/null 2>&1; then
    error "busybox command not found. Please install busybox."; exit 1;
fi
if [ $# -eq 0 ]; then
    set -- start
fi

COMMAND=""
USER_ARG="root"
BACKUP_PATH=""
RESIZE_SIZE=""
RUN_COMMAND=""
NO_SHELL_FLAG=0
WEBUI_MODE=0

for arg in "$@"; do
    case "$arg" in
        start|stop|restart|status|umount|fstrim|backup|restore|list-users|run|resize)
            COMMAND="$arg" ;;
        --no-shell) NO_SHELL_FLAG=1 ;;
        --webui) WEBUI_MODE=1 ;;
        --skip-post-exec) SKIP_POST_EXEC=1 ;;
        -s) SILENT=1 ;;
        -h|--help) usage ;;
        -*) echo "Unknown option: $arg"; usage ;;
        *)
            if [ "$COMMAND" = "run" ]; then
                if [ -z "$RUN_COMMAND" ]; then RUN_COMMAND="$arg"; else RUN_COMMAND="$RUN_COMMAND $arg"; fi
            elif [ "$COMMAND" = "backup" ] || [ "$COMMAND" = "restore" ]; then
                BACKUP_PATH="$arg"
            elif [ "$COMMAND" = "resize" ]; then
                RESIZE_SIZE="$arg"
            else
                USER_ARG="$arg"
            fi
            ;;
    esac
done

case "$COMMAND" in
    start)
        if is_chroot_running; then log "Chroot is already running."; else start_chroot; fi
        if [ "$NO_SHELL_FLAG" -eq 0 ]; then enter_chroot "$USER_ARG"; else log "Chroot setup complete (no-shell mode). Use 'sh $0 start' to enter."; fi
        ;;
    stop) stop_chroot ;;
    restart)
        log "Restarting chroot environment..."
        stop_chroot; start_chroot
        if [ "$NO_SHELL_FLAG" -eq 0 ]; then enter_chroot "$USER_ARG"; else log "Chroot setup complete (no-shell mode). Use 'sh $0 start' to enter."; fi
        ;;
    status) show_status ;;
    umount)
        log "Umounting chroot filesystems..."; umount_chroot; log "Chroot filesystems unmounted successfully." ;;
    fstrim) run_fstrim ; stop_chroot > /dev/null 2>&1 ;;
    list-users) list_users ;;
    run)
        if [ -z "$RUN_COMMAND" ]; then error "No command specified for run"; usage; fi
        run_command "$RUN_COMMAND" ;;
    backup) backup_chroot "$BACKUP_PATH" ;;
    restore) restore_chroot "$BACKUP_PATH" ;;
    resize) 
        if [ -z "$RESIZE_SIZE" ]; then
            error "New size not specified. Usage: chroot.sh resize <size_in_gb>"
            error "Example: chroot.sh resize 16"
            exit 1
        fi
        resize_sparse "$RESIZE_SIZE" ;;
    *) error "Invalid command: $COMMAND"; usage ;;
esac
