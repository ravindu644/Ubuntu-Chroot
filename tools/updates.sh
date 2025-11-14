#!/system/bin/sh
# Ubuntu Chroot Update Definitions
# Each function defines an update that runs INSIDE the chroot with bash
# Function name format: update_v{versionCode}
# These functions are sourced by the updater script
# Must use "[UPDATER]" prefix for all echo statements

# Version 2000: Wireless networking packages
update_v2000() {
    echo "[UPDATER] Starting update v2000: Wireless networking packages"

    echo "[UPDATER] Updating package lists..."
    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    echo "[UPDATER] Installing iw, hostapd, isc-dhcp-server..."
    if apt-get install -y iw hostapd isc-dhcp-server; then
        echo "[UPDATER] Wireless packages installed successfully"
    else
        echo "[UPDATER] Failed to install wireless packages"
        return 1
    fi

    echo "[UPDATER] Cleaning up packages..."
    apt-get autoremove -y && apt-get clean

    echo "[UPDATER] Setting up bash completion..."

    # Add bash completion to root's .bashrc
    if ! grep -q 'bash_completion' /root/.bashrc 2>/dev/null; then
        echo "[UPDATER] Adding bash completion to root's .bashrc"
        cat >> /root/.bashrc << 'EOF'
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
EOF
    fi

    # Add to default user's .bashrc if exists
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            USER_BASHRC="/home/$DEFAULT_USER/.bashrc"
            if [ -f "$USER_BASHRC" ] && ! grep -q 'bash_completion' "$USER_BASHRC"; then
                echo "[UPDATER] Adding bash completion to $DEFAULT_USER's .bashrc"
                cat >> "$USER_BASHRC" << 'EOF'
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
EOF
                chown "$DEFAULT_USER:$DEFAULT_USER" "$USER_BASHRC"
            fi
        fi
    fi

    echo "[UPDATER] ✓ Update v2000 completed: Wireless networking and bash completion configured!"
}

