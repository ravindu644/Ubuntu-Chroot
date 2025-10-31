#!/system/bin/sh

# ==============================================================================
# Advanced Chroot Management Script (Directory-Based)
# ==============================================================================

# Use environment variable if set, otherwise use default path
CHROOT_PATH="${CHROOT_PATH:-/data/local/ubuntu-chroot/rootfs}"
SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(dirname "$0")"
C_HOSTNAME="ubuntu"

log() { echo "[INFO] $1"; }
warn() { echo "[WARN] $1"; }
error() { echo "[ERROR] $1"; }

MOUNT_SUBPATHS="
proc
dev
dev/pts
tmp
run
"

if [ "$(id -u)" -ne 0 ]; then error "This script must be run as root."; exit 1; fi

usage() {
    echo "Usage: $SCRIPT_NAME [start|stop|restart|status] [USER] [--no-shell]"
    echo "  USER: Username to login as (default: root)"
    echo "  --no-shell: Setup chroot without entering interactive shell (for WebUI)"
    exit 1
}



kill_chroot_processes() {
    log "Killing all running chroot services and processes..."
    
    # NetHunter's killkali method - FAST and reliable
    # Uses lsof to find all PIDs with open files in chroot, then kills them
    local pids=$(lsof 2>/dev/null | grep "$CHROOT_PATH" | awk '{print $2}' | uniq)
    
    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null
        log "Killed chroot processes"
        return 0
    fi
    
    log "No chroot processes found"
    return 0
}

enter_chroot() {
    local user="${1:-root}"
    log "Entering chroot as user: $user"

    if [ "$user" = "root" ]; then
        # For root, direct chroot to bash with proper environment
        exec chroot "$CHROOT_PATH" /bin/bash -c "
            export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin'
            export TERM='xterm-256color'
            export HOME='/root'
            cd /root
            exec /bin/bash --login
        "
    else
        # For non-root users, use su to switch user with proper environment
        exec chroot "$CHROOT_PATH" /bin/bash -c "
            export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin'
            export TERM='xterm-256color'
            export HOME=\"/home/$user\"
            cd \"/home/$user\" 2>/dev/null || export HOME='/root'
            exec /bin/su '$user'
        "
    fi
}

apply_internet_fix() {
    log "Applying internet fix for chroot..."
    
    # Dynamic DNS from Android properties
    > "$CHROOT_PATH/etc/resolv.conf"
    for i in 1 2 3 4; do
        dns=$(getprop net.dns${i} 2>/dev/null)
        [ -z "$dns" ] && break
        echo "nameserver $dns" >> "$CHROOT_PATH/etc/resolv.conf"
    done
    # Add fallback DNS
    echo "nameserver 8.8.8.8" >> "$CHROOT_PATH/etc/resolv.conf"
    echo "nameserver 8.8.4.4" >> "$CHROOT_PATH/etc/resolv.conf"
    chmod 644 "$CHROOT_PATH/etc/resolv.conf"
    
    # Network groups
    grep -q "aid_inet" "$CHROOT_PATH/etc/group" || echo "aid_inet:x:3003:" >> "$CHROOT_PATH/etc/group"
    grep -q "aid_net_raw" "$CHROOT_PATH/etc/group" || echo "aid_net_raw:x:3004:" >> "$CHROOT_PATH/etc/group"
    if chroot "$CHROOT_PATH" id root >/dev/null 2>&1; then
        chroot "$CHROOT_PATH" /usr/sbin/usermod -aG aid_inet root 2>/dev/null
    fi
    if chroot "$CHROOT_PATH" id _apt >/dev/null 2>&1; then
        chroot "$CHROOT_PATH" /usr/sbin/usermod -aG aid_inet,aid_net_raw _apt 2>/dev/null
    fi
    
    # Network configuration
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
    echo "127.0.0.1    localhost $C_HOSTNAME" > "$CHROOT_PATH/etc/hosts"
    echo "::1          localhost ip6-localhost ip6-loopback" >> "$CHROOT_PATH/etc/hosts"
    echo "$C_HOSTNAME" > "$CHROOT_PATH/proc/sys/kernel/hostname" 2>/dev/null
    
    log "Internet fix successfully applied."
}

cleanup_mounts() {
    log "Stopping chroot..."
    
    # Kill all chroot processes first
    kill_chroot_processes
    
    # CRITICAL: Unmount storage FIRST with regular unmount (not lazy+force)
    # This prevents corrupting Android's /storage/emulated/0 FUSE mount
    local chroot_storage="$CHROOT_PATH/storage/emulated/0"
    if grep -q "$chroot_storage" /proc/mounts 2>/dev/null; then
        log "Unmounting storage safely..."
        # Try normal unmount first (3 attempts with delay)
        for i in 1 2 3; do
            if umount "$chroot_storage" 2>/dev/null; then
                log "Storage unmounted successfully"
                break
            fi
            [ $i -lt 3 ] && sleep 1
        done
        
        # If still mounted, use lazy unmount as last resort
        if grep -q "$chroot_storage" /proc/mounts 2>/dev/null; then
            warn "Storage still mounted, using lazy unmount..."
            umount -l "$chroot_storage" 2>/dev/null
        fi
    fi
    
    # Fast unmount: get all remaining chroot mounts and unmount with -lf (lazy + force)
    # Exclude storage mount as we already handled it
    log "Unmounting remaining filesystems..."
    grep "$CHROOT_PATH" /proc/mounts | awk '{print $2}' | grep -v "/storage/emulated/0" | sort -r | while read -r mount_point; do
        umount -lf "$mount_point" 2>/dev/null
    done
    
    # Verify cleanup
    if grep -q "$CHROOT_PATH" /proc/mounts 2>/dev/null; then
        warn "Some mounts still active, forcing cleanup..."
        grep "$CHROOT_PATH" /proc/mounts | awk '{print $2}' | grep -v "/storage/emulated/0" | while read -r mount_point; do
            umount -lf "$mount_point" 2>/dev/null
        done
    fi
    # Restore original SELinux status
    local og_selinux_file="/data/local/ubuntu-chroot/og-selinux"
    if [ -f "$og_selinux_file" ]; then
        local original_status="$(cat "$og_selinux_file")"
        case "$original_status" in
            Enforcing)
                (setenforce 1 && log "Restored SELinux to enforcing mode") || warn "Failed to restore SELinux to enforcing"
                ;;
            Permissive)
                (setenforce 0 && log "Restored SELinux to permissive mode") || warn "Failed to restore SELinux to permissive"
                ;;
            Disabled)
                log "SELinux was originally disabled, no restoration needed"
                ;;
            *)
                warn "Unknown SELinux status stored: $original_status"
                ;;
        esac
        rm -f "$og_selinux_file"
    fi
    
    log "Chroot stopped"
}

advanced_mount() {
    local src="$1" tgt="$2" type="$3" opts="$4"
    mkdir -p "$(dirname "$tgt")" 2>/dev/null
    [ -e "$src" ] || [ "$type" = "tmpfs" ] || [ "$type" = "devpts" ] && mkdir -p "$tgt"
    if [ "$type" = "bind" ]; then
        [ -e "$src" ] || { warn "Missing $src"; return 1; }
        mount --bind "$src" "$tgt"
    else
        mount -t "$type" $opts "$type" "$tgt"
    fi
    [ $? -eq 0 ] && log "Mounted $src -> $tgt ($type)" || error "Failed to mount $src"
}

mount_cgroup_v1() {
    local sub="$1" path="/sys/fs/cgroup/$sub"
    grep -q "^$sub" /proc/cgroups || return
    mkdir -p "$path"
    if mount -t cgroup -o rw,nosuid,nodev,noexec,relatime,$sub cgroup "$path" 2>/dev/null; then
        log "Mounted cgroup:$sub -> $path"
    else
        warn "Failed to mount cgroup:$sub"
    fi
}