# Version 2500: Docker and x86_64 support
update_v2500() {
    echo "[UPDATER] Starting update v2500: Docker and x86_64 support"

    echo "[UPDATER] Adding XDG environment variables..."

    cat >> /etc/environment << 'EOF'
TMPDIR=/tmp
XDG_RUNTIME_DIR=/tmp/runtime
EOF

    echo "[UPDATER] Installing Docker and QEMU..."

    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    if apt-get install -y docker.io qemu binfmt-support qemu-user-static; then
        echo "[UPDATER] Docker and QEMU installed successfully"
    else
        echo "[UPDATER] Failed to install Docker and QEMU"
        return 1
    fi

    # Configure Docker
    echo "[UPDATER] Configuring Docker daemon..."
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
    "iptables": false,
    "bridge": "none"
}
EOF

    # Add default user to docker group if exists
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            echo "[UPDATER] Adding $DEFAULT_USER to docker group..."
            usermod -aG docker "$DEFAULT_USER"
        fi
    fi

    echo "[UPDATER] Configuring x86_64 (amd64) support..."

    # Update sources.list for multiarch
    echo "[UPDATER] Updating APT sources for multiarch support..."

    rm -rf /etc/apt/sources.list && \
    rm -rf /etc/apt/sources.list.d/*

    cat > /etc/apt/sources.list << 'EOF'
# For arm64 (native architecture)
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-security main restricted universe multiverse

# For amd64 (foreign architecture)
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-backports main restricted universe multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
EOF

    echo "[UPDATER] Adding amd64 architecture..."
    if dpkg --add-architecture amd64; then
        echo "[UPDATER] amd64 architecture added successfully"
    else
        echo "[UPDATER] Failed to add amd64 architecture"
        return 1
    fi

    if apt-get update; then
        echo "[UPDATER] Sources updated successfully"
    else
        echo "[UPDATER] Failed to update sources"
        return 1
    fi

    echo "[UPDATER] Installing amd64 libraries..."
    if apt-get install -y libc6:amd64 libstdc++6:amd64 libgcc-s1:amd64; then
        echo "[UPDATER] amd64 libraries installed successfully"
    else
        echo "[UPDATER] Failed to install amd64 libraries"
        return 1
    fi

    echo "[UPDATER] Cleaning up..."
    apt-get autoremove -y && apt-get clean

    # Update post_exec.sh for binfmt-support
    if ! grep -q "binfmt-support" /data/local/ubuntu-chroot/post_exec.sh 2>/dev/null; then
        echo "[UPDATER] Updating post_exec.sh for binfmt-support..."
        cat >> /data/local/ubuntu-chroot/post_exec.sh << 'EOF'

# Start binfmt service
service binfmt-support start
EOF
    fi

    echo "[UPDATER] ✓ Update v2500 completed: Docker and x86_64 support configured!"
}

# Version 2510: VNC/Display support
update_v2510() {
    echo "[UPDATER] Starting update v2510: VNC/Display support"

    echo "[UPDATER] Updating package lists..."
    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    echo "[UPDATER] Installing dbus..."
    if apt-get install -y dbus; then
        echo "[UPDATER] dbus installed successfully"
    else
        echo "[UPDATER] Failed to install dbus"
        return 1
    fi

    echo "[UPDATER] Installing at-spi2-core..."
    if apt-get install -y at-spi2-core; then
        echo "[UPDATER] at-spi2-core installed successfully"
    else
        echo "[UPDATER] Failed to install at-spi2-core"
        return 1
    fi

    # Check if a regular user exists and create VNC startup script
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            echo "[UPDATER] Creating VNC startup script for $DEFAULT_USER..."
            mkdir -p "/home/$DEFAULT_USER/.vnc"
            cat > "/home/$DEFAULT_USER/.vnc/xstartup" << 'VNC_EOF'
#!/bin/sh
# Unset these to prevent session conflicts
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS

# Load user resources if available
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources

# Set solid background (better VNC performance than wallpaper)
xsetroot -solid grey

# Start XFCE with proper dbus session
exec dbus-launch --exit-with-session xfce4-session
VNC_EOF
            chmod +x "/home/$DEFAULT_USER/.vnc/xstartup"
            chown "$DEFAULT_USER:$DEFAULT_USER" "/home/$DEFAULT_USER/.vnc/xstartup"
            echo "[UPDATER] VNC startup script updated successfully"
        else
            echo "[UPDATER] No valid default user found for VNC setup"
        fi
    else
        echo "[UPDATER] No default user file found, skipping VNC setup"
    fi

    echo "[UPDATER] ✓ Update v2510 completed: VNC/Display support configured!"
}

# Version 2520: USB/udev support
update_v2520() {
    echo "[UPDATER] Starting update v2520: USB/udev support"

    echo "[UPDATER] Updating package lists..."
    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    echo "[UPDATER] Installing udev..."
    if apt-get install -y udev; then
        echo "[UPDATER] udev installed successfully"
    else
        echo "[UPDATER] Failed to install udev"
        return 1
    fi

    # Add udev rules for USB devices
    echo "[UPDATER] Adding udev rules for USB access..."
    cat > /etc/udev/rules.d/99-chroot.rules << 'EOF'
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", MODE="0666", GROUP="plugdev"
EOF

    # Add default user to plugdev group if exists
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            echo "[UPDATER] Adding $DEFAULT_USER to plugdev group..."
            usermod -aG plugdev "$DEFAULT_USER"
        fi
    fi

    # Update post_exec.sh for udev
    if ! grep -q "service udev" /data/local/ubuntu-chroot/post_exec.sh 2>/dev/null; then
        echo "[UPDATER] Updating post_exec.sh for udev service..."
        cat >> /data/local/ubuntu-chroot/post_exec.sh << 'EOF'

# Start udev service
service udev restart > /dev/null 2>&1 &
EOF
    fi

    echo "[UPDATER] ✓ Update v2520 completed: USB/udev support configured!"
}

update_v3200() {

    # Create udev rule for traditional wireless interface names
    if mkdir -p /etc/udev/rules.d && echo 'SUBSYSTEM=="net", ACTION=="add", ATTR{type}=="1", NAME="wlan%n"' > /etc/udev/rules.d/70-wlan.rules; then
        echo "[UPDATER] udev rule for traditional wireless interface names created successfully"
    else
        echo "[UPDATER] Failed to create udev rule for traditional wireless interface names"
        return 1
    fi

    echo "[UPDATER] ✓ Update v3200 completed: Wireless interface names configured!"
}

update_v3300() {
    if apt update && apt install -y xinit xorg xorgxrdp; then
        echo "[UPDATER] xinit, xorg, and xorgxrdp installed successfully"
    else
        echo "[UPDATER] Failed to install xinit, xorg, and xorgxrdp"
        return 1
    fi

    cat > /etc/xrdp/startwm.sh << 'EOF'
#!/bin/sh

#
# startwm.sh for chroot / non-systemd environments
# Copyright (c) 2025 ravindu644, adapted from community solutions
#

# --- 1. Clean and Prepare the Environment ---
# Unset potentially problematic variables inherited from the xrdp-sesman service.
unset DBUS_SESSION_BUS_ADDRESS
unset XDG_RUNTIME_DIR
unset SESSION_MANAGER

# Source profile scripts to get a basic user environment.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r ~/.profile ]; then
  . ~/.profile
fi

# --- 2. Manually Create XDG_RUNTIME_DIR ---
# This is the single most common point of failure. systemd-logind normally
# creates this directory. Without it, many modern applications, including
# parts of XFCE, will fail to start.
# We create it manually with the correct permissions.

XDG_RUNTIME_DIR="/run/user/$(id -u)"
if [ ! -d "$XDG_RUNTIME_DIR" ]; then
  mkdir -p "$XDG_RUNTIME_DIR"
  chown "$(id -u):$(id -g)" "$XDG_RUNTIME_DIR"
  chmod 0700 "$XDG_RUNTIME_DIR"
fi
export XDG_RUNTIME_DIR

# --- 3. Start Essential Session Services ---
# Start the system-wide D-Bus instance if it's not running.
# The --fork option is crucial for it to daemonize correctly.
if ! pgrep -x "dbus-daemon" > /dev/null; then
    dbus-daemon --system --fork
fi

# Start the PolicyKit daemon, which XFCE uses for permissions.
# Without this, the session can hang waiting for a Polkit agent.
/usr/lib/polkit-1/polkitd --no-debug &

# --- 4. Launch the Desktop Environment within its OWN D-Bus session ---
# This is the final step. We use the command that is proven to work in your
# VNC setup. The 'exec' command replaces the current script process with
# dbus-launch, ensuring a clean exit when you log out.

exec dbus-launch --exit-with-session startxfce4
EOF

    chmod +x /etc/xrdp/startwm.sh

    echo "[UPDATER] ✓ Update v3300 completed: Xorg support configured!"
}

update_v3400() {

    # Create a global script for custom aliases and functions
    ALIASES_FILE="/etc/profile.d/chroot-webui-aliases.sh"
    if [ ! -f "$ALIASES_FILE" ]; then
        echo "[UPDATER] Creating global aliases and functions script at $ALIASES_FILE"
        cat <<'EOF' > "$ALIASES_FILE"
#!/bin/sh
# Docker stuff
# List running containers (pretty)
alias dps="docker ps --format 'table {{.Names}} {{.Image}}  {{.Status}} {{.Ports}}'"

# List all containers
alias dpsa="docker ps -a --format 'table {{.Names}} {{.Image}}  {{.Status}} {{.Ports}}'"

# List all images
alias dim="docker images --format 'table {{.Repository}}    {{.Tag}}    {{.ID}} {{.Size}}'"

# Run an image interactively (with auto-remove)
alias drun="docker run -it --rm"

# Stop a container by name
alias dstop="docker stop"

# Remove a container by name
alias drm="docker rm"

# Remove an image by name or ID
alias drmi="docker rmi"

# Show logs of a container (follow)
alias dlog="docker logs -f"

# Quickly remove all stopped containers (human readable)
alias drmc="docker ps -a -q -f status=exited | xargs -r docker rm"

# Quickly remove all dangling images
alias drmid="docker images -f dangling=true -q | xargs -r docker rmi"

check_temps() {
    if [ ! -d /sys/class/thermal ]; then
        echo "Error: /sys/class/thermal not mounted or unavailable."
        return 1
    fi

    echo "==== Thermal Zone Temperatures ===="
    for zone in /sys/class/thermal/thermal_zone*; do
        # Get the type of the thermal zone
        type_file="$zone/type"
        if [ -f "$type_file" ]; then
            type=$(cat "$type_file")
        else
            type="unknown"
        fi

        # Get the temperature in millidegrees and convert to °C
        temp_file="$zone/temp"
        if [ -f "$temp_file" ]; then
            temp=$(cat "$temp_file")
            temp_c=$((temp / 1000))
            temp_milli=$((temp % 1000))
            printf "%-20s : %3d.%03d°C\n" "$type" "$temp_c" "$temp_milli"
        fi
    done
    echo "================================="
}

check_temp_rt() {
    # Make sure check_temps function exists
    if ! declare -f check_temps > /dev/null; then
        echo "Error: check_temps function not found!"
        return 1
    fi

    echo "Press Ctrl+C to stop the real-time temperature monitor."
    while true; do
        clear                # Clear previous output
        check_temps          # Call the original check_temps function
        sleep 1              # Wait 1 second
    done
}

# a simple file transfer function via ssh
# Usage: transfer /path/to/file_or_folder username@ip /path/to/save
transfer() {
    if [ $# -ne 3 ]; then
        echo "Usage: transfer /path/to/file_or_folder username@ip /path/to/save"
        return 1
    fi

    local SRC="$1"
    local DEST="$2"
    local REMOTE_PATH="$3"

    # Check if source exists
    if [ ! -e "$SRC" ]; then
        echo "Error: Source '$SRC' does not exist!"
        return 1
    fi

    # Perform the transfer recursively (works for files and folders)
    scp -r "$SRC" "$DEST":"$REMOTE_PATH"
    if [ $? -eq 0 ]; then
        echo "Transfer complete: $SRC -> $DEST:$REMOTE_PATH"
    else
        echo "Transfer failed!"
    fi
}
EOF
        chmod +x "$ALIASES_FILE"
        echo "[UPDATER] Global aliases and functions created successfully"
    else
        echo "[UPDATER] Global aliases and functions script already exists, skipping"
    fi

    echo "[UPDATER] ✓ Update v3400 completed: Aliases and functions configured!"
}

# Add your new updates below:
# update_v{VERSION}() {
#     echo "Your update description..."
#     # Regular bash commands here
#     # These run INSIDE the chroot, so just use normal commands
#     echo "✓ Done!"
# }