setup_storage() {
    # Mount storage at /storage/emulated/0 inside chroot (exactly like NetHunter)
    # This is the ONLY safe way - don't use /sdcard at all
    local storage_path="/storage/emulated/0"
    local chroot_storage="$CHROOT_PATH/storage/emulated/0"
    
    # Check if already mounted
    if grep -q "$chroot_storage" /proc/mounts 2>/dev/null; then
        log "Storage already mounted"
        return 0
    fi
    
    if [ -d "$storage_path" ] && [ -r "$storage_path" ]; then
        log "Setting up storage access: $storage_path"
        mkdir -p "$chroot_storage"
        # Simple bind mount
        if mount -o bind "$storage_path" "$chroot_storage" 2>/dev/null; then
            log "Storage mounted at /storage/emulated/0"
        else
            warn "Storage mount failed"
        fi
    else
        warn "Android storage not found at $storage_path"
    fi
}

is_chroot_running() {
    # Fast and reliable check using mountpoint command (like NetHunter's killkali)
    # Only check /proc mount - if proc is mounted, chroot is running
    # This is the first critical mount and most reliable indicator
    mountpoint -q "$CHROOT_PATH/proc" 2>/dev/null && return 0 || return 1
}

show_status() {
    log "Checking chroot status..."
    
    if is_chroot_running; then
        log "Status: RUNNING"
        log "Active mounts:"
        grep "$CHROOT_PATH" /proc/mounts | while read -r line; do
            echo "  ✓ $line"
        done
    else
        log "Status: STOPPED"
    fi
}

start_chroot() {
    local no_shell="$1"
    log "Setting up advanced chroot..."
    [ -d "$CHROOT_PATH" ] || { error "Chroot directory not found at $CHROOT_PATH"; exit 1; }

    # Store original SELinux status before changing it
    local og_selinux_file="/data/local/ubuntu-chroot/og-selinux"
    if [ ! -f "$og_selinux_file" ]; then
        getenforce > "$og_selinux_file" 2>/dev/null && log "Stored original SELinux status" || warn "Failed to store SELinux status"
    fi

    (setenforce 0 && log "SELinux set to permissive mode") || warn "Failed to set SELinux to permissive mode"

    # Fix sudo issues when running as normal user
    mount -o remount,suid /data 2>/dev/null && log "Remounted /data with suid" || warn "Failed to remount /data with suid"

    log "Setting up system bind mounts..."

    advanced_mount "/proc" "$CHROOT_PATH/proc" "proc" "-o rw,nosuid,nodev,noexec,relatime"
    advanced_mount "/sys" "$CHROOT_PATH/sys" "bind"
    advanced_mount "/dev" "$CHROOT_PATH/dev" "bind"
    advanced_mount "devpts" "$CHROOT_PATH/dev/pts" "devpts" "-o rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000"

    [ -d "/sys/kernel/debug" ] && advanced_mount "/sys/kernel/debug" "$CHROOT_PATH/sys/kernel/debug" "bind"
    [ -d "/config" ] && advanced_mount "/config" "$CHROOT_PATH/config" "bind"
    [ -d "/sys/kernel/config" ] && advanced_mount "/sys/kernel/config" "$CHROOT_PATH/sys/kernel/config" "bind"

    # Minimal cgroup setup for Docker support
    # Only mount devices cgroup to avoid conflicts with Android
    log "Setting up minimal cgroups for Docker..."
    mkdir -p "$CHROOT_PATH/sys/fs/cgroup"
    if mount -t tmpfs -o mode=755 tmpfs "$CHROOT_PATH/sys/fs/cgroup" 2>/dev/null; then
        mkdir -p "$CHROOT_PATH/sys/fs/cgroup/devices"
        if mount -t cgroup -o devices cgroup "$CHROOT_PATH/sys/fs/cgroup/devices" 2>/dev/null; then
            log "Cgroup devices mounted successfully"
        else
            warn "Failed to mount cgroup devices"
        fi
    else
        warn "Failed to mount cgroup tmpfs"
    fi

    advanced_mount "/proc/net" "$CHROOT_PATH/proc/net" "bind"
    [ -d "/proc/bus/usb" ] && advanced_mount "/proc/bus/usb" "$CHROOT_PATH/proc/bus/usb" "bind"
    [ -d "/dev/bus/usb" ] && advanced_mount "/dev/bus/usb" "$CHROOT_PATH/dev/bus/usb" "bind"

    # FIXED: Use safer storage mounting
    setup_storage

    advanced_mount "tmpfs" "$CHROOT_PATH/tmp" "tmpfs" "-o rw,nosuid,nodev,relatime,size=100M"
    advanced_mount "tmpfs" "$CHROOT_PATH/run" "tmpfs" "-o rw,nosuid,nodev,relatime,size=50M"

    for dev in /dev/null /dev/zero /dev/random /dev/urandom /dev/tty; do [ -e "$dev" ] && chmod 666 "$dev"; done
    [ -d "/sys/class/net" ] && chmod -R 755 /sys/class/net/ 2>/dev/null

    advanced_mount "/system" "$CHROOT_PATH/system" "bind"
    advanced_mount "/dev/binderfs" "$CHROOT_PATH/dev/binderfs" "bind"
    
    apply_internet_fix

    # SET 250MB TO ALLOW POSTGRESQL
    sysctl -w kernel.shmmax=268435456

    log "Mount setup completed successfully!"
    
    # Run post-execution script if it exists
    local post_exec_script="$SCRIPT_DIR/post_exec.sh"
    if [ -f "$post_exec_script" ] && [ -x "$post_exec_script" ]; then
        log "Running post-execution script..."
        # Copy script to chroot tmp and execute it inside chroot
        cp "$post_exec_script" "$CHROOT_PATH/tmp/post_exec.sh"
        chmod +x "$CHROOT_PATH/tmp/post_exec.sh"
        chroot "$CHROOT_PATH" /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/libexec:/opt/bin && /tmp/post_exec.sh"
        rm -f "$CHROOT_PATH/tmp/post_exec.sh"
    fi
    
    # Only enter shell if not in no-shell mode (for WebUI)
    if [ "$no_shell" != "--no-shell" ]; then
        enter_chroot
    else
        log "Chroot setup complete (no-shell mode). Use 'sh $0 start' to enter."
    fi
}

case "${1:-start}" in
    start)
        # Parse arguments: start [user] [--no-shell]
        local user=""
        local no_shell=""
        shift
        
        while [ $# -gt 0 ]; do
            case "$1" in
                --no-shell)
                    no_shell="--no-shell"
                    ;;
                *)
                    # Assume it's a username if not --no-shell
                    if [ -z "$user" ]; then
                        user="$1"
                    fi
                    ;;
            esac
            shift
        done
        
        if is_chroot_running; then
            if [ "$no_shell" = "--no-shell" ]; then
                # WebUI mode - already running, do nothing
                exit 0
            else
                # Manual mode - just enter the chroot with specified user
                enter_chroot "$user"
            fi
        else
            # Not running - start it
            start_chroot "$no_shell"
        fi
        ;;
    stop) cleanup_mounts ;;
    restart)
        # Parse restart arguments: restart [user] [--no-shell]
        local restart_user=""
        local restart_no_shell=""
        shift
        
        while [ $# -gt 0 ]; do
            case "$1" in
                --no-shell)
                    restart_no_shell="--no-shell"
                    ;;
                *)
                    if [ -z "$restart_user" ]; then
                        restart_user="$1"
                    fi
                    ;;
            esac
            shift
        done
        
        cleanup_mounts
        start_chroot "$restart_no_shell"
        # After restarting, enter as the specified user (if not no-shell mode)
        if [ "$restart_no_shell" != "--no-shell" ]; then
            enter_chroot "$restart_user"
        fi
        ;;
    status) show_status ;;
    *) usage ;;
esac
